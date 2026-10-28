import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBriefingEvidence,briefingNeedsSave,briefingPeriods,protectBriefingDraft} from '../site/lib/briefing-draft-model.js';
test('repeated captures preserve exact evidence versions without timestamp-only duplicates',()=>{
  const rows=[],first={kind:'planning-evidence',id:'kings',capturedAt:1,evidence:{capturedAt:1,sourceTime:4,value:0}};
  assert.equal(captureBriefingEvidence(rows,first),true);
  first.evidence.value=9;assert.equal(rows[0].evidence.value,0,'captured data is frozen');
  assert.equal(captureBriefingEvidence(rows,{capturedAt:2,id:'kings',kind:'planning-evidence',evidence:{value:0,sourceTime:4,capturedAt:2}}),false);
  assert.equal(captureBriefingEvidence(rows,{...first,capturedAt:3,evidence:{value:null,sourceTime:5}}),true);assert.equal(rows.length,2,'a changed source revision is retained, not overwritten');
});
test('draft warning stays active until its exact revision is saved privately',()=>{
  assert.equal(briefingNeedsSave(0,1,0),false);assert.equal(briefingNeedsSave(1,1,0),true);assert.equal(briefingNeedsSave(1,1,1),false);assert.equal(briefingNeedsSave(1,2,1),true,'editing during a save remains unsaved');
});
test('exit handler cancels an attempted exit only while a draft needs saving',()=>{
  const target=new EventTarget();let dirty=false;const remove=protectBriefingDraft(target,()=>dirty);
  assert.equal(target.dispatchEvent(new Event('beforeunload',{cancelable:true})),true);
  dirty=true;assert.equal(target.dispatchEvent(new Event('beforeunload',{cancelable:true})),false);
  remove();assert.equal(target.dispatchEvent(new Event('beforeunload',{cancelable:true})),true);
});
test('period choices preserve elapsed dates but exclude superseded and conflicting records',()=>{
  const p=(id,entity,start,end,supersedes=[])=>({id,entity,created:start,supersedes,payload:{start,end,label:id}}),now=10000;
  const records=[p('old','p1',100,200),p('a','p2',9000,11000),p('b','p2',9500,12000,['a']),p('c','p3',8000,12000),p('d','p3',8000,13000)];
  const choices=briefingPeriods(records,now);assert.deepEqual(choices.map(r=>r.id),['b','old']);assert.equal(choices[0].active,true);assert.equal(choices[1].active,false);
});
