/** Comparable time windows, not a routed reservoir-to-gauge forecast. */
import {HOUR,assessGauge,convertRiverUnits} from './river-model.js';
import {reservoirMetricState} from './environment-model.js';
import {scheduleEvidence} from './release-model.js';

export const TREND_REACHES=Object.freeze({
  MIL:{name:'Millerton / Friant → San Joaquin',metric:'release',gauges:['SJXC1','RSBC1','GVAC1','SJMC1'],note:'River outlet release only. Spill is shown separately in reservoir conditions; total reservoir outflow includes other outlets and is excluded. Diversions and intervening controls are not modeled.'},
  PNF:{name:'Pine Flat → Kings River',metric:'outflow',gauges:[],note:'No current downstream Kings gauge is connected. Trimmer and North Fork gauges are upstream and are not substituted. The former USGS 11221500 site has no current continuous record.'}
});

/** @param {object[]} points @param {number} maxGapMs @returns {object[][]} Missing/flagged samples explicitly break a line; zero remains valid. */
export function trendSegments(points,maxGapMs){
  const segments=[];let current=[];
  for(const p of points){
    if(!Number.isFinite(p.value)){if(current.length)segments.push(current);current=[];continue;}
    if(current.length&&p.time-current.at(-1).time>maxGapMs){segments.push(current);current=[];}
    current.push(p);
  }
  if(current.length)segments.push(current);
  return segments;
}

/** @param {object|null} raw @param {string} measure @param {number} start @param {number} end @returns {object} Do not mix stage with discharge or silently choose another measure. */
export function gaugeTrendSeries(raw,measure,start,end){
  const primary=raw?.name?.toLowerCase()===measure,secondary=raw?.secondaryName?.toLowerCase()===measure;
  const from=primary?raw.units:secondary?raw.secondaryUnits:null,units=measure==='flow'?'cfs':'ft';
  const supported=from&&convertRiverUnits(1,from,units)!==null;
  const points=supported?(raw.points||[]).filter(p=>p.time>=start&&p.time<=end).map(p=>({time:p.time,value:convertRiverUnits(primary?p.value:p.secondary,from,units),kind:'observation'})):[];
  return {points,units,supported:!!supported};
}

/** @param {object} input @returns {object} A single clock and x-domain for the paired charts. */
export function buildReleaseTrend({stationId='MIL',gaugeId='SJXC1',measure='flow',historyHours=168,futureHours=72,reservoirs={},entries=new Map(),config,now=Date.now()}){
  const reach=TREND_REACHES[stationId];
  if(!reach||![72,168].includes(historyHours)||![72,168].includes(futureHours)||!['flow','stage'].includes(measure))throw new Error('Invalid release trend selection.');
  const start=now-historyHours*HOUR,end=now+futureHours*HOUR;
  const station=reservoirs.selection?.stations.find(s=>s.id===stationId),row=reservoirs.snapshot?.stations.find(s=>s.id===stationId);
  const metric=station?.metrics.find(m=>m.key===reach.metric),raw=row?.metrics?.[reach.metric];
  const contract=metric&&raw?.sensor===metric.sensor&&raw.duration===metric.duration&&raw.units==='CFS';
  const daily=metric?.duration==='D';
  // CDEC daily records are calendar summaries, not instantaneous midnight measurements.
  const observed=contract?(raw.samples||[]).map(p=>({...p,sourceTime:p.time,time:p.time+(daily?12*HOUR:0),value:typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>=0&&!p.flag&&!p.conflict?p.value:null,kind:daily?'daily report':'observation'})).filter(p=>p.time>=start&&p.time<=now):[];
  const state=metric?reservoirMetricState(raw,metric,now):{label:'No release series',tone:'gap'};
  const schedule=scheduleEvidence({...reservoirs,config:config.environment},stationId,now);
  const notices=schedule.notices.filter(n=>n.time>=start&&n.time<=end);
  const markers=notices.filter(n=>n.valid).map(n=>({...n,kind:'scheduled',current:schedule.current}));
  const releaseFresh=[Date.parse(row?.lastSuccess),Date.parse(reservoirs.snapshot?.generatedAt)].every(t=>Number.isFinite(t)&&t<=now+120000&&now-t<=config.environment.collectorMaxAgeMs)&&Number.isFinite(reservoirs.checked)&&reservoirs.checked<=now+120000&&now-reservoirs.checked<=config.environment.weatherCheckMaxAgeMs&&!row?.error&&!reservoirs.error;
  const release={title:daily?'River outlet release · daily reports':'Reported outflow / release · hourly',units:'cfs',observed,forecast:[],daily,current:!!releaseFresh&&state.tone!=='gap',health:[state.label,!releaseFresh?'Collection failed or overdue · retained history':null].filter(Boolean).join(' · '),source:station?.source||null,collected:Date.parse(row?.lastSuccess),metric};
  const selected=reach.gauges.includes(gaugeId)?gaugeId:reach.gauges[0]||null,entry=selected?entries.get(selected):null,g=entry?.gauge;
  const assessment=assessGauge(g,config.rivers,futureHours,now,entry?.error||null);
  const obs=gaugeTrendSeries(g?.observed,measure,start,now),fc=gaugeTrendSeries(g?.forecast,measure,now,end);
  const observationCurrent=assessment.current&&Number.isFinite(obs.points.at(-1)?.value)&&now-obs.points.at(-1).time<=config.rivers.observationMaxAgeMs;
  const hasForecast=fc.points.some(p=>Number.isFinite(p.value)),forecastCurrent=assessment.forecastUsable&&hasForecast;
  const gauge={id:selected,title:g?.name||selected||'Downstream gauge coverage',units:obs.units,observed:obs.points,forecast:fc.points.map(p=>({...p,kind:'NWS forecast'})),daily:false,current:observationCurrent,forecastCurrent,issued:g?.forecast?.issued??null,checked:g?.fetched??null,source:g?.sourceUrl||null,health:!selected?'Coverage gap':!g?(entry?.error||'Waiting for NWPS gauge'):`${observationCurrent?'Current observation':'Observation missing, old or unverified'} · ${hasForecast?forecastCurrent?'Published forecast':'Forecast old / unverified':'No forecast for this measure'}${obs.supported?'':' · Measure unavailable'}`};
  const flowValues=[...release.observed,...markers,...(measure==='flow'?[...gauge.observed,...gauge.forecast]:[])].map(p=>p.value).filter(Number.isFinite);
  const sharedFlowDomain=[Math.min(0,...flowValues)*1.1,Math.max(1,...flowValues)*1.1];
  const stageValues=[...gauge.observed,...gauge.forecast].map(p=>p.value).filter(Number.isFinite);
  const stageMargin=stageValues.length?Math.max(.1,(Math.max(...stageValues)-Math.min(...stageValues))*.15):.1;
  const stageDomain=stageValues.length?[Math.min(...stageValues)-stageMargin,Math.max(...stageValues)+stageMargin]:[0,1];
  gauge.forecastEnd=g?.forecast?.points?.at(-1)?.time??null;
  return {stationId,reach,station,start,end,now,historyHours,futureHours,measure,release,gauge,schedule,markers,releaseDomain:sharedFlowDomain,gaugeDomain:measure==='flow'?sharedFlowDomain:stageDomain};
}
