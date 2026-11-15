import {readFile,writeFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {webcrypto,randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {loadHanfordTimeline,loadHanfordFrame,RADAR_MAX_AGE} from '../site/lib/hanford-radar-data.js';
import {buildRadarVolume,validateSourceFrame,volumeDirectory,sha256,SHA256,VOLUME_SHAPE,VOLUME_CHUNK_SHAPE,
 VOLUME_BOUNDS,VOLUME_HEIGHT_RANGE,VOLUME_FILL} from './lib/radar-volume.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const DEFAULT_OUTPUT=fileURLToPath(new URL('../site/data/radar-volume/',import.meta.url));
const MAX_FRAMES=12,MAX_METADATA_BYTES=64000,MAX_CHUNK_BYTES=8192;
const CHUNK_KEY=/^c\/([0-5])\/([0-2])\/([0-3])$/;

/** Write a same-directory temporary file, then atomically replace its destination. */
async function atomicWrite(filename,bytes){
 await mkdir(path.dirname(filename),{recursive:true});
 const temporary=`${filename}.${randomUUID()}.tmp`;
 try{await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,filename);}
 finally{await rm(temporary,{force:true});}
}

/** Bound local reads before parsing metadata or decompressing chunks. @returns {Promise<Buffer>} */
async function boundedRead(filename,limit){
 const info=await stat(filename);
 if(!info.isFile()||info.size>limit)throw Error('Local radar volume file exceeds limit');
 const bytes=await readFile(filename);
 if(bytes.length>limit)throw Error('Local radar volume file changed size');
 return bytes;
}

/** Validate a published manifest entry without trusting it as a filesystem path. @returns {object} */
function validateEntry(record,now){
 const source=validateSourceFrame({...record,count:record?.sourceCount,bytes:record?.sourceCount*16});
 if(now-source.end>RADAR_MAX_AGE||source.end>now+120000)throw Error('Local radar volume is stale or in the future');
 if(record.url!==`${volumeDirectory(source)}/`||typeof record.metadataSha256!=='string'||!SHA256.test(record.metadataSha256)||
  !Number.isSafeInteger(record.bytes)||record.bytes<0||record.bytes>72*MAX_CHUNK_BYTES||
  !Number.isSafeInteger(record.occupiedVoxels)||record.occupiedVoxels<0||record.occupiedVoxels>Math.min(record.sourceCount,73728))
  throw Error('Invalid local radar volume entry');
 return source;
}

/** Fully verify previously published bytes before reuse, including decompressed values and accounting. */
async function verifyLocalVolume(outDir,record,now,expectedSource){
 const source=validateEntry(record,now);
 if(expectedSource&&['file','sha256','start','end','count','bytes','source'].some(key=>source[key]!==expectedSource[key]))
  throw Error('Local radar volume source identity changed');
 const directory=path.join(outDir,volumeDirectory(source));
 const metadataBytes=await boundedRead(path.join(directory,'zarr.json'),MAX_METADATA_BYTES);
 if(sha256(metadataBytes)!==record.metadataSha256)throw Error('Local radar volume metadata checksum mismatch');
 const m=JSON.parse(metadataBytes.toString('utf8')),a=m.attributes;
 const fixed={zarr_format:3,node_type:'array',shape:VOLUME_SHAPE,data_type:'float32',
  chunk_grid:{name:'regular',configuration:{chunk_shape:VOLUME_CHUNK_SHAPE}},
  chunk_key_encoding:{name:'default',configuration:{separator:'/'}},fill_value:VOLUME_FILL,
  codecs:[{name:'bytes',configuration:{endian:'little'}},{name:'gzip',configuration:{level:6}}],dimension_names:['height','y','x']};
 if(Object.entries(fixed).some(([key,value])=>!isDeepStrictEqual(m[key],value))||a?.kind!=='sampled-radar-volume'||a.station!=='KHNX'||
  !isDeepStrictEqual(a.dimensions,['height','y','x'])||a.crs!=='EPSG:3857'||a.units!=='dBZ'||
  !isDeepStrictEqual(a.bounds3857,VOLUME_BOUNDS)||!isDeepStrictEqual(a.heightRange,VOLUME_HEIGHT_RANGE)||
  a.heightReference!=='estimated MSL metres'||a.processing?.version!==1||a.processing.interpolation!=='none'||a.processing.verticalFill!=='none'||
  a.sourceCount!==source.count||a.occupiedVoxels!==record.occupiedVoxels||a.collapsedSamples!==source.count-record.occupiedVoxels||
  !isDeepStrictEqual(a.sourceFrame,Object.fromEntries(['file','sha256','start','end','source'].map(key=>[key,source[key]])))||
  !Array.isArray(a.chunks)||a.chunks.length>72)throw Error('Local radar volume metadata contract changed');
 let bytes=0,occupied=0,maximum=null;
 const keys=new Set();
 for(const chunk of a.chunks){
  if(typeof chunk?.key!=='string'||!CHUNK_KEY.test(chunk.key)||keys.has(chunk.key)||!Number.isSafeInteger(chunk.bytes)||
   chunk.bytes<=0||chunk.bytes>MAX_CHUNK_BYTES||typeof chunk.sha256!=='string'||!SHA256.test(chunk.sha256))
   throw Error('Invalid local radar volume chunk inventory');
  keys.add(chunk.key);
  const encoded=await boundedRead(path.join(directory,...chunk.key.split('/')),MAX_CHUNK_BYTES);
  if(encoded.length!==chunk.bytes||sha256(encoded)!==chunk.sha256)throw Error('Local radar volume chunk checksum mismatch');
  const raw=gunzipSync(encoded,{maxOutputLength:4096});
  if(raw.length!==4096)throw Error('Local radar volume chunk shape changed');
  let chunkOccupied=0;
  for(let offset=0;offset<raw.length;offset+=4){
   const value=raw.readFloatLE(offset);
   if(value===VOLUME_FILL)continue;
   if(!Number.isFinite(value)||value<10||value>=80)throw Error('Invalid local radar volume value');
   chunkOccupied++;maximum=maximum===null?value:Math.max(maximum,value);
  }
  if(!chunkOccupied)throw Error('Empty chunk is listed as occupied');
  occupied+=chunkOccupied;bytes+=encoded.length;
 }
 if(bytes!==record.bytes||occupied!==record.occupiedVoxels||maximum!==a.maximumDbz)
  throw Error('Local radar volume accounting mismatch');
 return record;
}

/** Publish chunks first and metadata last; its manifest entry is created only after both succeed. */
async function publishVolume(outDir,source,volume){
 const directory=path.join(outDir,volume.directory);
 try{
  const old=JSON.parse((await boundedRead(path.join(directory,'zarr.json'),MAX_METADATA_BYTES)).toString('utf8'));
  const identity=old.attributes?.sourceFrame;
  if(identity&&['file','sha256','start','end','source'].some(key=>identity[key]!==source[key]))
   throw Error('Immutable radar volume directory identity collision');
 }catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}
 for(const chunk of volume.chunks)await atomicWrite(path.join(directory,...chunk.key.split('/')),chunk.data);
 await atomicWrite(path.join(directory,'zarr.json'),volume.metadataBytes);
 const {file,sha256:sourceSha256,start,end,source:url}=source;
 return {file,sha256:sourceSha256,start,end,source:url,url:`${volume.directory}/`,metadataSha256:volume.metadataSha256,
  bytes:volume.bytes,occupiedVoxels:volume.metadata.attributes.occupiedVoxels,sourceCount:source.count};
}

/**
 * Collect at most 12 recent verified regional cubes. A failed fetch never fabricates a volume.
 * @param {{outDir?:string,clock?:()=>number,fetchImpl?:typeof fetch,log?:(message:string)=>void}} options
 * @returns {Promise<object>} Published manifest, including explicit source/collection errors.
 */
export async function collectRadarVolume({outDir=DEFAULT_OUTPUT,clock=Date.now,fetchImpl=fetch,log=console.log}={}){
 const started=performance.now(),now=clock();
 if(!Number.isSafeInteger(now)||Math.abs(now)>8.64e15)throw Error('Invalid collection time');
 outDir=path.resolve(outDir);
 await mkdir(outDir,{recursive:true});
 const errors=[],previous=[],retained=new Map();
 try{
  const old=JSON.parse((await boundedRead(path.join(outDir,'manifest.json'),MAX_METADATA_BYTES)).toString('utf8'));
  if(old.version!==1||old.kind!=='sampled-radar-volume'||old.station!=='KHNX'||!Array.isArray(old.frames)||old.frames.length>MAX_FRAMES)
   throw Error('Invalid previous volume manifest');
  previous.push(...old.frames);
 }catch(error){if(error.code!=='ENOENT')log(`Previous radar volume manifest ignored: ${error.message}`);}
 // Verify local data even when upstream is unavailable; an unverified old cube cannot survive a rerun.
 for(const entry of previous){
  try{await verifyLocalVolume(outDir,entry,now);retained.set(entry.file,entry);}
  catch(error){log(`Local radar volume not reused (${String(entry?.file)}): ${error.message}`);}
 }
 let timeline;
 try{
  timeline=await loadHanfordTimeline({clock:()=>now,fetchImpl});
  if(timeline.delayed)errors.push({stage:'timeline',message:'Upstream Hanford timeline is delayed or reports collection errors'});
 }catch(error){errors.push({stage:'timeline',message:error.message});}
 for(const raw of timeline?.frames??[]){
  let frame;
  try{
   frame=validateSourceFrame(raw);
   const local=retained.get(frame.file);
   if(local){
    try{
     await verifyLocalVolume(outDir,local,now,frame);
     log(`${frame.file}: reused ${local.sourceCount} samples -> ${local.occupiedVoxels} occupied voxels (${local.bytes} compressed bytes)`);
     continue;
    }catch(error){retained.delete(frame.file);log(`Rebuilding ${frame.file}: ${error.message}`);}
   }
   const samples=await loadHanfordFrame(frame,{clock:()=>now,fetchImpl}),volume=buildRadarVolume(frame,samples);
   const entry=await publishVolume(outDir,frame,volume);
   retained.set(frame.file,entry);
   log(`${frame.file}: ${entry.sourceCount} samples -> ${entry.occupiedVoxels} occupied voxels; ${entry.sourceCount-entry.occupiedVoxels} samples collapsed by maximum (${entry.bytes} compressed bytes, ${volume.chunks.length} chunks)`);
  }catch(error){errors.push({stage:'frame',file:frame?.file??String(raw?.file),message:error.message});}
 }
 const frames=[...retained.values()].sort((a,b)=>a.end-b.end||a.file.localeCompare(b.file)).slice(-MAX_FRAMES);
 const stamp=new Date(now).toISOString();
 const manifest={version:1,kind:'sampled-radar-volume',station:'KHNX',generatedAt:stamp,checkedAt:stamp,frames,errors};
 await atomicWrite(path.join(outDir,'manifest.json'),Buffer.from(JSON.stringify(manifest,null,2)+'\n','utf8'));
 log(`Radar volume manifest: ${frames.length} frames, ${frames.reduce((sum,frame)=>sum+frame.bytes,0)} compressed bytes, ${errors.length} errors, ${Math.round(performance.now()-started)} ms`);
 return manifest;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 collectRadarVolume().then(manifest=>{if(manifest.errors.length)process.exitCode=1;}).catch(error=>{
  console.error(`Radar volume collection failed: ${error.message}`);process.exitCode=1;
 });
}
