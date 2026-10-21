import {CONFIG} from '../config.js';
import {fetchRiverWatch} from './nwps.js';
import {fetchPlanningRain} from './planning-data.js';
import {validatePilot} from './pilot-model.js';

/** Preserve the last report even outside the chart window: old is not absent. */
export function chartWindow(entry,now){
 if(!entry.gauge)return entry;
 const g=entry.gauge,last=g.observed.points.at(-1);
 return {...entry,gauge:{...g,observed:{...g.observed,points:g.observed.points.filter(p=>p.time>=now-26*3600000||p===last)}}};
}

/** Both renderers share this one public check; failed data never gain new source times. */
export async function refreshPilotSnapshot(snapshot,{now=Date.now(),fetchImpl=fetch,riverFetch=fetchRiverWatch,rainFetch=fetchPlanningRain}={}){
 validatePilot(snapshot,now);
 const original=snapshot.input;
 const [riverResult,rainResult]=await Promise.allSettled([
  riverFetch(original.gauges.stations,CONFIG.rivers,fetchImpl,()=>now),
  rainFetch(original.points,fetchImpl,()=>now)
 ]);
 const entries=original.gauges.stations.map(station=>{
  const current=riverResult.status==='fulfilled'?riverResult.value.find(e=>e.id===station.id):null;
  const prior=original.entries.find(e=>e.id===station.id);
  return chartWindow(current&&!current.error?current:{...prior,error:current?.error||riverResult.reason?.message||'Station query failed'},now);
 });
 const rain=rainResult.status==='fulfilled'?rainResult.value:{...original.rain,error:rainResult.reason?.message||'Rainfall check failed',checked:now};
 const input={...original,entries,rain};
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input)));
 const dataId=[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
 return {...snapshot,input,dataId,sourceBundleGeneratedAt:snapshot.sourceBundleGeneratedAt||snapshot.generatedAt,generatedAt:new Date(now).toISOString(),collectionMode:'Shared browser check of NWPS/WPC; scheduled public wind, utility, reservoir and comparison source copies'};
}
