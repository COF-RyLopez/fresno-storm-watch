/** Explainable review cues; no flood model, risk score or staging-site selection. */
import { assessGauge, HOUR } from './river-model.js';
import { qpfCycle, realNumber, reservoirMetricState } from './environment-model.js';
import {scheduleEvidence} from './release-model.js';

/** @param {object} areaConfig @param {object[]} gauges @param {object[]} reservoirs @returns {object[]} Validate associations before any source queries. */
export function planningPoints(areaConfig,gauges,reservoirs){
  const all=new Map([...gauges,...reservoirs].map(s=>[s.id,s]));
  if(areaConfig?.version!==1||areaConfig.qpfPeriod?.id!==9||areaConfig.qpfPeriod?.hours!==72||!Array.isArray(areaConfig.areas)||areaConfig.areas.length!==7||new Set(areaConfig.areas.map(a=>a.id)).size!==7)throw new Error('River-area configuration is invalid.');
  const ids=new Set();
  for(const area of areaConfig.areas){
    if(!area.name||!area.note||!Array.isArray(area.gauges)||!Array.isArray(area.releases)||!area.rainPoints?.length)throw new Error('River-area evidence contract is incomplete.');
    for(const id of area.gauges)if(!gauges.some(s=>s.id===id))throw new Error('Unknown gauge association.');
    for(const r of area.releases){
      if(!((r.station==='MIL'&&['release','spill'].includes(r.metric))||(r.station==='PNF'&&r.metric==='outflow'))||!reservoirs.find(s=>s.id===r.station)?.metrics.some(m=>m.key===r.metric))throw new Error('Unverified river-release association.');
    }
    for(const id of area.rainPoints){const p=all.get(id);if(!p||!Number.isFinite(p.longitude)||!Number.isFinite(p.latitude)||p.longitude< -121||p.longitude> -118||p.latitude<35||p.latitude>38)throw new Error('Rainfall sampling location is invalid.');ids.add(id);}
  }
  return [...ids].sort().map(id=>({...all.get(id),id}));
}

/** @param {object} payload @param {object} cycle @param {number} now @returns {object} Point intersection values remain polygon labels, never basin means. */
export function qpfPointValue(payload,cycle,now=Date.now()){
  if(payload?.error||payload?.exceededTransferLimit||!Array.isArray(payload?.features))throw new Error('Point forecast query is incomplete.');
  if(!payload.features.length)return {value:null,labels:[],reason:'No forecast polygon returned; amount unknown'};
  const checked=qpfCycle(payload,72,now);
  if(['issue','start','end','product'].some(k=>checked[k]!==cycle[k]))throw new Error('Point forecast changed cycle during collection.');
  const values=payload.features.map(f=>realNumber(f.attributes?.qpf));
  if(values.some(v=>v===null||v<0))throw new Error('Invalid forecast amount at sample point.');
  const labels=[...new Set(values)].sort((a,b)=>a-b);
  return {value:Math.max(...labels),labels,reason:labels.length>1?'Highest intersecting polygon label; overlapping contours/boundary':'Publisher polygon label at this point'};
}

/** @param {object} state @param {object} area @param {object[]} points @param {object} config @param {number} now @returns {object} A fresh cycle does not imply every point returned a value. */
function rainfallEvidence(state,area,points,config,now){
  const cycle=state?.cycle;
  const usable=!state?.error&&cycle&&Number.isFinite(state.checked)&&now-state.checked<=config.weatherCheckMaxAgeMs&&now>=state.checked-120_000&&now-cycle.issue<=config.qpfMaxAgeMs&&cycle.issue<=now+300_000&&cycle.end>now&&cycle.hours===72;
  const samples=area.rainPoints.map(id=>{
    const row=state?.points?.[id],point=points.find(p=>p.id===id);
    return {id,name:point?.name||id,value:usable&&!row?.error&&Number.isFinite(row?.value)?row.value:null,reason:!usable?(state?.error||'Forecast cycle unavailable, expired or check overdue'):row?.error||row?.reason||'Sample not returned',labels:row?.labels||[]};
  });
  const valid=samples.filter(p=>p.value!==null);
  return {cycle,checked:state?.checked,samples,usable:!!usable,positive:valid.some(p=>p.value>0),maximum:valid.length?Math.max(...valid.map(p=>p.value)):null,gaps:samples.filter(p=>p.value===null).length};
}

/** @param {object} input @param {object} association @param {number} now @returns {object} Only consecutive valid, current CDEC observations can produce an increase cue. */
export function releaseEvidence(input,association,now){
  const station=input.selection?.stations.find(s=>s.id===association.station),metric=station?.metrics.find(m=>m.key===association.metric);
  const row=input.snapshot?.stations.find(s=>s.id===association.station),series=row?.metrics?.[association.metric];
  const assessed=metric?reservoirMetricState(series,metric,now):{sample:null,tone:'gap',label:'Metric unavailable'};
  const generated=Date.parse(input.snapshot?.generatedAt),lastSuccess=Date.parse(row?.lastSuccess),checked=input.checked;
  const collectionCurrent=!input.error&&!row?.error&&Number.isFinite(generated)&&Number.isFinite(lastSuccess)&&Number.isFinite(checked)&&generated<=now+120_000&&lastSuccess<=now+120_000&&checked<=now+120_000&&now-generated<=input.config.collectorMaxAgeMs&&now-lastSuccess<=input.config.collectorMaxAgeMs&&now-checked<=input.config.weatherCheckMaxAgeMs;
  const contract=metric&&series?.sensor===metric.sensor&&series?.duration===metric.duration&&series?.units===metric.units;
  const current=!!collectionCurrent&&!!contract&&assessed.tone==='normal';
  const sample=assessed.sample;
  const ordered=(series?.samples||[]).filter(p=>Number.isFinite(p.time)&&p.time<=now).sort((a,b)=>a.time-b.time);
  const index=sample?ordered.findIndex(p=>p.time===sample.time):-1,prior=index>0?ordered[index-1]:null;
  const hours=sample&&prior?(sample.time-prior.time)/HOUR:null;
  const maxHours=metric?.duration==='D'?25:1.5,minHours=metric?.duration==='D'?23:0.5;
  const comparable=current&&prior&&Number.isFinite(prior.value)&&!prior.flag&&prior.units===metric.units&&hours>=minHours&&hours<=maxHours;
  const delta=comparable?sample.value-prior.value:null;
  return {station:station?.id||association.station,name:station?.name||association.station,label:metric?.label||association.metric,metric:association.metric,source:station?.source,duration:metric?.duration,sample,prior:comparable?prior:null,hours:comparable?hours:null,delta,current,increasing:delta!==null&&Math.round(delta)>0,reason:!collectionCurrent?'Collection failed, missing or overdue':!contract?'Metric identity/units changed':assessed.tone!=='normal'?assessed.label:!comparable?'No consecutive valid comparison':'Comparable source reports'};
}

/** @param {number|null} value @param {string} units @returns {boolean} Report differences at display precision; this is not an action threshold. */
export function positiveChange(value,units){return Number.isFinite(value)&&Math.round(value*(units==='kcfs'?1000:100))>0;}

/** @param {object} input @param {number} now @returns {object[]} Fixed scope and 72-hour gauge horizon; filters and map position never enter this function. */
export function evaluateAreas(input,now=Date.now()){
  const {areas,points,gaugeEntries,riverConfig,reservoirs,rain,environmentConfig}=input;
  return areas.map(area=>{
    const gauges=area.gauges.map(id=>{
      const entry=gaugeEntries.get(id),gauge=entry?.gauge??null;
      return {id,gauge,assessment:assessGauge(gauge,riverConfig,72,now,entry?.error??null)};
    });
    const rainfall=rainfallEvidence(rain,area,points,environmentConfig,now);
    const releases=area.releases.map(a=>releaseEvidence({...reservoirs,config:environmentConfig},a,now));
    const schedules=[...new Set(area.releases.map(a=>a.station))].map(id=>scheduleEvidence({...reservoirs,config:environmentConfig},id,now));
    const scheduled=schedules.flatMap(s=>s.cues);
    const threshold=gauges.some(g=>g.assessment.tone==='threshold');
    const rising=gauges.filter(g=>g.assessment.current&&positiveChange(g.assessment.trend?.delta,g.gauge.observed.units));
    const higher=gauges.filter(g=>positiveChange(g.assessment.delta,g.gauge?.forecast.units));
    const increased=releases.filter(r=>r.increasing);
    const change=!!(rising.length||higher.length||increased.length||scheduled.length);
    const gaps=[];
    if(!gauges.length)gaps.push('No downstream gauge connected');
    for(const g of gauges)if(!g.assessment.current||!g.assessment.forecastUsable)gaps.push(`${g.id}: ${!g.assessment.current?'observation unavailable/old':'forecast unavailable/old'}`);
    if(rainfall.gaps)gaps.push(`${rainfall.gaps}/${rainfall.samples.length} rainfall sample amounts unknown`);
    for(const r of releases)if(!r.current||r.delta===null)gaps.push(`${r.station} ${r.label}: ${r.reason}`);
    for(const s of schedules){if(!s.current)gaps.push(`${s.station} release notices: ${s.reason}`);else if(s.pending.length)gaps.push(`${s.station}: ${s.pending.length} release notice(s) need verification`);}
    const rank=threshold?4:change?3:rainfall.positive?2:gaps.length?1:0;
    const status=threshold?'Published NWS threshold cue':scheduled.length?'Scheduled release — review':change?(rainfall.positive?'Rain + river change — review':'River change — review'):rainfall.positive?'Rain forecast — monitor':gaps.length?'Incomplete evidence':'No current change cue';
    return {area,gauges,rainfall,releases,schedules,scheduled,rising,higher,increased,gaps,rank,status,review:rank>=3,threshold,unknownThresholds:gauges.filter(g=>!g.assessment.thresholdKnown).length};
  }).sort((a,b)=>b.rank-a.rank||a.area.name.localeCompare(b.area.name));
}
