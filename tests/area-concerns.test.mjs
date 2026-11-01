import test from 'node:test';
import assert from 'node:assert/strict';
import {CONFIG} from '../site/config.js';
import {planningPoints,evaluateAreas} from '../site/lib/planning-model.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {areaConcernExercise} from '../site/lib/area-concern-exercise.js';
import {validateAreaConcerns,areaWindEvidence,areaPowerEvidence,combineAreaConcerns} from '../site/lib/area-concern-model.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
const [areas,gauges,reservoirs,windInventory,associations]=await Promise.all(['river-areas.json','river-watchlist.json','reservoir-watchlist.json','wind-watchlist.json','area-concerns.json'].map(siteJson));
const points=planningPoints(areas,gauges.stations,reservoirs.stations),windSites=windInventory.sites;
const HOUR=3_600_000,now=Date.parse('2026-10-19T18:00:00Z'),lower=rs=>rs.find(r=>r.area.id==='san-joaquin-lower');
function fixture(scenario='overlap'){
  const f=planningExercise(gauges.stations,points,reservoirs,'combined',now);
  const rows=evaluateAreas({areas:areas.areas,points,gaugeEntries:f.entries,reservoirs:f.reservoirs,rain:f.rain,riverConfig:CONFIG.rivers,environmentConfig:CONFIG.environment},now);
  return {rows,points,windSites,associations,...areaConcernExercise(windSites,scenario,now)};
}
test('six explicit associations never substitute Shaver for Redinger or invent a wind trigger',()=>{
  assert.equal(validateAreaConcerns(associations,areas.areas,windSites),associations);
  assert.deepEqual(associations.areas.find(a=>a.id==='san-joaquin-upper').windPoints,[]);
  for(const mutate of [s=>s.windThresholdMph=30,s=>s.areas[0].windPoints.push('UNKNOWN'),s=>s.areas[0].windPoints.push('SJ41'),s=>s.areas[1].id=s.areas[0].id]){
    const bad=structuredClone(associations);mutate(bad);assert.throws(()=>validateAreaConcerns(bad,areas.areas,windSites));
  }
});
test('a PSPS polygon, river cue and forecast context appear once per area with exact gust timing',()=>{
  const r=lower(combineAreaConcerns(fixture(),now));
  assert.equal(r.pspsRiver,true);assert.equal(r.riverReview,true);assert.equal(r.windContext,true);assert.equal(r.power.psps.length,1);
  assert.equal(r.wind.gust.value,40);assert.equal(r.wind.gust.start,now+6*HOUR);assert.equal(r.paired[0].gust.value,40);assert.equal(r.paired[0].gust.id,'SJ41');
  assert.match(r.status,/PSPS \+ river/);assert.equal(combineAreaConcerns(fixture(),now).filter(r=>r.pspsRiver).length,1);
});
test('wind context alone, including strong gusts, does not invent a severity or deployment trigger',()=>{
  const x=fixture();x.rows=x.rows.map(r=>({...r,review:false,rank:0,status:'No current change cue'}));x.power.rows=[];
  const r=lower(combineAreaConcerns(x,now));assert.equal(r.wind.gust.value,40);assert.equal(r.review,false);assert.equal(r.pspsRiver,false);assert.equal(r.rank,0);
});
test('fixed 72 h maxima preserve short peaks, null gaps and real zero without hourly aliasing',()=>{
  const x=fixture(),s=x.wind.snapshot.sites[0];
  s.forecast.series.windGust=[{start:now,end:now+HOUR,value:0},{start:now+HOUR,end:now+HOUR+60_000,value:45},{start:now+2*HOUR,end:now+72*HOUR,value:null},{start:now+73*HOUR,end:now+74*HOUR,value:99}];
  const e=areaWindEvidence(x.wind,['SJ41'],now);assert.equal(e.gust.value,45);assert.equal(e.gust.end-e.gust.start,60_000);assert.match(e.gaps.join(' '),/missing intervals/);
  s.forecast.series.windGust=[{start:now,end:now+72*HOUR,value:0}];assert.equal(areaWindEvidence(x.wind,['SJ41'],now).gust.value,0);
});
test('stale checks, failed sites and old forecast updates cannot contribute wind maxima',()=>{
  for(const mutate of [x=>x.wind.checked=now-8*60_000,x=>x.wind.error='offline',x=>x.wind.snapshot.generatedAt=new Date(now-HOUR).toISOString(),x=>x.wind.snapshot.sites.forEach(s=>s.error='failed'),x=>x.wind.snapshot.sites.forEach(s=>s.forecast.issued=now-25*HOUR)]){
    const x=fixture();mutate(x);const r=lower(combineAreaConcerns(x,now));assert.equal(r.wind.gust,null);assert.equal(r.windContext,false);assert.equal(r.pspsRiver,true);assert.ok(r.wind.gaps.length);
  }
});
test('polygon holes, boundaries and point-only outages never become proximity matches',()=>{
  const x=fixture(),row=x.power.rows[0],p=windSites[0];
  row.geometries=[{x:p.longitude,y:p.latitude,spatialReference:{wkid:4326}}];
  let r=areaPowerEvidence(x.power,[p],now);assert.equal(r.active.length,0);assert.equal(r.pointOnly,1);
  const box=(d)=>[[p.longitude-d,p.latitude-d],[p.longitude+d,p.latitude-d],[p.longitude+d,p.latitude+d],[p.longitude-d,p.latitude+d],[p.longitude-d,p.latitude-d]];
  row.geometries=[{rings:[box(.02),box(.01)],spatialReference:{wkid:4326}}];assert.equal(areaPowerEvidence(x.power,[p],now).active.length,0);
  row.geometries[0].rings=[box(.01)];const boundary={...p,longitude:p.longitude+.01};assert.equal(areaPowerEvidence(x.power,[boundary],now).active.length,1);
  assert.equal(areaPowerEvidence(x.power,[{...p,longitude:p.longitude+.011}],now).active.length,0);
});
test('duplicate records, points and source representations do not inflate PSPS counts',()=>{
  const x=fixture();x.power.rows.push(structuredClone(x.power.rows[0]));x.power.rows[0].geometries.push(structuredClone(x.power.rows[0].geometries[0]));
  assert.equal(lower(combineAreaConcerns(x,now)).power.psps.length,1);
});
test('uncertain or ended utility status goes to verification instead of current co-location',()=>{
  for(const mutate of [x=>x.power.feeds[0].error='failed',x=>x.power.feeds[0].lastSuccess=new Date(now-HOUR).toISOString(),x=>x.power.rows[0].status='unknown',x=>x.power.rows[0].end.time=now-1,x=>x.power.rows[0].updated.time=null,x=>x.power.rows[0].updated.time=now-25*HOUR,x=>x.power.rows[0].start.time=now+11*HOUR,x=>x.power.error='snapshot failed']){
    const x=fixture();mutate(x);const r=lower(combineAreaConcerns(x,now));assert.equal(r.pspsRiver,false);assert.equal(r.power.pending.length,1);assert.equal(r.review,true);
  }
});
test('no valid PSPS dates means timing unknown, not an invented simultaneous event',()=>{
  const r=lower(combineAreaConcerns(fixture('timing'),now));assert.equal(r.pspsRiver,true);assert.equal(r.paired[0].window,null);assert.equal(r.paired[0].gust,null);assert.equal(r.power.verification.length,1);assert.match(r.gaps.join(' '),/PSPS start\/end timing unconfirmed/);
});
test('PSPS time pairing uses only wind points inside that polygon and its actual time window',()=>{
  const x=fixture();x.power.rows[0].start.time=now+HOUR;x.power.rows[0].end.time=now+2*HOUR;
  const r=lower(combineAreaConcerns(x,now));assert.equal(r.wind.gust.value,40);assert.equal(r.paired[0].gust.value,18);assert.equal(r.paired[0].gust.start,now+HOUR);
  // Polygon around a dam point without a wind sample: area context must not become a point match.
  const dam=points.find(p=>p.id==='MIL'),d=.00001;x.power.rows[0].geometries=[{rings:[[[dam.longitude-d,dam.latitude-d],[dam.longitude+d,dam.latitude-d],[dam.longitude+d,dam.latitude+d],[dam.longitude-d,dam.latitude+d],[dam.longitude-d,dam.latitude-d]]]}];
  const r2=lower(combineAreaConcerns(x,now));assert.equal(r2.pspsRiver,true);assert.equal(r2.paired[0].gust,null);
});
test('disappearance and reported restoration preserve a memory-only verification follow-up',()=>{
  const x=fixture(),first=combineAreaConcerns(x,now);
  for(const mode of ['missing','restored','moved']){
    const next=structuredClone(x);if(mode==='missing')next.power.rows=[];else if(mode==='restored')next.power.rows[0].status='restored';else next.power.rows[0].geometries=[{rings:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}];
    const result=combineAreaConcerns({...next,previous:first},now+60_000),r=lower(result);assert.equal(r.pspsRiver,false);assert.equal(r.power.followups.length,1);
    assert.equal(lower(combineAreaConcerns({...next,previous:result},now+120_000)).power.followups.length,1);
  }
});
test('outages are distinct from PSPS and a future published window beyond 72 h is context only',()=>{
  const x=fixture();x.power.rows[0].status='outage';let r=lower(combineAreaConcerns(x,now));assert.equal(r.pspsRiver,false);assert.equal(r.powerRiver,true);assert.equal(r.power.outages.length,1);
  x.power.rows[0].status='warning';x.power.rows[0].start.time=now+73*HOUR;x.power.rows[0].end.time=now+74*HOUR;r=lower(combineAreaConcerns(x,now));assert.equal(r.power.active.length,0);assert.equal(r.power.pending.length,0);
});
test('map, weather-timeline and utility filters cannot alter the fixed assessment',()=>{
  const x=fixture(),a=combineAreaConcerns(x,now),b=combineAreaConcerns({...x,selectedWeatherTime:now+HOUR,windMapVisible:false,powerFilter:'SCE',mapExtent:[0,0,1,1]},now);
  assert.deepEqual(a,b);assert.equal(a.find(r=>r.area.id==='san-joaquin-upper').wind.gust,null);
});
test('source intervals remain distinct from clipped planning windows and moved points are excluded',()=>{
  const x=fixture(),s=x.wind.snapshot.sites.find(s=>s.id==='SJ41');s.forecast.series.windGust=[{start:now-HOUR,end:now+74*HOUR,value:50}];
  let r=lower(combineAreaConcerns(x,now));assert.equal(r.wind.gust.sourceStart,now-HOUR);assert.equal(r.wind.gust.start,now);assert.equal(r.wind.gust.end,now+72*HOUR);
  s.longitude+=.1;r=lower(combineAreaConcerns(x,now));assert.notEqual(r.wind.gust.id,'SJ41');assert.match(r.wind.gaps.join(' '),/point moved/);assert.equal(r.paired[0].gust,null);
});
test('published NWS river threshold cues stay ahead of PSPS co-location queue ordering',()=>{
  const x=fixture();x.rows.find(r=>r.area.id==='james-bypass').threshold=true;
  assert.equal(combineAreaConcerns(x,now)[0].area.id,'james-bypass');
});
