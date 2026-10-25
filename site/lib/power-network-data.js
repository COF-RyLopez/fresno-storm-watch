import {countyGeometry} from './model.js';
import {NETWORK_SOURCES,normalizeNetworkFeature,validateNetworkSnapshot} from './power-network-model.js';
const MAX_FEATURES=5000;
/** Read a complete county-selected reference without credentials. Retain full intersecting features. */
export async function queryNetworkSource(spec,county,fetchImpl=fetch){
  const call=async(suffix,parameters)=>{const response=await fetchImpl(spec.url+suffix,{method:'POST',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000),body:new URLSearchParams({f:'json',...parameters})});if(!response.ok)throw Error('Utility reference HTTP '+response.status);const d=await response.json();if(d.error)throw Error('Utility reference query failed');return d;};
  const meta=await call('',{}),oid=meta.objectIdField||meta.fields?.find(f=>f.type==='esriFieldTypeOID')?.name;
  if(!oid||meta.geometryType!==(spec.kind==='substation'?'esriGeometryPoint':'esriGeometryPolyline'))throw Error('Utility reference schema changed');
  if(spec.fields.split(',').some(name=>!meta.fields.some(f=>f.name===name)))throw Error('Utility reference fields changed');
  const selection={where:'1=1',geometry:JSON.stringify(countyGeometry(county.geometry)),geometryType:'esriGeometryPolygon',inSR:'4326',spatialRel:'esriSpatialRelIntersects'};
  const ids=async()=>{const d=await call('/query',{...selection,returnIdsOnly:'true'});if(d.objectIds===null){const c=await call('/query',{...selection,returnCountOnly:'true'});if(c.count!==0||c.exceededTransferLimit)throw Error('Empty utility reference is unverified');return [];}if(!Array.isArray(d.objectIds)||d.exceededTransferLimit||d.objectIds.length>MAX_FEATURES||new Set(d.objectIds).size!==d.objectIds.length||d.objectIds.some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Utility reference IDs are incomplete');return d.objectIds.sort((a,b)=>a-b);};
  const selected=await ids(),features=[];
  for(let i=0;i<selected.length;i+=50){const batch=selected.slice(i,i+50),d=await call('/query',{objectIds:batch.join(','),outFields:spec.fields,outSR:'4326',returnGeometry:'true',geometryPrecision:'6',maxAllowableOffset:'0.00005'});if(!Array.isArray(d.features)||d.features.length!==batch.length||d.exceededTransferLimit||(d.spatialReference?.latestWkid||d.spatialReference?.wkid)!==4326||JSON.stringify(d.features.map(f=>f.attributes?.[oid]).sort((a,b)=>a-b))!==JSON.stringify(batch))throw Error('Utility reference batch or CRS is incomplete');for(const f of d.features)features.push(normalizeNetworkFeature({...f,geometry:{...f.geometry,spatialReference:f.geometry?.spatialReference||{wkid:4326}}},spec,oid));}
  if(JSON.stringify(await ids())!==JSON.stringify(selected))throw Error('Utility reference changed during collection');
  const finalMeta=await call('',{});if(Number.isFinite(meta.editingInfo?.lastEditDate)&&finalMeta.editingInfo?.lastEditDate!==meta.editingInfo.lastEditDate)throw Error('Utility reference edited during collection');
  return {features:features.sort((a,b)=>a.key.localeCompare(b.key)),accounting:{selected:selected.length,returned:features.length},publisherEdited:Number.isFinite(meta.editingInfo?.lastEditDate)?meta.editingInfo.lastEditDate:null};
}
/** Independent source failures retain dated geometry and never freshen it. */
export async function collectNetwork({county,previous=null,fetchImpl=fetch,now=Date.now()}={}){
  const sources=await Promise.all(NETWORK_SOURCES.map(async spec=>{const old=previous?.sources.find(s=>s.id===spec.id);try{return {...spec,lastAttempt:new Date(now).toISOString(),lastSuccess:new Date(now).toISOString(),error:null,...await queryNetworkSource(spec,county,fetchImpl)};}catch{return {...spec,features:old?.features||[],accounting:old?.accounting||null,publisherEdited:old?.publisherEdited||null,lastAttempt:new Date(now).toISOString(),lastSuccess:old?.lastSuccess||null,error:'Utility reference collection failed; previous verified data retained if available.'};}}));
  return validateNetworkSnapshot({schemaVersion:1,scope:'Fresno County 06019; whole intersecting features',generatedAt:new Date(now).toISOString(),geometryNote:'Publisher county-polygon intersection; whole features retained, generalized for display at 0.00005 degrees with 6 decimal places. Not survey geometry or an electrical topology.',sources});
}
