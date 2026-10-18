import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyRecords,makeEvent,heads,current,reportStatus,buildNotifications,reviewState,briefingSnapshot,briefingText,approvalFor,digest,validatePayload,safeLink,changeSummary} from '../site/lib/eoc-model.js';
import {createExerciseStore,createPrivateStore,privateObjectIds} from '../site/lib/eoc-store.js';
import {normalizeRoad,normalizeRoads,fetchRoads,roadInCurrentView,roadHealth,missingRoadRecords} from '../site/lib/roads.js';
const now=Date.now(),incident='test-incident';
const report=(condition='Overtopping reported')=>({location:'FICTIONAL crossing',observed:now-60000,condition,evidence:'FICTIONAL radio report',requestedFollowup:'Verify with exercise road owner',latitude:null,longitude:null});
const period={label:'EXERCISE OP1',start:now,end:now+3600000,nextBriefing:now+1800000,objectives:'Verify crossing and report to Planning'};
async function add(store,data,collection,payload,options={}){const r=await store.append(makeEvent(collection,payload,{incident,...options}),data);data[collection].push(r);return r;}
test('corrected reports reopen verification and preserve the original review',async()=>{
  const store=createExerciseStore(),data=emptyRecords();
  const original=await add(store,data,'reports',report());
  await add(store,data,'verifications',{reportEvent:original.id,outcome:'Confirmed',finding:'Exercise overtopping verified',evidence:'Exercise owner confirmation',verifiedAt:now});
  assert.equal(reportStatus(original,data.verifications),'Confirmed');
  const corrected=await add(store,data,'reports',report('Corrected depth report'),{entity:original.entity,supersedes:[original.id]});
  assert.equal(reportStatus(corrected,data.verifications),'Unverified');assert.equal(data.reports.length,2);assert.equal(heads(data.reports).length,1);
  assert.equal(buildNotifications(data,[])[0].category,'Verification queue');assert.equal(data.verifications.length,1);
});
test('duplicate retries are idempotent; changed content cannot reuse the same ID',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),event=makeEvent('reports',report(),{incident});
  const first=await store.append(event,data),retry=await store.append(event,data);assert.equal(first.id,retry.id);
  assert.equal((await store.load(incident)).reports.length,1);
  await assert.rejects(store.append({...event,payload:report('Different')},data),/different/);
});
test('parallel corrections are surfaced as conflicts and stale corrections are rejected',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),r=await add(store,data,'reports',report());
  const a=await add(store,data,'reports',report('A'),{entity:r.entity,supersedes:[r.id]});
  await assert.rejects(store.append(makeEvent('reports',report('B'),{incident,entity:r.entity,supersedes:[r.id]}),data),/changed/);
  const fork={...a,id:'fork',payload:report('B')};assert.equal(heads([...data.reports,fork])[0].conflict,true);assert.equal(current([...data.reports,fork]),null);
});
test('acknowledgement is team-specific and exact-revision specific; it never removes the notice',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),n={key:'official:1',revision:'v1',category:'Official agency alerts',location:'Test reach',change:'Warning'};
  await add(store,data,'reviews',{sourceKey:n.key,sourceRevision:n.revision,team:'Operations',action:'Acknowledged'});
  assert.equal(reviewState(n,data.reviews,'Operations'),'Acknowledged');assert.equal(reviewState(n,data.reviews,'Planning'),'Awaiting review');assert.equal(reviewState({...n,revision:'v2'},data.reviews,'Operations'),'Awaiting review');assert.equal(buildNotifications(data,[n]).length,1);
});
test('an overdue follow-up is separate from review, and completion requires evidence',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),p={kind:'Follow-up',title:'Check crossing',location:'Test',owner:'Road Maintenance',due:now-1000,nextReview:'Call owner',status:'Open',sourceKey:'official:1'};
  const r=await add(store,data,'coordination',p);assert.equal(buildNotifications(data,[],now)[0].category,'Overdue follow-ups');
  assert.throws(()=>validatePayload('coordination',{...p,status:'Complete'}),/evidence/);
  await add(store,data,'coordination',{...p,status:'Complete',evidence:'Exercise check complete'},{entity:r.entity,supersedes:[r.id]});assert.equal(buildNotifications(data,[],now).length,0);
});
test('a saved briefing is detached from later records and approval is tied to its digest',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),p=await add(store,data,'periods',period),r=await add(store,data,'reports',report());
  const original=await briefingSnapshot({records:data,notifications:buildNotifications(data,[]),sourceHealth:[{name:'test',status:'failed',checked:now}],period:p,exercise:true});
  const b=await add(store,data,'briefings',{title:'EXERCISE briefing',periodEvent:p.id,...original});
  await add(store,data,'reports',report('Later correction'),{entity:r.entity,supersedes:[r.id]});
  assert.equal(b.payload.snapshot.records.reports.length,1);assert.equal(await digest(b.payload.snapshot),b.payload.digest);
  const approval=await add(store,data,'approvals',{briefingEvent:b.id,digest:b.payload.digest,status:'Approved',evidence:'Exercise manager approval'});
  assert.equal(approvalFor(b,data.approvals).id,approval.id);assert.match(briefingText(b,approval),/APPROVED SNAPSHOT/);assert.match(briefingText(b,approval),/not submitted to Cal OES/);
  assert.match(briefingText(b,null),/DRAFT \/ NOT APPROVED/);assert.equal(approvalFor({...b,payload:{...b.payload,digest:'0'.repeat(64)}},data.approvals),null);
});
test('withdrawn approval remains in history',async()=>{
  const store=createExerciseStore(),data=emptyRecords(),p=await add(store,data,'periods',period),snapshot=await briefingSnapshot({records:data,notifications:[],sourceHealth:[],period:p});
  const b=await add(store,data,'briefings',{title:'test',periodEvent:p.id,...snapshot}),a=await add(store,data,'approvals',{briefingEvent:b.id,digest:b.payload.digest,status:'Approved',evidence:'approval'});
  await add(store,data,'approvals',{...a.payload,status:'Withdrawn',evidence:'Correction required'},{entity:a.entity,supersedes:[a.id]});assert.equal(approvalFor(b,data.approvals).payload.status,'Withdrawn');assert.equal(data.approvals.length,2);
});
test('absence is never represented as clearance',()=>{assert.match(changeSummary([{key:'x',revision:'1',location:'crossing'}],[])[0],/not a clearance/);});
test('Management sees pending decisions before their due time',async()=>{const store=createExerciseStore(),data=emptyRecords();await add(store,data,'coordination',{kind:'Decision',title:'Review staging proposal',location:'Exercise reach',owner:'Management',due:now+3600000,nextReview:'Confirm owner access',status:'Open'});assert.equal(buildNotifications(data,[],now)[0].category,'Decisions awaiting attention');});
test('invalid activation, staging confirmation, period and unsafe reference inputs fail',()=>{
  assert.throws(()=>validatePayload('incidents',{name:'test',level:'Automatic activation',authority:'system',decisionBy:'bot',evidence:'cue',effective:now}));
  assert.throws(()=>validatePayload('periods',{...period,end:period.start}),/follow/);
  assert.throws(()=>validatePayload('staging',{location:'test',owner:'test',status:'Owner confirmed',evidence:'test'}),/time/);
  assert.equal(safeLink('javascript:alert(1)'),null);assert.equal(safeLink('https://user:secret@example.com'),null);
});
test('private configuration fails closed before loading SDK or records',async()=>{await assert.rejects(createPrivateStore({enabled:false},{}),/not enabled/);await assert.rejects(createPrivateStore({enabled:true,environment:'exercise',orgId:'county'},{portal:{id:'other'}}),/county organization/);});
test('null private table IDs require a separate successful zero count',async()=>{
  let counts=0;
  assert.deepEqual(await privateObjectIds({objectIds:null},async()=>{counts++;return {count:0};}),[]);
  assert.equal(counts,1);
  for(const result of [{count:1},{count:'0'},{},{count:0,error:{code:499}},{count:0,exceededTransferLimit:true}])await assert.rejects(privateObjectIds({objectIds:null},async()=>result),/could not be verified/);
});
test('empty ID arrays and populated inventories are accepted without a count request',async()=>{
  const unused=()=>{throw new Error('unexpected count');};
  assert.deepEqual(await privateObjectIds({objectIds:[]},unused),[]);
  assert.deepEqual(await privateObjectIds({objectIds:[1,4,7]},unused),[1,4,7]);
});
test('private inventory rejects missing, repeated, truncated or malformed IDs',async()=>{
  for(const result of [{},{objectIds:undefined},{objectIds:[1,1]},{objectIds:['1']},{objectIds:[-1]},{objectIds:[],error:{code:403}},{objectIds:[],exceededTransferLimit:true}])await assert.rejects(privateObjectIds(result,()=>({count:0})));
});
test('clearing an exercise removes records and prevents later writes',async()=>{const s=createExerciseStore(),data=emptyRecords();await add(s,data,'reports',report());s.close();await assert.rejects(s.load(incident),/closed/);await assert.rejects(s.append(makeEvent('reports',report(),{incident}),data),/closed/);});
const road=(fields={})=>({attributes:{globalid:'{abc}',blocknm:'Test Road',active:'Yes',startdate:now-1000,enddate:now+10000,last_edited_date:now,...fields},geometry:{x:-119.8,y:36.8}});
test('county GlobalID deduplicates repeated records, never ObjectID',()=>{const r=road();assert.equal(normalizeRoads([{layer:0,features:[r,{...r,attributes:{...r.attributes,objectid:99}}]}]).length,1);assert.throws(()=>normalizeRoad(road({globalid:null}),0),/GlobalID/);});
test('elapsed end dates and inactive records never assert road open',()=>{const r=normalizeRoad(road({enddate:now-10000}),0,now);assert.equal(r.status,'Verification needed');assert.equal(roadInCurrentView(r,now),false);assert.match(r.issues[0],/not confirmed/);const inactive=normalizeRoad(road({active:'No'}),0,now);assert.match(inactive.status,/access unconfirmed/);assert.equal(roadInCurrentView(inactive,now),false);});
test('detours without active flags remain unconfirmed; missing dates are not zero',()=>{const r=normalizeRoad(road({active:null,startdate:null,enddate:null,last_edited_date:null}),2,now);assert.equal(r.start,null);assert.equal(r.end,null);assert.equal(r.edited,null);assert.match(r.status,/unconfirmed/);});
test('disappearing current road records remain in a session verification queue until returned',()=>{const r=normalizeRoad(road(),0,now),missing=missingRoadRecords([r],[],new Map(),now);assert.equal(missing.size,1);assert.equal(missingRoadRecords([],[],missing,now+100).get(r.key).detected,now);assert.equal(missingRoadRecords([],[r],missing,now+100).size,0);});
test('road fetch rejects partial inventory and service errors',async()=>{let count=0;const fetcher=async url=>({ok:true,json:async()=>String(url).includes('returnIdsOnly')?{objectIds:[1,2],objectIdFieldName:'objectid'}:{features:[road()]}});await assert.rejects(fetchRoads(fetcher),/truncated/);await assert.rejects(fetchRoads(async()=>({ok:true,json:async()=>({error:{code:500}})})),/error/);assert.match(roadHealth({rows:[],checked:now},null,now),/does not confirm/);assert.match(roadHealth({rows:[],checked:now},true,now),/failed/);});
