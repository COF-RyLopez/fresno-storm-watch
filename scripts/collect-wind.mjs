/** Public NWS forecasts for a bounded, named Fresno planning-point inventory. */
import {readFile} from 'node:fs/promises';
import {validateWindSnapshot} from '../site/lib/weather-model.js';
import {fetchWindForecasts} from '../site/lib/weather-data.js';
import {loadPrevious,writeAtomic} from './lib/snapshot-io.mjs';

const output=new URL('../site/data/wind-latest.json',import.meta.url);
const PUBLISHED='https://cof-rylopez.github.io/fresno-storm-watch/data/wind-latest.json';
const USER_AGENT='FresnoCountyStormWatch/0.17 (https://cof-rylopez.github.io/fresno-storm-watch/)';

/** @param {object} options @returns {Promise<object>} Share the validated public-source collector with the browser fallback. */
export async function collectWind({selection,previous=null,fetchImpl=fetch,now=Date.now()}={}){
  selection??=JSON.parse(await readFile(new URL('../site/data/wind-watchlist.json',import.meta.url),'utf8'));
  return fetchWindForecasts({selection,previous,fetchImpl,now,headers:{'User-Agent':USER_AGENT},sourceMode:'scheduled'});
}

/** @returns {Promise<void>} Persist only public forecasts; atomically replace the deployable snapshot. */
async function main(){
  const started=Date.now();
  const previous=await loadPrevious(output,validateWindSnapshot,'Previous wind snapshot unavailable:',{url:PUBLISHED,future:'Published collection time is in the future.',warning:'Published prior wind snapshot unavailable; using local fallback:'});
  const snapshot=validateWindSnapshot(await collectWind({previous}));
  await writeAtomic(output,JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({event:'wind-collection',generatedAt:snapshot.generatedAt,durationMs:Date.now()-started,sites:snapshot.sites.map(s=>({id:s.id,error:s.error,issued:s.forecast?.issued,lastSuccess:s.lastSuccess}))}));
  if(snapshot.sites.some(s=>s.error))console.warn('NWS wind collection incomplete; failed sites remain explicitly marked.');
}
if(import.meta.main)await main();
