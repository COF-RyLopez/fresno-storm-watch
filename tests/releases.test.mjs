import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduledRecords,scheduleEvidence,releaseSource} from '../site/lib/release-model.js';
import {collectScheduledReleases} from '../scripts/collect-reservoirs.mjs';
import {CONFIG} from '../site/config.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {planningPoints,evaluateAreas} from '../site/lib/planning-model.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
const now=Date.parse('2026-10-18T16:00:00Z'),HOUR=3600000,DAY=24*HOUR;
// Fictional schedules exercise both future increases and decreases; these are never live data.
const row=(hours,value,changes={})=>({stationId:'MIL',SENSOR_NUM:7,durCode:'E',units:'CFS',dataFlag:' ',obsDate:new Date(now+hours*HOUR-8*HOUR).toISOString().slice(0,16).replace('T',' '),value,...changes});
const fixture=(rows=[row(-48,400),row(6,650),row(18,300)])=>({selection:{stations:[{id:'MIL',name:'Millerton'}]},snapshot:{generatedAt:new Date(now).toISOString(),stations:[{id:'MIL',error:null,scheduled:{...scheduledRecords(rows,'MIL',now),lastSuccess:new Date(now).toISOString(),lastAttempt:new Date(now).toISOString(),error:null}}]},checked:now,config:CONFIG.environment});

test('future schedules retain effective times, stable IDs, revisions and no invented issuance',()=>{
  const a=scheduledRecords([row(6,650),row(6,650),row(-48,400)],'MIL',now);
  assert.equal(a.records.length,2);assert.equal(a.accounting.duplicates,1);assert.equal(a.records[1].time,now+6*HOUR);assert.equal(a.records[1].issued,null);
  const b=scheduledRecords([row(6,700)],'MIL',now);
  assert.equal(a.records[1].key,b.records[0].key);assert.notEqual(a.records[1].revision,b.records[0].revision);
  assert.deepEqual(a,scheduledRecords([row(-48,400),row(6,650),row(6,650)],'MIL',now));
});
test('CDEC event JSON fixed PST matches the release page daylight-time label',()=>{
  const r=scheduledRecords([row(0,390,{obsDate:'2026-10-16 13:00'})],'MIL',now).records[0];
  assert.equal(r.time,Date.parse('2026-10-16T21:00:00Z'));
  assert.match(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit'}).format(r.time),/2:00/);
});
test('schedule increase and decrease compare prior schedules, never measured outflow',()=>{
  const input=fixture();input.snapshot.stations[0].metrics={outflow:{lastValid:{value:9999}}};
  const s=scheduleEvidence(input,'MIL',now);
  assert.equal(s.current,true);assert.equal(s.upcoming.length,2);assert.deepEqual(s.cues.map(n=>n.delta),[250,-350]);assert.equal(s.cues[1].direction,'Scheduled decrease');
});
test('a corrected comparison baseline revises the cue without changing its stable notice key',()=>{
  const a=scheduleEvidence(fixture([row(-48,400),row(6,650)]),'MIL',now).cues[0];
  const b=scheduleEvidence(fixture([row(-48,450),row(6,650)]),'MIL',now).cues[0];
  assert.equal(a.key,b.key);assert.notEqual(a.revision,b.revision);assert.equal(b.delta,200);
});
test('scheduled changes remain usable during a measured-observation failure',()=>{
  const input=fixture();input.snapshot.stations[0].error='Observation failed';
  assert.equal(scheduleEvidence(input,'MIL',now).cues.length,2);
});
test('unknown previous schedule and zero releases are preserved, unchanged repetitions do not inflate cues',()=>{
  const s=scheduleEvidence(fixture([row(2,0),row(3,0)]),'MIL',now);
  assert.equal(s.cues.length,1);assert.equal(s.cues[0].value,0);assert.equal(s.cues[0].delta,null);assert.equal(s.upcoming.length,2);
});
test('empty response means no returned notices, not zero release or a failed feed',()=>{
  const s=scheduleEvidence(fixture([]),'MIL',now);assert.equal(s.current,true);assert.equal(s.last,null);assert.equal(s.cues.length,0);assert.equal(s.upcoming.length,0);
});
test('past schedules are not measured releases; only the last 24 hours remain review cues',()=>{
  const s=scheduleEvidence(fixture([row(-48,400),row(-2,650)]),'MIL',now);
  assert.equal(s.upcoming.length,0);assert.equal(s.cues.length,1);assert.equal(s.cues[0].phase,'effective');
  assert.equal(scheduleEvidence(fixture([row(-48,400)]),'MIL',now).cues.length,0);
});
test('seven-day horizon excludes distant events and never depends on map or gauge display filters',()=>{
  const s=scheduleEvidence(fixture([row(6,650),row(8*24,800)]),'MIL',now);
  assert.equal(s.upcoming.length,1);assert.equal(s.windowEnd,now+7*DAY);
});
test('stale or failed collection retains dated notices but suppresses active cues',()=>{
  for(const mutate of [x=>x.snapshot.stations[0].scheduled.error='HTTP 503',x=>x.error='offline',x=>x.checked=now-HOUR,x=>x.snapshot.generatedAt=new Date(now-HOUR).toISOString(),x=>x.snapshot.stations[0].scheduled.lastSuccess=new Date(now-HOUR).toISOString()]){
    const x=fixture();mutate(x);const s=scheduleEvidence(x,'MIL',now);assert.equal(s.current,false);assert.equal(s.cues.length,0);assert.equal(s.upcoming.length,2);
  }
});
test('conflicting and flagged notices require verification, even when their check is fresh',()=>{
  const s=scheduleEvidence(fixture([row(6,650),row(6,700),row(18,500,{dataFlag:'E'})]),'MIL',now);
  assert.equal(s.pending.length,2);assert.equal(s.cues.length,0);assert.equal(s.upcoming[0].value,null);
});
test('malformed times, wrong station and wrong units fail closed; duplicate snapshot keys are rejected',()=>{
  for(const change of [{obsDate:'tomorrow'},{stationId:'PNF'},{units:'CMS'},{durCode:'D'}])assert.throws(()=>scheduledRecords([row(6,650,change)],'MIL',now));
  const x=fixture();x.snapshot.stations[0].scheduled.records.push(x.snapshot.stations[0].scheduled.records[0]);assert.equal(scheduleEvidence(x,'MIL',now).current,false);
  const malformed=fixture();malformed.snapshot.stations[0].scheduled.records.push(null);assert.equal(scheduleEvidence(malformed,'MIL',now).current,false);
  assert.throws(()=>releaseSource('UNVERIFIED'));
});
test('failed schedule request preserves previous notices with previous success time',async()=>{
  const old=fixture().snapshot.stations[0].scheduled;
  const result=await collectScheduledReleases({station:'MIL',now:now+HOUR,old,fetchImpl:async()=>({ok:false,status:503})});
  assert.match(result.error,/503/);assert.equal(result.lastSuccess,old.lastSuccess);assert.deepEqual(result.records,old.records);
});
test('schedule fetch uses event sensor 7 and a bounded query; empty success replaces prior notices',async()=>{
  const old=fixture().snapshot.stations[0].scheduled;
  const result=await collectScheduledReleases({station:'MIL',now,old,fetchImpl:async url=>{assert.equal(url.searchParams.get('SensorNums'),'7');assert.equal(url.searchParams.get('dur_code'),'E');assert.equal(url.searchParams.get('Start'),'2026-09-17');return {ok:true,json:async()=>[]};}});
  assert.equal(result.error,null);assert.equal(result.records.length,0);
});
test('notices map only to downstream review areas and count once despite two Millerton release metrics',async()=>{
  const [areas,watch,selection]=await Promise.all(['river-areas.json','river-watchlist.json','reservoir-watchlist.json'].map(siteJson));
  const points=planningPoints(areas,watch.stations,selection.stations),f=planningExercise(watch.stations,points,selection,'scheduled',now);
  const rows=evaluateAreas({areas:areas.areas,points,gaugeEntries:f.entries,reservoirs:f.reservoirs,rain:f.rain,riverConfig:CONFIG.rivers,environmentConfig:CONFIG.environment},now);
  assert.deepEqual(rows.filter(r=>r.review).map(r=>r.area.id).sort(),['kings-lower','san-joaquin-lower']);
  assert.equal(rows.find(r=>r.area.id==='san-joaquin-lower').scheduled.length,2);
  assert.equal(new Set(rows.flatMap(r=>r.scheduled.map(n=>n.key))).size,4);
  assert(rows.filter(r=>!r.review).every(r=>r.scheduled.length===0));
});
