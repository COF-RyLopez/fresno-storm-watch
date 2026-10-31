import {POPULATION_SOURCES,POPULATION_METHOD,POPULATION_LIMIT,approximatePopulation} from './population-model.js?v=0.73.1';
import {ZONE_ACS_METHOD,ZONE_ACS_LIMIT,ZONE_ACS_ERROR,ZONE_ACS_BOUNDARIES,summarizeZoneAcs} from './zone-acs-model.js?v=0.67.0';
import {CARE_SOURCES} from './care-model.js?v=0.74.0-helpers';

const methods={allocation:ZONE_ACS_METHOD,baseline:POPULATION_METHOD,sampling:ZONE_ACS_ERROR,limits:ZONE_ACS_LIMIT+' '+POPULATION_LIMIT};
const count=value=>value===null||Number.isFinite(value)&&value>=0;
const date=value=>value===null||Number.isFinite(value)&&value>0&&value<=Date.now()+300000;
const optionalDate=value=>value===0||value===undefined?null:value;
const close=(a,b)=>a===null||b===null?a===b:Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-9;

/** Whitelist public evidence only: no geometry, full source collections or private form fields. */
export function freezePopulationEvidence({zone,newer=null,baseline=null,baselineMeta=null,errors=[],exercise=false,captured=Date.now()}){
  const snapshot={schema:1,methodVersion:'frog-zone-population/1',exercise,captured,zone:Object.fromEntries(['source','key','oid','name','status','checked','revision'].map(key=>[key,zone[key]])),sources:{
    acs:{item:POPULATION_SOURCES.acsItem,url:POPULATION_SOURCES.acs,period:newer?.period??null,checked:newer?.sourceChecked??null,modified:optionalDate(newer?.metadata?.modified),edited:optionalDate(newer?.metadata?.edited)},
    boundaries:{url:ZONE_ACS_BOUNDARIES.url,vintage:ZONE_ACS_BOUNDARIES.vintage,checked:newer?.boundaries?.checked??null},
    blocks:{item:POPULATION_SOURCES.blocksItem,url:POPULATION_SOURCES.blocks,year:2020,checked:baselineMeta?.checked??null,edited:optionalDate(baselineMeta?.edited)}
  },methods:{...methods},newer:newer?{estimate:newer.estimate,samplingMoe:newer.samplingMoe,tracts:newer.tracts,missing:newer.missing,missingMoe:newer.missingMoe,calculated:newer.checked,rows:newer.rows.map(row=>({id:row.id,population:row.population,moe:row.moe,weight:row.weight,baselineWithin:row.baselineWithin,baselineTotal:row.baselineTotal,blockChecked:row.blockChecked??null,blockEdited:optionalDate(row.blockEdited),reason:row.reason??null}))}:null,
    baseline:baseline?{estimate:baseline.estimate,blocks:baseline.blocks,missing:baseline.missing,wholePopulation:baseline.wholePopulation,boundaryPopulation:baseline.boundaryPopulation,wholeBlocks:baseline.wholeBlocks,boundaryBlocks:baseline.boundaryBlocks}:null,
    errors:errors.map(error=>({source:error.source,detail:String(error.detail).slice(0,500)}))};
  validatePopulationEvidence(snapshot,zone);return structuredClone(snapshot);
}

/** Validate saved values independently of current feeds; exact briefing versions never refresh. */
export function validatePopulationEvidence(s,zone){
  if(s?.schema!==1||s.methodVersion!=='frog-zone-population/1'||typeof s.exercise!=='boolean'||!date(s.captured)||s.captured===null)throw Error('Population evidence version or capture time is invalid.');
  const z=s.zone;
  if(z?.source!==CARE_SOURCES.zones||z.key!==zone.key||z.name!==zone.name||z.oid!==zone.oid||!/^county-zone:\d+$/.test(z.key)||!['Order','Warn','Lifted','unknown'].includes(z.status)||!date(z.checked)||z.checked===null||!/^[a-f0-9]{64}$/.test(z.revision||''))throw Error('Population evidence must retain the same county zone.');
  const a=s.sources?.acs,b=s.sources?.blocks,t=s.sources?.boundaries;
  if(a?.url!==POPULATION_SOURCES.acs||a.item!==POPULATION_SOURCES.acsItem||b?.url!==POPULATION_SOURCES.blocks||b.item!==POPULATION_SOURCES.blocksItem||b.year!==2020||t?.url!==ZONE_ACS_BOUNDARIES.url||t.vintage!==ZONE_ACS_BOUNDARIES.vintage)throw Error('Population evidence source references are invalid.');
  for(const d of [a.checked,a.modified,a.edited,b.checked,b.edited,t.checked])if(!date(d))throw Error('Population source date is invalid.');
  if(!s.methods||Object.keys(methods).some(key=>typeof s.methods[key]!=='string'||!s.methods[key].trim()||s.methods[key].length>2000))throw Error('Population evidence needs saved methods and uncertainty.');
  if(!Array.isArray(s.errors)||s.errors.length>2||s.errors.some(e=>!['acs','baseline'].includes(e.source)||typeof e.detail!=='string'||!e.detail.trim()||e.detail.length>500))throw Error('Population source failure evidence is invalid.');
  if(s.newer){
    const n=s.newer;if(a.period!==ZONE_ACS_BOUNDARIES.period||a.checked===null||!date(n.calculated)||n.calculated===null||!Array.isArray(n.rows)||n.rows.length>500)throw Error('Saved ACS period, time or tract evidence is invalid.');
    const total=summarizeZoneAcs(n.rows);if(!close(n.estimate,total.estimate)||!close(n.samplingMoe,total.samplingMoe)||n.tracts!==total.tracts||n.missing!==total.missing||n.missingMoe!==total.missingMoe)throw Error('Saved ACS allocation does not reconcile to its source weights.');
    for(const row of n.rows)if(!count(row.baselineWithin)||!count(row.baselineTotal)||!date(row.blockChecked)||!date(row.blockEdited)||row.reason!==null&&(typeof row.reason!=='string'||row.reason.length>500))throw Error('Saved block-pattern evidence is invalid.');
  }else if(!s.errors.some(e=>e.source==='acs'))throw Error('Unavailable ACS evidence needs a recorded failure.');
  if(s.baseline){const r=s.baseline;if(!count(r.estimate)||!['blocks','missing','wholePopulation','boundaryPopulation','wholeBlocks','boundaryBlocks'].every(key=>Number.isInteger(r[key])&&r[key]>=0)||r.blocks!==r.wholeBlocks+r.boundaryBlocks||r.missing>r.blocks||r.missing&&r.estimate!==null||!r.blocks&&r.estimate!==null||b.checked===null||r.estimate!==null&&(r.estimate<r.wholePopulation-1e-6||r.estimate>r.wholePopulation+r.boundaryPopulation+1e-6))throw Error('Saved 2020 baseline is invalid.');}
  else if(!s.errors.some(e=>e.source==='baseline'))throw Error('Unavailable baseline needs a recorded failure.');
  if(JSON.stringify(s).length>45000)throw Error('Population evidence exceeds the private record size budget. No evidence was truncated.');
  return s;
}

export function populationEvidenceSummary(s){return s?`${s.exercise?'EXERCISE illustrative · ':''}${approximatePopulation(s.newer?.estimate)} newer planning residents (${s.sources.acs.period||'ACS unavailable'}) · ${approximatePopulation(s.baseline?.estimate)} separate 2020 baseline`:'Population evidence not captured; no affected-person count is inferred.';}

/** Human-readable handoff uses only frozen values and wording, never a live query. */
export function populationEvidenceLines(s,zone,time){
  if(!s)return [populationEvidenceSummary(null)];
  const n=s.newer,a=s.sources.acs,b=s.sources.blocks,t=s.sources.boundaries;
  return [populationEvidenceSummary(s),`Population evidence captured ${time(s.captured)} · method ${s.methodVersion} · zone ${s.zone.name} / ${s.zone.key} · queried ${time(s.zone.checked)} · revision ${s.zone.revision}`,
    ...(s.zone.revision!==zone.revision?['REVIEW: population evidence is tied to an older county zone revision; do not apply it to the current boundary/status without review.']:[]),
    `ACS source period ${a.period||'Unavailable'} · queried ${time(a.checked)} · item modified ${time(a.modified)} · layer edited ${time(a.edited)} · allocation calculated ${time(n?.calculated)}. Capture/query times are not new population observations.`,a.item,a.url,
    `Analysis boundaries: ${t.vintage} · queried ${time(t.checked)} · ${t.url}`,
    `2020 Census blocks · queried ${time(b.checked)} · publisher edited ${time(b.edited)} · ${b.item} · ${b.url}`,
    `Sampling-only MOE component: ${n?.samplingMoe===null||!n?'Unavailable':'± '+Math.ceil(n.samplingMoe)+' residents'}. Total zone uncertainty is not quantified.`,
    ...Object.values(s.methods),
    ...(n?.rows||[]).map(r=>`Tract ${r.id}: published total ${r.population??'Unknown'}; 90% MOE ${r.moe??'Unknown'}; fixed weight ${r.weight??'Unknown'}; 2020 pattern ${r.baselineWithin??'Unknown'} / ${r.baselineTotal??'Unknown'}; blocks queried ${time(r.blockChecked)} / edited ${time(r.blockEdited)}${r.reason?'; '+r.reason:''}`),
    ...s.errors.map(e=>`UNAVAILABLE ${e.source}: ${e.detail}`),
    'Age, language and household values are whole-tract context and are not allocated to this zone. Population does not confirm current occupancy, an order, communication needs or delivery.'
  ];
}
