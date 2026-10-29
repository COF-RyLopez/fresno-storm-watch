import {AFN_SOURCES,validateLanguageAreas,normalizePuma,normalizeSvi,normalizeCes,normalizeDac,normalizeCcl} from './afn-model.js?v=0.68.0';

async function read(url,query,{fetcher=fetch,signal}={}){
  const timeout=AbortSignal.timeout(25000),r=await fetcher(query?url:url+'?f=json',{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,...(query?{method:'POST',body:new URLSearchParams({f:'json',...query})}:{})});
  if(!r.ok)throw Error('Source HTTP '+r.status);const data=await r.json();if(data.error)throw Error('Publisher query failed.');return data;
}
const normalizers={puma:normalizePuma,svi:normalizeSvi,ces:normalizeCes,sb535:normalizeDac,ccl:normalizeCcl};

/** Bounded read of every record intersecting the zone; a partial result is an error, never a smaller count. */
export async function readIntersecting(key,geometry,options={}){
  const s=AFN_SOURCES[key],meta=await read(s.url,null,options);
  if(!s.fields.every(n=>meta.fields?.some(f=>f.name===n)))throw Error('Publisher field schema changed.');
  const filter={where:s.where,geometry:JSON.stringify(geometry),geometryType:'esriGeometryPolygon',inSR:4326,spatialRel:'esriSpatialRelIntersects'},url=s.url+'/query';
  const count=await read(url,{...filter,returnCountOnly:true},options);
  if(!Number.isInteger(count.count)||count.count<0||count.count>s.limit)throw Error('Record count exceeds the bounded zone query.');
  if(!count.count)return {key,rows:[],checked:Date.now()};
  const data=await read(url,{...filter,outFields:s.fields.join(','),returnGeometry:false,orderByFields:s.fields[0],resultRecordCount:s.limit},options);
  if(!Array.isArray(data.features)||data.exceededTransferLimit||data.features.length!==count.count)throw Error('Query is incomplete or changed during retrieval.');
  const rows=data.features.map(normalizers[key]),ids=rows.map(r=>r.key||r.id);
  if(new Set(ids).size!==ids.length)throw Error('Duplicate source record.');
  return {key,rows,checked:Date.now(),edited:meta.editingInfo?.dataLastEditDate??meta.editingInfo?.lastEditDate??null};
}
export async function readLanguageAreas({fetcher=fetch,signal}={}){
  const r=await fetcher(new URL('../data/acs-b16001-fresno.json',import.meta.url),{credentials:'omit',signal:signal||AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Language reference unavailable.');return validateLanguageAreas(await r.json());
}

/** Topics fail independently, like readPioContext; an abort cancels all of them. */
export async function readAfnContext(geometry,options={}){
  const topic=async(key,work)=>{try{return {key,...await work()};}catch(e){if(e.name==='AbortError')throw e;return {key,error:e.message};}};
  return Promise.all([
    topic('languages',async()=>{
      const [areas,reference]=await Promise.all([readIntersecting('puma',geometry,options),readLanguageAreas(options)]),byId=new Map(reference.rows.map(r=>[r.puma,r]));
      return {rows:areas.rows.map(p=>{const values=byId.get(p.id);if(!values)throw Error('No language reference for PUMA '+p.id+'.');return {...values,id:p.id,name:p.name};}),period:reference.period,source:reference.source,checked:areas.checked};
    }),
    topic('svi',()=>readIntersecting('svi',geometry,options)),
    topic('ces',async()=>{
      const [ces,dac]=await Promise.all([readIntersecting('ces',geometry,options),readIntersecting('sb535',geometry,options)]),category=new Map(dac.rows.map(r=>[r.id,r.category]));
      return {rows:ces.rows.map(r=>({...r,dac:category.get(r.id)||null})),checked:ces.checked};
    }),
    topic('ccl',()=>readIntersecting('ccl',geometry,options))
  ]);
}
