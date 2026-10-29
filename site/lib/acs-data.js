import {ACS_SOURCES,acsFields,acsPeriod,normalizeAcs} from './acs-model.js?v=0.65.0';

async function read(url,query,{fetcher=fetch,signal}={}){
  const timeout=AbortSignal.timeout(25000),r=await fetcher(query?url:url+'?f=json',{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,...(query?{method:'POST',body:new URLSearchParams({f:'json',...query})}:{})});
  if(!r.ok)throw Error('ACS source HTTP '+r.status);const data=await r.json();if(data.error)throw Error('ACS publisher query failed.');return data;
}
export async function readAcsMetadata(key,options={}){
  const s=ACS_SOURCES[key];if(!s)throw Error('Unknown ACS topic.');
  const [item,layer]=await Promise.all([read('https://www.arcgis.com/sharing/rest/content/items/'+s.id,null,options),read(s.url,null,options)]);
  if(item.id!==s.id||item.owner!=='esri_demographics'||layer.geometryType!=='esriGeometryPolygon'||!acsFields(key).every(n=>layer.fields?.some(f=>f.name===n)))throw Error('ACS publisher or field schema changed.');
  return {key,period:acsPeriod(item.description),checked:Date.now()};
}
/** Bounded county or single-tract read. No tract estimates are allocated to a zone. */
export async function readAcsTracts({key='population',id=null,geometry=null,metadata=null,...options}={}){
  if(id!==null&&!/^06019\d{6}$/.test(id))throw Error('Choose a Fresno County tract.');
  const meta=metadata&&metadata.key===key&&Date.now()-metadata.checked<900000?metadata:await readAcsMetadata(key,options),where=id?`GEOID = '${id}'`:"GEOID LIKE '06019%'";
  const filter={where,...(geometry?{geometry:JSON.stringify(geometry),geometryType:'esriGeometryPolygon',inSR:4326,spatialRel:'esriSpatialRelIntersects'}:{})},url=ACS_SOURCES[key].url+'/query';
  const count=await read(url,{...filter,returnCountOnly:true},options);
  if(!Number.isInteger(count.count)||count.count<0||count.count>500)throw Error('ACS inventory exceeds the bounded county query.');
  const data=await read(url,{...filter,outFields:acsFields(key).join(','),returnGeometry:!!id&&key==='population',outSR:4326,orderByFields:'GEOID',resultRecordCount:500},options);
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
