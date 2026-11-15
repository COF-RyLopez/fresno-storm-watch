import {CLOUD_PAIR_GAP,loadCloudTimes,loadCloudImage,matchCloudObservation} from './watch-cloud-data.js';
import {CLOUD_TOP_MAX_GAP,cloudTopFrameAt,loadCloudTopCatalog,loadCloudTopFrame} from './cloud-top-height-data.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

/** The satellite overlay follows the radar observation, with its own time and failure state. */
export function installWatchClouds(session){
 const button=document.createElement('calcite-button');
 button.scale='s';button.textContent='Clouds';button.hidden=true;
 const status=document.createElement('p');
 status.className='watch-cloud-time';status.hidden=true;
 let enabled=true,lifecycle,target,rendered=null,generation=0;
 const catalogs=new Map(),frames=new Map();
 function sync(){
  button.appearance=enabled?'solid':'outline';button.kind='neutral';
  button.setAttribute('aria-pressed',String(enabled));
  status.hidden=!lifecycle||!enabled;
 }
 function clearImage(){
  if(rendered?.kind==='surface')session.cloudTops(null);
  if(rendered?.kind==='infrared')session.cloud(null);
  rendered=null;
  status.removeAttribute('title');
 }
 function catalog(kind,load,signal){
  const previous=catalogs.get(kind);
  if(previous&&Date.now()-previous.checked<5*60_000)return previous.task;
  const task=load({signal}).catch(error=>{if(catalogs.get(kind)?.task===task)catalogs.delete(kind);throw error;});
  catalogs.set(kind,{checked:Date.now(),task});
  return task;
 }
 function frame(key,load){
  if(frames.has(key))return frames.get(key);
  const task=load().catch(error=>{if(frames.get(key)===task)frames.delete(key);throw error;});
  frames.set(key,task);
  if(frames.size>4)frames.delete(frames.keys().next().value);
  return task;
 }
 async function observe(when){
  target=Math.min(when,Date.now());
  if(!lifecycle||!enabled)return;
  const signal=lifecycle.signal,run=++generation,observation=target;
  const current=()=>!signal.aborted&&generation===run;
  if(rendered&&(rendered.stamp>observation||observation-rendered.stamp>(rendered.kind==='surface'?CLOUD_TOP_MAX_GAP:CLOUD_PAIR_GAP)))clearImage();
  if(!rendered)status.textContent='Checking GOES clouds…';
  try{
   const catalogFrames=await catalog('surface',loadCloudTopCatalog,signal);
   if(!current())return;
   const scene=cloudTopFrameAt(catalogFrames,observation);
   if(scene?.count){
    if(rendered?.key===scene.sha256&&rendered.stamp===scene.end)return;
    const mesh=await frame(scene.sha256,()=>loadCloudTopFrame(scene,{signal}));
    if(!current())return;
    if(rendered?.kind==='infrared')clearImage();
    session.cloudTops(mesh.vertices);
    rendered={kind:'surface',stamp:scene.end,key:scene.sha256};
    status.textContent=`3D cloud tops · GOES-18 ${time.format(scene.end)}`;
    status.title=`Regional cloud-top height estimate ${(mesh.min/1000).toFixed(1)}–${(mesh.max/1000).toFixed(1)} km (geopotential)`;
    return;
   }
  }catch{
   // Use the independently dated infrared image when the height retrieval is unavailable.
  }
  if(!current())return;
  if(rendered?.kind==='surface')clearImage();
  try{
   const times=await catalog('infrared',loadCloudTimes,signal);
   if(!current())return;
   const newTime=matchCloudObservation(times,observation,Date.now());
   if(newTime===null){clearImage();status.textContent='No GOES image near this scan';return;}
   if(rendered?.stamp===newTime)return;
   clearImage();status.textContent='Loading GOES clouds…';
   const image=await frame(`ir:${newTime}`,()=>loadCloudImage(newTime,{signal}));
   if(!current())return;
   session.cloud(image);rendered={kind:'infrared',stamp:newTime};status.textContent=`Clouds (2D IR) · ${time.format(newTime)}`;
  }catch{
   if(current()){clearImage();status.textContent='GOES clouds unavailable';}
  }
 }
 button.addEventListener('click',()=>{
  enabled=!enabled;sync();
  if(enabled)void observe(target);
  else{generation++;clearImage();}
 });
 return {button,status,observe,
  open(){lifecycle=new AbortController();button.hidden=false;sync();void observe(Date.now());},
  close(){lifecycle?.abort();lifecycle=null;button.hidden=true;frames.clear();catalogs.clear();clearImage();sync();}
 };
}
