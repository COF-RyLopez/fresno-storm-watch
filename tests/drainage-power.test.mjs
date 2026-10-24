import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDrainagePumpPower,drainagePowerTiming,freezeDrainagePumpPower} from '../site/lib/drainage-power-model.js';
import {drainageReviewExercise} from '../site/lib/drainage-review-exercise.js';
import {powerScope} from '../site/lib/power-geometry.js';
import {assessDrainageReviews,drainageReviewGroups,freezeDrainageReview} from '../site/lib/drainage-review-model.js';
const now=Date.parse('2026-10-24T18:00:00Z'),hour=3600000;
function fixture(){const d=drainageReviewExercise(now);return {records:d.snapshot.rows,state:d.power,contours:d.rain.features.map(f=>({...f,scope:powerScope(f.geometry)})),cycle:d.rain.cycle,rainCurrent:true,inventoryCurrent:true};}
const assess=input=>assessDrainagePumpPower(input,now),first=input=>[...assess(input).values()][0];
const ring=(x,y,d)=>[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]];

test('only existing FMFCD pump records get exact utility-area and backup reviews; duplicate records count once',()=>{
  const f=fixture();f.records.push(f.records[1]);const rows=assess(f);assert.equal(rows.size,1);
  const p=[...rows.values()][0];assert(p.review&&p.powerRain);assert.equal(p.reviews.length,1);assert.equal(p.backup,null);
  assert.equal(p.reviews[0].row.utility,'PG&E');assert.equal(p.reviews[0].timing.relation,'overlap');
  assert.match(p.nextReview,/generator compatibility/);assert(!('powerLost' in p));
});
test('polygon holes and outside points do not become pump matches; polygon boundary is included',()=>{
  const f=fixture(),g=f.records[1].geometry,row=f.state.rows[0];
  row.geometries=[{rings:[ring(g.x,g.y,.02),ring(g.x,g.y,.01)],spatialReference:{wkid:4326}}];
  assert.equal(first(f).review,false);
  row.geometries=[{rings:[ring(g.x,g.y,.01)],spatialReference:{wkid:4326}}];
  f.records[1].geometry.x=g.x+.01;assert(first(f).review);
  f.records[1].geometry.x=g.x+.011;assert.equal(first(f).review,false);
});
test('nearby or colocated point-only outages cannot establish pump service coverage',()=>{
  const f=fixture();f.state.rows[0].geometries=[structuredClone(f.records[1].geometry)];
  const p=first(f);assert.equal(p.review,false);assert.equal(p.evidence.pointOnly,1);assert.equal(p.reviews.length,0);
});
test('SCE polygons use their own source health and retain unknown restoration timing at the pump',()=>{
  const f=fixture(),shape=structuredClone(f.state.rows[0].geometries);
  f.state.rows=f.state.rows.filter(r=>r.utility==='SCE');f.state.rows[0].geometries=shape;
  let p=first(f);assert(p.review&&p.powerRain);assert.equal(p.reviews[0].row.status,'psps');assert.equal(p.reviews[0].row.utility,'SCE');assert.equal(p.reviews[0].timing.relation,'unknown');
  f.state.feeds.find(s=>s.id==='sce-psps').error='SCE unavailable';p=first(f);assert(p.review);assert.equal(p.powerRain,false);assert.match(p.reviews[0].problem,/failed/);
});
test('utility revisions and multiple representations do not inflate pump or utility counts; outages remain distinct from PSPS',()=>{
  const f=fixture(),row=f.state.rows[0];row.geometries.push(structuredClone(row.geometries[0]));f.state.rows.push(structuredClone(row));
  assert.equal(first(f).reviews.length,1);
  f.state.rows.push({...structuredClone(row),key:'fictional:outage',kind:'pge-outage',status:'outage',revision:'outage-1'});
  const p=first(f);assert.equal(p.reviews.length,2);assert.equal(p.evidence.psps.length,1);assert.equal(p.evidence.outages.length,1);
});
test('rainfall elsewhere in a basin cannot become rainfall at its pump; missing and zero amounts stay distinct',()=>{
  const f=fixture(),g=f.records[1].geometry;
  f.contours=[{value:1,scope:powerScope({rings:[ring(g.x+.1,g.y,.01)]})}];
  let p=first(f);assert(p.review);assert.equal(p.maximum,null);assert.equal(p.powerRain,false);
  f.contours=[{value:0,scope:powerScope({rings:[ring(g.x,g.y,.01)]})}];p=first(f);assert.equal(p.maximum,0);assert.equal(p.powerRain,false);
});
test('utility interval comparisons preserve before / overlap / after / unknown and ignore restoration estimates',()=>{
  const f=fixture(),m=first(f).reviews[0],cycle=f.cycle;
  m.row.start.time=cycle.start-2*hour;m.row.end.time=cycle.start;assert.equal(drainagePowerTiming(m,cycle,true).relation,'before');
  m.row.start.time=cycle.end;m.row.end.time=cycle.end+hour;assert.equal(drainagePowerTiming(m,cycle,true).relation,'after');
  m.row.start.time=cycle.start;m.row.end.time=cycle.start+hour;assert.equal(drainagePowerTiming(m,cycle,true).relation,'overlap');
  m.row.end.time=null;m.row.restoration.time=cycle.start-1;assert.equal(drainagePowerTiming(m,cycle,true).relation,'unknown');
  assert.equal(drainagePowerTiming(m,cycle,false).relation,'unknown');
});
test('failed, stale, ambiguous and old utility records stay verification evidence rather than current combined cues',()=>{
  for(const mutate of [f=>f.state.error='offline',f=>f.state.feeds[0].error='failed',f=>f.state.feeds[0].lastSuccess=new Date(now-hour).toISOString(),f=>f.state.rows[0].updated.time=null,f=>f.state.rows[0].updated.time=now-25*hour,f=>f.state.rows[0].status='unknown',f=>f.state.rows[0].end.time=now-1]){
    const f=fixture();mutate(f);const p=first(f);assert(p.review);assert.equal(p.powerRain,false);assert.equal(p.evidence.active.length,0);assert(p.reviews[0].problem);
  }
  const f=fixture();f.rainCurrent=false;assert.equal(first(f).powerRain,false);assert.equal(first(f).maximum,null);
  f.rainCurrent=true;f.inventoryCurrent=false;assert.equal(first(f).powerRain,false);
});
test('disappearance and utility-reported restoration retain a memory-only follow-up until owner verification',()=>{
  const f=fixture();f.previous=assess(f);f.state.rows=[];
  let p=first(f);assert(p.review);assert(p.reviews[0].followup);assert.equal(p.reviews[0].returned,false);assert.equal(p.powerRain,false);
  const restored=fixture();restored.previous=f.previous;restored.state.rows[0].status='cancelled';restored.state.rows[0].revision='cancelled-2';
  p=first(restored);assert(p.review);assert(p.reviews[0].followup);assert.equal(p.reviews[0].timing.relation,'ended');assert.equal(p.powerRain,false);
  assert.equal(p.reviews[0].row.revision,'cancelled-2');assert.equal(p.reviews[0].row.status,'cancelled');assert(p.reviews[0].previousRevision);
});
test('missing or contradictory pump CRS cannot silently create a utility-area match',()=>{
  const f=fixture();delete f.records[1].geometry.spatialReference;assert.throws(()=>first(f),/CRS/);
  f.records[1].geometry.spatialReference={wkid:2228};assert.throws(()=>first(f),/CRS/);
});
test('moving a pump invalidates prior location matches; a fresh session cannot inherit another session follow-up',()=>{
  const f=fixture();f.previous=assess(f);f.state.rows=[];f.records[1].geometry.x-=.1;
  assert.equal(first(f).review,false);f.previous=new Map();assert.equal(first(f).review,false);
});
test('a later published utility window is separate context, not a current pump-power review',()=>{
  const f=fixture();f.state.rows[0].start.time=now+74*hour;f.state.rows[0].end.time=now+76*hour;
  const p=first(f);assert.equal(p.review,false);assert.equal(p.powerRain,false);assert.equal(p.reviews.length,1);assert(p.reviews[0].outside);assert.equal(p.reviews[0].timing.relation,'after');
});
test('private briefing capture freezes source revisions, timing and unknown backup without coordinates or utility polygons',()=>{
  const f=fixture(),p=first(f),frozen=freezeDrainagePumpPower([p]);
  p.reviews[0].row.name='Later edit';p.reviews[0].row.start.time=now+99*hour;
  assert.notEqual(frozen[0].utility[0].name,'Later edit');assert.equal(frozen[0].utility[0].start.time,now+hour);assert.equal(frozen[0].backup,null);
  assert.equal(frozen[0].utility[0].timing.relation,'overlap');
  for(const forbidden of ['"geometry"','"geometries"','"location"','"rings"','"longitude"'])assert(!JSON.stringify(frozen).includes(forbidden));
});
test('Area Watch combines pump reviews, preserves nearby-road and facility evidence, and deduplicates per source record',()=>{
  const f=drainageReviewExercise(now),groups=drainageReviewGroups(f.snapshot.rows);
  const rows=assessDrainageReviews({...f,groups,vicinity:new Map(),config:{qpfMaxAgeMs:86400000,weatherCheckMaxAgeMs:420000}},now);
  assert.equal(rows.length,1);assert(rows[0].powerRain&&rows[0].review);assert.equal(rows[0].pumpPower.length,1);
  assert.match(rows[0].change,/backup readiness/);assert.equal(freezeDrainageReview(rows[0],now).pumpPower[0].backup,null);
});
