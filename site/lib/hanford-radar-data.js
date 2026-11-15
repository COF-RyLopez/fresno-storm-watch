// Public F.R.O.G. derivatives of completed NOAA KHNX Level II volume scans.
const ROOT='https://frog-demo.ryanlopez.tech/live/khnx-v1/';
const ARCHIVE='https://unidata-nexrad-level2.s3.amazonaws.com/';
const STATION='KHNX';
const SCAN_NAME=new RegExp(`^${STATION}(\\d{4})(\\d{2})(\\d{2})_(\\d{2})(\\d{2})(\\d{2})_V06\\.bin$`);
const MINUTE=60_000, MAX_SAMPLES=150_000, STRIDE=16;
export const RADAR_EXTENT=[-120.6,36.3,-118.5,37.7].map(Math.fround);
export const RADAR_MAX_AGE=120*MINUTE;
export const RADAR_BANDS=[
 {min:10,label:'10–<20',color:[145,155,173]},
 {min:20,label:'20–<30',color:[108,197,229]},
 {min:30,label:'30–<40',color:[82,204,159]},
 {min:40,label:'40–<50',color:[250,215,89]},
 {min:50,label:'50–<80',color:[245,120,91]}
];

function scanFrame(frame,now){
 const timestamp=value=>Number.isFinite(value)?value:Date.parse(value);
 const start=timestamp(frame?.start),end=timestamp(frame?.end);
 const id=SCAN_NAME.exec(frame?.file);
 if(!id||!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>30*MINUTE||end>now+2*MINUTE||
   !Number.isInteger(frame.count)||frame.count<0||frame.count>MAX_SAMPLES||frame.bytes!==frame.count*STRIDE||
   !/^[a-f0-9]{64}$/.test(frame.sha256))throw Error('Invalid Hanford radar scan');
 const [,year,month,day,hour,minute,second]=id;
 const stamp=`${year}-${month}-${day}T${hour}:${minute}:${second}`;
 if(new Date(start).toISOString().slice(0,19)!==stamp||
   frame.source!==`${ARCHIVE}${year}/${month}/${day}/${STATION}/${frame.file.slice(0,-4)}`)throw Error('Unexpected NOAA source identity');
 return {...frame,start,end};
}

export function hanfordRadarTimeline(manifest,now){
 const checked=Date.parse(manifest?.checkedAt);
 if(manifest?.kind!=='live-observation'||manifest.station!==STATION||!Number.isFinite(checked)||checked>now+2*MINUTE||
   !Array.isArray(manifest.frames)||manifest.frames.length>32)throw Error('Invalid Hanford radar manifest');
 const frames=manifest.frames.map(frame=>scanFrame(frame,now));
 if(new Set(frames.map(frame=>frame.file)).size!==frames.length)throw Error('Duplicate Hanford radar scan');
 frames.sort((a,b)=>a.end-b.end);
 const latest=frames.at(-1);
 if(latest&&(checked<latest.end-2*MINUTE||now-latest.end>RADAR_MAX_AGE))throw Error('Hanford radar scan is too old');
 const recent=frames.filter(frame=>now-frame.end<=60*MINUTE).slice(-12);
 const retained=recent.length?recent:frames.slice(-1);
 return {frames:retained,delayed:now-checked>6*MINUTE||!!manifest.errors?.length,
  gaps:retained.some((frame,index)=>index>0&&frame.start-retained[index-1].end>15*MINUTE)};
}

export function radarSampleColor(dbz){return RADAR_BANDS.findLast(band=>dbz>=band.min).color;}

/** Validate little-endian lon, lat, MSL metres and dBZ. Return packed, aligned floats. */
function decodeSamples(buffer,count){
 const source=new DataView(buffer),samples=new Float32Array(count*4),[west,south,east,north]=RADAR_EXTENT;
 for(let i=0;i<samples.length;i+=4){
  const lon=source.getFloat32(i*4,true),lat=source.getFloat32((i+1)*4,true);
  const height=source.getFloat32((i+2)*4,true),dbz=source.getFloat32((i+3)*4,true);
  if(![lon,lat,height,dbz].every(Number.isFinite)||lon<west||lon>east||lat<south||lat>north||height<0||height>12000||dbz<10||dbz>=80)
   throw Error('Invalid Hanford radar sample');
  samples[i]=lon;samples[i+1]=lat;samples[i+2]=height;samples[i+3]=dbz;
 }
 return samples;
}

async function getBytes(response,limit){
 if(!response.ok||!response.body)throw Error(`Hanford radar returned HTTP ${response.status}`);
 const reader=response.body.getReader(),chunks=[];
 let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   size+=value.byteLength;
   if(size>limit){await reader.cancel();throw Error('Hanford radar response exceeds limit');}
   chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);
 let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return bytes.buffer;
}

function read(file,limit,{signal,fetchImpl=fetch}){
 const timeout=AbortSignal.timeout(12_000);
 return fetchImpl(new URL(file,ROOT),{credentials:'omit',cache:'no-store',redirect:'error',
  signal:signal?AbortSignal.any([signal,timeout]):timeout}).then(response=>getBytes(response,limit));
}

export async function loadHanfordTimeline(options={}){
 const metadata=await read('manifest.json',192_000,options);
 return hanfordRadarTimeline(JSON.parse(new TextDecoder().decode(metadata)),(options.clock??Date.now)());
}

export async function loadHanfordFrame(record,options={}){
 const now=(options.clock??Date.now)();
 const frame=scanFrame(record,now);
 if(now-frame.end>RADAR_MAX_AGE)throw Error('Hanford radar scan is too old');
 const bytes=await read(frame.file,frame.bytes,options);
 if(bytes.byteLength!==frame.bytes)throw Error('Hanford radar scan length changed');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(digest!==frame.sha256)throw Error('Hanford radar scan checksum mismatch');
 return decodeSamples(bytes,frame.count);
}
