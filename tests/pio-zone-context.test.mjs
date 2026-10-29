import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pioZoneLink,readPioZoneRequest,freezePopulationMapEvidence,validatePopulationMapEvidence,loadPioZoneContext,assertPopulationMapBoundary,populationMapLines} from '../site/lib/pio-zone-context.js';
import {boundaryFingerprint} from '../site/lib/zone-population-product.js';
import {emptyRecords,makeEvent,heads,briefingSnapshot,briefingText} from '../site/lib/eoc-model.js';
import {createExerciseStore,GROUP_FOR} from '../site/lib/eoc-store.js';
import {validatePioPayload,pioStates} from '../site/lib/pio-model.js';
import {CARE_SOURCES} from '../site/lib/care-model.js';

const now=Date.now(),folder=new URL('../site/data/zone-population/',import.meta.url);
async function fixture(){
  const [meta,data,bytes]=await Promise.all([readFile(new URL('manifest.json',folder),'utf8').then(JSON.parse),readFile(new URL('zones.geojson',folder),'utf8').then(JSON.parse),readFile(new URL('evidence.json',folder))]);
  const feature=data.features.find(f=>f.properties.name==='L39'),row={oid:feature.properties.oid,key:feature.properties.key,name:'L39',status:'unknown',geometry:{rings:[[[-119.8,36.7],[-119.8,36.71],[-119.79,36.71],[-119.8,36.7]]],spatialReference:{wkid:4326}}},collection={rows:[row],checked:now};
  meta.geometryFingerprint=await boundaryFingerprint(collection.rows);
  return {meta,data,bytes,feature,row,collection,contributions:JSON.parse(bytes)[row.key],request:{oid:row.oid,key:row.key,snapshot:meta.geojson.sha256},readProduct:async()=>({meta,data})};
}
async function saved(){const f=await fixture();return {f,s:freezePopulationMapEvidence(f.meta,f.feature,f.contributions,{checked:now,captured:now})};}
function plan(s){return {kind:'Follow-up',title:'EXERCISE zone link check',location:s.zone.name,owner:'EXERCISE PIO',due:now+3600000,nextReview:'EXERCISE',status:'Open',evidence:'',pioOutreach:{schema:1,zone:{...s.zone,source:CARE_SOURCES.zones,status:'unknown',checked:now,revision:'a'.repeat(64)},languages:['English'],confirmedBy:'EXERCISE partner',confirmedAt:now,languageEvidence:'EXERCISE only',messageLanguage:'English',message:'EXERCISE ONLY — do not distribute.',channels:['EXERCISE channel'],partners:[],zoneVerifiedBy:'EXERCISE authority',zoneVerifiedAt:now,zoneEvidence:'EXERCISE source check',analysisNotes:'',populationMapEvidence:s}};}

test('zone outreach URL carries only the public ID and optional snapshot hash',()=>{
  const url=pioZoneLink(299,'a'.repeat(64));assert.equal(url,'./eoc.html?pioZone=299&populationMap='+'a'.repeat(64)+'#outreach');assert.deepEqual(readPioZoneRequest(url.split('?')[1].split('#')[0]),{oid:299,key:'county-zone:299',snapshot:'a'.repeat(64)});assert.deepEqual(readPioZoneRequest('?pioZone=299'),{oid:299,key:'county-zone:299',snapshot:null});assert.equal(readPioZoneRequest('?unrelated=x'),null);
  for(const q of ['?pioZone=-1','?pioZone=0','?pioZone=abc','?populationMap=abc','?pioZone=1&pioZone=2','?pioZone=1&populationMap=x','?pioZone=1&populationMap='+'a'.repeat(64)+'&populationMap='+'b'.repeat(64)])assert.throws(()=>readPioZoneRequest(q));
});
test('snapshot retains the exact map figures, source times, MOE, assumptions and bounded contributions',async()=>{
  const {f,s}=await saved();validatePopulationMapEvidence(s,s.zone);assert.equal(s.population,f.feature.properties.population);assert.equal(s.samplingMoe,f.feature.properties.samplingMoe);assert.equal(s.built,f.meta.built);assert.equal(s.zonesChecked,f.meta.zonesChecked);assert.equal(s.sources.acs,f.meta.source.acs);assert.match(s.limits.uncertainty,/not a complete 90% confidence interval/);assert(!JSON.stringify(s).includes('coordinates'));assert(!JSON.stringify(s).includes('rings'));
  const before=s.rows[0].population;f.contributions[0].population=999999;assert.equal(s.rows[0].population,before);
});
test('saved estimates cannot move to a different zone or discard their uncertainty',async()=>{
  const {s}=await saved();for(const mutate of [x=>x.population++,x=>x.samplingMoe=-1,x=>x.snapshot='bad',x=>x.built=Date.now()+3600000,x=>x.sources.acs='https://other.invalid',x=>delete x.limits.uncertainty,x=>x.rows[0].weight=2]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validatePopulationMapEvidence(bad,s.zone));}assert.throws(()=>validatePopulationMapEvidence(s,{...s.zone,key:'county-zone:2',oid:2}));
});
test('unknown map allocation stays unknown with its reason',async()=>{
  const f=await fixture(),feature=f.data.features.find(f=>f.properties.population===null),s=freezePopulationMapEvidence(f.meta,feature,JSON.parse(f.bytes)[feature.properties.key],{checked:now});assert.equal(s.population,null);assert.equal(s.samplingMoe,null);assert(s.reason);assert(populationMapLines(s,String).some(x=>x.includes(s.reason)));
});
test('current public boundaries and the evidence-file hash are checked before importing',async()=>{
  const f=await fixture(),calls=[],result=await loadPioZoneContext(f.request,f.collection,{readProduct:f.readProduct,fetcher:async(url,options)=>{calls.push({url:String(url),options});return new Response(f.bytes);}});assert.equal(result.zone.name,'L39');assert.equal(result.populationMap.population,f.feature.properties.population);assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'omit');assert(!calls[0].url.includes('token'));
  await assertPopulationMapBoundary(result.populationMap,f.collection.rows);
  const changed=structuredClone(f.collection.rows);changed[0].geometry.rings[0][1][1]+=.001;await assert.rejects(assertPopulationMapBoundary(result.populationMap,changed),/boundaries differ/);
  await assert.rejects(loadPioZoneContext(f.request,f.collection,{readProduct:f.readProduct,fetcher:async()=>new Response('{}')}),/different snapshot/);
});
test('stale links, missing zones and source failures never silently select a replacement estimate',async()=>{
  const f=await fixture();await assert.rejects(loadPioZoneContext({...f.request,snapshot:'b'.repeat(64)},f.collection,{readProduct:f.readProduct}),/changed since/);await assert.rejects(loadPioZoneContext(f.request,{rows:[],checked:now}),/no longer returned/);await assert.rejects(loadPioZoneContext(f.request,f.collection,{readProduct:f.readProduct,fetcher:async()=>new Response('',{status:503})}),/HTTP 503/);
  const live=await loadPioZoneContext({...f.request,snapshot:null},f.collection,{readProduct:()=>{throw Error('Must not read map snapshot');}});assert.equal(live.populationMap,null);assert.equal(live.zone.key,f.row.key);
});
test('snapshot evidence delivery bytes remain reproducible',async()=>{const f=await fixture();assert.equal(f.bytes.length,f.meta.evidence.bytes);assert.equal(createHash('sha256').update(f.bytes).digest('hex'),f.meta.evidence.sha256);});
test('a PIO version chooses either the frozen map or live calculated population evidence',async()=>{const {s}=await saved(),p=plan(s);validatePioPayload(p);p.pioOutreach.populationEvidence={};assert.throws(()=>validatePioPayload(p),/Choose one/);assert.equal(GROUP_FOR.coordination,'coordinators');});
test('map context survives private recording and exact briefing snapshots; later edits need new approval',async()=>{
  const {s}=await saved(),records=emptyRecords(),store=createExerciseStore(),incident='zone-link-test';
  const add=async(key,payload,options={})=>{const r=await store.append(makeEvent(key,payload,{incident,...options}),records);records[key].push(r);return r;};
  const r=await add('coordination',plan(s));await add('approvals',{kind:'pio-outreach',outreachEvent:r.id,status:'Approved',decisionBy:'EXERCISE approver',decidedAt:now,evidence:'EXERCISE only'});assert(pioStates(records,{heads})[0].approved);
  const period=await add('periods',{label:'EXERCISE period',start:now,end:now+3600000,nextBriefing:now+1800000,objectives:'EXERCISE handoff'}),b=await briefingSnapshot({records,notifications:[],sourceHealth:[],period,scope:'pio',zoneKey:s.zone.key}),original=structuredClone(b);
  const text=briefingText({id:'brief',payload:{title:'EXERCISE',...b},author:'EXERCISE'},null);for(const expected of ['saved population map estimate','2020–2024',s.snapshot,'Total zone uncertainty is not quantified',s.sources.acs])assert(text.includes(expected),expected);
  const p=plan(s);p.title='EXERCISE revised purpose';await add('coordination',p,{entity:r.entity,supersedes:[r.id]});assert.equal(pioStates(records,{heads})[0].approved,false);assert.equal(records.approvals.length,1);assert.deepEqual(b,original);
});
test('public links and private workspace do not persist or transmit private form values',async()=>{
  const [ui,context,page]=await Promise.all(['../site/lib/pio-ui.js','../site/lib/pio-zone-context.js','../site/zone-population.js'].map(p=>readFile(new URL(p,import.meta.url),'utf8')));assert(!/localStorage|sessionStorage|sendBeacon|postMessage/.test(ui+context));assert(page.includes('Open private PIO outreach for this zone'));assert(ui.includes('assertPopulationMapBoundary'));assert(ui.includes('rows=request?allRows.filter'));assert(context.includes('credentials:\'omit\''));
});
