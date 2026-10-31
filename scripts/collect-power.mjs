/** Public utility snapshots for GitHub Pages. No account, meter, address lookup or partner-only records. */
import {fresnoCounty,loadPrevious,writeAtomic} from './lib/snapshot-io.mjs';
import {collectPower} from '../site/lib/power-data.js';
import {validatePowerSnapshot} from '../site/lib/power-model.js';
const output=new URL('../site/data/power-latest.json',import.meta.url);
const county=await fresnoCounty();
const previous=await loadPrevious(output,validatePowerSnapshot,'Local power fallback unavailable:',{url:'https://cof-rylopez.github.io/fresno-storm-watch/data/power-latest.json',future:'Future snapshot timestamp',warning:'Published power fallback unavailable:'});
const start=Date.now(),snapshot=validatePowerSnapshot(await collectPower({county,previous}));
await writeAtomic(output,JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({event:'power-collection',time:snapshot.generatedAt,durationMs:Date.now()-start,feeds:snapshot.feeds.map(f=>({id:f.id,error:f.error,records:f.rows.length,accounting:f.accounting}))}));
if(snapshot.feeds.some(f=>f.error))console.warn('Power feed incomplete: failed sources and retained data are marked in the published app.');
