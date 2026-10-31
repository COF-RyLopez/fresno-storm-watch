import {collectSandbags} from '../site/lib/county-sandbag-data.js';
import {validateSandbagSnapshot} from '../site/lib/county-sandbag-model.js';
import {fresnoCounty,loadPrevious,writeAtomic} from './lib/snapshot-io.mjs';
const output=new URL('../site/data/county-sandbags-latest.json',import.meta.url);
const county=await fresnoCounty();
// ponytail: published copy compares lastSuccess with no cache-buster or future check, so only the local load is shared.
let previous=await loadPrevious(output,validateSandbagSnapshot,'Local sandbag reference unavailable:');
if(process.argv.includes('--published')){try{const r=await fetch('https://cof-rylopez.github.io/fresno-storm-watch/data/county-sandbags-latest.json',{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('HTTP '+r.status);const d=validateSandbagSnapshot(await r.json());if(!previous||Date.parse(d.lastSuccess)>Date.parse(previous.lastSuccess))previous=d;}catch(error){console.warn('Published sandbag reference unavailable:',error.message);}}
const start=Date.now(),snapshot=await collectSandbags({county,previous});await writeAtomic(output,JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({event:'county-sandbag-collection',durationMs:Date.now()-start,lastSuccess:snapshot.lastSuccess,error:snapshot.error,accounting:snapshot.accounting}));
