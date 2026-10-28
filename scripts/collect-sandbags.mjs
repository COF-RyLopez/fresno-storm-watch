import {readFile,writeFile,rename} from 'node:fs/promises';
import {collectSandbags} from '../site/lib/county-sandbag-data.js';
import {validateSandbagSnapshot} from '../site/lib/county-sandbag-model.js';
const output=new URL('../site/data/county-sandbags-latest.json',import.meta.url),temp=new URL('../site/data/county-sandbags-latest.tmp',import.meta.url);
const county=JSON.parse(await readFile(new URL('../site/data/counties.geojson',import.meta.url),'utf8')).features.find(f=>f.properties.GEOID==='06019');
let previous=null;
try{previous=validateSandbagSnapshot(JSON.parse(await readFile(output,'utf8')));}catch(error){if(error.code!=='ENOENT')console.warn('Local sandbag reference unavailable:',error.message);}
if(process.argv.includes('--published')){try{const r=await fetch('https://cof-rylopez.github.io/fresno-storm-watch/data/county-sandbags-latest.json',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('HTTP '+r.status);const d=validateSandbagSnapshot(await r.json());if(!previous||Date.parse(d.lastSuccess)>Date.parse(previous.lastSuccess))previous=d;}catch(error){console.warn('Published sandbag reference unavailable:',error.message);}}
const start=Date.now(),snapshot=await collectSandbags({county,previous});await writeFile(temp,JSON.stringify(snapshot,null,2)+'\n','utf8');await rename(temp,output);
console.log(JSON.stringify({event:'county-sandbag-collection',durationMs:Date.now()-start,lastSuccess:snapshot.lastSuccess,error:snapshot.error,accounting:snapshot.accounting}));
