import test from 'node:test';
import assert from 'node:assert/strict';
import {drainageReviewGroups,drainageVicinity,assessDrainageReviews,drainageRoadTiming,freezeDrainageReview,DRAINAGE_RAIN_BOUNDS} from '../site/lib/drainage-review-model.js';
import {drainageReviewExercise} from '../site/lib/drainage-review-exercise.js';
import {fetchDrainageRain} from '../site/lib/drainage-review-data.js';
import {nearbyEntries} from '../site/lib/nearby-search.js';
const now=Date.parse('2026-10-24T06:00:00Z'),config={qpfMaxAgeMs:86400000,weatherCheckMaxAgeMs:420000};
const fake=()=>drainageReviewExercise(now);
const lookup=(shape,entries,options)=>nearbyEntries(shape,entries,{...options,distance:async()=>0,yieldTask:async()=>{}});
async function input(){const data=fake(),groups=drainageReviewGroups(data.snapshot.rows),vicinity=await drainageVicinity(groups,data.roads,data.facilities,lookup);return {...data,groups,vicinity,config};}

test('source-code groups exclude proposed / other assets and do not double count repeated records',()=>{
  const {snapshot}=fake(),rows=[...snapshot.rows,snapshot.rows[0],{...snapshot.rows[1],key:'other',category:'other'}];
  const groups=drainageReviewGroups(rows);assert.equal(groups.length,1);assert.equal(groups[0].records.length,2);
  const copy={...snapshot.rows[1],key:'no-code',code:null};assert.equal(drainageReviewGroups([...rows,copy]).length,2);
  assert.throws(()=>drainageReviewGroups([...rows,{...snapshot.rows[0],name:'Changed'}]),/Conflicting/);
});
test('complete geometry joins deduplicate road/facility matches across a basin and pump; inactive history is excluded',async()=>{
  const data=fake();data.roads.snapshot.rows.push({...data.roads.snapshot.rows[0],key:'inactive',active:'no'});
  delete data.roads.snapshot.rows[0].geometry.spatialReference;
  const groups=drainageReviewGroups(data.snapshot.rows),seen=[];
  const result=await drainageVicinity(groups,data.roads,data.facilities,async(shape,entries,options)=>{seen.push(shape);return lookup(shape,entries,options);});
  assert.equal(result.get(groups[0].id).roads.length,1);assert.equal(result.get(groups[0].id).facilities.length,1);
  assert(seen.some(s=>s.rings));assert(seen.some(s=>Number.isFinite(s.x)));assert.equal(result.get(groups[0].id).geometryIncomplete,false);
});
test('canceled joins ignore late results instead of reintroducing private groups',async()=>{
  const data=fake(),groups=drainageReviewGroups(data.snapshot.rows);let current=true;
  const result=await drainageVicinity(groups,data.roads,data.facilities,async(...args)=>{const v=await lookup(...args);current=false;return v;},()=>current);
  assert.equal(result,null);
});
test('rainfall with nearby records is a readiness review, not a modeled impact; elapsed active roads stay unverified',async()=>{
  const rows=assessDrainageReviews(await input(),now),r=rows[0];
  assert.equal(rows.length,1);assert(r.review&&r.combined&&r.rainfall);assert.equal(r.maximum,.5);
  assert.equal(r.roads.length,1);assert(r.roads[0].verification);assert.match(r.roads[0].timing,/do not overlap/);
  assert.equal(r.facilities[0].record.site.backup,null);assert(!('riskScore' in r));assert(!('floodDepth' in r));
  assert.match(r.nextReview,/confirm FMFCD/);
});
test('rainfall holes, valid zero and absent polygons remain distinct',async()=>{
  const data=await input();data.rain.features[0].value=0;
  let r=assessDrainageReviews(data,now)[0];assert.equal(r.maximum,0);assert.equal(r.rainfall,false);
  data.rain.features=[];r=assessDrainageReviews(data,now)[0];assert.equal(r.maximum,null);assert(r.gaps.some(g=>g.includes('amount unknown')));
  const {geometry}=data.snapshot.rows[0];const ring=geometry.rings[0],hole=ring.map(([x,y])=>[x,y]);
  data.rain.features=[{value:1,geometry:{rings:[[[-120,36],[-119,36],[-119,37],[-120,37],[-120,36]],hole],spatialReference:{wkid:4326}}}];
  data.groups=[{...data.groups[0],records:[data.snapshot.rows[1]]}];r=assessDrainageReviews(data,now)[0];assert.equal(r.maximum,null);
});
test('failed / stale rainfall, inventory, roads and facility data cannot become a complete current cue',async()=>{
  const data=await input();data.rain.error='WPC failed';let r=assessDrainageReviews(data,now)[0];assert.equal(r.maximum,null);assert.equal(r.combined,false);assert(r.gaps.includes('WPC failed'));
  data.rain.error=null;data.snapshot.checked=now-700000;data.roads.error='Service failed';data.facilities.sourceGaps=1;
  r=assessDrainageReviews(data,now)[0];assert.equal(r.inventoryCurrent,false);assert.equal(r.rainfall,false);assert.equal(r.roadCurrent,false);assert(r.gaps.length>=3);
  data.rain.cycle.end=now-1;r=assessDrainageReviews(data,now)[0];assert.equal(r.rainCurrent,false);assert.equal(r.maximum,null);
});
test('road time overlap is interval-based, with missing and reversed dates explicitly unknown',()=>{
  const cycle={start:100,end:200};assert.match(drainageRoadTiming({start:50,end:150},cycle),/^Published dates overlap/);
  assert.match(drainageRoadTiming({start:0,end:100},cycle),/do not overlap/);
  for(const row of [{start:null,end:200},{start:300,end:100}])assert.match(drainageRoadTiming(row,cycle),/unknown/);
});
test('briefing snapshots freeze source times and uncertainty; no geometries or display filters enter the assessment',async()=>{
  const data=await input(),row=assessDrainageReviews(data,now)[0],captured=freezeDrainageReview(row,now);
  row.records[0].name='Later edit';row.facilities[0].record.site.name='Later facility edit';
  assert.equal(captured.facilities[0].name,'Fictional county operations facility');assert(!JSON.stringify(captured).includes('"geometry":'));
  assert.equal(captured.inventory.retrieved,now);assert.equal(captured.rainfall.cycle.start,now+3600000);assert.match(captured.note,/not flood exposure/);
  assert(!('mapExtent' in data));assert(!('displayFilter' in data));
});

const attrs={objectid:1,qpf:.5,units:'Inches',product:'72-hour QPF',issue_time:'2026-10-24 00:00:00',start_time:'2026-10-24 00:00:00',end_time:'2026-10-27 00:00:00'};
const polygon={rings:[[[-120,36],[-119,36],[-119,37],[-120,37],[-120,36]]]};
function fetcher({inventory,batch}={}){const calls=[];const run=async(url,options)=>{calls.push({u:new URL(url),options});const p=new URL(url).searchParams;let d=p.get('returnIdsOnly')==='true'?inventory||{objectIds:[1]}:p.has('objectIds')?batch||{spatialReference:{wkid:4326},features:[{attributes:attrs,geometry:polygon}]}:{features:[{attributes:attrs}]};return {ok:true,json:async()=>d,text:async()=>JSON.stringify(d)};};return {run,calls};}
test('regional rainfall requests use a fixed public extent and no credentials, reconcile source IDs and clip locally',async()=>{
  const f=fetcher();let clips=0;const r=await fetchDrainageRain({fetchImpl:f.run,clock:()=>now,clip:async g=>{clips++;return g;}});
  assert.equal(r.features[0].value,.5);assert.equal(clips,1);
  const query=f.calls.find(c=>c.u.searchParams.has('geometry'));assert.equal(query.u.searchParams.get('geometry'),DRAINAGE_RAIN_BOUNDS.join(','));
  assert(f.calls.every(c=>c.options.credentials==='omit'&&!c.u.href.includes('token=')));
  assert.equal(f.calls.filter(c=>c.u.searchParams.has('geometry')).length,1);
});
test('rainfall schema, cycle, CRS and ID-accounting errors fail closed',async()=>{
  for(const overrides of [{inventory:{objectIds:null}},{inventory:{objectIds:[1,1]}},{batch:{spatialReference:{wkid:2228},features:[{attributes:attrs,geometry:polygon}]}},{batch:{spatialReference:{wkid:4326},features:[]}},{batch:{spatialReference:{wkid:4326},exceededTransferLimit:true,features:[{attributes:attrs,geometry:polygon}]}},{batch:{spatialReference:{wkid:4326},features:[{attributes:{...attrs,objectid:2},geometry:polygon}]}},{batch:{spatialReference:{wkid:4326},features:[{attributes:{...attrs,issue_time:'2026-10-24 01:00:00'},geometry:polygon}]}}]){
    const f=fetcher(overrides);await assert.rejects(fetchDrainageRain({fetchImpl:f.run,clock:()=>now,clip:async g=>g}));
  }
});
