import {QPF_URL,qpfCycle,realNumber} from './environment-model.js';
import {fetchQpfCycle} from './environment-data.js';
import {powerGeometry} from './power-geometry.js';
import {DRAINAGE_RAIN_BOUNDS} from './drainage-review-model.js';

/** Public-only local clipping through the same SDK loader as the operational map. */
export function createDrainageRainClipper(loadSdk){
  let modules;
  return async geometry=>{
    modules??=loadSdk().then(sdk=>sdk.import(['@arcgis/core/geometry/operators/intersectionOperator.js','@arcgis/core/geometry/Polygon.js','@arcgis/core/geometry/Extent.js'])).catch(error=>{modules=null;throw error;});
    const [operator,Polygon,Extent]=await modules,[xmin,ymin,xmax,ymax]=DRAINAGE_RAIN_BOUNDS;
    const result=operator.execute(new Polygon(geometry),new Extent({xmin,ymin,xmax,ymax,spatialReference:{wkid:4326}}));
    return result?.rings?.length?result.toJSON():null;
  };
}

/** Fixed public Fresno envelope only; no private inventory coordinates are sent to NOAA. */
export async function fetchDrainageRain({clip,fetchImpl=fetch,clock=Date.now,signal}={}){
  const cycle=await fetchQpfCycle({id:9,hours:72},fetchImpl,clock()),base=`${QPF_URL}/9/query`;
  const call=async params=>{if(signal?.aborted)throw Error('Rainfall check canceled.');const u=new URL(base);u.search=new URLSearchParams({f:'json',where:'1=1',...params});const r=await fetchImpl(u,{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000)});if(!r.ok)throw Error('WPC regional rainfall request failed.');const text=await r.text();if(text.length>16000000)throw Error('WPC regional geometry exceeds the bounded limit.');const d=JSON.parse(text);if(d.error||d.exceededTransferLimit)throw Error('WPC regional rainfall returned an error or incomplete records.');return d;};
  const inventory=await call({geometry:DRAINAGE_RAIN_BOUNDS.join(','),geometryType:'esriGeometryEnvelope',inSR:4326,spatialRel:'esriSpatialRelIntersects',returnIdsOnly:true});
  const ids=inventory.objectIds;if(!Array.isArray(ids)||ids.length>200||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw Error('WPC regional inventory is unverified or exceeds the bounded limit.');
  if(typeof clip!=='function')throw Error('Regional rainfall geometry processing is not ready.');
  const features=[];
  for(let start=0;start<ids.length;start+=10){
    const batch=ids.slice(start,start+10),d=await call({objectIds:batch.join(','),outFields:'objectid,qpf,units,product,issue_time,start_time,end_time',outSR:4326,returnGeometry:true});
    if((d.spatialReference?.latestWkid||d.spatialReference?.wkid)!==4326||!Array.isArray(d.features)||d.features.length!==batch.length||new Set(d.features.map(f=>f.attributes?.objectid)).size!==batch.length||d.features.some(f=>!batch.includes(f.attributes?.objectid)))throw Error('WPC regional geometry / ID accounting failed.');
    const check=qpfCycle(d,72,clock());if(['issue','start','end','product'].some(k=>check[k]!==cycle[k]))throw Error('WPC forecast revised during collection; retry required.');
    for(const f of d.features){const value=realNumber(f.attributes.qpf);if(value===null||value<0)throw Error('WPC rainfall label is invalid.');const geometry=await clip(powerGeometry({...f.geometry,spatialReference:{wkid:4326}}));if(geometry)features.push({value,geometry:powerGeometry(geometry)});}
  }
  if(signal?.aborted)throw Error('Rainfall check canceled.');
  return {cycle,features,checked:clock(),error:null};
}
