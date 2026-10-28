import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeSandbags,validateSandbagSnapshot,sandbagHealth,sandbagContext,sandbagHours,sandbagSearchEntries,SANDBAG_SOURCE,SANDBAG_APP,SANDBAG_CONFIG} from '../site/lib/county-sandbag-model.js';
import {collectSandbags} from '../site/lib/county-sandbag-data.js';
const now=Date.parse('2026-10-28T23:00:00Z'),at=new Date(now).toISOString();
const county={geometry:{type:'Polygon',coordinates:[[[-121,36],[-119,36],[-119,38],[-121,38],[-121,36]]]}};
const f=(id=1,active='Yes',geometry={x:-120,y:36.7})=>({attributes:{fid:id,active,rdyard_nm:'AUBERRY YARD',rdyard_add:'33148 AUBERRY RD',rdyard_a_1:'AUBERRY CA 93602',modifiedda:1568073600000},geometry});
const normalized=()=>normalizeSandbags([f(),f(2,null),f(3,'No'),f(4,'Yes',null)],{wkid:4326},county);
const snapshot=()=>({schemaVersion:1,countyGeoid:'06019',source:SANDBAG_SOURCE,app:SANDBAG_APP,generatedAt:at,lastAttempt:at,lastSuccess:at,error:null,...normalized()});
const response=d=>({ok:true,text:async()=>JSON.stringify(d)});

test('county active, unknown, inactive and missing geometry reconcile independently',()=>{
  const d=normalized();assert.deepEqual(d.accounting,{read:4,active:2,unknown:1,inactive:1,mapped:3,unmapped:1});assert.equal(d.rows[3].geometry,null);assert.match(d.rows[3].locationIssue,/no coordinates/);assert.equal(d.rows[0].edited,1568073600000);assert.equal(d.rows[0].maintained,null);
});
test('invalid IDs and geometry CRS fail closed, while outside-county points remain address-only',()=>{
  assert.throws(()=>normalizeSandbags([f(),f()],{wkid:4326},county));assert.throws(()=>normalizeSandbags([f('1')],{wkid:4326},county));assert.throws(()=>normalizeSandbags([f()],{wkid:3857},county));assert.throws(()=>normalizeSandbags([f(1,'Yes',{x:-120,y:36.7,spatialReference:{wkid:3857}})],{wkid:4326},county));
  const outside=normalizeSandbags([f(1,'Yes',{x:-118,y:36.7})],{wkid:4326},county);assert.equal(outside.rows[0].geometry,null);assert.match(outside.rows[0].locationIssue,/outside Fresno/);assert.equal(outside.accounting.read,1);
});
test('unrecognized source status is unknown and neither active flags nor edited dates become stock confirmation',()=>{
  const d=normalizeSandbags([f(1,'maybe'),f(2,' Yes ')],{wkid:4326},county);assert.equal(d.rows[0].state,'unknown');assert.equal(d.rows[1].state,'active');assert(!Object.hasOwn(d.rows[1],'stock'));assert(!Object.hasOwn(d.rows[1],'inspection'));
});
test('snapshot validation rejects mismatched accounting, identity, source and future collection times',()=>{
  assert.equal(validateSandbagSnapshot(snapshot(),now).accounting.read,4);
  for(const d of [{...snapshot(),accounting:{...snapshot().accounting,read:5}},{...snapshot(),source:'https://example.com'}, {...snapshot(),generatedAt:new Date(now+300000).toISOString()},{...snapshot(),generatedAt:null},{...snapshot(),rows:[snapshot().rows[0],snapshot().rows[0]]}])assert.throws(()=>validateSandbagSnapshot(d,now));
});
test('a fresh collection does not refresh old record dates; failures and expired snapshots are not current',()=>{
  assert.equal(sandbagHealth(snapshot(),now).current,true);assert.equal(snapshot().rows[0].edited,1568073600000);
  assert.equal(sandbagHealth(snapshot(),now+46*60000).current,false);assert.equal(sandbagHealth({...snapshot(),error:'Failed'},now).current,false);assert.equal(sandbagHealth(null,now).current,false);
});
test('default context excludes unknown/inactive, preserves unmapped active addresses and cannot spatially associate them',()=>{
  const planning={points:[{id:'g',name:'Gauge',longitude:-120,latitude:36.72}],rows:[{area:{id:'reach',name:'River',rainPoints:['g']},status:'Monitor',rainfall:{usable:false}}]};
  const roads={snapshot:{checked:now,rows:[{key:'road',revision:'one',active:'yes',name:'Bridge road',issues:['End date elapsed; reopening not confirmed'],end:now-1,geometry:{paths:[[[-120,36.6],[-120,36.8]]]}}]}};
  const all=sandbagContext(snapshot(),planning,roads,{},now);assert.equal(all.rows.length,2);assert.equal(all.rows.find(r=>r.site.id===1).areas.length,1);assert.equal(all.rows.find(r=>r.site.id===1).roads[0].verification,true);assert.equal(all.rows.find(r=>r.site.id===4).areas.length,0);
  const reach=sandbagContext(snapshot(),planning,roads,{areaId:'reach'},now);assert.equal(reach.rows.length,1);assert.equal(reach.unmappedInFilter,1);assert.equal(sandbagContext(snapshot(),planning,roads,{filter:'unknown'},now).rows.length,1);assert.equal(sandbagContext(snapshot(),planning,roads,{query:'not here'},now).rows.length,0);
});
test('yard-hour exceptions attach only to the exact published yard/address, and search includes address-only records with qualifications',()=>{
  assert.equal(sandbagHours(normalized().rows[0]),'7:00 AM–3:00 PM');assert.equal(sandbagHours({...normalized().rows[0],address:'New address'}),null);assert.equal(sandbagHours({name:'Coalinga Fire Dept',address:'300 W ELM'}),null);
  const rows=sandbagSearchEntries(snapshot());assert.equal(rows.length,4);assert.equal(rows[3].geometry,null);assert(rows[0].aliases.includes('33148 AUBERRY RD'));assert.match(rows[0].reference,/require confirmation/);assert.equal(rows[2].history,true);
});

function service({fail=false,omit=false,change=false,duplicate=false,exceeded=false}={}){let ids=0;const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options});if(fail)throw new Error('Unavailable');if(url===SANDBAG_CONFIG)return response({subtitle:'Last Updated: 01/31/2024'});const p=new URL(url).searchParams;if(p.has('returnIdsOnly'))return response({objectIds:change&&++ids>1?[1]:[1,2]});if(p.has('objectIds'))return response({spatialReference:{wkid:4326},features:omit?[f()]:duplicate?[f(),f()]:[f(),f(2,'Yes',null)],exceededTransferLimit:exceeded});throw new Error('Unexpected source request');}};}
test('collector uses public allowlisted fields, reconciles IDs and retains the county app date separately',async()=>{
  const api=service(),d=await collectSandbags({county,fetchImpl:api.fetchImpl,now});assert.equal(d.error,null);assert.equal(d.accounting.read,2);assert.equal(d.accounting.unmapped,1);assert.equal(d.appSubtitle,'Last Updated: 01/31/2024');assert.equal(d.lastSuccess,at);
  for(const c of api.calls){assert.equal(c.options.credentials,'omit');assert(!/token=|createdby|modifiedby|outFields=\*/i.test(c.url));}assert.equal(api.calls.filter(c=>c.url.includes('returnIdsOnly')).length,2);
});
test('incomplete, duplicated, truncated and changing publisher results retain last success with a visible error',async()=>{
  for(const settings of [{omit:true},{duplicate:true},{exceeded:true},{change:true},{fail:true}]){const api=service(settings),d=await collectSandbags({county,previous:snapshot(),fetchImpl:api.fetchImpl,now:now+100000});assert(d.error);assert.equal(d.lastSuccess,at);assert.deepEqual(d.rows,snapshot().rows);assert.equal(sandbagHealth(d,now+100000).current,false);}
});
test('an initial source failure is unavailable, not an empty confirmed county inventory',async()=>{
  const api=service({fail:true}),d=await collectSandbags({county,fetchImpl:api.fetchImpl,now});assert(d.error);assert.equal(d.lastSuccess,null);assert.equal(d.rows.length,0);
});
test('prepared public snapshot contains no private editor names and reconciles all source records',async()=>{
  const bytes=await readFile(new URL('../site/data/county-sandbags-latest.json',import.meta.url),'utf8'),d=validateSandbagSnapshot(JSON.parse(bytes));assert(!/createdby|modifiedby|access_token|password/i.test(bytes));assert.equal(d.accounting.read,d.accounting.active+d.accounting.unknown+d.accounting.inactive);assert.equal(d.accounting.read,d.accounting.mapped+d.accounting.unmapped);
});
