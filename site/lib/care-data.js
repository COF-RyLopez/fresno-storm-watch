import {CARE_SOURCES,normalizeCare,normalizeZone} from './care-model.js?v=0.56.0-r1';
import {powerScope} from './power-geometry.js';
import {countyGeometry} from './model.js';

/** Fixed public endpoints only; reconcile complete object-ID batches before returning. */
export async function readCareCollection(kind,{county,fetcher=fetch,signal}={}){
 if(!['facilities','zones'].includes(kind))throw Error('Unknown care source.');
 const read=async(path,query={})=>{const u=new URL(CARE_SOURCES[kind]+path);u.search=new URLSearchParams({f:'json',...query});const r=await fetcher(u,{credentials:'omit',cache:'no-store',signal:signal||AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Source HTTP ${r.status}`);const j=await r.json();if(j.error)throw Error('Publisher query failed.');return j;};
 const metadata=await read(''),where=kind==='facilities'?"UPPER(County)='FRESNO'":'1=1';
 const required=kind==='facilities'?['ObjectId2','OBJECTID','County','Facility_Name','Facility_Address','City','Facility_Type','Licensed_Beds','CERTIFICATION_STATUS']:['OID','Name','EvacuationStatus'];
 if(!Array.isArray(metadata.fields)||required.some(name=>!metadata.fields.some(f=>f.name===name))||metadata.objectIdField!==(kind==='facilities'?'ObjectId2':'OID')||metadata.geometryType!==(kind==='facilities'?'esriGeometryPoint':'esriGeometryPolygon'))throw Error('Publisher schema changed.');
 const inventory=await read('/query',{where,returnIdsOnly:true}),ids=inventory.objectIds;
 if(!Array.isArray(ids)||ids.length>2000||ids.some(i=>!Number.isSafeInteger(i))||new Set(ids).size!==ids.length||inventory.exceededTransferLimit)throw Error('Publisher inventory is incomplete or exceeds the bounded limit.');
 const scope=powerScope(countyGeometry(county.geometry)),rows=[],accounting={returned:0,outside:0,rejected:0,retained:0};
 const fields=kind==='facilities'?'ObjectId2,OBJECTID,County,Facility_Name,Facility_Address,City,Facility_Type,Licensed_Beds,CERTIFICATION_STATUS':'OID,Name,EvacuationStatus';
 for(let i=0;i<ids.length;i+=100){const batch=ids.slice(i,i+100),d=await read('/query',{objectIds:batch.join(','),outFields:fields,returnGeometry:true,outSR:4326});
  if((d.spatialReference?.latestWkid||d.spatialReference?.wkid)!==4326||!Array.isArray(d.features)||d.features.length!==batch.length||d.exceededTransferLimit||new Set(d.features.map(f=>f.attributes?.[metadata.objectIdField])).size!==batch.length||d.features.some(f=>!batch.includes(f.attributes?.[metadata.objectIdField])))throw Error('Publisher batch changed or returned incomplete geometry.');
  for(const f of d.features){accounting.returned++;let row;try{row=(kind==='facilities'?normalizeCare:normalizeZone)({...f,geometry:{...f.geometry,spatialReference:{wkid:4326}}});}catch{accounting.rejected++;continue;}if(!scope.intersects(row.geometry)){accounting.outside++;continue;}rows.push(row);accounting.retained++;}
 }
 const after=await read('/query',{where,returnIdsOnly:true});if(!Array.isArray(after.objectIds)||after.exceededTransferLimit||JSON.stringify([...ids].sort((a,b)=>a-b))!==JSON.stringify([...after.objectIds].sort((a,b)=>a-b)))throw Error('Publisher inventory changed during retrieval; retry.');
 return {rows,accounting,checked:Date.now(),edited:metadata.editingInfo?.dataLastEditDate||metadata.editingInfo?.lastEditDate||null};
}
export async function readCarePlaces({fetcher=fetch}={}){
 const base=new URL('../data/care-places/',import.meta.url),read=async url=>{const r=await fetcher(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Overture Places reference unavailable.');return r;};
 const index=await(await read(new URL('index.json',base))).json();
 if(index.schemaVersion!==1||!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(index.release)||index.file!==`${index.release}.json.gz`||index.crs!=='EPSG:4326'||index.compression!=='gzip'||index.count>100000||index.bytes>10000000||index.decodedBytes>60000000||!/^[a-f0-9]{64}$/.test(index.sha256))throw Error('Invalid Places reference manifest.');
 const buffer=await(await read(new URL(index.file,base))).arrayBuffer();if(buffer.byteLength!==index.bytes)throw Error('Places reference size changed.');
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');if(digest!==index.sha256)throw Error('Places reference version changed.');
 const decoded=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(decoded.byteLength!==index.decodedBytes)throw Error('Places reference expanded size changed.');
 const data=JSON.parse(new TextDecoder().decode(decoded)),seen=new Set();if(data.schemaVersion!==1||data.release!==index.release||!Array.isArray(data.rows)||data.rows.length!==index.count)throw Error('Places reference is incomplete.');
 for(const p of data.rows){if(typeof p.id!=='string'||!p.id.trim()||seen.has(p.id)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x< -121.1||p.x> -118.2||p.y<35.7||p.y>37.7||!Array.isArray(p.addresses)||typeof p.name!=='string')throw Error('Invalid Places record.');seen.add(p.id);}
 return {index,rows:data.rows};
}
