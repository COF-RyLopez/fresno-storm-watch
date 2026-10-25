import test from 'node:test';
import assert from 'node:assert/strict';
import {pumpCopyVerification} from '../site/lib/pump-refresh-health.js';
import {pumpFormRetainsSelection,pumpFormCurrent} from '../site/lib/pump-form-model.js';
import {pumpSummaryExercise} from '../site/lib/pump-summary-exercise.js';
const now=Date.now(),copy={sourceChecked:now-10*86400000,snapshot:'a'.repeat(36),digest:'b'.repeat(64)},manualLimit=7*86400000;
const health={schema:'frog-pump-refresh-v1',enabled:true,state:'healthy',intervalMinutes:60,maxLagMs:10800000,activeSnapshot:copy.snapshot,activeDigest:copy.digest,lastAttempt:now,lastSuccess:now};
test('unchanged snapshot remains current only after a matching authenticated verification',()=>{
  const verified=pumpCopyVerification(copy,{frogPumpRefresh:health},manualLimit,now);assert.equal(verified.snapshotCaptured,copy.sourceChecked);assert.equal(verified.sourceChecked,now);assert.equal(verified.maxSourceAgeMs,3*3600000);assert.equal(verified.refreshMode,'scheduled');
  const fixture=pumpSummaryExercise(now),pump=fixture.snapshot.rows.find(r=>r.key==='fictional-pump');assert(pumpFormCurrent(pump,{...fixture.snapshot,...verified,rows:[pump]},now));assert.equal(pumpFormCurrent(pump,{...fixture.snapshot,...verified,rows:[pump]},now+3*3600000+1),false);
});
test('missing scheduling metadata stays manual; failed checks never advance the successful source time',()=>{
  assert.equal(pumpCopyVerification(copy,null,manualLimit,now).refreshMode,'manual');
  const r=pumpCopyVerification(copy,{frogPumpRefresh:{...health,state:'failed',lastAttempt:now+1000,lastSuccess:now-3600000}},manualLimit,now+1000);assert.equal(r.sourceChecked,now-3600000);assert.equal(r.refreshState,'failed');
});
test('wrong generation/digest, future checks and malformed schedules do not freshen old inventory',()=>{
  for(const change of [{activeSnapshot:'other'},{activeDigest:'other'},{lastSuccess:now+61000},{intervalMinutes:1},{maxLagMs:Infinity},{lastAttempt:now-1},{schema:'other'}])assert.throws(()=>pumpCopyVerification(copy,{frogPumpRefresh:{...health,...change}},manualLimit,now));
});
test('background inventory reads retain drafts only for the exact same pump association',()=>{
  const p=pumpSummaryExercise(now).snapshot.rows.find(r=>r.key==='fictional-pump');assert(pumpFormRetainsSelection(p,[{...p,updated:now}]));
  for(const rows of [[],[{...p,key:'different'}],[{...p,code:'different'}],[{...p,geometry:{...p.geometry,x:p.geometry.x+.001}}],[{...p,category:'proposed',subtype:0}]])assert.equal(pumpFormRetainsSelection(p,rows),false);
});
