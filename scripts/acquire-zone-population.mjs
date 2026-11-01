import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readCareCollection} from '../site/lib/care-data.js';
import {readZoneAcsTracts} from '../site/lib/zone-acs-data.js';
import {readPopulationBlocks} from '../site/lib/population-data.js';
import {readAcsMetadata} from '../site/lib/acs-data.js';
import {countyGeometry} from '../site/lib/model.js';
import {POPULATION_SOURCES} from '../site/lib/population-model.js';
import {CARE_SOURCES} from '../site/lib/care-model.js';
import {fresnoCounty,writeAtomic} from './lib/snapshot-io.mjs';

export const fingerprint=rows=>createHash('sha256').update(JSON.stringify([...rows].sort((a,b)=>(a.key||a.id).localeCompare(b.key||b.id)))).digest('hex');
export const acsChanged=(a,b)=>['period','modified','edited'].some(k=>a[k]!==b[k]);
const folder=new URL('../work/zone-population/',import.meta.url);

/** Public county inputs only. Reconcile source IDs and preserve complete raw geometry. */
async function acquire(){
  await mkdir(folder,{recursive:true});
  const county=await fresnoCounty();
  const geometry=countyGeometry(county.geometry);let requests=0;
  const fetcher=async(...args)=>{const r=await fetch(...args);if(++requests%25===0)console.log(`${requests} public requests completed`);return r;};
  const started=Date.now();
  const [zones,tracts,blocks]=await Promise.all([
    readCareCollection('zones',{county,fetcher}),
    readZoneAcsTracts({geometry,fetcher}),
    readPopulationBlocks(geometry,{fetcher})
  ]);
  const [afterZones,afterAcs]=await Promise.all([readCareCollection('zones',{county,fetcher}),readAcsMetadata('population',{fetcher})]);
  if(fingerprint(zones.rows)!==fingerprint(afterZones.rows))throw Error('County evacuation zones changed during acquisition; rerun.');
  if(acsChanged(tracts.metadata,afterAcs))throw Error('ACS source changed during acquisition; rerun.');
  const data={schema:1,started,acquired:Date.now(),county,zones,tracts,blocks,sources:{zones:CARE_SOURCES.zoneItem,acs:POPULATION_SOURCES.acsItem,blocks:POPULATION_SOURCES.blocksItem},fingerprints:{zones:fingerprint(zones.rows),tracts:fingerprint(tracts.rows),blocks:fingerprint(blocks.rows)}};
  const target=new URL('inputs.json',folder);await writeAtomic(target,JSON.stringify(data));
  console.log(JSON.stringify({status:'complete',zones:zones.rows.length,tracts:tracts.rows.length,blocks:blocks.rows.length,seconds:(Date.now()-started)/1000,file:fileURLToPath(target)}));return data;
}
if(import.meta.main)await acquire();
