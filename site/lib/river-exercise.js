import { HOUR, normalizeGauge } from './river-model.js';
/** @param {object[]} stations @param {string} scenario @param {number} clock @returns {object[]} Fictional source-shaped records; no live river API requests. */
export function exerciseRivers(stations, scenario, clock) {
  return stations.map((station,i)=>{
    if(scenario==='failure' && i<2) return {id:station.id,gauge:null,error:'Exercise: station request failed.'};
    const iso=t=>new Date(t).toISOString(), base=clock-(scenario==='old'?30:0)*HOUR;
    const raw={lid:station.id,name:`[EXERCISE] ${station.name}`,latitude:station.latitude,longitude:station.longitude,county:station.county,
      flood:{stageUnits:'ft',flowUnits:'cfs',categories:i<3?{action:{stage:11},minor:{stage:12},moderate:{stage:15},major:{stage:18}}:{}},inService:{enabled:true},status:{},forecastReliability:'Fictional exercise forecast.'};
    const block={primaryName:'Stage',primaryUnits:'ft',secondaryName:'Flow',secondaryUnits:'cfs',issuedTime:iso(base-HOUR),pedts:'EXERCISE'};
    const observed={...block,data:i===5?[]:Array.from({length:25},(_,n)=>({validTime:iso(base-(24-n)*HOUR),primary:9.8+n/120,secondary:180+n}))};
    const forecast={...block,data:i===4?[]:Array.from({length:25},(_,n)=>({validTime:iso(base+n*3*HOUR),primary:scenario==='crossing'&&i===0?10+Math.min(n,10)*0.4:10+n*0.01,secondary:210+n}))};
    return {id:station.id,gauge:normalizeGauge(raw,{observed,forecast},station,clock),error:null};
  });
}
