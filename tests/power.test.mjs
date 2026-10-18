import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pointInRings,powerScope,powerGeometry} from '../site/lib/power-geometry.js';
import {POWER_LAYERS,queryPowerLayer,collectPower} from '../site/lib/power-data.js';
import {normalizePower,deduplicatePower,powerHealth,powerRowIssues,powerChanges,validatePowerSnapshot} from '../site/lib/power-model.js';
import {powerExercise} from '../site/lib/power-exercise.js';
const now=Date.parse('2026-10-18T21:00:00Z');
const square=[[-120,36],[-119,36],[-119,37],[-120,37],[-120,36]];
const county={geometry:{type:'Polygon',coordinates:[square]}};
const scope=powerScope({rings:[square]});
const point={x:-119.5,y:36.5};
const pge=POWER_LAYERS.find(l=>l.kind==='pge-outage'&&!l.psps),sce=POWER_LAYERS.find(l=>l.kind==='sce-psps');
const pgeFeature={attributes:{OBJECTID:1,OUTAGE_ID:'A',OUTAGE_START:now-3600000,LAST_UPDATE:now,CURRENT_ETOR:now+3600000,EST_CUSTOMERS:12,CREW_CURRENT_STATUS:'Crew On Site'},geometry:point};
const response=data=>({ok:true,json:async()=>data});

test('power scope excludes envelope false positives and respects holes and boundary',()=>{
  const rings=[square,[[-119.8,36.2],[-119.2,36.2],[-119.2,36.8],[-119.8,36.8],[-119.8,36.2]]];
  assert.equal(pointInRings([-119.5,36.5],rings),false);
  assert.equal(pointInRings([-120,36.5],rings),true);
  const holeScope=powerScope({rings});assert.equal(holeScope.intersects(point),false);
  assert.equal(scope.intersects({x:-118.9,y:36.5}),false);
  assert.equal(scope.intersects({rings:[[[-120.5,36.4],[-118.5,36.4],[-118.5,36.6],[-120.5,36.6],[-120.5,36.4]]]}),true);
  assert.equal(scope.intersects({rings:[[[-121,35],[-118,35],[-118,38],[-121,38],[-121,35]]]}),true);
  assert.equal(holeScope.intersects({rings:[[[-119.6,36.4],[-119.4,36.4],[-119.4,36.6],[-119.6,36.6],[-119.6,36.4]]]}),false);
});
test('malformed, missing and projected power geometries fail explicitly',()=>{
  for(const g of [null,{x:NaN,y:36},{x:-119,y:36,spatialReference:{wkid:3857}},{rings:[[[0,0],[1,0],[1,1],[0,1]]]}])assert.throws(()=>powerGeometry(g));
});
test('SCE monitored/downstream are PSPS consideration, not power off or river flow',()=>{
  for(const value of ['Monitored','Downstream']){
    const row=normalizePower({attributes:{GlobalID:'g',PSPS:value},geometry:point},sce);
    assert.equal(row.status,'consideration');assert.equal(row.customers,null);assert(row.issues.some(i=>i.includes('electrical circuits')));
  }
  assert.equal(normalizePower({attributes:{GlobalID:'g',PSPS:'Monitored',PSPS_Details:'De-Energization Expected'},geometry:point},sce).status,'warning');
});
test('restoration expected remains power off, explicit re-energized is restored',()=>{
  const feature={attributes:{GlobalID:'g',PSPS:'De-Energized',PSPS_Details:'Re-Energization Expected',ERT:now-60000},geometry:point};
  const row=normalizePower(feature,sce);assert.equal(row.status,'psps');assert(powerRowIssues(row,now).some(i=>i.includes('estimate has passed')));
  feature.attributes.PSPS='Re-Energized';assert.equal(normalizePower(feature,sce).status,'restored');
});
test('PG&E notice stage and ambiguous dates are preserved without numeric guesses',()=>{
  const f={attributes:{EventID:'event',Stage:'Warning',DeEngStart:'10/19/2026 02:00 PM',TotCustAff:''},geometry:{rings:[square]}};
  const row=normalizePower(f,POWER_LAYERS[0]);assert.equal(row.status,'warning');assert.equal(row.start.time,null);assert.equal(row.start.text,f.attributes.DeEngStart);assert.equal(row.customers,null);
  f.attributes.Stage='2';assert.equal(normalizePower(f,POWER_LAYERS[0]).status,'unknown');
});
test('outage point and polygon deduplicate by utility identity, never add customers',()=>{
  const a=normalizePower(pgeFeature,pge),b=normalizePower({...pgeFeature,geometry:{rings:[square]}},pge);
  const rows=deduplicatePower([a,b,a]);assert.equal(rows.length,1);assert.equal(rows[0].customers,12);assert.equal(rows[0].geometries.length,2);
  assert.equal(rows[0].revision,deduplicatePower([b,a])[0].revision);
  b.customers=15;assert(deduplicatePower([a,b])[0].issues.some(i=>i.includes('representations differ')));
  assert.equal(deduplicatePower([a,b])[0].revision,deduplicatePower([b,a])[0].revision);
});
test('source revision changes with restoration estimate, not volatile object ID',()=>{
  const r=f=>deduplicatePower([normalizePower(f,pge)])[0].revision;
  assert.equal(r(pgeFeature),r({...pgeFeature,attributes:{...pgeFeature.attributes,OBJECTID:999}}));
  assert.notEqual(r(pgeFeature),r({...pgeFeature,attributes:{...pgeFeature.attributes,CURRENT_ETOR:now+7200000}}));
});
test('SCE current outage text does not become an assumed UTC date',()=>{
  const row=normalizePower({attributes:{IncidentId:17,Status:'ACTIVE',LastChngDateTime:'10/18/2026 01:15 PM',ERT:'Most up by 10/18/2026 04:30 PM'},geometry:point},POWER_LAYERS.find(l=>l.kind==='sce-outage'));
  assert.equal(row.updated.time,null);assert.equal(row.restoration.time,null);assert.equal(row.status,'outage');
});
test('query inventories reject truncation and apply actual county scope',async()=>{
  let calls=0;
  const fetcher=async()=>response(++calls===1?{objectIds:[1,2]}:{spatialReference:{wkid:4326},features:[pgeFeature,{...pgeFeature,attributes:{...pgeFeature.attributes,OBJECTID:2,OUTAGE_ID:'B'},geometry:{x:-118.5,y:36.5}}]});
  const result=await queryPowerLayer(pge,scope,fetcher);assert.equal(result.rows.length,1);assert.equal(result.accounting.outsideCounty,1);
  calls=0;await assert.rejects(()=>queryPowerLayer(pge,scope,async()=>response(++calls===1?{objectIds:[1]}:{features:[pgeFeature],spatialReference:{wkid:4326},exceededTransferLimit:true})),/incomplete/);
});
test('a null empty inventory requires count confirmation',async()=>{
  await assert.rejects(()=>queryPowerLayer(pge,scope,async url=>response(url.includes('returnCountOnly')?{count:1}:{objectIds:null})),/Empty utility inventory/);
});
test('a failed source retains previous data and cannot clear another utility',async()=>{
  const previous=powerExercise('watch',now);
  const result=await collectPower({county,previous,now:now+60000,only:['pge-psps'],fetchImpl:async()=>{throw new Error('Test network failure');}});
  assert.equal(result.feeds[0].rows.length,1);assert.equal(result.feeds[0].lastSuccess,previous.feeds[0].lastSuccess);assert.match(result.feeds[0].error,/Test/);
  assert.deepEqual(result.feeds[2],previous.feeds[2]);assert.match(powerHealth(result.feeds[0],now),/failed/);
});
test('fresh empty results differ from missing, stale and future retrieval stamps',()=>{
  assert.equal(powerHealth({lastSuccess:new Date(now).toISOString(),rows:[]},now),null);
  assert.match(powerHealth(null,now),/No successful/);
  assert.match(powerHealth({lastSuccess:new Date(now-3600000).toISOString()},now),/overdue/);
  assert.match(powerHealth({lastSuccess:new Date(now+3600000).toISOString()},now),/future/);
});
test('change badges deduplicate revisions and disappearance is a distinct review cue',()=>{
  let s=powerChanges(null,[{key:'A',revision:'1'}]);assert.equal(s.pending.size,1);
  s.pending.clear();s=powerChanges(s,[{key:'A',revision:'1'}]);assert.equal(s.pending.size,0);
  s=powerChanges(s,[{key:'A',revision:'2'}]);assert.equal(s.pending.size,1);
  s=powerChanges(s,[]);assert.equal(s.pending.size,0);assert(s.missing.has('A'));
  s=powerChanges(s,[]);assert.equal(s.missing.size,1);
  s=powerChanges(s,[{key:'A',revision:'2'}]);assert.equal(s.missing.size,0);assert.equal(s.pending.size,1);
});
test('exercise snapshots remain separate, validated and explicit',()=>{
  for(const scenario of ['watch','restored','failure']){const d=validatePowerSnapshot(powerExercise(scenario,now));assert.match(d.scope,/EXERCISE/);assert(d.feeds.flatMap(f=>f.rows).every(r=>r.key.includes('exercise')||r.key.includes('EXERCISE')));}
  const bad=powerExercise('watch',now);bad.feeds[0].rows[0].official='javascript:alert(1)';assert.throws(()=>validatePowerSnapshot(bad));
});
test('published power snapshot has only public configured sources and no personal account fields',async()=>{
  const text=await readFile(new URL('../site/data/power-latest.json',import.meta.url),'utf8'),data=validatePowerSnapshot(JSON.parse(text));
  assert.equal(data.feeds.length,4);assert(!/MedBaseline|SPID|blueSkyNotificationSubscription|created_user|accessToken/.test(text));
});
