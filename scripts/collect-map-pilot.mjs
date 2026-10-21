/** Public-only comparison bundle: same collectors and models as the main app. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {arcgisToGeoJSON} from '@terraformer/arcgis';
import {CONFIG} from '../site/config.js';
import {fetchRiverWatch} from '../site/lib/nwps.js';
import {fetchPlanningRain} from '../site/lib/planning-data.js';
import {planningPoints} from '../site/lib/planning-model.js';
import {validateAreaConcerns} from '../site/lib/area-concern-model.js';
import {validatePowerSnapshot} from '../site/lib/power-model.js';
import {validateWindSnapshot} from '../site/lib/weather-model.js';
import {validateReservoirSnapshot} from '../site/lib/environment-model.js';
import {chartWindow} from '../site/lib/pilot-data.js';
export {chartWindow} from '../site/lib/pilot-data.js';

const ROOT=new URL('../site/data/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name+'.json',ROOT),'utf8'));

/** Snapshot source times remain original; collection time is not observation time. */
export async function collectPilot({fetchImpl=fetch,now=Date.now(),published=false}={}){
 const source=async name=>{if(!published||!name.endsWith('-latest'))return read(name);const r=await fetchImpl('https://cof-rylopez.github.io/fresno-storm-watch/data/'+name+'.json',{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Published '+name+' unavailable');return r.json();};
 const [areas,gauges,reservoirSettings,associations,windSettings,power,wind,reservoirs,comparisons]=await Promise.all(['river-areas','river-watchlist','reservoir-watchlist','area-concerns','wind-watchlist','power-latest','wind-latest','reservoir-latest','comparison-latest'].map(source));
 validateAreaConcerns(associations,areas.areas,windSettings.sites);validatePowerSnapshot(power);validateWindSnapshot(wind);validateReservoirSnapshot(reservoirs);
 const points=planningPoints(areas,gauges.stations,reservoirSettings.stations);
 const [gaugeResult,rainResult]=await Promise.allSettled([fetchRiverWatch(gauges.stations,CONFIG.rivers,fetchImpl,()=>now),fetchPlanningRain(points,fetchImpl,()=>now)]);
 const rawEntries=gaugeResult.status==='fulfilled'?gaugeResult.value:gauges.stations.map(s=>({id:s.id,gauge:null,error:gaugeResult.reason.message}));
 // Assessment uses the latest trend; hydrographs show the preceding 24 hours.
 // Retain 26 hours of original observations, all forecasts, units and source times.
 const entries=rawEntries.map(e=>chartWindow(e,now));
 const rain=rainResult.status==='fulfilled'?rainResult.value:{error:rainResult.reason.message,checked:now,points:{}};
 const utilityFeatures=power.feeds.flatMap(feed=>feed.rows.flatMap(row=>row.geometries.map((g,i)=>({type:'Feature',id:`${row.key}:${i}`,properties:{powerKey:row.key,status:row.status},geometry:arcgisToGeoJSON({...g,spatialReference:{wkid:4326}})}))));
 const input={areas,gauges,reservoirSettings,associations,windSettings,power,wind,reservoirs,comparisons,entries,rain,points,utilityFeatures};
 return {schemaVersion:1,generatedAt:new Date(now).toISOString(),dataId:createHash('sha256').update(JSON.stringify(input)).digest('hex'),scope:'Public-source renderer comparison. Same inputs for both engines; independent from main app live queries.',input,error:null};
}
async function main(){
 const started=Date.now(),output=new URL('map-pilot-latest.json',ROOT);
 try{const s=await collectPilot({published:process.argv.includes('--published')});const tmp=new URL('map-pilot-latest.tmp',ROOT);await mkdir(ROOT,{recursive:true});await writeFile(tmp,JSON.stringify(s)+'\n','utf8');await rename(tmp,output);console.log(JSON.stringify({event:'map-pilot-collection',dataId:s.dataId,durationMs:Date.now()-started,gauges:s.input.entries.length,failed:s.input.entries.filter(e=>e.error).length,rainError:s.input.rain.error}));}
 catch(e){console.warn('::warning title=Map pilot unavailable::'+e.message);await writeFile(output,JSON.stringify({schemaVersion:1,error:'Public pilot collection failed. Check workflow and original sources.',generatedAt:new Date().toISOString()}),'utf8');}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
