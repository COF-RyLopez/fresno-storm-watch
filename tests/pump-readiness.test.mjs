import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpBinding,bindingKey,validatePumpReadiness,PUMP_READINESS_SCOPE} from '../site/lib/pump-readiness-contract.js';
import {pumpReadiness,unmatchedPumpReadiness,freezePumpReadiness} from '../site/lib/pump-readiness-model.js';
import {emptyRecords,makeEvent,digest} from '../site/lib/eoc-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';
import {drainageReviewExercise} from '../site/lib/drainage-review-exercise.js';
import {assessDrainagePumpPower} from '../site/lib/drainage-power-model.js';
import {powerScope} from '../site/lib/power-geometry.js';
const now=Date.now(),hour=3600000,pump=drainageReviewExercise(now).snapshot.rows[1];
const payload=(extra={})=>({kind:'pump-readiness',schema:1,binding:pumpBinding(pump),identityConfirmed:true,pumpLabel:'FICTIONAL station A',backup:'Available',connection:'Confirmed compatible / tested',fuel:'Confirmed available',runtimeHours:12,runtimeBasis:'FICTIONAL verified fuel at stated load',owner:'FICTIONAL FMFCD operator',contact:'EXERCISE radio A',observed:now-60000,validUntil:now+hour,evidence:'FICTIONAL owner confirmation',...extra});
const record=(extra={})=>({id:'event1',entity:'pump1',incident:PUMP_READINESS_SCOPE,collection:'checklists',supersedes:[],created:now,author:'EXERCISE operator',payload:payload(),...extra});
const state=(records=[record()],extra={})=>({connected:true,records,checked:now,error:null,...extra});

test('current owner confirmation retains exact attribution, runtime assumptions and review deadline',()=>{
  const r=pumpReadiness(pump,state(),now);assert.equal(r.needsReview,false);assert(r.current);assert.equal(r.event.author,'EXERCISE operator');assert.equal(r.event.payload.runtimeHours,12);assert.match(r.label,/verify duration/);
});
test('unknown, zero runtime, unavailable backup and fuel follow-up are distinct, never a zero default',()=>{
  for(const change of [{runtimeHours:null},{runtimeHours:0},{backup:'Unavailable',connection:'Unknown'},{fuel:'Refuel needed'},{fuel:'Unknown'},{connection:'Needs verification'}])assert(pumpReadiness(pump,state([record({payload:payload(change)})]),now).needsReview);
  assert.notEqual(pumpReadiness(pump,state([record({payload:payload({runtimeHours:null})})]),now).event.payload.runtimeHours,0);
});
test('expired confirmation or failed/stale private queries cannot clear the review',()=>{
  assert.match(pumpReadiness(pump,state([record({payload:payload({validUntil:now-1})})]),now).label,/overdue/);
  for(const change of [{connected:false},{error:'denied'},{checked:now-121000},{checked:null}]){const r=pumpReadiness(pump,state([record()],change),now);assert(r.needsReview);assert.equal(r.event,null);assert.equal(r.current,false);}
});
test('changed source OID, code or geometry invalidates readiness; no nearest-pump transfer',()=>{
  for(const change of [{key:'fmfcd:0:999'},{code:'OTHER'},{geometry:{...pump.geometry,x:pump.geometry.x+.000001}}]){const r={...pump,...change};assert.equal(pumpReadiness(r,state(),now).event,null);assert.equal(unmatchedPumpReadiness([r],state()),1);}
  assert.equal(unmatchedPumpReadiness([pump],state([record(),record({id:'event2'})])),0);
  assert.equal(unmatchedPumpReadiness([],state([record(),record({id:'event2'})])),1);
});
test('proposed assets or an unverified CRS cannot receive readiness confirmations',()=>{
  assert.throws(()=>pumpBinding({...pump,category:'proposed'}),/existing/);assert.throws(()=>pumpBinding({...pump,geometry:{...pump.geometry,spatialReference:{wkid:2228}}}),/WGS84/);
});
test('concurrent heads and duplicate associations remain conflicting; explicit correction preserves history',()=>{
  const a=record(),b=record({id:'event2',payload:payload({fuel:'Refuel needed'})});assert.match(pumpReadiness(pump,state([a,b]),now).label,/Conflicting/);
  assert.match(pumpReadiness(pump,state([a,{...b,entity:'another'}]),now).label,/Conflicting/);
  const c=record({id:'event3',supersedes:['event1','event2']});const r=pumpReadiness(pump,state([a,b,c]),now);assert.equal(r.event.id,'event3');assert.equal(r.history.length,3);assert.equal(r.needsReview,false);
});
test('checklist storage appends with idempotent retry, rejects stale corrections, and survives a fresh read',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),entity='pump-'+await digest(pumpBinding(pump));
  const event=makeEvent('checklists',payload(),{incident:PUMP_READINESS_SCOPE,entity});const first=await store.append(event,data);data.checklists.push(first);
  assert.equal((await store.append(event,data)).id,first.id);assert.equal((await store.loadCollection('checklists',PUMP_READINESS_SCOPE)).length,1);
  const correction=makeEvent('checklists',payload({fuel:'Refuel needed'}),{incident:PUMP_READINESS_SCOPE,entity,supersedes:[first.id]});const second=await store.append(correction,data);data.checklists.push(second);
  await assert.rejects(store.append(makeEvent('checklists',payload(),{incident:PUMP_READINESS_SCOPE,entity,supersedes:[first.id]}),data),/changed/);
  const read=await store.loadCollection('checklists',PUMP_READINESS_SCOPE);assert.equal(read.length,2);assert(pumpReadiness(pump,state(read),now).needsReview);assert.equal((await store.loadCollection('checklists','different-incident')).length,0);
  store.close();await assert.rejects(store.loadCollection('checklists',PUMP_READINESS_SCOPE),/closed/);
});
test('input validation rejects future observations, invalid associations and ungrounded runtime estimates',()=>{
  for(const extra of [{identityConfirmed:false},{observed:now+hour},{validUntil:now-60001},{runtimeHours:-1},{runtimeHours:'12'},{runtimeHours:12,runtimeBasis:''},{owner:''},{contact:''},{backup:'Unavailable'},{binding:{...pumpBinding(pump),source:'https://example.com'} }])assert.throws(()=>validatePumpReadiness(payload(extra),now));
  assert.equal(validatePumpReadiness(payload({runtimeHours:null,runtimeBasis:''}),now).runtimeHours,null);
});
test('readiness updates change pump follow-up counts without clearing utility alerts or official source evidence',()=>{
  const d=drainageReviewExercise(now),args={records:d.snapshot.rows,state:d.power,contours:d.rain.features.map(f=>({...f,scope:powerScope(f.geometry)})),cycle:d.rain.cycle,rainCurrent:true,inventoryCurrent:true};
  const before=[...assessDrainagePumpPower(args,now).values()][0];assert(before.readinessReview&&before.review);
  const after=[...assessDrainagePumpPower({...args,readinessState:state()},now).values()][0];assert.equal(after.readinessReview,false);assert(after.review&&after.powerRain);assert.equal(after.reviews[0].row.revision,before.reviews[0].row.revision);
  assert([...assessDrainagePumpPower({...args,readinessState:state([record({payload:payload({runtimeHours:0})})])},now).values()][0].readinessReview);
});
test('briefing evidence freezes confirmation version and excludes private contact method and coordinates',()=>{
  const value=pumpReadiness(pump,state(),now),frozen=freezePumpReadiness(value);value.event.payload.runtimeHours=99;
  assert.equal(frozen.confirmation.runtimeHours,12);assert.equal(frozen.eventId,'event1');
  assert(!JSON.stringify(frozen).includes('EXERCISE radio A'));for(const k of ['binding','selectionKey','"x"','"y"'])assert(!JSON.stringify(frozen).includes(k));
});
