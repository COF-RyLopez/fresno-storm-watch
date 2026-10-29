import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeAfnEvidence,validateAfnEvidence,afnEvidenceLines,AFN_TOPIC_KEYS} from '../site/lib/afn-snapshot-model.js';
import {captureAfnEvidence} from '../site/lib/afn-snapshot-data.js';
import {emptyRecords,makeEvent,briefingSnapshot,briefingText,heads,digest} from '../site/lib/eoc-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';
import {pioStates} from '../site/lib/pio-model.js';
import {CARE_SOURCES} from '../site/lib/care-model.js';
const now=Date.now(),zone={source:CARE_SOURCES.zones,key:'county-zone:299',oid:299,name:'L39',status:'Lifted',checked:now-1000,revision:'a'.repeat(64)};
const m=(estimate,moe)=>({estimate,moe});
const topics=()=>[
  {key:'languages',period:'2020–2024',source:'https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b16001.dat',collected:'2026-10-29',checked:now-100,referenceChecked:now,edited:0,rows:[{id:'0601902',name:'EXERCISE whole PUMA',age5:m(185882,3678),hmong:m(1206,368),hmongLep:m(313,174),punjabi:m(4455,1007),punjabiLep:m(1930,457)}]},
  {key:'svi',checked:now-100,edited:now-100000,rows:[{id:'06019004503',overall:.5835,household:null,limitedEnglish:m(75,91)}]},
  {key:'ces',checked:now-100,edited:now-200000,designationChecked:now-50,designationEdited:now-300000,rows:[{id:'06019004503',overall:.579,linguistic:.3069,dac:null}]},
  {key:'ccl',checked:now-100,edited:now-400000,rows:[{key:'ccl:1',number:'1234',name:'EXERCISE facility',type:'RESIDENTIAL-ELDERLY',status:3,capacity:6,city:'FRESNO'},{key:'ccl:2',number:'5678',name:'EXERCISE second facility',type:'RESIDENTIAL-ELDERLY',status:6,capacity:99,city:'FRESNO'}]}
];
const fixture=()=>freezeAfnEvidence({zone,topics:topics()});
const payload=(afn=fixture())=>({kind:'Follow-up',title:'EXERCISE AFN handoff',location:zone.name,owner:'EXERCISE PIO',due:now+3600000,nextReview:'Review',status:'Open',evidence:'EXERCISE only',pioOutreach:{schema:1,zone:structuredClone(zone),languages:['English'],confirmedBy:'EXERCISE partner',confirmedAt:now-1000,languageEvidence:'EXERCISE confirmation',messageLanguage:'English',message:'EXERCISE ONLY — do not distribute.',channels:['EXERCISE radio'],partners:[],zoneVerifiedBy:'EXERCISE county source',zoneVerifiedAt:now-1000,zoneEvidence:'EXERCISE applicability',analysisNotes:'No individual needs inferred',...(afn?{afnEvidence:afn}:{})}});

test('AFN capture freezes exact MOEs, source periods/edit/query dates and whole-area limits without private inputs',()=>{
  const input=topics();input[0].token='PRIVATE';input[3].rows[0].phone='PRIVATE';input[3].rows[0].geometry={x:1,y:2};
  const s=freezeAfnEvidence({zone:{...zone,geometry:{rings:[]},privateContact:'PRIVATE'},topics:input});
  input[0].rows[0].hmong.estimate=9999;
  assert.deepEqual(s.topics[0].rows[0].hmong,m(1206,368));assert.equal(s.sources.b16001.collected,'2026-10-29');assert.equal(s.sources.b16001.period,'2020–2024');
  assert.equal(s.sources.svi.edited,now-100000);assert.equal(s.sources.sb535.edited,now-300000);assert.equal(s.sources.puma.edited,null);
  assert(s.limits.wholeArea.includes('not zone totals'));assert(s.limits.facilities.includes('not current residents'));assert(s.limits.language.includes('not speakers inside this evacuation zone'));
  assert(!/PRIVATE|geometry|token|phone/.test(JSON.stringify(s)));
});

test('saved AFN validation rejects wrong zones, mismatched sources/dates, duplicate IDs and invalid measures',()=>{
  for(const mutate of [s=>s.zone.key='county-zone:1',s=>s.sources.svi.url='https://example.org',s=>s.sources.b16001.period='2021–2025',s=>s.sources.ccl.checked=null,s=>s.sources.ces.edited=now+3600000,s=>s.topics[1].rows.push(s.topics[1].rows[0]),s=>s.topics[1].rows[0].overall=2,s=>s.topics[1].rows[0].limitedEnglish.moe=-1,s=>s.topics[0].rows[0].hmongLep.estimate=5000,s=>s.topics[3].rows[0].capacity=-1]){
    const s=fixture();mutate(s);assert.throws(()=>validateAfnEvidence(s,zone));
  }
});

test('partial failures, missing MOEs and missing percentiles remain unknown while other topics survive',()=>{
  const t=topics();t[1]={key:'svi',error:'Source HTTP 503'};t[0].rows[0].hmong.moe=null;t[2].rows[0].overall=null;
  const s=freezeAfnEvidence({zone,topics:t}),output=afnEvidenceLines(s,zone,String).join('\n');
  assert.equal(s.topics[1].rows,null);assert.equal(s.sources.svi.checked,null);assert.equal(s.topics[0].rows[0].hmong.moe,null);
  assert(output.includes('UNAVAILABLE svi'));assert(output.includes('MOE unavailable'));assert(output.includes('CalEnviroScreen Unavailable'));assert(!output.includes('105 licensed'));
  const all=freezeAfnEvidence({zone,topics:AFN_TOPIC_KEYS.map(key=>({key,error:'Unavailable'}))});assert(all.topics.every(t=>t.rows===null));
});

test('AFN capture passes only public geometry and cancels superseded reads',async()=>{
  const geometry={rings:[]},row={geometry,privateMessage:'PRIVATE'};let calls=0;
  const snapshot=await captureAfnEvidence(row,zone,{readContext:async(g,options)=>{assert.equal(g,geometry);assert.deepEqual(Object.keys(options),['signal']);calls++;return topics();}});assert.equal(snapshot.zone.key,zone.key);assert.equal(calls,1);
  await assert.rejects(captureAfnEvidence(row,zone,{signal:AbortSignal.abort(),readContext:async()=>{throw Error('Must not run');}}),{name:'AbortError'});
  let current=true;await assert.rejects(captureAfnEvidence(row,zone,{current:()=>current,readContext:async()=>{current=false;return topics();}}),{name:'AbortError'});
  const unavailable=await captureAfnEvidence(row,zone,{readContext:async()=>{throw Error('Offline');}});assert(unavailable.topics.every(t=>t.error==='Offline'&&t.rows===null));
});

test('outreach and briefings retain exact AFN versions through later refreshes and require fresh approval',async()=>{
  const records=emptyRecords(),store=createExerciseStore(),incident='afn-exercise';
  const add=async(key,p,options={})=>{const r=await store.append(makeEvent(key,p,{incident,...options}),records);records[key].push(r);return r;};
  const plan=await add('coordination',payload());await add('approvals',{kind:'pio-outreach',outreachEvent:plan.id,status:'Approved',decisionBy:'EXERCISE approver',decidedAt:now,evidence:'EXERCISE documented approval'});
  const period=await add('periods',{label:'EXERCISE AFN handoff',start:now,end:now+3600000,nextBriefing:now+1800000,objectives:'EXERCISE only'});
  const frozen=await briefingSnapshot({records,notifications:[],sourceHealth:[],period,scope:'pio',pioZoneKey:zone.key});
  const next=payload();next.pioOutreach.afnEvidence.topics[0].rows[0].hmong.estimate=1400;await add('coordination',next,{entity:plan.entity,supersedes:[plan.id]});
  assert.equal(pioStates(records,{heads})[0].approved,false);assert.equal(frozen.snapshot.records.coordination[0].payload.pioOutreach.afnEvidence.topics[0].rows[0].hmong.estimate,1206);assert.equal(await digest(frozen.snapshot),frozen.digest);
  const output=briefingText({id:'saved',author:'EXERCISE',payload:{title:'EXERCISE',...frozen}});
  for(const value of ['Whole PUMA 0601902','1,206 ± 368','90% MOEs','2020–2024','ACS 2018–2022','2010 Census tract','not zone totals','2026-10-29','licensed capacity 6','licensed capacity 99','Manual handoff only'])assert(output.includes(value),value);
  assert(!output.includes('licensed capacity 105'));
});

test('older records stay readable and an older zone revision is preserved with a review warning',()=>{
  const s=fixture(),current={...zone,revision:'b'.repeat(64)};validateAfnEvidence(s,current);assert(afnEvidenceLines(s,current,String).some(l=>l.startsWith('REVIEW:')));
  const records={...emptyRecords(),coordination:[{...makeEvent('coordination',payload(null),{incident:'exercise'}),author:'EXERCISE',created:now}]};assert.equal(pioStates(records,{heads}).length,1);assert(afnEvidenceLines(null,zone,String)[0].includes('not captured'));
});

test('oversized evidence fails visibly without truncating the facility cohort',()=>{
  const t=topics();t[3].rows=Array.from({length:1000},(_,i)=>({...t[3].rows[0],key:'ccl:'+i,number:String(i)}));assert.throws(()=>freezeAfnEvidence({zone,topics:t}),/No evidence was truncated/);assert.equal(t[3].rows.length,1000);
});
