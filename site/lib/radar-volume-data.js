import {hanfordRadarTimeline,RADAR_EXTENT,RADAR_MAX_AGE} from './hanford-radar-data.js';

const base=new URL('../data/radar-volume/',import.meta.url);
const shape=[24,48,64],chunkShape=[4,16,16],chunkBytes=4096;
const stamp=value=>typeof value==='number'?value:Date.parse(value);
const hashPattern=/^[a-f0-9]{64}$/;
const radius=6378137,mercY=lat=>radius*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
const expectedBounds=[RADAR_EXTENT[0]*Math.PI/180*radius,mercY(RADAR_EXTENT[1]),RADAR_EXTENT[2]*Math.PI/180*radius,mercY(RADAR_EXTENT[3])];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function volumeRecord(record,now){
 if(!record||!/^KHNX\d{8}_\d{6}_V06\.bin$/.test(record.file)||!hashPattern.test(record.sha256)||
   record.url!==`${record.file.slice(0,-4)}-${record.sha256.slice(0,12)}.zarr/`||!hashPattern.test(record.metadataSha256)||
   !Number.isInteger(record.sourceCount)||record.sourceCount<0||record.sourceCount>150000||
   !Number.isInteger(record.occupiedVoxels)||record.occupiedVoxels<0||record.occupiedVoxels>73728||record.occupiedVoxels>record.sourceCount||
   !Number.isInteger(record.bytes)||record.bytes<0||record.bytes>72*8192)
  throw Error('Invalid radar volume record');
 const frame={...record,count:record.sourceCount,bytes:record.sourceCount*16};
 // Existing source-identity, completed-scan, date and region contract still applies.
 hanfordRadarTimeline({kind:'live-observation',station:'KHNX',checkedAt:new Date(now).toISOString(),frames:[frame]},now);
 return {...frame,start:stamp(record.start),end:stamp(record.end),volumeRecord:record};
}

export async function boundedVolumeBytes(stream,limit){
 if(!stream)throw Error('Weather volume response is empty');
 const reader=stream.getReader(),chunks=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   if(size>limit){await reader.cancel();throw Error('Weather volume response exceeds limit');}chunks.push(value);}
 }finally{reader.releaseLock();}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
async function read(url,limit,{signal,fetchImpl=fetch}){
 const timeout=AbortSignal.timeout(12000);
 const response=await fetchImpl(url,{credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout});
 if(!response.ok)throw Error(`Radar volume HTTP ${response.status}`);
 return boundedVolumeBytes(response.body,limit);
}
async function verified(bytes,expected){
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==expected)throw Error('Radar volume checksum mismatch');return bytes;
}

/** The experimental timeline follows published, complete cubes, with its own observed times. */
export async function loadRadarVolumeTimeline(options={}){
 const doc=JSON.parse(new TextDecoder().decode(await read(new URL('manifest.json',base),192000,options)));
 const now=(options.clock??Date.now)(),generated=stamp(doc.generatedAt),checked=stamp(doc.checkedAt);
 if(doc.version!==1||doc.kind!=='sampled-radar-volume'||doc.station!=='KHNX'||!Array.isArray(doc.frames)||doc.frames.length>12||
   !Number.isFinite(generated)||!Number.isFinite(checked)||generated>now+120000||checked>now+120000||now-generated>RADAR_MAX_AGE)
  throw Error('Radar volume catalog unavailable or old');
 const frames=doc.frames.map(record=>volumeRecord(record,now));
 const timeline=hanfordRadarTimeline({kind:'live-observation',station:'KHNX',checkedAt:new Date(checked).toISOString(),frames,errors:doc.errors},now);
 return {...timeline,delayed:now-checked>20*60000||!!doc.errors?.length};
}

function metadata(meta,record){
 const a=meta?.attributes;
 if(meta.zarr_format!==3||meta.node_type!=='array'||meta.data_type!=='float32'||meta.fill_value!==-999||
   !equal(meta.shape,shape)||meta.chunk_grid?.name!=='regular'||!equal(meta.chunk_grid.configuration?.chunk_shape,chunkShape)||
   meta.chunk_key_encoding?.name!=='default'||meta.chunk_key_encoding.configuration?.separator!=='/'||
   !Array.isArray(meta.codecs)||meta.codecs.length!==2||meta.codecs[0].name!=='bytes'||meta.codecs[0].configuration?.endian!=='little'||meta.codecs[1].name!=='gzip'||
   !a||a.crs!=='EPSG:3857'||a.units!=='dBZ'||a.heightReference!=='estimated MSL metres'||!equal(a.heightRange,[0,12000])||
   !equal(a.dimensions,['height','y','x'])||a.sourceCount!==record.sourceCount||a.occupiedVoxels!==record.occupiedVoxels)
  throw Error('Unsupported radar volume metadata');
 if(!Array.isArray(a.bounds3857)||a.bounds3857.length!==4||a.bounds3857.some((v,i)=>!Number.isFinite(v)||Math.abs(v-expectedBounds[i])>.1))throw Error('Invalid radar volume bounds');
 if(!a.sourceFrame||['file','sha256','source'].some(key=>a.sourceFrame[key]!==record[key])||
   ['start','end'].some(key=>stamp(a.sourceFrame[key])!==stamp(record[key])))throw Error('Radar volume source mismatch');
 if(!Array.isArray(a.chunks)||a.chunks.length>72)throw Error('Invalid radar volume chunk inventory');
 const seen=new Set();let bytes=0;
 for(const c of a.chunks){
  if(!/^c\/[0-5]\/[0-2]\/[0-3]$/.test(c?.key)||seen.has(c.key)||!Number.isInteger(c.bytes)||c.bytes<1||c.bytes>8192||!hashPattern.test(c.sha256))throw Error('Invalid radar volume chunk');
  seen.add(c.key);bytes+=c.bytes;
 }
 if(bytes!==record.bytes)throw Error('Radar volume chunk accounting mismatch');
 return a;
}

/** Bounded regional cube, four requests at a time. Only listed nonempty Zarr chunks are read. */
export async function loadRadarVolumeFrame(record,options={}){
 volumeRecord(record,(options.clock??Date.now)());
 const folder=new URL(record.url,base);
 const raw=await verified(await read(new URL('zarr.json',folder),128000,options),record.metadataSha256);
 const a=metadata(JSON.parse(new TextDecoder().decode(raw)),record);
 const values=new Float32Array(73728).fill(-999),controller=new AbortController();
 const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
 let cursor=0,occupied=0;
 async function worker(){
  while(cursor<a.chunks.length){
   const c=a.chunks[cursor++];
   const compressed=await verified(await read(new URL(c.key,folder),c.bytes,{...options,signal}),c.sha256);
   const bytes=await boundedVolumeBytes(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')),chunkBytes);
   if(bytes.length!==chunkBytes)throw Error('Radar volume chunk length mismatch');
   const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),[cz,cy,cx]=c.key.split('/').slice(1).map(Number);
   for(let z=0;z<4;z++)for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const v=view.getFloat32(((z*16+y)*16+x)*4,true);
    if(!Number.isFinite(v)||v!==-999&&(v<10||v>=80))throw Error('Invalid radar volume sample');
    values[((cz*4+z)*48+cy*16+y)*64+cx*16+x]=v;if(v!==-999)occupied++;
   }
  }
 }
 try{await Promise.all(Array.from({length:Math.min(4,a.chunks.length)},worker));}
 catch(error){controller.abort();throw error;}
 signal.throwIfAborted();
 if(occupied!==record.occupiedVoxels)throw Error('Radar volume occupied-cell accounting mismatch');
 return {values,shape:[...shape],bounds3857:a.bounds3857,heightRange:a.heightRange,occupiedVoxels:occupied,
  sourceCount:record.sourceCount,transferBytes:raw.length+record.bytes};
}
