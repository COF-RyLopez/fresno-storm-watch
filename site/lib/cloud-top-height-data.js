import {observationAt} from './weather-model.js';

const base=new URL('../data/goes-cloud-tops/',import.meta.url);
const product='ABI-L2-ACHA2KMC';
const origin='https://noaa-goes18.s3.amazonaws.com/';
const filename=/^[a-z0-9][a-z0-9-]{0,79}\.bin$/;
const sourceKey=new RegExp(`^${product}/\\d{4}/\\d{3}/\\d{2}/OR_${product}-M\\d_G18_s\\d{14}_e\\d{14}_c\\d{14}\\.nc$`);
export const CLOUD_TOP_MAX_GAP=20*60_000;
const MAX_AGE=90*60_000, MAX_VERTICES=300_000;

export function validateCloudTopManifest(doc,now=Date.now()){
 const generated=Date.parse(doc?.generatedAt);
 if(doc?.schemaVersion!==1||doc.product!==product||doc.satellite!=='GOES-18'||!Number.isFinite(generated)||
   generated>now+120_000||now-generated>2*MAX_AGE||!Array.isArray(doc.frames)||doc.frames.length>24)
  throw Error('GOES cloud-top catalog unavailable or old');
 const files=new Set(),ends=new Set();
 return doc.frames.map(record=>{
  const start=Date.parse(record?.start),end=Date.parse(record?.end);
  if(!filename.test(record?.file)||files.has(record.file)||ends.has(end)||!Number.isFinite(start)||!Number.isFinite(end)||
    start>=end||end-start>10*60_000||end>now+120_000||
    !Number.isInteger(record.count)||record.count<0||record.count>MAX_VERTICES||record.count%3!==0||
    !Number.isFinite(record.resolutionKm)||record.resolutionKm<2||record.resolutionKm>20||!(/^[a-f0-9]{64}$/).test(record.sha256)||
    typeof record.source!=='string'||!record.source.startsWith(origin)||!sourceKey.test(record.source.slice(origin.length)))
   throw Error('Invalid GOES cloud-top frame');
  files.add(record.file);ends.add(end);
  return {...record,start,end};
 }).filter(record=>now-record.end<=MAX_AGE).sort((a,b)=>a.end-b.end);
}

export function cloudTopFrameAt(frames,target,now=Date.now()){
 const stamp=observationAt(frames.map(row=>row.end),target,now,{maxGapMs:CLOUD_TOP_MAX_GAP,maxAgeMs:MAX_AGE});
 return frames.find(row=>row.end===stamp)??null;
}

function read(url,signal,fetchImpl=fetch){
 const timeout=AbortSignal.timeout(8000);
 return fetchImpl(url,{credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([timeout,signal]):timeout});
}
export async function loadCloudTopCatalog({signal}={}){
 const response=await read(new URL('manifest.json',base),signal);
 if(!response.ok)throw Error('GOES cloud-top catalog unavailable');
 return validateCloudTopManifest(await response.json());
}
export async function loadCloudTopFrame(frame,{signal,fetchImpl=fetch}={}){
 if(!filename.test(frame.file)||!Number.isInteger(frame.count)||frame.count<0||frame.count>MAX_VERTICES||frame.count%3!==0)
  throw Error('Invalid GOES cloud-top frame');
 const response=await read(new URL(frame.file,base),signal,fetchImpl);
 if(!response.ok)throw Error('GOES cloud-top mesh unavailable');
 const bytes=await response.arrayBuffer();
 if(bytes.byteLength!==frame.count*12)throw Error('GOES cloud-top mesh length changed');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
 if(digest!==frame.sha256)throw Error('GOES cloud-top mesh checksum mismatch');
 const view=new DataView(bytes),vertices=new Float32Array(frame.count*3);
 let min=Infinity,max=-Infinity;
 for(let i=0;i<vertices.length;i+=3){
  const lon=view.getFloat32(i*4,true),lat=view.getFloat32((i+1)*4,true),height=view.getFloat32((i+2)*4,true);
  if(!Number.isFinite(lon)||lon< -122.51||lon> -116.49||!Number.isFinite(lat)||lat<34.74||lat>39.61||
    !Number.isFinite(height)||height<0||height>20000)throw Error('Invalid GOES cloud-top vertex');
  vertices[i]=lon;vertices[i+1]=lat;vertices[i+2]=height;
  min=Math.min(min,height);max=Math.max(max,height);
 }
 return {vertices,min,max};
}
