import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpSummaryExercise} from '../site/lib/pump-summary-exercise.js';
import {pumpTasks,pumpTaskCounts,freezePumpTasks} from '../site/lib/pump-task-model.js';
import {PUMP_READINESS_SCOPE,pumpBinding} from '../site/lib/pump-readiness-contract.js';
import {makeEvent,emptyRecords,heads,validatePayload} from '../site/lib/eoc-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';
import {pumpReadinessSummary,filterPumpSummary} from '../site/lib/pump-summary-model.js';
import {freezeDrainageReview,assessDrainageReviews,drainageReviewGroups} from '../site/lib/drainage-review-model.js';
import {briefText} from '../site/lib/mission-model.js';
const now=Date.now(),f=pumpSummaryExercise(now),pump=f.snapshot.rows.find(r=>r.key==='fictional-pump'),first=f.readinessRecords.coordination[0],readiness=f.readinessRecords.checklists[0];
const state=(tasks=[first],extra={})=>({connected:true,checked:now,error:null,tasks,records:f.readinessRecords.checklists,...extra});
test('pump tasks retain owner, work type, due time and overdue state separately from readiness',()=>{
  const t=pumpTasks(pump,state(),readiness,now);assert.equal(t.rows.length,1);assert(t.rows[0].overdue);assert(t.rows[0].active);assert(!t.rows[0].changed);assert.equal(t.rows[0].owner,'Fictional logistics team');assert.equal(t.rows[0].assigneeType,'Team');
});
test('updates and duplicate retries preserve one task, server attribution and complete history',async()=>{
  const store=createExerciseStore(f.readinessRecords),r=emptyRecords();r.coordination=[first];
  const second=makeEvent('coordination',{...first.payload,status:'In progress',owner:'Fictional person',pumpTask:{...first.payload.pumpTask,assigneeType:'Person'}},{incident:PUMP_READINESS_SCOPE,entity:first.entity,supersedes:[first.id]});
  const saved=await store.append(second,r);r.coordination.push(saved);assert.equal((await store.append(second,r)).id,saved.id);assert.equal(saved.author,'EXERCISE operator');
  const third=makeEvent('coordination',{...saved.payload,status:'Complete',evidence:'FICTIONAL work completed; readiness remains separately unconfirmed.'},{incident:PUMP_READINESS_SCOPE,entity:first.entity,supersedes:[saved.id]});r.coordination.push(await store.append(third,r));
  const moved=makeEvent('coordination',{...third.payload,pumpTask:{...third.payload.pumpTask,type:'Refueling'}},{incident:PUMP_READINESS_SCOPE,entity:first.entity,supersedes:[third.id]});await assert.rejects(store.append(moved,r),/cannot be moved/);
  const data=await store.loadCollection('coordination',PUMP_READINESS_SCOPE),t=pumpTasks(pump,state(data),readiness,now);assert.equal(t.history.length,3);assert.equal(t.rows.length,1);assert(!t.rows[0].active);assert(!t.rows[0].overdue);assert.equal(t.rows[0].status,'Complete');
  await assert.rejects(store.append(makeEvent('coordination',first.payload,{incident:PUMP_READINESS_SCOPE,entity:first.entity,supersedes:[first.id]}),r),/changed/);
});
test('a new readiness version flags a closed task for review without altering status or readiness',()=>{
  const done={...first,payload:{...first.payload,status:'Complete'}};const t=pumpTasks(pump,state([done]),{...readiness,id:'new-report'},now).rows[0];assert(t.changed&&t.needsReview);assert.equal(t.status,'Complete');assert.equal(readiness.payload.backup,'Unavailable');
});
test('parallel task heads / duplicate identities never imply completed work',()=>{
  const parallel={...structuredClone(first),id:'parallel',payload:{...first.payload,status:'Complete'}};
  let t=pumpTasks(pump,state([first,parallel]),readiness,now);assert(t.rows[0].conflict);assert.equal(t.rows[0].status,'Conflicting updates');
  t=pumpTasks(pump,state([first,{...parallel,entity:'another'}]),readiness,now);assert(t.rows.every(r=>r.conflict));assert.equal(t.rows.length,1);assert.equal(pumpTaskCounts([{pumpPower:[{key:pump.key,tasks:t}]}],state([first,parallel]),now).active,1);
});
test('failed private access and changed pump identity cannot carry a confirmed assignment to a different pump',()=>{
  for(const extra of [{connected:false},{checked:now-121000},{checked:now+61000},{error:'denied'}])assert.deepEqual(pumpTasks(pump,state([first],extra),readiness,now),{current:false,history:[],rows:[]});
  const different={...pump,key:'changed-key'};assert.equal(pumpTasks(different,state(),readiness,now).rows.length,0);
  assert.equal(pumpTaskCounts([{pumpPower:[{key:different.key,tasks:pumpTasks(different,state(),readiness,now)}]}],state(),now).unmatched,1);
  assert.equal(pumpTaskCounts([],state([], {connected:false}),now),null);
});
test('typed task contract rejects incomplete identity, bogus source, invalid times, missing completion evidence',()=>{
  for(const mutate of [p=>p.pumpTask.identityConfirmed=false,p=>p.pumpTask.binding.source='https://example.com',p=>p.pumpTask.type='Dispatch',p=>p.pumpTask.assigneeType='Admin',p=>p.due=NaN,p=>p.owner='',p=>{p.status='Complete';p.evidence='';}]){const p=structuredClone(first.payload);mutate(p);assert.throws(()=>validatePayload('coordination',p));}
  assert.throws(()=>pumpBinding({...pump,category:'proposed'}));
});
test('summary, counts, search and briefing retain assignments independent of display filters',()=>{
  const args={...f,groups:drainageReviewGroups(f.snapshot.rows),vicinity:new Map(),readinessState:state(),config:{weatherCheckMaxAgeMs:420000,qpfMaxAgeMs:86400000}},groups=assessDrainageReviews(args,now),s=pumpReadinessSummary(groups),counts=pumpTaskCounts([...groups,...groups],state(),now);
  assert.equal(counts.active,1);assert.equal(counts.overdue,1);assert.equal(filterPumpSummary(s.rows,{search:'logistics',filter:'all'}).length,1);assert.equal(s.counts.backup,1);
  const captured=freezeDrainageReview(groups.find(g=>g.records.some(r=>r.key===pump.key)),now),before=JSON.stringify(captured);first.payload.owner='CHANGED';assert.equal(JSON.stringify(captured),before);first.payload.owner='Fictional logistics team';
  const text=briefText('FICTIONAL handoff',[captured],String);assert.match(text,/Fictional logistics team/);assert.match(text,/OVERDUE/);assert.match(text,/exercise-backup-task/);assert.match(text,/Not an approved briefing/);
  const frozen=freezePumpTasks(pumpTasks(pump,state(),readiness,now));assert.equal(heads(frozen.records).length,1);assert.equal(frozen.summary[0].event,first.id);
});
