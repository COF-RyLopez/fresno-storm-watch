/** CDEC operator-reported schedules. Effective time is not issuance or river arrival time. */
import {cdecSeries} from './environment-model.js';

const HOUR=3_600_000,DAY=24*HOUR;
export const RELEASE_LOOKBACK_DAYS=31;
export const RELEASE_HORIZON_DAYS=7;
export const RELEASE_SENSOR=Object.freeze({sensor:7,duration:'E',units:'CFS'});

/** @param {string} station @returns {string} Official human-readable notices. */
export function releaseSource(station){
  if(!['MIL','PNF'].includes(station))throw new Error('Unknown scheduled-release station.');
  return `https://cdec.water.ca.gov/dynamicapp/QueryRES?s=${station}`;
}

/** @param {object[]} rows @param {string} station @param {number} now @returns {object} Preserve flagged/conflicting entries; never turn an absent schedule into a zero. */
export function scheduledRecords(rows,station,now){
  if(!Array.isArray(rows)||rows.some(r=>r.stationId!==station||r.durCode!=='E'||Number(r.SENSOR_NUM)!==7||r.units!=='CFS'))throw new Error('Scheduled-release identity or units changed.');
  const windowStart=now-RELEASE_LOOKBACK_DAYS*DAY,windowEnd=now+RELEASE_HORIZON_DAYS*DAY;
  const series=cdecSeries(rows,station,RELEASE_SENSOR,now,{through:windowEnd});
  if(series.invalidTimes)throw new Error('Scheduled-release timestamp not recognized.');
  const records=series.samples.filter(s=>s.time>=windowStart).map(s=>({
    ...s,key:`cdec:scheduled:${station}:${s.time}`,revision:JSON.stringify([s.value,s.flag,s.units,!!s.conflict]),issued:null
  }));
  return {...RELEASE_SENSOR,windowStart,windowEnd,records,accounting:{input:series.input,accepted:series.accepted,rejected:series.rejected,duplicates:series.duplicates,conflicts:series.conflicts}};
}

/** @param {object} input @param {string} stationId @param {number} now @returns {object} Schedules are independent of observation availability and use a fixed seven-day horizon. */
export function scheduleEvidence(input,stationId,now=Date.now()){
  const station=input.selection?.stations.find(s=>s.id===stationId),schedule=input.snapshot?.stations.find(s=>s.id===stationId)?.scheduled;
  const collected=Date.parse(schedule?.lastSuccess),generated=Date.parse(input.snapshot?.generatedAt),checked=input.checked;
  const contract=schedule?.sensor===7&&schedule.duration==='E'&&schedule.units==='CFS'&&Array.isArray(schedule.records)&&Number.isFinite(schedule.windowStart)&&Number.isFinite(schedule.windowEnd)&&schedule.windowStart<now&&schedule.windowEnd>now;
  const validRecords=contract&&schedule.records.every(r=>r&&Number.isFinite(r.time)&&r.time>=schedule.windowStart&&r.time<=schedule.windowEnd&&r.units==='CFS'&&(r.value===null||(Number.isFinite(r.value)&&r.value>=0))&&r.key===`cdec:scheduled:${stationId}:${r.time}`&&typeof r.flag==='string'&&typeof r.revision==='string');
  const unique=validRecords&&new Set(schedule.records.map(r=>r.key)).size===schedule.records.length;
  const fresh=[collected,generated].every(t=>Number.isFinite(t)&&t<=now+120_000&&now-t<=input.config.collectorMaxAgeMs)&&Number.isFinite(checked)&&checked<=now+120_000&&now-checked<=input.config.weatherCheckMaxAgeMs;
  const current=!!(unique&&fresh&&!input.error&&!schedule.error);
  const records=unique?[...schedule.records].sort((a,b)=>a.time-b.time):[];
  const notices=records.map((r,i)=>{
    const prior=records[i-1],valid=r.value!==null&&!r.flag&&!r.conflict;
    const comparable=valid&&prior&&prior.value!==null&&!prior.flag&&!prior.conflict;
    const delta=comparable?r.value-prior.value:null;
    return {...r,revision:JSON.stringify([r.revision,comparable?prior.time:null,comparable?prior.value:null]),station:stationId,name:station?.name||stationId,source:releaseSource(stationId),delta,prior:comparable?{time:prior.time,value:prior.value}:null,valid,phase:r.time>now?'upcoming':'effective',direction:delta===null?'Scheduled release':Math.round(delta)>0?'Scheduled increase':Math.round(delta)<0?'Scheduled decrease':'Schedule unchanged'};
  });
  const upcoming=notices.filter(r=>r.time>now),recent=notices.filter(r=>r.time<=now&&r.time>=now-DAY);
  const pending=notices.filter(r=>r.time>=now-DAY&&!r.valid);
  const cues=current?[...upcoming,...recent].filter(r=>r.valid&&(r.delta===null||Math.round(r.delta)!==0)):[];
  const last=notices.filter(r=>r.time<=now).at(-1)||null;
  const reason=!contract||!unique?'Scheduled-release data unavailable or invalid':input.error||schedule.error?'Scheduled-release check failed; retained notices need verification':!fresh?'Scheduled-release collection overdue':'Schedule checked';
  return {station:stationId,name:station?.name||stationId,source:releaseSource(stationId),current,reason,collected,windowEnd:schedule?.windowEnd,upcoming,recent,last,pending,cues};
}
