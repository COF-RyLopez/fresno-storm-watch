/** Public utility planning data only; no partner portals, credentials or live electrical telemetry. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {collectNetwork} from '../site/lib/power-network-data.js';
import {validateNetworkSnapshot,NETWORK_SOURCES} from '../site/lib/power-network-model.js';
const output=new URL('../site/data/power-network.json',import.meta.url);
let previous=null;
try{previous=validateNetworkSnapshot(JSON.parse(await readFile(output,'utf8')));}catch(e){if(e.code!=='ENOENT')console.warn('Local utility reference invalid; it will not be reused.');}
if(process.argv.includes('--published'))try{const r=await fetch('https://cof-rylopez.github.io/fresno-storm-watch/data/power-network.json',{credentials:'omit',signal:AbortSignal.timeout(15000)});if(r.ok){const d=validateNetworkSnapshot(await r.json());if(Date.parse(d.generatedAt)<=Date.now()+120000&&(!previous||Date.parse(d.generatedAt)>Date.parse(previous.generatedAt)))previous=d;}}catch{console.warn('Published utility reference unavailable; using verified local fallback if present.');}
const start=Date.now(),county=JSON.parse(await readFile(new URL('../site/data/counties.geojson',import.meta.url),'utf8')).features.find(f=>f.properties.GEOID==='06019');
const fresh=previous&&previous.sources.every(s=>!s.error&&Date.parse(s.lastSuccess)<=start+120000&&start-Date.parse(s.lastSuccess)<24*3600000);
const snapshot=fresh&&!process.argv.includes('--force')?previous:await collectNetwork({county,previous});
const temp=new URL('../site/data/power-network.tmp',import.meta.url);await writeFile(temp,JSON.stringify(snapshot)+'\n','utf8');await rename(temp,output);
console.log(JSON.stringify({event:'public-utility-network',reused:!!(fresh&&!process.argv.includes('--force')),durationMs:Date.now()-start,bytes:Buffer.byteLength(JSON.stringify(snapshot)),sources:NETWORK_SOURCES.map(s=>{const d=snapshot.sources.find(v=>v.id===s.id);return {id:s.id,records:d.features.length,error:d.error};})}));
