import test from 'node:test';
import assert from 'node:assert/strict';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
import {CONFIG} from '../site/config.js';
import {planningPoints,evaluateAreas} from '../site/lib/planning-model.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {concernSummary,freezeConcern} from '../site/lib/mission-model.js';
import {commandQueue} from '../site/lib/command-queue-model.js';
const areas=await siteJson('river-areas.json'),watch=await siteJson('river-watchlist.json'),selection=await siteJson('reservoir-watchlist.json');
const points=planningPoints(areas,watch.stations,selection.stations),now=Date.parse('2026-11-14T18:00:00Z');
const input=()=>{const f=planningExercise(watch.stations,points,selection,'baseline',now);return {areas:areas.areas,points,gaugeEntries:f.entries,reservoirs:f.reservoirs,rain:f.rain,riverConfig:CONFIG.rivers,environmentConfig:CONFIG.environment};};
function rise(x,id){const s=x.reservoirs.snapshot.stations.find(s=>s.id===id).metrics.elevation;s.samples.at(-2).value=s.lastValid.value-0.12;return s;}
const area=(x,id='san-joaquin-lower')=>evaluateAreas(x,now).find(r=>r.area.id===id);

test('rain and rising pool create one area review, not a release or threshold claim',()=>{
 const x=input();rise(x,'MIL');x.rain.points.MIL.value=1.25;const r=area(x);
 assert.equal(r.pools.length,1);assert.equal(r.poolRising.length,1);assert.equal(r.review,true);assert.equal(r.threshold,false);assert.equal(r.increased.length,0);
 assert.match(r.status,/Rain \+ rising pool/);assert.equal(commandQueue({rivers:[r]}).length,1);
 assert.match(concernSummary(r).change,/MIL pool \+0.12 ft/);assert.match(concernSummary(r).change,/1.25 in/);
});
test('pool rise alone monitors, and falling pool never clears a rising downstream gauge',()=>{
 const x=input();rise(x,'MIL');assert.equal(area(x).review,false);assert.match(area(x).status,/Pool rising/);
 const s=x.reservoirs.snapshot.stations[0].metrics.elevation;s.samples.at(-2).value=s.lastValid.value+1;
 const g=x.gaugeEntries.get('SJXC1').gauge;g.observed.points.forEach((p,i,a)=>p.value=10-(a.length-1-i)*0.1);
 assert.equal(area(x).review,true);assert.equal(area(x).poolRising.length,0);assert.equal(area(x).pools[0].delta,-1);
});
test('failed collection, changed units, gaps and partial daily reports cannot cue pool rise',()=>{
 for(const mutate of [x=>x.reservoirs.error='offline',x=>x.reservoirs.snapshot.stations[0].metrics.elevation.units='M',x=>x.reservoirs.snapshot.stations[0].metrics.elevation.samples.at(-2).value=null,x=>{const s=x.reservoirs.snapshot.stations[0].metrics.elevation;s.lastValid.time=now-3600000;}]){
  const x=input();rise(x,'MIL');x.rain.points.MIL.value=2;mutate(x);const r=area(x);assert.equal(r.poolRising.length,0);assert.equal(r.review,false);assert.ok(r.gaps.some(g=>g.includes('Pool elevation')));
 }
});
test('Pine Flat pool remains in downstream Kings group with missing downstream telemetry explicit',()=>{
 const x=input();rise(x,'PNF');x.rain.points.PNF.value=0.5;const r=area(x,'kings-lower');assert.equal(r.review,true);assert.equal(r.pools[0].station,'PNF');assert.equal(r.gauges.length,1);assert.equal(r.gauges[0].id,'PFQC1');assert.equal(r.gauges[0].assessment.current,false);assert.ok(r.gaps.some(g=>g.includes('farther-downstream')));
 assert.equal(area(x,'kings-upper').pools.length,0);assert.equal(area(x,'little-dry').pools.length,0);
});
test('briefing captures reservoir evidence and rainfall times without later mutation',()=>{
 const x=input();rise(x,'MIL');const r=area(x),f=freezeConcern(r,null,now);
 assert.equal(f.reservoirEvidence.pools[0].sample.units,'FEET');assert.equal(f.rainfallEvidence.cycle.start,now);assert.match(f.reservoirEvidence.connection,/travel time/i);
 r.pools[0].sample.value=999;assert.notEqual(f.reservoirEvidence.pools[0].sample.value,999);
 assert.equal(f.reservoirEvidence.travelTime,null);assert.equal(f.reservoirEvidence.routingVerified,false);
});
test('HADS near-dam rise joins Kings review and briefing; failed or overdue checks cannot cue a rise',()=>{
 const x=input();x.reservoirs.snapshot.telemetry={PFQC1:{id:'PFQC1',pe:'HG',units:'ft',error:null,lastSuccess:new Date(now-10*60000).toISOString(),points:[{time:now-3*3600000,value:1},{time:now-30*60000,value:1.4}]}};
 let r=area(x,'kings-lower');assert.equal(r.rising[0].id,'PFQC1');assert.equal(r.threshold,false);assert.equal(r.review,true);assert.equal(freezeConcern(r,null,now).gaugeEvidence[0].observed.value,1.4);
 x.reservoirs.snapshot.telemetry.PFQC1.error='Source unavailable';r=area(x,'kings-lower');assert.equal(r.rising.length,0);assert.equal(r.gauges[0].assessment.current,false);
 x.reservoirs.snapshot.telemetry.PFQC1.error=null;x.reservoirs.snapshot.telemetry.PFQC1.lastSuccess=new Date(now-3600000).toISOString();assert.equal(area(x,'kings-lower').gauges[0].assessment.current,false);
});
test('Pine Flat pool backup is labeled and retains primary source gap rather than changing stale thresholds',()=>{
 const x=input(),s=x.reservoirs.snapshot.stations.find(s=>s.id==='PNF').metrics.elevation;
 s.samples=[{time:now-4*3600000,value:755.5,units:'FEET',flag:''}];s.lastValid=s.latest=s.samples[0];
 x.reservoirs.snapshot.telemetry={PFTC1:{id:'PFTC1',pe:'HP',units:'ft',lastSuccess:new Date(now).toISOString(),points:[{time:now-4*3600000,value:755.5},{time:now-2*3600000,value:755.6},{time:now-3600000,value:755.7}]}};
 const r=area(x,'kings-lower'),p=r.pools[0];assert.equal(p.backup,true);assert.equal(p.current,true);assert.match(p.publisher,/provisional/);assert.match(p.primaryReason,/Old/);assert.equal(s.lastValid.value,755.5);assert.ok(p.source.includes('PFTC1'));
 x.reservoirs.snapshot.telemetry.PFTC1.points[0].value=750;assert.equal(area(x,'kings-lower').pools[0].current,false);
});
