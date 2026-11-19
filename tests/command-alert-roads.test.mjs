import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandSearch} from '../site/lib/command-search.js';
import {nwsGuidance} from '../site/lib/command-alert-guidance.js';
const routes=nwsGuidance({description:'State Routes 41 and 99.'}).corridors;
test('NWS-cited routes load only bounded exact county road geometry and retain missing matches',async()=>{
 const requests=[];
 const search=createCommandSearch({base:new URL('https://county.example/search/'),fetcher:async(url)=>{
  requests.push(String(url));
  const data=String(url).endsWith('index.json')?{generatedAt:'2026-10-20T12:00:00Z',entries:[{key:'sr41',kind:'street',name:'CA-41 HWY',shard:'ab.json'}]}
   : {sr41:{paths:[[[-119.8,36.8],[-119.7,36.9]]],spatialReference:{wkid:4326}}};
  return {ok:true,json:async()=>data};
 }});
 const result=await search.citedCorridors(routes,{signal:new AbortController().signal});
 assert.equal(result.records.length,1);
 assert.equal(result.records[0].route.label,'SR 41');
 assert.deepEqual(result.records[0].record.features[0].geometry.coordinates,[[[-119.8,36.8],[-119.7,36.9]]]);
 assert.deepEqual(result.unmapped.map(r=>r.label),['SR 99']);
 assert.equal(result.limited,false);
 assert.ok(requests.every(url=>!url.includes('waterbodies')));
});
test('failed geometry and cancellation cannot be presented as mapped roads',async()=>{
 const search=createCommandSearch({base:new URL('https://county.example/search/'),fetcher:async(url)=>String(url).endsWith('index.json')
  ? {ok:true,json:async()=>({entries:[{key:'road',kind:'street',name:'CA-41 HWY',shard:'ab.json'}]})}
  : {ok:false,status:503}});
 const result=await search.citedCorridors(routes,{signal:new AbortController().signal});
 assert.equal(result.records.length,0);assert.equal(result.failures.length,1);
 assert.deepEqual(result.incomplete.map(r=>r.label),['SR 41']);
 const controller=new AbortController();controller.abort();
 await assert.rejects(search.citedCorridors(routes,{signal:controller.signal}),error=>error.name==='AbortError');
});
test('the reference loading limit labels skipped routes incomplete',async()=>{
 const entries=Array.from({length:25},(_,i)=>({key:String(i),kind:'street',name:i===24?'SR-99 HWY':'SR-41 HWY',shard:'ab.json'}));
 const shard=Object.fromEntries(entries.map(e=>[e.key,{paths:[[[-119.8,36.8],[-119.7,36.9]]],spatialReference:{wkid:4326}}]));
 const search=createCommandSearch({base:new URL('https://county.example/search/'),fetcher:async(url)=>({ok:true,json:async()=>String(url).endsWith('index.json')?{entries}:shard})});
 const result=await search.citedCorridors(routes);
 assert.equal(result.records.length,24);
 assert.equal(result.limited,true);
 assert.deepEqual(result.incomplete.map(r=>r.label),['SR 99']);
});
