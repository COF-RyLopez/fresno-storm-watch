import {ACS_SOURCES,acsFields,acsPeriod,normalizeAcs} from './acs-model.js';

/** Public ArcGIS REST JSON: GET metadata (?f=json) or POST a form query; caller signal combined with a timeout. */
export async function readArcgis(url,query,{fetcher=fetch,signal}={},timeoutMs=25000,httpError='ACS source HTTP ',queryError='ACS publisher query failed.'){
  const timeout=AbortSignal.timeout(timeoutMs),r=await fetcher(query?url:url+'?f=json',{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,...(query?{method:'POST',body:new URLSearchParams({f:'json',...query})}:{})});
  if(!r.ok)throw Error(httpError+r.status);const data=await r.json();if(data.error)throw Error(queryError);return data;
}
export const editedAt=meta=>meta.editingInfo?.dataLastEditDate??meta.editingInfo?.lastEditDate??null;
/** objectId batches of `size`: each must return exactly its IDs once, untruncated, in WGS84; rows mapped per batch. */
export async function readIdBatches(ids,size,oid,query,error,row=f=>f){
  const rows=[];
  for(let i=0;i<ids.length;i+=size){
    const batch=ids.slice(i,i+size),d=await query(batch);
    if((d.spatialReference?.latestWkid||d.spatialReference?.wkid)!==4326||d.exceededTransferLimit||!Array.isArray(d.features)||d.features.length!==batch.length||new Set(d.features.map(f=>f.attributes?.[oid])).size!==batch.length||d.features.some(f=>!batch.includes(f.attributes?.[oid])))throw Error(error);
    for(const f of d.features)rows.push(row(f));
  }
  return rows;
}
export async function readAcsMetadata(key,options={}){
  const s=ACS_SOURCES[key];if(!s)throw Error('Unknown ACS topic.');
  const [item,layer]=await Promise.all([readArcgis('https://www.arcgis.com/sharing/rest/content/items/'+s.id,null,options),readArcgis(s.url,null,options)]);
  if(item.id!==s.id||item.owner!=='esri_demographics'||layer.geometryType!=='esriGeometryPolygon'||!acsFields(key).every(n=>layer.fields?.some(f=>f.name===n)))throw Error('ACS publisher or field schema changed.');
  return {key,period:acsPeriod(item.description),checked:Date.now(),modified:item.modified??null,edited:editedAt(layer)};
}
/** Bounded county or single-tract read. No tract estimates are allocated to a zone. */
export async function readAcsTracts({key='population',id=null,geometry=null,metadata=null,...options}={}){
  if(id!==null&&!/^06019\d{6}$/.test(id))throw Error('Choose a Fresno County tract.');
  const meta=metadata&&metadata.key===key&&Date.now()-metadata.checked<900000?metadata:await readAcsMetadata(key,options),where=id?`GEOID = '${id}'`:"GEOID LIKE '06019%'";
  const filter={where,...(geometry?{geometry:JSON.stringify(geometry),geometryType:'esriGeometryPolygon',inSR:4326,spatialRel:'esriSpatialRelIntersects'}:{})},url=ACS_SOURCES[key].url+'/query';
  const count=await readArcgis(url,{...filter,returnCountOnly:true},options);
  if(!Number.isInteger(count.count)||count.count<0||count.count>500)throw Error('ACS inventory exceeds the bounded county query.');
  const data=await readArcgis(url,{...filter,outFields:acsFields(key).join(','),returnGeometry:!!id&&key==='population',outSR:4326,orderByFields:'GEOID',resultRecordCount:500},options);
  if(!Array.isArray(data.features)||data.exceededTransferLimit||data.features.length!==count.count)throw Error('ACS query is incomplete or changed during retrieval.');
  const rows=data.features.map(f=>normalizeAcs(f,key));if(new Set(rows.map(r=>r.id)).size!==rows.length||id&&(rows.length!==1||rows[0].id!==id))throw Error('ACS tract is missing or duplicated.');
  if(id&&key==='population'){
    const sr=data.spatialReference?.wkid??rows[0].geometry?.spatialReference?.wkid;
    if(sr!==4326||!rows[0].geometry?.rings?.length)throw Error('ACS outline is missing or has an unexpected coordinate system.');
    rows[0].geometry.spatialReference={wkid:4326};
  }
  return {rows,metadata:meta,checked:Date.now()};
}
export async function readPioContext(id,period,options={}){
  return Promise.all(['language','internet','disability','vehicles'].map(async key=>{
    try{const result=await readAcsTracts({key,id,...options});if(result.metadata.period!==period)throw Error('Source period differs from selected population context; comparison requires review.');return {key,...result};}
    catch(e){if(e.name==='AbortError')throw e;return {key,error:e.message};}
  }));
}
