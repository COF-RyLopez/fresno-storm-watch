/** Public NWS forecasts for a bounded, named Fresno planning-point inventory. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateWindSnapshot} from '../site/lib/weather-model.js';
import {fetchWindForecasts} from '../site/lib/weather-data.js';

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
