import {digest} from './eoc-model.js?v=0.73.1';
import {CARE_SOURCES} from './care-model.js?v=0.56.0-r1';
import {readCareCollection} from './care-data.js?v=0.56.0-r1';
import {loadCounties} from './nws.js';
import {pool} from './pool.js';
import {readAfnContext} from './afn-data.js?v=0.70.0';
import {freezeAfnEvidence,AFN_TOPIC_KEYS} from './afn-snapshot-model.js?v=0.70.0';
import {PIO_SOURCE_CHECK_MS,pioSourceReviews} from './pio-source-review.js?v=0.73.1';

async function readZones({signal}){
  const counties=await loadCounties(new URL('../data/counties.geojson',import.meta.url));
  signal.throwIfAborted();
  return readCareCollection('zones',{county:counties.find(c=>c.properties.GEOID==='06019'),signal});
}

/** Same zone identity as saved outreach; a digest change requests review, not an order. */
export async function pioZoneSnapshot(row,checked){return {source:CARE_SOURCES.zones,key:row.key,oid:row.oid,name:row.name,status:row.status,checked,revision:await digest({name:row.name,status:row.status,geometry:row.geometry})};}

/** Bounded public reads, two zones at a time, cached in memory only. No writes. */
export function createPioSourceMonitor({loadZones=readZones,readContext=readAfnContext,exercise=false,now=Date.now}={}){
  let epoch=0,controller=null,zones=null,cache=new Map();
  function clear(){epoch++;controller?.abort();controller=null;zones=null;cache.clear();}
  async function check(states,{force=false}={}){
    controller?.abort();controller=new AbortController();const generation=++epoch,signal=controller.signal;
    const valid=()=>{signal.throwIfAborted();if(generation!==epoch)throw new DOMException('Private scope changed','AbortError');};
    const active=states.filter(s=>s.active);if(!active.length){cache.clear();return {notices:[],checked:now()};}
    let data;
    try{data=zones&&!force&&now()-zones.checked<PIO_SOURCE_CHECK_MS?zones:await loadZones({signal:AbortSignal.any([signal,AbortSignal.timeout(45000)]),force});valid();zones=data;}
    catch(e){valid();return {notices:await pioSourceReviews(active,{checked:now(),error:'County evacuation-zone query unavailable'}),checked:now()};}
    const byKey=new Map(data.rows.map(row=>[row.key,row])),current={},jobs=[...new Set(active.map(s=>s.record.payload.pioOutreach.zone.key))];
    // Retain only selected active zones. Neither geometry nor private records persist.
    for(const key of cache.keys())if(!jobs.includes(key))cache.delete(key);
    await pool(jobs,2,async key=>{
      valid();const row=byKey.get(key);if(!row)return;
      const zone=await pioZoneSnapshot(row,data.checked);valid();let result=cache.get(key);
      const needsAfn=active.some(s=>s.record.payload.pioOutreach.zone.key===key&&s.record.payload.pioOutreach.afnEvidence);
      if(needsAfn&&(!result||force||result.zone.revision!==zone.revision||now()-result.checked>=PIO_SOURCE_CHECK_MS)){
        try{
          const topics=exercise?AFN_TOPIC_KEYS.map(key=>({key,error:'EXERCISE · live AFN checks disabled'})):await readContext(row.geometry,{signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});valid();
          result={zone,afn:freezeAfnEvidence({zone,topics,exercise,captured:now()}),checked:now()};
        }catch(e){valid();result={zone,afnError:true,checked:now()};}
        cache.set(key,result);
      }
      for(const s of active.filter(s=>s.record.payload.pioOutreach.zone.key===key))current[s.record.entity]={...result,zone};
    });valid();
    const checked=now(),notices=await pioSourceReviews(active,{current,checked:data.checked});valid();return {notices,checked};
  }
  return {check,clear};
}
