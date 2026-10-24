import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpSummaryExercise} from '../site/lib/pump-summary-exercise.js';
import {pumpReadinessSummary,filterPumpSummary} from '../site/lib/pump-summary-model.js';
import {drainageReviewGroups,assessDrainageReviews} from '../site/lib/drainage-review-model.js';
const now=Date.now(),hour=3600000;
function fixture(change=()=>{}){
  const f=pumpSummaryExercise(now);f.readinessState={connected:true,checked:now,error:null,records:f.readinessRecords.checklists};change(f);
  return assessDrainageReviews({...f,groups:drainageReviewGroups(f.snapshot.rows),vicinity:new Map(),config:{weatherCheckMaxAgeMs:420000,qpfMaxAgeMs:86400000}},now);
}

test('summary separates reported backup / fuel needs and unknown follow-ups for existing pumps only',()=>{
  const {rows,counts}=pumpReadinessSummary(fixture());assert.equal(rows.length,3);assert.equal(counts.backup,1);assert.equal(counts.refuel,1);assert.equal(counts.followup,3);assert.equal(counts.unconfirmed,1);
  assert.equal(rows[0].name,'Fictional pump B');assert.equal(rows[0].runtimeHours,2);assert.equal(rows[0].contact.method,'EXERCISE radio B');
  assert(rows.every(r=>r.powerRain));assert(rows.every(r=>r.rain.cycle.hours===72));assert(rows.every(r=>r.rain.value===.5));
  assert(!rows.some(r=>r.key==='fictional-proposed'));
});
test('expired / stale / conflicting confirmations cannot become current resource requests or confirmed contacts',()=>{
  for(const mutate of [f=>f.readinessState.checked=now-121000,f=>f.readinessState.error='denied',f=>f.readinessRecords.checklists[0].payload.validUntil=now-1,f=>f.snapshot.checked=now-700000,f=>f.readinessState.records.push({...structuredClone(f.readinessState.records[0]),id:'parallel',payload:{...f.readinessState.records[0].payload,owner:'Another fictional owner'}})]){
    const s=pumpReadinessSummary(fixture(mutate)),backup=s.rows.find(r=>r.key==='fictional-pump');assert.equal(backup.backup,false);assert(backup.followup);assert(!backup.contact||backup.contact.current===false);
    if(backup.contact)assert.equal(backup.contact.owner,'Fictional FMFCD operator');
  }
});
test('zero runtime and unknown runtime remain distinct; zero alone does not invent a refueling request',()=>{
  const s=pumpReadinessSummary(fixture(f=>{f.readinessRecords.checklists[0].payload={...f.readinessRecords.checklists[0].payload,backup:'Available',connection:'Confirmed compatible / tested',runtimeHours:0};}));
  const p=s.rows.find(r=>r.key==='fictional-pump');assert.equal(p.runtimeHours,0);assert.equal(p.refuel,false);assert(p.followup);
  assert.equal(s.rows.find(r=>r.key==='fictional-pump-c').runtimeHours,null);
});
test('search and category filters never change countywide summary counts, include contact and source identifiers',()=>{
  const s=pumpReadinessSummary(fixture()),before=structuredClone(s.counts);
  assert.equal(filterPumpSummary(s.rows,{filter:'backup'}).length,1);assert.equal(filterPumpSummary(s.rows,{filter:'refuel'}).length,1);
  assert.equal(filterPumpSummary(s.rows,{filter:'all',search:'EXERCISE-B'})[0].name,'Fictional pump B');assert.equal(filterPumpSummary(s.rows,{filter:'all',search:'FMFCD operator'}).length,2);
  assert.deepEqual(s.counts,before);
});
test('repeated group representations count a pump once and missing rain is never zero / rain onset',()=>{
  const groups=fixture(f=>{f.rain.features=[];});const s=pumpReadinessSummary([...groups,...structuredClone(groups)]);
  assert.equal(s.rows.length,3);assert(s.rows.every(r=>r.rain.value===null));assert(s.rows.every(r=>r.powerRain===false));assert(s.rows.every(r=>!('arrivalTime' in r.rain)));
});
test('a complete owner confirmation leaves utility review visible without inventing backup or fuel need',()=>{
  const s=pumpReadinessSummary(fixture(f=>{for(const e of f.readinessRecords.checklists)Object.assign(e.payload,{backup:'Available',connection:'Confirmed compatible / tested',fuel:'Confirmed available',runtimeHours:24});}));
  assert.equal(s.counts.backup,0);assert.equal(s.counts.refuel,0);assert.equal(s.counts.followup,3);assert(s.rows.every(r=>r.utilityConcern));
});
test('explicit review ordering puts utility/rain overlap before other resource needs, then earlier review deadlines',()=>{
  const groups=fixture(),p=groups[0].pumpPower[0];groups.push({...groups[0],id:'other',pumpPower:[{...structuredClone(p),key:'another-pump',name:'Other fictional pump',powerRain:false,review:false,maximum:null,readiness:{...p.readiness,event:{...p.readiness.event,payload:{...p.readiness.event.payload,pumpLabel:'Other fictional pump',validUntil:now+hour}}}}]});
  const rows=pumpReadinessSummary(groups).rows;assert.equal(rows[0].name,'Fictional pump B');assert.equal(rows.at(-1).name,'Other fictional pump');
});
test('missing confirmations remain follow-up even without rain or utility overlap; completed details do not become an all-clear',()=>{
  const groups=fixture(f=>{f.power.rows=[];f.rain.features.forEach(r=>r.value=0);for(const e of f.readinessRecords.checklists)Object.assign(e.payload,{backup:'Available',connection:'Confirmed compatible / tested',fuel:'Confirmed available',runtimeHours:24});});
  const s=pumpReadinessSummary(groups);assert.equal(s.counts.attention,1);assert.equal(s.counts.followup,1);assert.equal(s.counts.unconfirmed,1);assert.equal(filterPumpSummary(s.rows).length,1);
  assert(s.rows.filter(r=>!r.attention).every(r=>r.labels[0].includes('check event needs')));
});
