import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pioSourceReviews,pioReviewCount,pendingPioSourceReviews,PIO_SOURCE_CHECK_MS} from '../site/lib/pio-source-review.js';
import {createPioSourceMonitor,pioZoneSnapshot} from '../site/lib/pio-source-data.js';
import {freezeAfnEvidence} from '../site/lib/afn-snapshot-model.js';
import {emptyRecords,heads,makeEvent,briefingSnapshot,digest,reviewState} from '../site/lib/eoc-model.js';
import {pioStates} from '../site/lib/pio-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';

const now=Date.now(),row={key:'county-zone:1',oid:1,name:'EXERCISE ZONE',status:'Lifted',geometry:{rings:[[[-119.8,36.7],[-119.8,36.71],[-119.79,36.71],[-119.79,36.7],[-119.8,36.7]]],spatialReference:{wkid:4326}}};
const zone=await pioZoneSnapshot(row,now),m=(estimate=100,moe=10)=>({estimate,moe});
const topics=()=>[
  {key:'languages',period:'2020–2024',source:'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b16001.dat',collected:'2026-10-29',checked:now,referenceChecked:now,edited:null,rows:[{id:'0601902',name:'EXERCISE whole PUMA',age5:m(10000),hmong:m(),hmongLep:m(50),punjabi:m(),punjabiLep:m(50)}]},
  {key:'svi',checked:now,edited:now-10000,rows:[{id:'06019000100',overall:.5,household:.4,limitedEnglish:m()}]},
  {key:'ces',checked:now,edited:now-10000,designationChecked:now,designationEdited:now-10000,rows:[]},
  {key:'ccl',checked:now,edited:now-10000,rows:[]}
];
const snapshot=()=>freezeAfnEvidence({zone,topics:topics()});
const state=(id='a')=>({active:true,approved:true,record:{id,entity:'entity-'+id,payload:{location:zone.name,owner:'EXERCISE PIO',pioOutreach:{zone,afnEvidence:snapshot(),message:'EXERCISE APPROVED — DO NOT DISTRIBUTE',languages:['English']}}}});
const current=(s,afn=snapshot(),z=zone)=>({[s.record.entity]:{zone:z,afn}});

test('PIO source checks ignore query/capture timestamps and preserve approval, text and saved snapshots',async()=>{
  const s=state(),saved=structuredClone(s),live=snapshot();live.captured+=100;live.zone.checked+=100;for(const ref of Object.values(live.sources))ref.checked+=100;
  assert.deepEqual(await pioSourceReviews([s],{current:current(s,live),checked:now+100}),[]);assert.deepEqual(s,saved);
});

test('boundary/status change and AFN changes count one outreach and never alter approved messages',async()=>{
  const s=state(),before=structuredClone(s),live=snapshot();live.topics[0].rows[0].hmong.estimate=110;
  const changed={...zone,status:'Order',revision:'b'.repeat(64)},notices=await pioSourceReviews([s],{current:current(s,live,changed),checked:now});
  assert.equal(notices.length,2);assert.equal(pioReviewCount(notices),1);assert(notices.some(n=>/Language.*differs/.test(n.change)));assert.deepEqual(s,before);
  assert(!JSON.stringify(notices).includes(s.record.payload.pioOutreach.message));
  const next=await pioSourceReviews([s],{current:current(s,live,changed),checked:now+10000});assert.deepEqual(notices.map(n=>n.revision),next.map(n=>n.revision));
});

test('MOE, facility records and whole-area membership changes trigger review even without layer edit dates',async()=>{
  for(const change of [x=>x.topics[0].rows[0].hmong.moe=30,x=>x.topics[1].rows=[],x=>x.topics[3].rows=[{key:'ccl:1',number:'1',name:'EXERCISE',type:'EXERCISE',status:3,capacity:1,city:'FRESNO'}]]){
    const s=state(),live=snapshot();for(const ref of Object.values(live.sources))ref.edited=null;for(const ref of Object.values(s.record.payload.pioOutreach.afnEvidence.sources))ref.edited=null;change(live);
    assert.equal(pioReviewCount(await pioSourceReviews([s],{current:current(s,live),checked:now})),1);
  }
});

test('publisher revision is explicitly source-wide, not a claim that zone values changed',async()=>{
  const s=state(),live=snapshot();live.sources.ccl.edited+=1000;const n=await pioSourceReviews([s],{current:current(s,live),checked:now});
  assert.equal(n.length,1);assert.match(n[0].change,/zone values may be unchanged/);assert.equal(n[0].evidence.changes.ccl.contentRevision,null);
});

test('acknowledgement is tied to the substantive source revision, not successive query times',async()=>{
  const s=state(),live=snapshot();live.sources.svi.edited+=1000;
  const [first]=await pioSourceReviews([s],{current:current(s,live),checked:now}),reviews=[{id:'review',entity:'review',created:now,supersedes:[],payload:{sourceKey:first.key,sourceRevision:first.revision,team:'PIO',action:'Acknowledged'}}];
  const [repeat]=await pioSourceReviews([s],{current:current(s,live),checked:now+1000});assert.equal(reviewState(repeat,reviews,'PIO'),'Acknowledged');assert.equal(pendingPioSourceReviews([repeat],reviews,'PIO').length,0);assert.equal(pendingPioSourceReviews([repeat],reviews,'Other team').length,1);
  live.topics[1].rows[0].limitedEnglish.moe=20;const [changed]=await pioSourceReviews([s],{current:current(s,live),checked:now+2000});assert.equal(reviewState(changed,reviews,'PIO'),'Awaiting review');assert.equal(pendingPioSourceReviews([changed],reviews,'PIO').length,1);assert.equal(s.approved,true);
  const failed={...first,category:'Data failures'};assert.equal(pendingPioSourceReviews([failed],reviews,'PIO').length,1,'Acknowledgement cannot hide a failed feed');
});

test('source failures deduplicate across outreach; missing context and closed records do not become zero or safe',async()=>{
  const a=state('a'),b=state('b'),live=snapshot();live.topics[1]={key:'svi',error:'Unavailable',rows:null};const n=await pioSourceReviews([a,b],{current:{...current(a,live),...current(b,live)},checked:now});
  assert.equal(n.length,1);assert.equal(n[0].key,'pio:afn-source:svi');assert.equal(pioReviewCount(n),0);assert.match(n[0].change,/unknown/);
  assert.equal((await pioSourceReviews([a,b],{error:'Offline',checked:now})).length,1);
  assert.equal((await pioSourceReviews([{...a,active:false}],{error:'Offline'})).length,0);
  delete a.record.payload.pioOutreach.afnEvidence;assert.match((await pioSourceReviews([a],{current:current(a),checked:now}))[0].change,/not been captured/);
});

test('missing zone requests verification without extrapolation; newly available AFN evidence needs explicit recapture',async()=>{
  const s=state();assert.match((await pioSourceReviews([s],{current:{},checked:now}))[0].change,/no longer returned/);
  s.record.payload.pioOutreach.afnEvidence.topics[1]={key:'svi',error:'Unavailable',rows:null};
  assert.match((await pioSourceReviews([s],{current:current(s),checked:now}))[0].change,/SVI returned context differs/);
});

test('public monitor shares zone reads, limits concurrency to two and caches without persistence',async()=>{
  const a=state('a'),b=state('b');let reads=0,zoneReads=0,clock=now;
  const monitor=createPioSourceMonitor({now:()=>clock,loadZones:async()=>{zoneReads++;return {rows:[row],checked:clock};},readContext:async(g,options)=>{assert.deepEqual(g,row.geometry);assert.deepEqual(Object.keys(options),['signal']);reads++;return topics();}});
  assert.deepEqual((await monitor.check([a,b])).notices,[]);assert.equal(reads,1);assert.equal(zoneReads,1);
  clock+=60000;await monitor.check([a,b]);assert.equal(reads,1);assert.equal(zoneReads,1);
  await monitor.check([a,b],{force:true});assert.equal(reads,2);clock+=PIO_SOURCE_CHECK_MS;await monitor.check([a]);assert.equal(reads,3);
  monitor.clear();await monitor.check([a]);assert.equal(reads,4);
  let running=0,max=0;const rows=[1,2,3,4].map(oid=>({...row,oid,key:'county-zone:'+oid})),states=[];
  for(const r of rows){const s=state(String(r.oid));s.record.payload.pioOutreach.zone=await pioZoneSnapshot(r,now);s.record.payload.pioOutreach.afnEvidence.zone=s.record.payload.pioOutreach.zone;states.push(s);}
  const bounded=createPioSourceMonitor({loadZones:async()=>({rows,checked:now}),readContext:async()=>{max=Math.max(max,++running);await new Promise(r=>setImmediate(r));running--;return topics();}});await bounded.check(states);assert.equal(max,2);
});

test('source failure stays visible and forced retry can recover without changing saved evidence',async()=>{
  let failed=true;const monitor=createPioSourceMonitor({loadZones:async()=>({rows:[row],checked:now}),readContext:async()=>{if(failed)throw Error('Offline');return topics();}}),s=state(),before=structuredClone(s);
  assert.equal((await monitor.check([s])).notices.filter(n=>n.category==='Data failures').length,4);
  failed=false;assert.equal((await monitor.check([s],{force:true})).notices.length,0);assert.deepEqual(s,before);
});

test('sign-out/scope changes abort pending source reads even when a reader ignores abort',async()=>{
  let release,entered;const started=new Promise(r=>entered=r),monitor=createPioSourceMonitor({loadZones:async()=>({rows:[row],checked:now}),readContext:async()=>{entered();await new Promise(r=>release=r);return topics();}});
  const pending=monitor.check([state()]);await started;monitor.clear();release();await assert.rejects(pending,{name:'AbortError'});
});

test('no active outreach makes no public queries and exercise mode never reads live AFN',async()=>{
  let calls=0;const monitor=createPioSourceMonitor({exercise:true,loadZones:async()=>({rows:[row],checked:now}),readContext:async()=>{calls++;return topics();}});
  assert.equal((await monitor.check([{...state(),active:false}])).notices.length,0);assert.equal(calls,0);assert.equal((await monitor.check([state()])).notices.length,4);assert.equal(calls,0);
});

test('zone PIO handoffs retain source-review flags and freeze them independently of later checks',async()=>{
  const records=emptyRecords(),store=createExerciseStore(),incident='exercise-source-check';
  const add=async(k,p)=>{const r=await store.append(makeEvent(k,p,{incident}),records);records[k].push(r);return r;};
  const p={kind:'Follow-up',title:'EXERCISE',location:zone.name,owner:'EXERCISE PIO',due:now+3600000,nextReview:'Review',status:'Open',evidence:'EXERCISE',pioOutreach:{schema:1,zone,languages:['English'],confirmedBy:'EXERCISE',confirmedAt:now,languageEvidence:'EXERCISE',messageLanguage:'English',message:'EXERCISE — DO NOT DISTRIBUTE',channels:['EXERCISE'],partners:[],zoneVerifiedBy:'EXERCISE',zoneVerifiedAt:now,zoneEvidence:'EXERCISE',analysisNotes:'EXERCISE',afnEvidence:snapshot()}};
  const plan=await add('coordination',p);await add('approvals',{kind:'pio-outreach',outreachEvent:plan.id,status:'Approved',decisionBy:'EXERCISE',decidedAt:now,evidence:'EXERCISE'});
  const period=await add('periods',{label:'EXERCISE',start:now,end:now+3600000,nextBriefing:now+10000,objectives:'EXERCISE'}),s=pioStates(records,{heads})[0],live=snapshot();live.sources.svi.edited+=1000;
  const notices=await pioSourceReviews([s],{current:current(s,live),checked:now}),before=structuredClone(records),b=await briefingSnapshot({records,notifications:notices,sourceHealth:[],period,scope:'pio',pioZoneKey:zone.key});
  assert.equal(b.snapshot.notifications.length,1);assert.equal(pioStates(records,{heads})[0].approved,true);assert.deepEqual(records,before);notices[0].change='Later check';assert.equal(await digest(b.snapshot),b.digest);
});

test('private review controllers do not write records, persist browser data or send private payloads to sources',async()=>{
  for(const p of ['pio-source-data.js','pio-source-review.js','mission-followup-ui.js']){
    const text=await readFile(new URL('../site/lib/'+p,import.meta.url),'utf8');assert(!/localStorage|sessionStorage|sendBeacon|\.append\(makeEvent|\.applyEdits\(/.test(text),p);
  }
});
