import test from 'node:test';
import assert from 'node:assert/strict';
import {restorationEstimate,createEstimateTracker} from '../site/lib/command-power.js';
import {snapshotConcern} from '../site/lib/command-model.js';
const t=Date.parse('2026-11-15T19:00:00Z');
const row=(time,estimate,extra={})=>({id:'power:pge:1',kind:'power',time,quality:'Utility published area',details:[],utilityUpdate:{restoration:estimate},...extra});
test('restoration display preserves missing, unknown-time-zone and elapsed estimates',()=>{
 assert.equal(restorationEstimate(null,'PG&E',t).label,'Not supplied');
 const raw=restorationEstimate({time:t,text:'11/15/2026 11:00 AM'},'SCE',t+1);
 assert.match(raw.label,/11:00 AM.*time zone not supplied/);assert.equal(raw.passed,false);
 const known=restorationEstimate({time:t},'PG&E',t+1);assert.match(known.label,/PST/);assert.equal(known.passed,true);
 assert.equal(restorationEstimate({time:null,text:'To be determined'},'PG&E',t).label,'To be determined');
});
test('only comparable newer estimates trigger changes; duplicate/older responses do not roll back',()=>{
 const track=createEstimateTracker(), a=restorationEstimate({time:t+3600000},'PG&E',t), b=restorationEstimate({time:t+7200000},'PG&E',t);
 assert.equal(track.apply([row(t,a)],t)[0].utilityUpdate.estimateChange,undefined);
 let changed=track.apply([row(t+1,b)],t+1)[0];assert.equal(changed.utilityUpdate.estimateChange.previous,a.label);
 assert.equal(track.apply([row(t+1,b)],t+2)[0].utilityUpdate.estimateChange.detected,t+1);
 assert.equal(track.apply([row(t,a)],t+3)[0].utilityUpdate.restoration.key,b.key);
 assert.equal(track.apply([row(t+2,b)],t+4)[0].utilityUpdate.estimateChange.previous,a.label);
 assert.equal(track.apply([],t+5).length,0);
 assert.ok(track.apply([row(t+3,restorationEstimate(null,'PG&E',t))],t+6)[0].utilityUpdate.estimateChange);
 assert.equal(createEstimateTracker().apply([row(null,a)],t)[0].utilityUpdate.estimateChange,undefined);
});
test('equal-time conflicts and elapsed estimates remain review cues, never restored status',()=>{
 const track=createEstimateTracker(),a=restorationEstimate({time:t+100},'PG&E',t),b=restorationEstimate({time:t+200},'PG&E',t);
 track.apply([row(t,a)],t);
 const conflict=track.apply([row(t,b,{change:'Reported outage'})],t+1)[0];
 assert.equal(conflict.utilityUpdate.estimateChange.type,'conflict');assert.equal(conflict.change,'Reported outage');
 const removed=track.apply([row(t+1,restorationEstimate(null,'PG&E',t),{change:'Reported outage'})],t+2)[0];
 assert.equal(removed.utilityUpdate.estimateChange.type,'changed');assert.equal(removed.change,'Reported outage');
});

test('retaining a newer utility update still ages its restoration deadline without changing estimate history',()=>{
 const track=createEstimateTracker(),a=restorationEstimate({time:t+100},'PG&E',t),b=restorationEstimate({time:t+200},'PG&E',t);
 track.apply([row(t,a)],t);const changed=track.apply([row(t+1,b)],t+1);
 const retained=track.apply([row(t,a)],t+1000)[0];
 assert.equal(retained.utilityUpdate.restoration.key,b.key);assert.equal(retained.utilityUpdate.restoration.passed,true);
 assert.deepEqual(retained.utilityUpdate.estimateChange,changed[0].utilityUpdate.estimateChange);assert.equal(retained.time,t+1);
});
test('briefing capture freezes the displayed estimate and count with its review history',()=>{
 const c=row(t,restorationEstimate({time:t+1000},'PG&E',t));
 c.utilityUpdate.customers=0;
 c.utilityUpdate.estimateChange={previous:'Not supplied',detected:t};
 const snapshot=snapshotConcern(c,t);
 c.utilityUpdate.customers=40;c.utilityUpdate.restoration.label='Changed later';
 assert.ok(snapshot.details.includes('Customers reported: 0'));
 assert.ok(snapshot.details.some(s=>s.includes('previously Not supplied')));
 assert.ok(!snapshot.details.some(s=>s.includes('Changed later')));
});
