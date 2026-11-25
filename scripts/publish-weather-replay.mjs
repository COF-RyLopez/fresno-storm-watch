/** Publish an explicit allowlist of public replay assets; never copy the work directory. */
import {readFile,writeFile,mkdir,stat,realpath,mkdtemp,rename,rm} from 'node:fs/promises';
import {resolve,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {validateWeatherReplay,createPreparedWeather,weatherReferenceFeatures} from '../site/lib/weather-frame-package.js';
import {QPF_URL} from '../site/lib/environment-model.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Validate all inputs before writing the manifest that exposes the recording. */
async function preparePackage(source){
  const root=await realpath(source),files=new Map();
  const read=async(file,max=2*1024*1024)=>{
    const path=resolve(root,file),actual=await realpath(path);
    if(!actual.startsWith(root+sep)||(await stat(actual)).size>max)throw Error('Replay asset outside public bounds');
    return readFile(actual);
  };
  const p=validateWeatherReplay(JSON.parse(await read('manifest.json')));
  const manifest=Object.fromEntries(['schemaVersion','kind','capturedAt','clock','publisher','source','rasterCrs','coordinateCrs','bounds'].map(k=>[k,p[k]]));
  manifest.frames=p.frames.map(f=>Object.fromEntries(['id','window','cycle','coordinates','legend','image'].map(k=>[k,f[k]])));
  const routes={};
  const entries=Object.entries(JSON.parse(await read('routes.json')));
  if(entries.length>128)throw Error('Replay response inventory exceeds bounds');
  for(const [href,r] of entries){
    const url=new URL(href);
    if(url.username||url.password||!url.href.startsWith(QPF_URL+'/')||[...url.searchParams.keys()].some(k=>/token|secret|password|key/i.test(k))||
      !/^responses\/[a-f0-9]{64}\.bin$/.test(r.file)||r.file!==`responses/${r.sha256}.bin`||
      !Number.isInteger(r.bytes)||r.bytes<1||r.bytes>12*1024*1024||!/^application\/json(?:;.*)?$|^image\/png$/.test(r.type))throw Error('Nonpublic or invalid replay response');
    const bytes=await read(r.file,12*1024*1024);
    if(bytes.length!==r.bytes||digest(bytes)!==r.sha256)throw Error('Recorded response integrity failed');
    files.set(r.file,bytes);routes[href]={file:r.file,type:r.type,bytes:r.bytes,sha256:r.sha256};
  }
  const context=JSON.parse(await read('context.json'));
  if(context.watersheds?.type!=='FeatureCollection'||context.watersheds.features.length!==2||
    new Set(context.watersheds.features.map(f=>f.properties?.reservoir)).size!==2||
    context.watersheds.features.some(f=>!['MIL','PNF'].includes(f.properties?.reservoir)||f.private||f.properties.private))throw Error('Expected two public reservoir watersheds');
  context.features=weatherReferenceFeatures(context.features);
  const store=createPreparedWeather(manifest,new URL('https://recorded.invalid/'),{fetchImpl:async url=>{
    const file=new URL(url).pathname.slice(1),bytes=await read(file,12*1024*1024);files.set(file,bytes);
    return new Response(bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}});
  }});
  try{for(const frame of manifest.frames)await store.load(frame.id);}finally{store.destroy();}
  files.set('routes.json',Buffer.from(JSON.stringify(routes)));
  files.set('context.json',Buffer.from(JSON.stringify({watersheds:context.watersheds,features:context.features,contextNote:String(context.contextNote||'Reference observations not assessed')})));
  files.set('profile.json',Buffer.from(JSON.stringify({latencyMs:0,kind:'same-origin-recorded-response-replay'})));
  files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
  return {root,files,manifest,referencePoints:context.features.length};
}

/** Stage outside site, expose an immutable recording, then atomically switch its pointer. */
export async function publishWeatherReplay(source,destination){
  const packet=await preparePackage(source),dest=resolve(destination);
  await mkdir(dest,{recursive:true});
  const version=digest(Buffer.concat([...packet.files.entries()].sort(([a],[b])=>a.localeCompare(b)).flatMap(([file,bytes])=>[Buffer.from(file),bytes])));
  const relative=`records/${version}/`,record=resolve(dest,relative);
  if(!record.startsWith(dest+sep))throw Error('Invalid publication path');
  const parent=dirname(packet.root),stage=await mkdtemp(resolve(parent,'.weather-publish-'));
  const cleanup=async()=>{if(!stage.startsWith(parent+sep+'.weather-publish-'))throw Error('Unsafe stage cleanup');await rm(stage,{recursive:true,force:true});};
  try{
    for(const [file,bytes]of packet.files){const target=resolve(stage,file);if(!target.startsWith(stage+sep))throw Error('Invalid stage path');await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
    await mkdir(dirname(record),{recursive:true});
    const exists=await stat(record).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
    if(exists){for(const [file,bytes]of packet.files)if(digest(await readFile(resolve(record,file)))!==digest(bytes))throw Error('Immutable recording changed');}
    else await rename(stage,record);
    const pointer=JSON.stringify({schemaVersion:1,recording:relative,capturedAt:packet.manifest.capturedAt});
    await writeFile(resolve(dest,'index.next.json'),pointer);await rename(resolve(dest,'index.next.json'),resolve(dest,'index.json'));
  }finally{await cleanup();}
  return {capturedAt:packet.manifest.capturedAt,recording:relative,frames:packet.manifest.frames.length,referencePoints:packet.referencePoints,files:packet.files.size+1};
}

/** Independently validate the retained public seed before a deployment refresh. */
export async function verifyPublishedWeatherReplay(destination){
  const dest=await realpath(destination),p=JSON.parse(await readFile(resolve(dest,'index.json'),'utf8'));
  if(p.schemaVersion!==1||!/^records\/[a-f0-9]{64}\/$/.test(p.recording))throw Error('Invalid public recording pointer');
  const packet=await preparePackage(resolve(dest,p.recording));
  if(packet.manifest.capturedAt!==p.capturedAt)throw Error('Recording pointer time mismatch');
  return {capturedAt:p.capturedAt,frames:packet.manifest.frames.length,referencePoints:packet.referencePoints,files:packet.files.size+1};
}

if(import.meta.main){
  if(process.argv.includes('--verify')){process.stdout.write(JSON.stringify(await verifyPublishedWeatherReplay(fileURLToPath(new URL('../site/data/weather-delivery-experiment/',import.meta.url))))+'\n');process.exit(0);}
  const base=new URL('../work/weather-delivery/',import.meta.url),pointer=JSON.parse(await readFile(new URL('current.json',base),'utf8'));
  if(!/^capture-\d+-[a-f0-9]{8}$/.test(pointer.id))throw Error('Invalid public capture pointer');
  const result=await publishWeatherReplay(fileURLToPath(new URL(pointer.id+'/',base)),fileURLToPath(new URL('../site/data/weather-delivery-experiment/',import.meta.url)));
  process.stdout.write(JSON.stringify({status:'public_recorded_experiment_published',...result})+'\n');
}
