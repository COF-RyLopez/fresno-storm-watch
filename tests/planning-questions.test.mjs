import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateQuestions,gaugeQuestions,questionOwner,questionScenarios,questionsFor,questionEvidence,questionsCsv,QUESTION_KINDS,COUNTY} from '../site/lib/planning-questions-model.js';
import {missionEvidenceKey} from '../site/lib/mission-followup-model.js';

const data=JSON.parse(readFileSync(new URL('../site/data/planning/questions.json',import.meta.url)));
const scenarios=JSON.parse(readFileSync(new URL('../site/data/flood-scenarios/index.json',import.meta.url))).scenarios;

test('the published questions file validates and covers every built topic and place',()=>{
  validateQuestions(data);
  for(const kind of ['dams','levees','sandbags','power'])assert(data.questions.some(q=>q.kind===kind),kind);
  assert.equal(data.places[0],COUNTY);assert(data.exposure[COUNTY]&&data.exposure.Fresno);
  for(const q of data.questions)assert(data.places.includes(q.place),q.place);
  assert.throws(()=>validateQuestions({...data,questions:[...data.questions,data.questions[0]]}),/Duplicate/);
  assert.throws(()=>validateQuestions({...data,questions:[{...data.questions[0],id:'x',lon:-100}]}),/outside Fresno County/);
});

test('gauge questions: no NWS stage asks for a local action level; no gauge asks how rising water is seen; failed data asks nothing',()=>{
  const gauge=(id,known)=>({id,gauge:{name:`Gauge ${id}`,longitude:-119.5,latitude:36.8},assessment:{thresholdKnown:known}});
  const rows=[{area:{id:'a',name:'Area A'},gauges:[gauge('g1',false),gauge('g2',true),{id:'g3',gauge:null,assessment:{thresholdKnown:false}}]},
    {area:{id:'b',name:'Area B'},gauges:[gauge('g1',false)]},{area:{id:'c',name:'Area C'},gauges:[]}];
  const q=gaugeQuestions(rows);
  assert.deepEqual(q.map(x=>x.id).sort(),['gauges:none:c','gauges:threshold:g1']);
  assert.match(q.find(x=>x.id==='gauges:threshold:g1').detail,/Watch areas: Area A, Area B/);
  assert.equal(q.find(x=>x.id==='gauges:none:c').lon,null);
});

test('dam questions name the operator the dam popup names, else keep the build owner',()=>{
  const q={kind:'dams',owner:'Dam owner (Private) · DSOD'};
  assert.match(questionOwner({...q,nidAttributes:{NAME:'BIG CREEK DAM NO. 2'}}),/Southern California Edison/);
  assert.equal(questionOwner({...q,nidAttributes:{NAME:'PINE FLAT',FED_AGENCY_OPERATIONS:'US Army Corps of Engineers'}}),'US Army Corps of Engineers');
  assert.equal(questionOwner({...q,nidAttributes:{NAME:'SOMEWHERE'}}),q.owner);
  assert.equal(questionOwner({kind:'levees',owner:'KRCD'}),'KRCD');
  assert(questionScenarios({kind:'dams',dam:'BIG DRY CREEK'},scenarios).length>=3);
  assert.deepEqual(questionScenarios({kind:'levees',dam:'BIG DRY CREEK'},scenarios),[]);
});

test('place and topic filters; county-wide shows every place',()=>{
  const qs=[{kind:'dams',place:COUNTY},{kind:'sandbags',place:'Fresno',parcels:20},{kind:'sandbags',place:'Clovis',parcels:90}];
  assert.deepEqual(questionsFor(qs,COUNTY).map(q=>q.place),['Clovis','Fresno',COUNTY]);
  assert.equal(questionsFor(qs,'Fresno').length,1);
  assert.equal(questionsFor(qs,COUNTY,'sandbags').length,2);
});

test('evidence carries a stable follow-up key and the CSV quotes commas and quotes',()=>{
  const q=data.questions.find(x=>x.kind==='levees');
  const e=questionEvidence(q,1);
  assert.equal(missionEvidenceKey(e),`mission:planning-question:${q.id}`);
  assert.equal(e.topic,QUESTION_KINDS.levees);assert.match(e.nextReview,/Answer from:/);
  const csv=questionsCsv([{...q,title:'Who, "exactly"?'}],()=>'Open');
  assert.match(csv,/"Who, ""exactly""\?"/);assert.match(csv.split('\r\n')[1],/,Open,/);
});

test('flood-pocket questions carry their outline and nearby options; bad ones are rejected',async()=>{
  const {nearbyBadge}=await import('../site/lib/planning-questions-model.js');
  const pockets=data.questions.filter(q=>q.kind==='sandbags');
  assert(pockets.length&&pockets.every(q=>q.geometry?.rings?.length&&q.nearby?.length>=3));
  assert(pockets.every(q=>q.nearby.every((n,i,a)=>!i||a[i-1].miles<=n.miles)));// nearest first
  const q=pockets[0];
  assert.throws(()=>validateQuestions({...data,questions:[{...q,geometry:{rings:[[[-119.8,36.7]]]}}]}),/flood-pocket outline/);
  assert.throws(()=>validateQuestions({...data,questions:[{...q,nearby:[{name:'X',kind:'County building',miles:1,lon:-100,lat:36}]}]}),/nearby-site list/);
  assert.deepEqual(nearbyBadge('County road yard').glyph,'garage');
  assert.equal(nearbyBadge('Fire station (City-owned)').fill,'#a5a9ad');assert.equal(nearbyBadge('Fire station').glyph,'fire');
  assert.equal(nearbyBadge('County building').glyph,'building');
});
