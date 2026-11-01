/** Public utility planning data only; no partner portals, credentials or live electrical telemetry. */
import {collectNetwork} from '../site/lib/power-network-data.js';
import {validateNetworkSnapshot,NETWORK_SOURCES} from '../site/lib/power-network-model.js';
import {fresnoCounty,loadPrevious,writeAtomic} from './lib/snapshot-io.mjs';
const output=new URL('../site/data/power-network.json',import.meta.url);
const previous=await loadPrevious(output,validateNetworkSnapshot,'Local utility reference invalid; it will not be reused:',{url:'https://cof-rylopez.github.io/fresno-storm-watch/data/power-network.json',init:{credentials:'omit'},future:'Future utility reference timestamp',warning:'Published utility reference unavailable; using verified local fallback if present:'});
const start=Date.now(),county=await fresnoCounty();
const fresh=previous&&previous.sources.every(s=>!s.error&&Date.parse(s.lastSuccess)<=start+120000&&start-Date.parse(s.lastSuccess)<24*3600000);
const snapshot=fresh?previous:await collectNetwork({county,previous});
await writeAtomic(output,JSON.stringify(snapshot)+'\n');
console.log(JSON.stringify({event:'public-utility-network',reused:!!fresh,durationMs:Date.now()-start,bytes:Buffer.byteLength(JSON.stringify(snapshot)),sources:NETWORK_SOURCES.map(s=>{const d=snapshot.sources.find(v=>v.id===s.id);return {id:s.id,records:d.features.length,error:d.error};})}));
