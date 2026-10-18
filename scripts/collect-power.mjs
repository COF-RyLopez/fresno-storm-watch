/** Public utility snapshots for GitHub Pages. No account, meter, address lookup or partner-only records. */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {collectPower} from '../site/lib/power-data.js';
import {validatePowerSnapshot} from '../site/lib/power-model.js';
const output=new URL('../site/data/power-latest.json',import.meta.url);
const county=JSON.parse(await readFile(new URL('../site/data/counties.geojson',import.meta.url),'utf8')).features.find(f=>f.properties.GEOID==='06019');
let previous=null;
try{previous=validatePowerSnapshot(JSON.parse(await readFile(output,'utf8')));}catch(e){if(e.code!=='ENOENT')console.warn('Local power fallback unavailable:',e.message);}
if(process.argv.includes('--published')){
  try{
    const r=await fetch(`https://cof-rylopez.github.io/fresno-storm-watch/data/power-latest.json?check=${Date.now()}`,{signal:AbortSignal.timeout(15000)});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const p=validatePowerSnapshot(await r.json());
    if(Date.parse(p.generatedAt)>Date.now()+120000)throw new Error('Future snapshot timestamp');
    if(!previous||Date.parse(p.generatedAt)>Date.parse(previous.generatedAt))previous=p;
  }catch(e){console.warn('Published power fallback unavailable:',e.message);}
}
const start=Date.now(),snapshot=validatePowerSnapshot(await collectPower({county,previous}));
const temp=new URL('../site/data/power-latest.tmp',import.meta.url);
await writeFile(temp,JSON.stringify(snapshot,null,2)+'\n','utf8');await rename(temp,output);
console.log(JSON.stringify({event:'power-collection',time:snapshot.generatedAt,durationMs:Date.now()-start,feeds:snapshot.feeds.map(f=>({id:f.id,error:f.error,records:f.rows.length,accounting:f.accounting}))}));
if(snapshot.feeds.some(f=>f.error))console.warn('Power feed incomplete: failed sources and retained data are marked in the published app.');
