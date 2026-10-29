import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freezePopulationEvidence,validatePopulationEvidence,populationEvidenceLines} from '../site/lib/population-snapshot-model.js';
import {capturePopulationEvidence} from '../site/lib/population-snapshot-data.js';
import {emptyRecords,makeEvent,briefingSnapshot,briefingText,heads,digest} from '../site/lib/eoc-model.js';
import {createExerciseStore} from '../site/lib/eoc-store.js';
import {pioStates} from '../site/lib/pio-model.js';
import {CARE_SOURCES} from '../site/lib/care-model.js';
const now=Date.now(),zone={source:CARE_SOURCES.zones,key:'county-zone:287',oid:287,name:'L62',status:'Lifted',checked:now-1000,revision:'a'.repeat(64)};
const newer=()=>({period:'2020–2024',checked:now,sourceChecked:now-100,metadata:{modified:now-100000,edited:now-200000},boundaries:{checked:now-100},estimate:1000,samplingMoe:100,tracts:1,missing:0,missingMoe:0,rows:[{id:'06019000100',population:2000,moe:200,weight:.5,baselineWithin:980,baselineTotal:1960,reason:null,blockChecked:now-50,blockEdited:null}]});
const baseline=()=>({estimate:980,blocks:2,missing:0,wholePopulation:960,boundaryPopulation:40,wholeBlocks:1,boundaryBlocks:1});
const fixture=()=>freezePopulationEvidence({zone,newer:newer(),baseline:baseline(),baselineMeta:{checked:now-50,edited:now-100000}});
const payload=(population=fixture())=>({kind:'Follow-up',title:'EXERCISE population evidence',location:zone.name,owner:'EXERCISE PIO',due:now+3600000,nextReview:'Review',status:'Open',evidence:'EXERCISE only',pioOutreach:{schema:1,zone:structuredClone(zone),languages:['English'],confirmedBy:'EXERCISE reviewer',confirmedAt:now-1000,languageEvidence:'EXERCISE confirmation',messageLanguage:'English',message:'EXERCISE ONLY — do not distribute.',channels:['EXERCISE radio'],partners:[],zoneVerifiedBy:'EXERCISE county source',zoneVerifiedAt:now-1000,zoneEvidence:'EXERCISE applicability',analysisNotes:'Not current affected persons',...(population?{populationEvidence:population}:{})}});

test('population snapshot freezes source periods, dates, method, uncertainty and raw weights without geometry',()=>{
  const input=newer(),s=freezePopulationEvidence({zone:{...zone,geometry:{rings:[]}},newer:input,baseline:baseline(),baselineMeta:{checked:now-50,edited:null}});
  input.rows[0].population=9999;assert.equal(s.newer.rows[0].population,2000);assert.equal(s.sources.acs.period,'2020–2024');assert.equal(s.sources.blocks.year,2020);assert(s.methods.sampling.includes('not a complete 90% confidence interval'));
  assert(!JSON.stringify(s).includes('geometry'));assert.equal(s.zone.revision,zone.revision);assert.equal(s.newer.rows[0].weight,.5);assert.equal(s.newer.rows[0].blockChecked,now-50);
});
test('snapshot validation rejects wrong zone, sources, dates, duplicate tracts and manipulated sums',()=>{
  for(const mutate of [s=>s.zone.key='county-zone:1',s=>s.sources.acs.url='https://example.org',s=>s.captured=now+10000000,s=>s.newer.estimate=1001,s=>s.newer.samplingMoe=10,s=>s.newer.rows.push(s.newer.rows[0]),s=>s.newer.rows[0].weight=2,s=>s.sources.acs.period='2021–2025']){
    const s=fixture();mutate(s);assert.throws(()=>validatePopulationEvidence(s,zone));
  }
});
test('unavailable population and missing MOE remain unknown and retain failure evidence',()=>{
  const s=freezePopulationEvidence({zone,baseline:baseline(),baselineMeta:{checked:now},errors:[{source:'acs',detail:'Public source HTTP 503'}]});assert.equal(s.newer,null);assert.equal(s.baseline.estimate,980);assert(populationEvidenceLines(s,zone,String).some(line=>line.includes('UNAVAILABLE acs')));
  const n=newer();n.rows[0].moe=null;n.samplingMoe=null;n.missingMoe=1;assert.equal(freezePopulationEvidence({zone,newer:n,errors:[{source:'baseline',detail:'Unavailable'}]}).newer.samplingMoe,null);
  assert.throws(()=>freezePopulationEvidence({zone}),/failure/);
});
test('an older county revision is preserved and explicitly marked for review',()=>{
  const s=fixture(),current={...zone,revision:'b'.repeat(64)};assert.equal(validatePopulationEvidence(s,current),s);assert(populationEvidenceLines(s,current,String).some(line=>line.startsWith('REVIEW:')));assert.equal(s.zone.revision,zone.revision);
});
test('publisher zero edit-date sentinels stay unknown rather than becoming a source date',()=>{
  const n=newer();n.metadata.edited=0;n.metadata.modified=0;n.rows[0].blockEdited=0;const s=freezePopulationEvidence({zone,newer:n,baseline:baseline(),baselineMeta:{checked:now,edited:0}});assert.equal(s.sources.acs.edited,null);assert.equal(s.sources.acs.modified,null);assert.equal(s.sources.blocks.edited,null);assert.equal(s.newer.rows[0].blockEdited,null);
});
test('capture runs independent public collectors and retains the available counterpart',async()=>{
  const row={geometry:{rings:[]}},options={operators:{},readNewer:async received=>{assert.equal(received,row);return newer();},readBlocks:async()=>({checked:now,edited:null}),calculateBaseline:async()=>baseline()};
  const s=await capturePopulationEvidence(row,zone,options);assert.equal(s.newer.estimate,1000);assert.equal(s.baseline.estimate,980);
  const partial=await capturePopulationEvidence(row,zone,{...options,readNewer:async()=>{throw Error('HTTP 503');}});assert.equal(partial.newer,null);assert.equal(partial.errors[0].source,'acs');assert.equal(partial.baseline.estimate,980);
  const missing=await capturePopulationEvidence(row,zone,{...options,readBlocks:async()=>{throw Error('Baseline failed');}});assert.equal(missing.baseline,null);assert.equal(missing.newer.estimate,1000);
});
test('superseded and canceled captures cannot produce an attachable snapshot',async()=>{
  const signal=AbortSignal.abort();await assert.rejects(capturePopulationEvidence({},zone,{signal,operators:{}}),{name:'AbortError'});
  let calls=0;await assert.rejects(capturePopulationEvidence({},zone,{operators:{},current:()=>++calls<3,readNewer:async()=>newer(),readBlocks:async()=>({checked:now}),calculateBaseline:async()=>baseline()}),{name:'AbortError'});
});
test('outreach versions and approved briefing evidence do not change when later population inputs change',async()=>{
  const records=emptyRecords(),store=createExerciseStore(),incident='population-exercise';
  const add=async(key,p,options={})=>{const r=await store.append(makeEvent(key,p,{incident,...options}),records);records[key].push(r);return r;};
  const r=await add('coordination',payload()),a=await add('approvals',{kind:'pio-outreach',outreachEvent:r.id,status:'Approved',decisionBy:'EXERCISE approver',decidedAt:now,evidence:'EXERCISE documented approval'}),period=await add('periods',{label:'EXERCISE PIO population',start:now,end:now+3600000,nextBriefing:now+1800000,objectives:'Exercise only'});
  const frozen=await briefingSnapshot({records,notifications:[],sourceHealth:[],period,scope:'pio',pioZoneKey:zone.key});const originalDigest=frozen.digest;
  const p=payload();p.pioOutreach.populationEvidence.newer.rows[0].population=2400;p.pioOutreach.populationEvidence.newer.estimate=1200;
  await add('coordination',p,{entity:r.entity,supersedes:[r.id]});assert.equal(pioStates(records,{heads})[0].approved,false);assert.equal(records.approvals[0].id,a.id);
  assert.equal(frozen.snapshot.records.coordination[0].payload.pioOutreach.populationEvidence.newer.estimate,1000);assert.equal(await digest(frozen.snapshot),originalDigest);
  const text=briefingText({id:'saved-briefing',author:'EXERCISE',payload:{title:'EXERCISE',...frozen}});for(const value of ['2020–2024','Sampling-only MOE','Total zone uncertainty is not quantified','fixed weight 0.5','Manual handoff only'])assert(text.includes(value));
});
test('zone PIO handoff excludes other zones while retaining selected approvals and exact history',async()=>{
  const records=emptyRecords(),first={...makeEvent('coordination',payload(),{incident:'exercise'}),created:now,author:'EXERCISE'},other=payload();other.location='L1';other.pioOutreach.zone={...zone,key:'county-zone:305',oid:305,name:'L1'};delete other.pioOutreach.populationEvidence;
  const second={...makeEvent('coordination',other,{incident:'exercise'}),created:now,author:'EXERCISE'};records.coordination.push(first,second);
  const period={id:'period',payload:{label:'EXERCISE',start:now,end:now+3600000,nextBriefing:now,objectives:'Exercise'}};
  const notifications=[{key:'pio:'+first.entity,revision:'1',location:'L62'},{key:'pio:'+second.entity,revision:'1',location:'L1'}];
  const s=await briefingSnapshot({records,notifications,sourceHealth:[{name:'unrelated feed'}],period,scope:'pio',pioZoneKey:zone.key});assert.equal(s.snapshot.records.coordination.length,1);assert.equal(s.snapshot.notifications.length,1);assert.equal(s.snapshot.sourceHealth.length,0);assert.equal(s.snapshot.pioZoneKey,zone.key);
  await assert.rejects(briefingSnapshot({records,notifications:[],sourceHealth:[],period,scope:'pio',pioZoneKey:'county-zone:123'}),/No saved/);
  await assert.rejects(briefingSnapshot({records,notifications:[],sourceHealth:[],period,pioZoneKey:zone.key}),/Choose/);
});
test('older outreach remains readable without inventing a population snapshot',()=>{
  const p=payload(null),r={...makeEvent('coordination',p,{incident:'exercise'}),created:now,author:'EXERCISE'},records={...emptyRecords(),coordination:[r]};assert.equal(pioStates(records,{heads}).length,1);assert.equal(r.payload.pioOutreach.populationEvidence,undefined);
});
test('population persistence and briefing construction never fetch latest values or use browser storage',async()=>{
  const model=await readFile(new URL('../site/lib/population-snapshot-model.js',import.meta.url),'utf8'),ui=await readFile(new URL('../site/lib/pio-ui.js',import.meta.url),'utf8');assert(!/fetch\(|localStorage|sessionStorage|applyEdits|accessToken/.test(model));assert(!/localStorage|sessionStorage/.test(ui));assert(ui.includes('populationAbort?.abort()'));assert(ui.includes('if(e.population)o.populationEvidence=e.population'));
});
