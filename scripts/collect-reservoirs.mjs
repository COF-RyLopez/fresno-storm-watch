/** Public CDEC collector. Run locally or before a Pages deployment; no credentials/proxy. */
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CDEC_URL, cdecSeries, validateReservoirSnapshot } from '../site/lib/environment-model.js';

const selectionUrl=new URL('../site/data/reservoir-watchlist.json',import.meta.url);
const outputUrl=new URL('../site/data/reservoir-latest.json',import.meta.url);
const POLL_MS=15*60_000;

/** @param {object} options @returns {Promise<object>} Bounded requests; retain explicitly dated previous data on a station failure. */
export async function collectReservoirs({fetchImpl=fetch,now=Date.now(),previous=null,selection}={}) {
  selection??=JSON.parse(await readFile(selectionUrl,'utf8'));
  const start=new Date(now-5*86_400_000).toISOString().slice(0,10),end=new Date(now+86_400_000).toISOString().slice(0,10);
  const stations=[];
  for(const station of selection.stations){
    const old=previous?.stations?.find(s=>s.id===station.id);
    const result={id:station.id,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,metrics:old?.metrics||{},requests:[]};
    try{
      const next={};
      for(const duration of new Set(station.metrics.map(m=>m.duration))){
        const metrics=station.metrics.filter(m=>m.duration===duration);
        const url=new URL(CDEC_URL);url.search=new URLSearchParams({Stations:station.id,SensorNums:metrics.map(m=>m.sensor).join(','),dur_code:duration,Start:start,End:end});
        result.requests.push(url.href);
        const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error(`CDEC HTTP ${response.status}`);
        const rows=await response.json();
        if(!Array.isArray(rows)||rows.some(r=>r.stationId!==station.id||r.durCode!==duration||!metrics.some(m=>m.sensor===Number(r.SENSOR_NUM))))throw new Error('Unexpected station, duration or sensor in CDEC response.');
        for(const metric of metrics)next[metric.key]=cdecSeries(rows,station.id,metric,now);
      }
      result.metrics=next;result.lastSuccess=new Date(now).toISOString();
    }catch(error){result.error=error.name==='TimeoutError'?'CDEC request timed out':String(error.message||'CDEC request failed').slice(0,180);}
    stations.push(result);
  }
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),collector:'CDEC public JSON · 15-minute target, not guaranteed',sourceTimeZone:'PST (UTC-08:00) year-round',stations};
}

/** @returns {Promise<void>} Atomic same-directory write; never claim a failed source check succeeded. */
async function main(){
  let previous=null;try{previous=validateReservoirSnapshot(JSON.parse(await readFile(outputUrl,'utf8')));}catch(error){if(error.code!=='ENOENT')console.warn('Previous snapshot unavailable:',error.message);}
  const snapshot=await collectReservoirs({previous});validateReservoirSnapshot(snapshot);
  const temporary=new URL('../site/data/reservoir-latest.tmp',import.meta.url);
  await writeFile(temporary,JSON.stringify(snapshot,null,2)+'\n','utf8');await rename(temporary,outputUrl);
  console.log(JSON.stringify({event:'reservoir-collection',time:snapshot.generatedAt,stations:snapshot.stations.map(s=>({id:s.id,error:s.error,series:Object.keys(s.metrics).length,values:Object.values(s.metrics).filter(m=>m.lastValid).length}))}));
  if(snapshot.stations.some(s=>s.error))console.warn('CDEC collection incomplete; the published snapshot marks failed stations and retained values.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await main();
  if(process.argv.includes('--watch'))setInterval(()=>void main().catch(error=>console.error('Reservoir snapshot write failed:',error.message)),POLL_MS);
}
