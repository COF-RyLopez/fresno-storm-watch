/** Public NWS forecasts for a bounded, named Fresno planning-point inventory. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {windForecast,validateWindSnapshot} from '../site/lib/weather-model.js';

const output=new URL('../site/data/wind-latest.json',import.meta.url);
const PUBLISHED='https://cof-rylopez.github.io/fresno-storm-watch/data/wind-latest.json';
const USER_AGENT='FresnoCountyStormWatch/0.17 (https://cof-rylopez.github.io/fresno-storm-watch/)';

/** @param {URL|string} url @param {Function} fetchImpl @returns {Promise<object>} Bounded public requests; no authentication. */
async function nwsJson(url,fetchImpl){
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(25_000),headers:{'User-Agent':USER_AGENT,Accept:'application/geo+json,application/json'}});
  if(!response.ok)throw new Error(`NWS HTTP ${response.status}`);
  const data=await response.json();if(data?.status>=400||data?.error)throw new Error('NWS returned a source error.');return data;
}

/** @param {object} options @returns {Promise<object>} Two workers; each failed site retains explicitly dated prior data and an error. */
export async function collectWind({selection,previous=null,fetchImpl=fetch,now=Date.now()}={}){
  selection??=JSON.parse(await readFile(new URL('../site/data/wind-watchlist.json',import.meta.url),'utf8'));
  const results=new Array(selection.sites.length);let cursor=0;
  async function worker(){
    while(cursor<selection.sites.length){
      const index=cursor++,site=selection.sites[index],old=previous?.sites?.find(s=>s.id===site.id);
      const row={...site,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,forecast:old?.forecast||null};
      try{
        const points=`https://api.weather.gov/points/${site.latitude.toFixed(4)},${site.longitude.toFixed(4)}`;
        const p=(await nwsJson(points,fetchImpl)).properties;
        if(!/^[A-Z]{3}$/.test(p?.gridId)||!Number.isInteger(p?.gridX)||!Number.isInteger(p?.gridY))throw new Error('NWS point-to-grid mapping is invalid.');
        const grid={office:p.gridId,x:p.gridX,y:p.gridY};
        // Rebuild a trusted NWS URL rather than requesting a payload-supplied host.
        const url=`https://api.weather.gov/gridpoints/${grid.office}/${grid.x},${grid.y}`;
        row.forecast=windForecast(await nwsJson(url,fetchImpl),grid,now);
        row.source=url;row.pointSource=points;row.lastSuccess=new Date(now).toISOString();
      }catch(error){row.error=String(error.name==='TimeoutError'?'NWS forecast request timed out':error.message||'NWS forecast check failed').slice(0,180);}
      results[index]=row;
    }
  }
  await Promise.all([worker(),worker()]);
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),publisher:'NOAA National Weather Service',collection:'15-minute target, not guaranteed',scope:selection.scope,sites:results};
}

/** @returns {Promise<void>} Persist only public forecasts; atomically replace the deployable snapshot. */
async function main(){
  const started=Date.now();let previous=null;
  try{previous=validateWindSnapshot(JSON.parse(await readFile(output,'utf8')));}catch(error){if(error.code!=='ENOENT')console.warn('Previous wind snapshot unavailable:',error.message);}
  if(process.argv.includes('--published')){
    try{
      const response=await fetch(`${PUBLISHED}?check=${Date.now()}`,{signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const candidate=validateWindSnapshot(await response.json()),stamp=Date.parse(candidate.generatedAt);
      if(stamp>Date.now()+120_000)throw new Error('Published collection time is in the future.');
      if(!previous||stamp>Date.parse(previous.generatedAt))previous=candidate;
    }catch(error){console.warn('Published prior wind snapshot unavailable; using local fallback:',error.message);}
  }
  const snapshot=validateWindSnapshot(await collectWind({previous}));
  const temporary=new URL('../site/data/wind-latest.tmp',import.meta.url);
  await writeFile(temporary,JSON.stringify(snapshot,null,2)+'\n','utf8');await rename(temporary,output);
  console.log(JSON.stringify({event:'wind-collection',generatedAt:snapshot.generatedAt,durationMs:Date.now()-started,sites:snapshot.sites.map(s=>({id:s.id,error:s.error,issued:s.forecast?.issued,lastSuccess:s.lastSuccess}))}));
  if(snapshot.sites.some(s=>s.error))console.warn('NWS wind collection incomplete; failed sites remain explicitly marked.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
