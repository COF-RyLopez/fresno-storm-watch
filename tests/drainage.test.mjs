import test from 'node:test';
import assert from 'node:assert/strict';
import {DRAINAGE_LAYERS,authorizeDrainage,drainageRecord,drainageCounts} from '../site/lib/drainage-model.js';
import {readDrainageLayer,openDrainage} from '../site/lib/drainage-data.js';
import {workspaceDefaults} from '../site/lib/workspace-model.js';
const spec=DRAINAGE_LAYERS.find(l=>l.kind==='pump');
const metadata={geometryType:spec.geometry,fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},...spec.fields.map(name=>({name,type:'esriFieldTypeString'}))]};
const feature=(id=1,subtype=1)=>({attributes:{OBJECTID:id,DA:'Fictional area',SUBTYPE:subtype,MODIFIEDDATE:null},geometry:{x:-119.7,y:36.8}});
const config={enabled:true,orgId:'county',owner:'builder',groups:{viewers:'private-viewers'}};
const session=(username='viewer',groups=['private-viewers'],id='county')=>({username,portal:{id,user:{fetchGroups:async()=>groups.map(id=>({id}))}}});
function fakeCall(overrides={}){return async(suffix,p)=>{if(!suffix.endsWith('/query'))return overrides.metadata||metadata;if(p.returnIdsOnly)return overrides.inventory||{objectIds:[1]};if(p.returnCountOnly)return overrides.count||{count:0};return overrides.batch||{spatialReference:{wkid:4326},features:[feature()]};};}

test('county EOC viewer authorization rejects anonymous, other orgs and nonmembers before opening the SDK',async()=>{
  await assert.rejects(authorizeDrainage(config,null));await assert.rejects(authorizeDrainage(config,session('viewer',['private-viewers'],'other')));
  await assert.rejects(authorizeDrainage(config,session('viewer',[])));
  await authorizeDrainage(config,session());await authorizeDrainage(config,session('builder',[]));
  let loaded=false;await assert.rejects(openDrainage(config,null,async()=>{loaded=true;}));assert.equal(loaded,false);
});
test('existing, proposed and other records stay separate; no capacity or safe status is invented',()=>{
  const rows=[1,0,2,3,null,'1'].map((s,i)=>drainageRecord(spec,feature(i+1,s),'OBJECTID'));
  assert.deepEqual(rows.map(r=>r.category),['existing','proposed','other','other','other','other']);
  assert.equal(drainageCounts(rows).pumps,1);assert.equal(drainageCounts(rows).proposed,1);assert.equal(drainageCounts(rows).other,4);
  assert(rows.every(r=>r.updated===null&&!('capacity' in r)));assert(rows[0].status.includes('unconfirmed'));
  const defaults=workspaceDefaults('drainage');assert(defaults.layers.drainage&&defaults.layers.weather&&defaults.layers.roads&&defaults.layers.facilities);
  assert.equal(defaults.layers.drainageProposed,false);assert.equal(defaults.layers.drainageOther,false);assert.equal(defaults.layers.drainageCatchments,false);
});
test('bounded inventory normalizes WGS84 and reconciles every requested object ID',async()=>{
  const rows=await readDrainageLayer(spec,fakeCall());assert.equal(rows.length,1);assert.equal(rows[0].geometry.spatialReference.wkid,4326);assert.equal(rows[0].key,'fmfcd:0:1');
  const calls=[];await readDrainageLayer(spec,async(suffix,p)=>{calls.push(p);return fakeCall()(suffix,p);});
  assert.equal(calls[2].outSR,4326);assert(!calls[2].outFields.includes('CREATEDBY'));
});
test('truncation, duplicates, changing batches, wrong CRS, bad geometry and schema drift fail closed',async()=>{
  for(const overrides of [
    {inventory:{objectIds:[1,1]}},{inventory:{objectIds:[1],exceededTransferLimit:true}},
    {batch:{spatialReference:{wkid:4326},features:[]}},
    {batch:{spatialReference:{wkid:4326},features:[feature(2)]}},
    {batch:{spatialReference:{wkid:2228},features:[feature()]}},
    {batch:{spatialReference:{wkid:4326},exceededTransferLimit:true,features:[feature()]}},
    {batch:{spatialReference:{wkid:4326},features:[{...feature(),geometry:{x:6000000,y:2000000}}]}},
    {metadata:{...metadata,fields:metadata.fields.filter(f=>f.name!=='SUBTYPE')}},
    {metadata:{...metadata,geometryType:'esriGeometryPolygon'}}
  ])await assert.rejects(readDrainageLayer(spec,fakeCall(overrides)));
});
test('null ID lists require a separately confirmed empty source; null is not an all-clear',async()=>{
  assert.deepEqual(await readDrainageLayer(spec,fakeCall({inventory:{objectIds:null}})),[]);
  await assert.rejects(readDrainageLayer(spec,fakeCall({inventory:{objectIds:null},count:{count:1}})));
});
test('polygon selection retains all rings and rejects open boundaries rather than inventing an outline',()=>{
  const basin=DRAINAGE_LAYERS[0],f={attributes:{OBJECTID:5,BASIN:'Fictional basin',SUBTYPE:1},geometry:{rings:[[[-119.7,36.8],[-119.6,36.8],[-119.6,36.9],[-119.7,36.8]],[[-119.69,36.81],[-119.68,36.81],[-119.68,36.82],[-119.69,36.81]]]}};
  assert.equal(drainageRecord(basin,f,'OBJECTID').geometry.rings.length,2);
  f.geometry.rings[0].pop();assert.throws(()=>drainageRecord(basin,f,'OBJECTID'));
});
test('closed adapters and revoked EOC membership cannot read or retain new records',async()=>{
  const methods=[];const mockRequest=async(url,options)=>{methods.push(options.method);return {data:await fakeCall()(url.slice(url.indexOf('/MapServer')+10),options.query)};};
  const s=session();const source=await openDrainage(config,s,async()=>({import:async()=>[mockRequest]}));source.close();await assert.rejects(source.read());assert.equal(methods.length,0);
  const next=await openDrainage(config,s,async()=>({import:async()=>[mockRequest]}));s.portal.user.fetchGroups=async()=>[];await assert.rejects(next.read());assert.equal(methods.length,0);next.close();
});
test('complete adapters use POST only and read all three fixed layers without an editing endpoint',async()=>{
  const calls=[];
  const request=async(url,options)=>{
    calls.push({url,options});const id=Number(url.match(/MapServer\/(\d+)/)[1]),s=DRAINAGE_LAYERS.find(l=>l.id===id);
    if(!url.endsWith('/query'))return {data:{geometryType:s.geometry,fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},...s.fields.map(name=>({name,type:'esriFieldTypeString'}))]}};
    if(options.query.returnIdsOnly)return {data:{objectIds:[1]}};
    const geometry=s.kind==='pump'?{x:-119.7,y:36.8}:{rings:[[[-119.7,36.8],[-119.6,36.8],[-119.6,36.9],[-119.7,36.8]]]};
    return {data:{spatialReference:{wkid:4326},features:[{attributes:{OBJECTID:1,SUBTYPE:1,BASIN:'Fictional',DA:'Fictional',DRAINAGE:'Fictional'},geometry}]}};
  };
  const source=await openDrainage(config,session(),async()=>({import:async()=>[request]}));
  const primary=await source.read();assert.equal(primary.length,2);assert(primary.every(r=>r.kind!=='catchment'));assert(calls.every(c=>!c.url.includes('/16')));
  const rows=await source.read({includeBoundaries:true});assert.equal(rows.length,3);assert.deepEqual(drainageCounts(rows),{basins:1,pumps:1,proposed:0,other:0,catchments:1});
  assert.equal(calls.find(c=>c.url.includes('/16/query')&&c.options.query.objectIds).options.query.maxAllowableOffset,0.00002);
  assert(calls.every(c=>c.options.method==='post'&&c.options.cacheBust&&c.options.signal));assert(calls.every(c=>!/applyEdits|addFeatures|updateFeatures|deleteFeatures/.test(c.url)));source.close();
});
test('disconnect aborts an outstanding request and ignores its late response',async()=>{
  let resolveRequest,signal,started;const ready=new Promise(resolve=>{started=resolve;});
  const request=async(url,options)=>{signal=options.signal;started();return new Promise(resolve=>{resolveRequest=resolve;});};
  const source=await openDrainage(config,session(),async()=>({import:async()=>[request]}));const read=source.read();await ready;source.close();assert.equal(signal.aborted,true);resolveRequest({data:metadata});await assert.rejects(read);
});
