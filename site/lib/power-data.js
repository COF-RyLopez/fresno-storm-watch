import {POWER_FEEDS,normalizePower,deduplicatePower} from './power-model.js';
import {powerScope} from './power-geometry.js';
import {countyGeometry} from './model.js';

const PGE='https://ags.pge.esriemcs.com/arcgis/rest/services/43/';
const SCE='https://sce-outage-ags.esriemcs.com/arcgis/rest/services/43/';
const outageFields='OUTAGE_START,CURRENT_ETOR,EST_CUSTOMERS,OUTAGE_CAUSE,CREW_CURRENT_STATUS,LAST_UPDATE,OUTAGE_START_TEXT,LAST_UPDATE_TEXT,CURRENT_ETOR_TEXT';
const scePspsFields='GlobalID,CIRCUIT_NAME,COUNTY,GrandTotal,PSPS,PSPS_Details,StartDate,EndDate,ERT,EditDate,EventName';
export const POWER_LAYERS=[
  {feedId:'pge-psps',utility:'PG&E',kind:'pge-psps',url:PGE+'psps_public/MapServer/1',fields:'EventID,EventName,TimePeriod,Stage,TotCustAff,DeEngStart,DeEngEnd,ETOR,LstUpdated'},
  ...[2,3,4,5,7,8].map(id=>({feedId:'pge-outages',utility:'PG&E',kind:'pge-outage',psps:[2,3,7].includes(id),url:PGE+`outages/MapServer/${id}`,fields:`${[3,5].includes(id)?'F_OUTAGE_ID,CITY':'OUTAGE_ID'},${outageFields}`})),
  ...[0,1].map(id=>({feedId:'sce-psps',utility:'SCE',kind:'sce-psps',url:SCE+`psps/MapServer/${id}`,fields:scePspsFields})),
  {feedId:'sce-outages',utility:'SCE',kind:'sce-outage',url:SCE+'outage/MapServer/0',fields:'IncidentId,OanNo,CountyName,CityName,NoOfAffectedCust_Inci,Status,OutageStartDateTime,LastChngDateTime,ERT,MemoCauseCdDesc,CrewStatusCdDesc,Circuit_Number'}
];
/** @param {string} url @param {Function} fetchImpl @returns {Promise<object>} Public read-only calls with no ArcGIS credentials. */
async function json(url,fetchImpl){
  const r=await fetchImpl(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw new Error(`Utility service HTTP ${r.status}`);
  const d=await r.json();if(d.error)throw new Error('Utility GIS query failed');return d;
}
/** @param {object} layer @param {object} scope @param {Function} fetchImpl @returns {Promise<object>} Complete inventory, bounded chunks, exact county intersection. */
export async function queryPowerLayer(layer,scope,fetchImpl=fetch){
  const params=new URLSearchParams({f:'json',where:'1=1',geometry:scope.envelope.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',returnIdsOnly:'true'});
  const inventory=await json(`${layer.url}/query?${params}`,fetchImpl);
  if(inventory.objectIds===null){
    params.delete('returnIdsOnly');params.set('returnCountOnly','true');
    const n=await json(`${layer.url}/query?${params}`,fetchImpl);if(n.count!==0||n.exceededTransferLimit)throw new Error('Empty utility inventory could not be verified');inventory.objectIds=[];
  }
  const ids=inventory.objectIds;
  if(!Array.isArray(ids)||ids.length>10000||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)))throw new Error('Utility inventory missing, repeated or too large');
  let returned=0;const rows=[];
  for(let offset=0;offset<ids.length;offset+=100){
    const chunk=ids.slice(offset,offset+100);
    const q=new URLSearchParams({f:'json',objectIds:chunk.join(','),outFields:`OBJECTID,${layer.fields}`,outSR:'4326',returnGeometry:'true'});
    const d=await json(`${layer.url}/query?${q}`,fetchImpl);
    if(!Array.isArray(d.features)||d.exceededTransferLimit||d.features.length!==chunk.length||(d.spatialReference?.latestWkid||d.spatialReference?.wkid)!==4326)throw new Error('Utility records changed or geometry query was incomplete');
    if(new Set(d.features.map(f=>f.attributes?.OBJECTID)).size!==chunk.length||d.features.some(f=>!chunk.includes(f.attributes?.OBJECTID)))throw new Error('Utility record identity mismatch');
    for(const f of d.features){returned++;if(scope.intersects(f.geometry))rows.push(normalizePower(f,layer));}
  }
  return {rows,accounting:{layer:layer.url,envelopeRecords:ids.length,returned,countyRecords:rows.length,outsideCounty:returned-rows.length}};
}
/** @param {object} options @returns {Promise<object>} One failed utility/category retains only that category's last verified snapshot. */
export async function collectPower({county,previous=null,fetchImpl=fetch,now=Date.now(),only=null}={}){
  const scope=powerScope(countyGeometry(county.geometry));
  const feeds=[];
  for(const spec of POWER_FEEDS){
    const old=previous?.feeds?.find(f=>f.id===spec.id);
    if(only&&!only.includes(spec.id)){feeds.push(old||{id:spec.id,lastAttempt:null,lastSuccess:null,error:'Not checked',rows:[],accounting:[]});continue;}
    const feed={id:spec.id,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:null,rows:old?.rows||[],accounting:old?.accounting||[]};
    try{
      const results=[];
      const layers=POWER_LAYERS.filter(l=>l.feedId===spec.id);
      for(let i=0;i<layers.length;i+=2){
        const pair=await Promise.allSettled(layers.slice(i,i+2).map(l=>queryPowerLayer(l,scope,fetchImpl)));
        const failed=pair.find(p=>p.status==='rejected');if(failed)throw failed.reason;
        results.push(...pair.map(p=>p.value));
      }
      feed.rows=deduplicatePower(results.flatMap(r=>r.rows));feed.accounting=results.map(r=>r.accounting);feed.lastSuccess=new Date(now).toISOString();
    }catch(e){feed.error=e.name==='TimeoutError'?'Utility request timed out':String(e.message||'Utility check failed').slice(0,180);}
    feeds.push(feed);
  }
  return {schemaVersion:1,generatedAt:new Date(now).toISOString(),scope:'Fresno County (06019), exact intersection with county boundary; utility footprints remain uncut',feeds};
}
