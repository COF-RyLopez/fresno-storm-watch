import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePumpCopy,verifyStagedCopy,readPumpCopy,samePumpAssociation,pumpCopyLayer,COPY_TAG} from '../site/lib/pump-copy-model.js';
import {authorizePumpCopyAdmin,verifyCopyAccess,advancePumpCopy} from '../site/lib/pump-copy-admin.js';
import {copyUrl,openPumpCopy} from '../site/lib/pump-copy-data.js';
import {drainageRecord,DRAINAGE_LAYERS} from '../site/lib/drainage-model.js';
import {pumpFormCurrent} from '../site/lib/pump-form-model.js';
const now=Date.now(),spec=DRAINAGE_LAYERS.find(s=>s.kind==='pump'),id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const row=(oid,subtype=1)=>drainageRecord(spec,{attributes:{OBJECTID:oid,DA:'FICTIONAL-'+oid,SUBTYPE:subtype,MODIFIEDDATE:now-60000},geometry:{x:-119.7-oid/100000,y:36.8}},'OBJECTID');
const rows=[row(150),row(151),row(152,0),row(153,2)];
const snapshot=()=>preparePumpCopy(rows,now,id);
const hosted=features=>features.map((f,i)=>({...f,attributes:{...f.attributes,OBJECTID:i+1000},geometry:{x:0,y:0,spatialReference:{wkid:3857}}}));
test('copy preserves original pump association despite different hosted IDs/projection; proposed pumps remain separate',async()=>{
  const s=await snapshot();assert.equal(s.total,4);assert.equal(s.counts.pumps,2);assert.equal(s.counts.proposed,1);assert.equal(s.counts.other,1);
  await verifyStagedCopy(hosted(s.features),s);
  const copy=readPumpCopy(hosted(s.features.filter(f=>f.attributes.source_subtype===1)),now);assert.equal(copy.total,4);assert.equal(copy.rows.length,2);assert.equal(copy.sourceChecked,now);
  for(let i=0;i<copy.rows.length;i++)assert(samePumpAssociation(rows[i],copy.rows[i]));
  assert.equal(copy.rows[0].key,'fmfcd:0:150');assert.equal(copy.rows[0].geometry.x,rows[0].geometry.x);
});
test('corrupt, partial, duplicated and mixed generations fail closed',async()=>{
  const s=await snapshot(),f=hosted(s.features),existing=f.slice(0,2);
  await assert.rejects(verifyStagedCopy(f.slice(1),s),/count/);
  await assert.rejects(verifyStagedCopy(f.map((v,i)=>i? v:{...v,attributes:{...v.attributes,source_x:-119}}),s),/content/);
  await assert.rejects(preparePumpCopy([...rows,rows[0]],now,id),/duplicate/);
  for(const bad of [existing.slice(1),[existing[0],existing[0]],[existing[0],{...existing[1],attributes:{...existing[1].attributes,snapshot_id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'}}],f])assert.throws(()=>readPumpCopy(bad,now));
});
test('source-copy freshness and query freshness are distinct save requirements',()=>{
  const inventory={connected:true,rows,checked:now,sourceChecked:now-6*86400000,maxSourceAgeMs:7*86400000};assert(pumpFormCurrent(rows[0],inventory,now));
  for(const extra of [{sourceChecked:now-8*86400000},{sourceChecked:null},{sourceChecked:now+61000},{maxSourceAgeMs:0},{checked:now-600001}])assert.equal(pumpFormCurrent(rows[0],{...inventory,...extra},now),false);
});
test('maintenance is restricted to the existing county owner; parent stays private and form service Query-only',()=>{
  const c={enabled:true,environment:'exercise',orgId:'county',owner:'owner'},s={username:'owner',portal:{id:'county'}};authorizePumpCopyAdmin(c,s);
  for(const other of [{...s,username:'operator'},{...s,portal:{id:'elsewhere'}},null])assert.throws(()=>authorizePumpCopyAdmin(c,other));
  const item={owner:'owner',type:'Feature Service',tags:[COPY_TAG],access:'private'};
  verifyCopyAccess(item,{isView:false,capabilities:'Query,Create,Editing'},{owner:'owner',isView:false});
  assert.throws(()=>verifyCopyAccess({...item,access:'shared'},{isView:false,capabilities:'Query,Create'},{owner:'owner',isView:false}));
  assert.throws(()=>verifyCopyAccess(item,{isView:true,capabilities:'Query,Update'},{owner:'owner',isView:true}));
  assert.throws(()=>verifyCopyAccess({...item,access:'public'},{isView:true,capabilities:'Query'},{owner:'owner',isView:true}));
  assert.throws(()=>copyUrl('https://elsewhere.example/FeatureServer/0','county'));
});
function service(s,{breakBatch=false,loseReceipt=false}={}){
  let records=[],filter='1=0',next=1,switched=0;const calls=[];
  const parent='https://services3.arcgis.com/county/arcgis/rest/services/parent/FeatureServer',view=parent.replace('/parent/','/view/');
  const call=async(url,p={})=>{calls.push({url,p});if(url.endsWith('/addFeatures')){const features=JSON.parse(p.features);if(breakBatch){breakBatch=false;throw Error('connection lost');}const added=features.map(f=>({...f,attributes:{...f.attributes,OBJECTID:next++}}));records.push(...added);if(loseReceipt){loseReceipt=false;throw Error('receipt lost');}return {addResults:added.map(f=>({success:true,objectId:f.attributes.OBJECTID}))};}
    if(url.endsWith('/updateDefinition')){switched++;filter=JSON.parse(p.updateDefinition).viewDefinitionQuery;return {success:true};}
    if(!url.endsWith('/query'))return {...pumpCopyLayer(),viewDefinitionQuery:filter};
    const source=url.includes('/view/')?(filter==='1=0'?[]:records.filter(f=>f.attributes.source_subtype===1)):records;
    if(p.returnIdsOnly)return {objectIds:source.map(f=>f.attributes.OBJECTID)};
    if(p.returnCountOnly)return {count:source.length};
    return {features:source.filter(f=>p.objectIds.split(',').map(Number).includes(f.attributes.OBJECTID))};
  };
  return {call,parent,view,calls,get switched(){return switched;},records:()=>records};
}
test('interrupted upload does not switch the view; same-generation retry and repeated request do not duplicate source rows',async()=>{
  const s=await snapshot(),api=service(s,{breakBatch:true}),args={call:api.call,parentUrl:api.parent,viewUrl:api.view,snapshot:s};
  await assert.rejects(advancePumpCopy(args),/connection lost/);assert.equal(api.switched,0);
  const copy=await advancePumpCopy(args);assert.equal(copy.rows.length,2);assert.equal(api.records().length,4);
  await advancePumpCopy(args);assert.equal(api.records().length,4);assert.equal(api.calls.filter(c=>c.url.endsWith('/addFeatures')).length,2);
});
test('lost upload receipt reconciles staged keys without uploading the accepted rows again',async()=>{
  const s=await snapshot(),api=service(s,{loseReceipt:true}),args={call:api.call,parentUrl:api.parent,viewUrl:api.view,snapshot:s};await assert.rejects(advancePumpCopy(args),/receipt lost/);assert.equal(api.switched,0);assert.equal(api.records().length,4);await advancePumpCopy(args);assert.equal(api.records().length,4);assert.equal(api.calls.filter(c=>c.url.endsWith('/addFeatures')).length,1);
});
test('content verification failure and an older source check cannot replace a verified view',async()=>{
  const s=await snapshot(),api=service(s);const call=async(url,p)=>{const r=await api.call(url,p);if(url.includes('/parent/')&&r.features?.length)return {features:r.features.map((f,i)=>i?f:{...f,attributes:{...f.attributes,source_x:-119}})};return r;};
  await assert.rejects(advancePumpCopy({call,parentUrl:api.parent,viewUrl:api.view,snapshot:s}),/content/);assert.equal(api.switched,0);
  const newer=await preparePumpCopy(rows,now+1000,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),clean=service(newer);await advancePumpCopy({call:clean.call,parentUrl:clean.parent,viewUrl:clean.view,snapshot:newer});const switches=clean.switched;
  await assert.rejects(advancePumpCopy({call:clean.call,parentUrl:clean.parent,viewUrl:clean.view,snapshot:s}),/newer/);assert.equal(clean.switched,switches);
});
test('AGOL form reader uses only the configured county view; no Enterprise request or editing',async()=>{
  const s=await snapshot(),f=hosted(s.features.slice(0,2)),calls=[],eoc={enabled:true,orgId:'county',owner:'owner'},session={username:'owner',portal:{id:'county',user:{fetchGroups:async()=>[]}},getToken:async()=>'synthetic-token'},config={enabled:true,readItemId:'a'.repeat(32),readUrl:'https://services3.arcgis.com/county/arcgis/rest/services/pumps_read/FeatureServer/0',maxSourceAgeMs:7*86400000};
  const request=async(url,o)=>{calls.push({url,o});return {data:!url.endsWith('/0')&&!url.endsWith('/query')?{serviceItemId:config.readItemId,isView:true,capabilities:'Query'}:url.endsWith('/0')?pumpCopyLayer():o.query.returnIdsOnly?{objectIds:[1000,1001]}:{features:f}};};
  const a=await openPumpCopy(config,eoc,session,async()=>({import:async()=>[request]}));const copy=await a.read();assert.equal(copy.rows.length,2);assert(calls.every(c=>(c.url.startsWith('https://services3.arcgis.com/county/')||c.url===`https://cofgisonline.maps.arcgis.com/sharing/rest/content/items/${config.readItemId}/data`)&&c.o.method==='post'&&!c.url.includes('token')));assert(calls.every(c=>!c.url.includes('Enterprise')&&!c.url.includes('addFeatures')));a.close();await assert.rejects(a.read());
});
