import {boundedVolumeBytes} from './radar-volume-data.js';

const base=new URL('../data/hrrr-clouds/',import.meta.url);
const HOUR=3600000;
const shape=[32,96,104],heightRange=[0,16000];
const byteCount=shape.reduce((a,b)=>a*b,1);
const r=6378137;
const x=lon=>r*lon*Math.PI/180;
const y=lat=>r*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const bounds=[x(-121.5),y(35.5),x(-117.7),y(38.65)];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function validateForecastClouds(doc,now=Date.now()){
 const run=Date.parse(doc?.run);
 if(doc?.version!==1||!Number.isFinite(run)||run%HOUR!==0||run>now||run+12*HOUR<now||
   !same(doc.shape,shape)||!same(doc.heightRange,heightRange)||
   !Array.isArray(doc.bounds3857)||doc.bounds3857.length!==4||
   doc.bounds3857.some((value,i)=>!Number.isFinite(value)||Math.abs(value-bounds[i])>.1)||
   !Array.isArray(doc.frames)||doc.frames.length!==12)
  throw Error('Current HRRR cloud forecast unavailable');
 const cycle=new Date(run).toISOString().slice(0,13).replaceAll('-','').replace('T','');
 const frames=doc.frames.map((frame,i)=>{
  const lead=i+1,valid=Date.parse(frame?.valid),hash=frame?.sha256;
  if(frame?.lead!==lead||valid!==run+lead*HOUR||typeof hash!=='string'||!(/^[a-f0-9]{64}$/).test(hash)||
    frame.file!==`${cycle}-f${String(lead).padStart(2,'0')}-${hash.slice(0,12)}.gz`||
    !Number.isInteger(frame.bytes)||frame.bytes<=0||frame.bytes>400000)
   throw Error('Invalid HRRR cloud forecast hour');
  return {...frame,valid};
 });
 return {run,frames,bounds3857:[...doc.bounds3857]};
}

async function read(name,limit,signal,cache='no-store'){
 const response=await fetch(new URL(name,base),{
  credentials:'omit',redirect:'error',cache,signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])
 });
 if(!response.ok)throw Error(`HRRR clouds HTTP ${response.status}`);
 return boundedVolumeBytes(response.body,limit);
}

export async function loadForecastClouds(signal){
 const bytes=await read('latest.json',30000,signal);
 return validateForecastClouds(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function loadForecastCloudHour(catalog,frame,signal){
 if(!catalog.frames.includes(frame))throw Error('Unknown HRRR forecast hour');
 const compressed=await read(frame.file,frame.bytes,signal,'force-cache');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',compressed)),
  byte=>byte.toString(16).padStart(2,'0')).join('');
 if(compressed.length!==frame.bytes||hash!==frame.sha256)throw Error('HRRR cloud frame integrity check failed');
 const inflated=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
 const values=await boundedVolumeBytes(inflated,byteCount);
 signal.throwIfAborted();
 if(values.length!==byteCount)throw Error('HRRR cloud volume shape mismatch');
 return {values,shape,bounds3857:catalog.bounds3857,heightRange};
}
