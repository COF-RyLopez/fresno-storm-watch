/** Co-located planning evidence, not a hazard score, PSPS prediction or resource order. */
import {HOUR,windAt,intervalAt} from './weather-model.js';
import {pointInRings} from './power-geometry.js';
import {POWER_FEEDS,powerHealth,powerRowIssues} from './power-model.js';

const HORIZON=72*HOUR,CHECK_MAX=7*60_000;
const ACTIVE=new Set(['consideration','warning','psps','outage','unknown']);
const PSPS=new Set(['consideration','warning','psps']);
const dated=t=>Number.isFinite(t)&&t>0;

/** @param {object} settings @param {object[]} areas @param {object[]} sites @returns {object} Reject unverified associations instead of choosing a nearest sample. */
export function validateAreaConcerns(settings,areas,sites){
  if(settings?.version!==1||settings.windThresholdMph!==null||settings.areas?.length!==areas.length||new Set(settings.areas.map(a=>a.id)).size!==areas.length)throw new Error('Area concern configuration is invalid.');
  for(const a of settings.areas)if(!areas.some(r=>r.id===a.id)||!a.note||!Array.isArray(a.windPoints)||new Set(a.windPoints).size!==a.windPoints.length||a.windPoints.some(id=>!sites.some(s=>s.id===id)))throw new Error('Area wind association is invalid.');
  return settings;
}

/** @param {object} state @param {string[]} ids @param {number} now @returns {object} Exact valid intervals in a fixed 72 h window; no hourly peak approximation. */
export function areaWindEvidence(state,ids,now=Date.now()){
  const gaps=[],samples=[],end=now+HORIZON;
  const checked=state?.checked,generated=Date.parse(state?.snapshot?.generatedAt);
  const collectionBad=!!state?.error||!dated(checked)||checked>now+120_000||now-checked>CHECK_MAX||!Number.isFinite(generated)||generated>now+120_000||now-generated>45*60_000;
  for(const id of ids){
    const site=state?.snapshot?.sites.find(s=>s.id===id),reason=windAt(site,now,now,collectionBad).reason;
    if(reason){gaps.push(`${id}: ${state?.error||site?.error||reason}`);continue;}
    const values={};
    for(const key of ['windSpeed','windGust']){
      const spans=site.forecast.series[key].filter(s=>s.value!==null&&s.end>now&&s.start<end).map(s=>({...s,sourceStart:s.start,sourceEnd:s.end,start:Math.max(s.start,now),end:Math.min(s.end,end)}));
      const peak=spans.slice().sort((a,b)=>b.value-a.value||a.start-b.start)[0]||null;
      const hours=spans.reduce((sum,s)=>sum+s.end-s.start,0)/HOUR;
      values[key]={peak,hours};
      if(hours<72-1/3600)gaps.push(`${id}: ${key==='windGust'?'gust':'sustained wind'} has missing intervals within the next 72 h (${hours.toFixed(1)} h with values)`);
    }
    samples.push({id,name:site.name,longitude:site.longitude,latitude:site.latitude,issued:site.forecast.issued,lastSuccess:Date.parse(site.lastSuccess),...values,
      gustDirection:values.windGust.peak?intervalAt(site.forecast.series.windDirection,values.windGust.peak.start)?.value??null:null});
  }
  if(!ids.length)gaps.push('No wind sample assigned to this reach');
  const maximum=key=>samples.filter(s=>s[key].peak).map(s=>({...s[key].peak,id:s.id,name:s.name,issued:s.issued,direction:s.gustDirection})).sort((a,b)=>b.value-a.value||a.start-b.start||a.id.localeCompare(b.id))[0]||null;
  return {start:now,end,checked,generated,sourceMode:state?.snapshot?.sourceMode,samples,gaps,gust:maximum('windGust'),sustained:maximum('windSpeed')};
}

/** @param {object} state @param {object[]} points @param {number} now @param {object} prior @returns {object} Polygon containment only; duplicates count once and disappearance needs verification. */
export function areaPowerEvidence(state,points,now=Date.now(),prior=null){
  const rows=state?.rows||[],feeds=state?.feeds||[],matches=[];
  const gaps=POWER_FEEDS.map(spec=>{const f=feeds.find(f=>f.id===spec.id);return powerHealth(f,now)?`${spec.label}: ${powerHealth(f,now)}`:null;}).filter(Boolean);
  if(state?.error)gaps.push(`Power snapshot check failed: ${state.error}`);
  let pointOnly=0;
  for(const row of new Map(rows.map(r=>[r.key,r])).values()){
    const polygons=row.geometries.filter(g=>g.rings);
    if(!polygons.length){if(ACTIVE.has(row.status))pointOnly++;continue;}
    const at=points.filter(p=>polygons.some(g=>pointInRings([p.longitude,p.latitude],g.rings)));
    if(!at.length)continue;
    const issues=powerRowIssues(row,now),feed=feeds.find(f=>f.id===row.feedId);
    const problem=state?.error||powerHealth(feed,now)||row.health||issues.find(s=>/passed|ended|24 hours|future|differ|conflict|Unrecognized/i.test(s))||(!dated(row.updated?.time)?'Utility record update time is unknown':null)||(dated(row.start?.time)&&dated(row.end?.time)&&row.end.time<=row.start.time?'Published start/end times conflict':null);
    const outside=dated(row.start?.time)&&row.start.time>=now+HORIZON;
    const eligible=ACTIVE.has(row.status)&&row.status!=='unknown'&&!problem&&!outside;
    const start=dated(row.start?.time)?Math.max(now,row.start.time):null,end=dated(row.end?.time)?Math.min(now+HORIZON,row.end.time):null;
    const window=start!==null&&end!==null&&end>start?{start,end}:null;
    matches.push({row,points:at,eligible,psps:PSPS.has(row.status),window,outside,problem:problem||(outside?'Published start is beyond the next 72 hours':null)});
  }
  const active=matches.filter(m=>m.eligible),pending=matches.filter(m=>ACTIVE.has(m.row.status)&&!m.eligible&&!m.outside);
  const candidates=[...(prior?.active||[]),...(prior?.pending||[]),...(prior?.followups||[])];
  const followups=[...new Map(candidates.filter(m=>!matches.some(n=>n.row.key===m.row.key&&ACTIVE.has(n.row.status)&&!n.outside)).map(m=>[m.row.key,m])).values()];
  const timingUnknown=active.filter(m=>m.psps&&!m.window),verification=[...new Map([...pending,...followups,...timingUnknown].map(m=>[m.row.key,m])).values()];
  return {matches,active,pending,followups,timingUnknown,verification,gaps,pointOnly,psps:active.filter(m=>m.psps),outages:active.filter(m=>!m.psps),checked:state?.checked};
}

/** @param {object} input @param {number} now @returns {object[]} Preserve river semantics and add separate wind context / utility match / follow-up evidence. */
export function combineAreaConcerns({rows,associations,windSites,points,wind,power,previous=[]},now=Date.now()){
  if(wind?.snapshot)wind={...wind,snapshot:{...wind.snapshot,sites:wind.snapshot.sites.map(s=>{const expected=windSites.find(p=>p.id===s.id);return !expected||Math.abs(s.longitude-expected.longitude)>1e-6||Math.abs(s.latitude-expected.latitude)>1e-6?{...s,error:'Configured wind point moved; verify its location'}:s;})}};
  return rows.map(row=>{
    const a=associations.areas.find(a=>a.id===row.area.id);
    const samplePoints=[...new Map([...points.filter(p=>row.area.rainPoints.includes(p.id)),...windSites.filter(p=>a.windPoints.includes(p.id))].map(p=>[p.id,p])).values()];
    const windEvidence=areaWindEvidence(wind,a.windPoints,now),powerEvidence=areaPowerEvidence(power,samplePoints,now,previous.find(r=>r.area.id===row.area.id)?.power);
    const riverReview=row.review,pspsRiver=riverReview&&!!powerEvidence.psps.length,powerRiver=riverReview&&!!powerEvidence.active.length;
    const windContext=!!windEvidence.gust||!!windEvidence.sustained;
    // This is co-location in a planning horizon, not proof of simultaneous river arrival and shutoff.
    const paired=powerEvidence.psps.map(m=>({key:m.row.key,window:m.window,gust:m.window?windEvidence.samples.filter(s=>m.row.geometries.some(g=>g.rings&&pointInRings([s.longitude,s.latitude],g.rings))).flatMap(s=>{
      const source=wind?.snapshot?.sites.find(p=>p.id===s.id);return source.forecast.series.windGust.filter(v=>v.value!==null&&v.end>m.window.start&&v.start<m.window.end).map(v=>({...v,id:s.id,start:Math.max(v.start,m.window.start),end:Math.min(v.end,m.window.end)}));
    }).sort((a,b)=>b.value-a.value||a.start-b.start)[0]||null:null}));
    const review=riverReview||!!(powerEvidence.active.length||powerEvidence.pending.length||powerEvidence.followups.length);
    const rank=Math.max(row.rank,review?3:0);
    const status=pspsRiver?`PSPS + river review${windContext?' · wind forecast context':''}`:powerRiver?'Outage + river review':powerEvidence.active.length?'Utility match at watchpoints — review':powerEvidence.pending.length||powerEvidence.followups.length?'Utility match needs verification':row.status;
    return {...row,riverReview,review,rank,status,wind:windEvidence,power:powerEvidence,association:a,samplePoints,pspsRiver,powerRiver,windContext,paired,
      gaps:[...row.gaps,...windEvidence.gaps,...powerEvidence.gaps,...powerEvidence.timingUnknown.map(m=>`${m.row.utility} ${m.row.name}: PSPS start/end timing unconfirmed`),...paired.filter(p=>p.window&&!p.gust).map(()=> 'No usable wind sample inside a matched PSPS polygon during its published window')]};
  }).sort((a,b)=>Number(b.threshold)-Number(a.threshold)||Number(b.pspsRiver)-Number(a.pspsRiver)||Number(b.powerRiver)-Number(a.powerRiver)||b.rank-a.rank||a.area.name.localeCompare(b.area.name));
}
