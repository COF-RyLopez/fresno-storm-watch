import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../site/config.js';
import { planningPoints,qpfPointValue,releaseEvidence,evaluateAreas,positiveChange } from '../site/lib/planning-model.js';
import { planningExercise } from '../site/lib/planning-exercise.js';
import { fetchPlanningRain } from '../site/lib/planning-data.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
const areas=await siteJson('river-areas.json'),watch=await siteJson('river-watchlist.json'),reservoirs=await siteJson('reservoir-watchlist.json');
const points=planningPoints(areas,watch.stations,reservoirs.stations);
const now=Date.parse('2026-10-17T22:00:00Z'),HOUR=3600000;
const input=(scenario='combined')=>{const f=planningExercise(watch.stations,points,reservoirs,scenario,now);return {areas:areas.areas,points,gaugeEntries:f.entries,reservoirs:f.reservoirs,rain:f.rain,riverConfig:CONFIG.rivers,environmentConfig:CONFIG.environment};};
const lower=rows=>rows.find(r=>r.area.id==='san-joaquin-lower');
const cycle={issue:Date.parse('2026-10-17T21:00:00Z'),start:Date.parse('2026-10-18T00:00:00Z'),end:Date.parse('2026-10-21T00:00:00Z'),hours:72,product:'QPF72hr'};
const feature=qpf=>({attributes:{qpf,units:'Inches',product:'QPF72hr',issue_time:'2026-10-17 21:00:00',start_time:'2026-10-18 00:00:00',end_time:'2026-10-21 00:00:00'}});

test('fixed six-area inventory uses all nine gauges and two dam sampling points',()=>{
  assert.equal(points.length,11);assert.equal(new Set(areas.areas.flatMap(a=>a.gauges)).size,9);
  assert.equal(areas.areas.find(a=>a.id==='kings-lower').gauges.length,0);
  assert.equal(areas.areas.find(a=>a.id==='kings-upper').releases.length,0);
  const bad=structuredClone(areas);bad.areas[0].releases[0].metric='outflow';
  assert.throws(()=>planningPoints(bad,watch.stations,reservoirs.stations),/Unverified/);
});
test('point sampling preserves unknown and zero; overlapping labels are explicit',()=>{
  assert.equal(qpfPointValue({features:[]},cycle,now).value,null);
  assert.equal(qpfPointValue({features:[feature(0)]},cycle,now).value,0);
  const result=qpfPointValue({features:[feature(0.25),feature(0.5)]},cycle,now);
  assert.equal(result.value,0.5);assert.deepEqual(result.labels,[0.25,0.5]);assert.match(result.reason,/Highest/);
});
test('point forecast rejects invalid amounts, transfer limits and changing cycles',()=>{
  for(const qpf of [null,'',-1,-9999])assert.throws(()=>qpfPointValue({features:[feature(qpf)]},cycle,now));
  assert.throws(()=>qpfPointValue({features:[],exceededTransferLimit:true},cycle,now));
  const changed=feature(1);changed.attributes.issue_time='2026-10-17 21:30:00';
  assert.throws(()=>qpfPointValue({features:[changed]},cycle,now),/changed cycle/);
});
test('rain, observed rise and release increase produce one area review with all evidence',()=>{
  const rows=evaluateAreas(input(),now),r=lower(rows);
  assert.equal(rows.filter(a=>a.review).length,1);assert.equal(r.rank,3);assert.equal(r.rising.length,1);assert.equal(r.higher.length,1);assert.equal(r.increased.length,1);assert.equal(r.rainfall.maximum,1.25);
  assert.equal(r.increased[0].delta,200);assert.equal(r.increased[0].hours,24);assert.match(r.status,/Rain \+ river/);
});
test('published NWS threshold outranks contextual changes without inventing county thresholds',()=>{
  const r=lower(evaluateAreas(input('threshold'),now));assert.equal(r.rank,4);assert.equal(r.threshold,true);assert.ok(r.gauges.some(g=>g.assessment.crossings.length));
});
test('rain alone is monitor, never a prepositioning instruction',()=>{
  const x=input('baseline');x.rain.points.MIL.value=3;
  const r=lower(evaluateAreas(x,now));assert.equal(r.rank,2);assert.equal(r.review,false);
});
test('stale and missing sources cannot produce active change cues or false zeros',()=>{
  for(const scenario of ['stale','missing']){
    const rows=evaluateAreas(input(scenario),now);assert.ok(rows.every(r=>!r.review));assert.ok(rows.every(r=>r.gaps.length));
    assert.ok(rows.every(r=>r.rainfall.samples.every(p=>p.value===null)));
  }
});
test('current gauge rise remains reviewable when rainfall fails',()=>{
  const x=input();x.rain.error='Service failed';const r=lower(evaluateAreas(x,now));
  assert.equal(r.review,true);assert.equal(r.rainfall.maximum,null);assert.equal(r.status,'River change — review');
});
test('expired rainfall and stale browser checks invalidate point amounts',()=>{
  for(const change of [x=>x.rain.cycle.end=now-1,x=>x.rain.checked=now-8*60000,x=>x.rain.cycle.issue=now-25*HOUR]){
    const x=input('baseline');x.rain.points.MIL.value=1;change(x);assert.equal(lower(evaluateAreas(x,now)).rainfall.maximum,null);
  }
});
test('missing newer release record blocks increase while retaining dated last valid evidence',()=>{
  const x=input(),s=x.reservoirs.snapshot.stations[0].metrics.release;
  s.latest={...s.latest,time:now,value:null};
  const r=releaseEvidence({...x.reservoirs,config:CONFIG.environment},{station:'MIL',metric:'release'},now);
  assert.equal(r.increasing,false);assert.equal(r.sample.value,600);assert.match(r.reason,/missing/);
});
test('release comparisons reject gaps, identity changes and failed collection',()=>{
  for(const mutate of [x=>x.reservoirs.snapshot.stations[0].metrics.release.samples.at(-2).value=null,x=>x.reservoirs.snapshot.stations[0].metrics.release.samples.at(-2).time-=24*HOUR,x=>x.reservoirs.snapshot.stations[0].metrics.release.sensor=23,x=>x.reservoirs.error='failed',x=>x.reservoirs.checked=now-8*60000]){
    const x=input();mutate(x);const r=releaseEvidence({...x.reservoirs,config:CONFIG.environment},{station:'MIL',metric:'release'},now);assert.equal(r.increasing,false);assert.equal(r.delta,null);
  }
});
test('valid zero release and unchanged release are not increase cues',()=>{
  const x=input('baseline');const r=releaseEvidence({...x.reservoirs,config:CONFIG.environment},{station:'MIL',metric:'spill'},now);
  assert.equal(r.sample.value,0);assert.equal(r.delta,0);assert.equal(r.increasing,false);
});
test('positive differences use display precision without a rapid-rise category',()=>{
  assert.equal(positiveChange(0.004,'ft'),false);assert.equal(positiveChange(0.006,'ft'),true);assert.equal(positiveChange(0.0006,'kcfs'),true);assert.equal(positiveChange(null,'ft'),false);assert.equal(positiveChange(-1,'ft'),false);
});
test('changing unrelated UI horizon does not alter the fixed 72-hour planning assessment',()=>{
  const x=input('baseline');const g=x.gaugeEntries.get('SJXC1').gauge;g.forecast.points.at(-2).value=13;
  const r=lower(evaluateAreas({...x,uiHorizonHours:24},now));assert.equal(r.threshold,true);assert.ok(r.gauges.find(g=>g.id==='SJXC1').assessment.peak.time>now+24*HOUR);
});
test('point collector bounds concurrency, uses explicit CRS, and isolates one failed point',async()=>{
  let active=0,max=0,calls=[];
  const fetcher=async url=>{
    const u=new URL(url);calls.push(u);active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;
    const point=u.searchParams.get('geometry');
    if(point&&JSON.parse(point).x===points[0].longitude)return {ok:false,status:503};
    return {ok:true,json:async()=>({features:[feature(0.5)]})};
  };
  const data=await fetchPlanningRain(points,fetcher,()=>now);assert.ok(max<=3);assert.equal(calls.length,12);assert.equal(Object.keys(data.points).length,11);assert.equal(data.points[points[0].id].value,null);
  assert.equal(calls[1].searchParams.get('inSR'),'4326');assert.equal(calls[1].searchParams.get('geometryType'),'esriGeometryPoint');assert.equal(data.cycle.hours,72);
});
