/** Public CDEC collector. Run locally or before a Pages deployment; no credentials/proxy. */
import { readFile } from 'node:fs/promises';
import { CDEC_URL, cdecSeries, validateReservoirSnapshot } from '../site/lib/environment-model.js';
import {scheduledRecords,RELEASE_LOOKBACK_DAYS,RELEASE_HORIZON_DAYS} from '../site/lib/release-model.js';
import {loadPrevious,writeAtomic} from './lib/snapshot-io.mjs';

const selectionUrl=new URL('../site/data/reservoir-watchlist.json',import.meta.url);
const outputUrl=new URL('../site/data/reservoir-latest.json',import.meta.url);
const POLL_MS=15*60_000;
const DAY=86_400_000;
const PUBLISHED_SNAPSHOT='https://cof-rylopez.github.io/fresno-storm-watch/data/reservoir-latest.json';
/** @param {number} time @returns {string} CDEC JSON outputs fixed PST, including during daylight saving. */
const pstDate=time=>new Date(time-8*3_600_000).toISOString().slice(0,10);

/** @param {object} options @returns {Promise<object>} Independent notice failure cannot block measured reservoir values. */
export async function collectScheduledReleases({station,now,old,fetchImpl}){
  const url=new URL(CDEC_URL);url.search=new URLSearchParams({Stations:station,SensorNums:'7',dur_code:'E',Start:pstDate(now-RELEASE_LOOKBACK_DAYS*DAY),End:pstDate(now+(RELEASE_HORIZON_DAYS+1)*DAY)});
  const result={...old,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,request:url.href};
  try{
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`CDEC schedule HTTP ${response.status}`);
    Object.assign(result,scheduledRecords(await response.json(),station,now),{lastSuccess:new Date(now).toISOString()});
  }catch(error){result.error=error.name==='TimeoutError'?'CDEC schedule request timed out':String(error.message||'CDEC schedule request failed').slice(0,180);}
  return result;
}

/** Daily storage above Millerton in one request; a failure keeps the previous series with the error recorded. */
export async function collectUpstream({upstream,old,now,start,fetchImpl}){
  const ids=upstream.stations.map(s=>s.id),metric=upstream.metric;
  const url=new URL(CDEC_URL);url.search=new URLSearchParams({Stations:ids.join(','),SensorNums:String(metric.sensor),dur_code:metric.duration,Start:start,End:pstDate(now-DAY)});
  const result={lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,request:url.href,series:old?.series||{}};
  try{
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error(`CDEC HTTP ${response.status}`);
    const rows=await response.json();
    if(!Array.isArray(rows)||rows.some(r=>!ids.includes(r.stationId)||r.durCode!==metric.duration||Number(r.SENSOR_NUM)!==metric.sensor))throw new Error('Unexpected station, duration or sensor in CDEC response.');
    result.series=Object.fromEntries(ids.map(id=>[id,cdecSeries(rows,id,metric,now)]));result.lastSuccess=new Date(now).toISOString();
  }catch(error){result.error=error.name==='TimeoutError'?'CDEC request timed out':String(error.message||'CDEC request failed').slice(0,180);}
  return result;
}

/** @param {object} options @returns {Promise<object>} Bounded requests; retain explicitly dated previous data on a station failure. */
export async function collectReservoirs({fetchImpl=fetch,now=Date.now(),previous=null,selection}={}) {
  selection??=JSON.parse(await readFile(selectionUrl,'utf8'));
  const start=pstDate(now-8*DAY),end=pstDate(now+DAY);
  const stations=[];
  for(const station of selection.stations){
    const old=previous?.stations?.find(s=>s.id===station.id);
    const result={id:station.id,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,metrics:old?.metrics||{},requests:[]};
    try{
      const next={};
      for(const duration of new Set(station.metrics.map(m=>m.duration))){
        const metrics=station.metrics.filter(m=>m.duration===duration);
        // Daily reports cover completed source-calendar days. Do not request today's unfinished daily placeholder.
        const url=new URL(CDEC_URL);url.search=new URLSearchParams({Stations:station.id,SensorNums:metrics.map(m=>m.sensor).join(','),dur_code:duration,Start:start,End:duration==='D'?pstDate(now-DAY):end});
        result.requests.push(url.href);
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error(`CDEC HTTP ${response.status}`);
        const rows=await response.json();
        if(!Array.isArray(rows)||rows.some(r=>r.stationId!==station.id||r.durCode!==duration||!metrics.some(m=>m.sensor===Number(r.SENSOR_NUM))))throw new Error('Unexpected station, duration or sensor in CDEC response.');
        for(const metric of metrics)next[metric.key]=cdecSeries(rows,station.id,metric,now);
      }
      result.metrics=next;result.lastSuccess=new Date(now).toISOString();
    }catch(error){result.error=error.name==='TimeoutError'?'CDEC request timed out':String(error.message||'CDEC request failed').slice(0,180);}
    result.scheduled=await collectScheduledReleases({station:station.id,now,old:old?.scheduled,fetchImpl});
    stations.push(result);
  }
  const upstream=selection.upstream?await collectUpstream({upstream:selection.upstream,old:previous?.upstream,now,start:pstDate(now-10*DAY),fetchImpl}):undefined;
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),collector:'CDEC public JSON · 15-minute target, not guaranteed',sourceTimeZone:'PST (UTC-08:00) year-round',stations,...(upstream?{upstream}:{})};
}

/** @returns {Promise<void>} Atomic same-directory write; never claim a failed source check succeeded. */
async function main(){
  const previous=await loadPrevious(outputUrl,validateReservoirSnapshot,'Previous snapshot unavailable:',{url:PUBLISHED_SNAPSHOT,init:{headers:{Accept:'application/json'}},future:'Published snapshot timestamp is in the future',warning:'Published prior snapshot unavailable; using local fallback:'});
  const snapshot=await collectReservoirs({previous});validateReservoirSnapshot(snapshot);
  await writeAtomic(outputUrl,JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({event:'reservoir-collection',time:snapshot.generatedAt,stations:snapshot.stations.map(s=>({id:s.id,error:s.error,series:Object.keys(s.metrics).length,values:Object.values(s.metrics).filter(m=>m.lastValid).length,conflicts:Object.values(s.metrics).reduce((n,m)=>n+(m.conflicts||0),0),scheduleError:s.scheduled.error,notices:s.scheduled.records?.length||0}))}));
  if(snapshot.stations.some(s=>s.error||s.scheduled.error))console.warn('CDEC collection incomplete; the published snapshot marks failed sources and retained values.');
}
if(import.meta.main){
  await main();
  if(process.argv.includes('--watch'))setInterval(()=>void main().catch(error=>console.error('Reservoir snapshot write failed:',error.message)),POLL_MS);
}
