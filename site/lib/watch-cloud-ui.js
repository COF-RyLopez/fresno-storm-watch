import {CLOUD_PAIR_GAP,loadCloudTimes,loadCloudImage,matchCloudObservation} from './watch-cloud-data.js';
import {CLOUD_TOP_MAX_GAP,cloudTopFrameAt,loadCloudTopCatalog,loadCloudTopFrame} from './cloud-top-height-data.js';
import {createWeatherFrameCache} from './weather-frame-cache.js';
import {CLOUD_TOP_HEIGHT_BANDS} from './cloud-top-style.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

/** The satellite overlay follows the radar observation, with its own time and failure state. */
export function installWatchClouds(session){
 const button=document.createElement('calcite-button');
 button.scale='s';button.textContent='Clouds';button.hidden=true;
 const status=document.createElement('p');
 status.className='watch-cloud-time';status.hidden=true;
 const legend=document.createElement('div');legend.className='watch-cloud-key';legend.hidden=true;
 legend.setAttribute('aria-label','Cloud-top altitude key');
 const title=document.createElement('strong');title.textContent='Cloud tops · km';legend.append(title);
 for(const band of CLOUD_TOP_HEIGHT_BANDS){
  const label=document.createElement('span'),swatch=document.createElement('i');
  swatch.className='legend-swatch';swatch.style.backgroundColor=band.color;
  label.append(swatch,band.label);legend.append(label);
 }
 legend.title='GOES geopotential altitude, not height above local terrain or storm severity. Hover or tap a cloud for its estimate.';
 let enabled=true,lifecycle,target,rendered=null,generation=0,surfaceFailed=false;
 const catalogs=new Map(),frames=createWeatherFrameCache(4);
 function sync(){
  button.appearance=enabled?'solid':'outline';button.kind='neutral';
  button.setAttribute('aria-pressed',String(enabled));
  status.hidden=!lifecycle||!enabled;
  legend.hidden=!lifecycle||!enabled||rendered?.kind!=='surface';
 }
 function clearImage(){
  if(rendered?.kind==='surface')session.cloudTops(null);
  if(rendered?.kind==='infrared')session.cloud(null);
  rendered=null;
  legend.hidden=true;
  status.removeAttribute('title');
 }
 function catalog(kind,load,signal){
  const previous=catalogs.get(kind);
  if(previous&&Date.now()-previous.checked<5*60_000)return previous.task;
  const entry={checked:Date.now(),settled:false};
  entry.task=load({signal}).then(value=>{entry.settled=true;return value;}).catch(error=>{if(catalogs.get(kind)===entry)catalogs.delete(kind);throw error;});
  catalogs.set(kind,entry);
  return entry.task;
 }
 async function infrared(observation,signal){
  if(signal.aborted)return null;
  try{
   const times=await catalog('infrared',loadCloudTimes,signal);
   signal.throwIfAborted();
   const newTime=matchCloudObservation(times,observation,Date.now());
   if(newTime===null)return {kind:'missing'};
   const image=await frames.get(`ir:${newTime}`,abort=>loadCloudImage(newTime,{signal:AbortSignal.any([signal,abort])}));
   return {kind:'infrared',stamp:newTime,key:`ir:${newTime}`,image};
  }catch{return {kind:'unavailable'};}
 }
 async function prepare(when){
  if(!lifecycle||!enabled||!Number.isFinite(when))return null;
  const signal=lifecycle.signal,observation=Math.min(when,Date.now());
  if(surfaceFailed)return infrared(observation,signal);
  try{
   const catalogFrames=await catalog('surface',loadCloudTopCatalog,signal);
   signal.throwIfAborted();
   const scene=cloudTopFrameAt(catalogFrames,observation);
   if(scene?.count){
    const mesh=await frames.get(scene.sha256,abort=>loadCloudTopFrame(scene,{signal:AbortSignal.any([signal,abort])}));
    return {kind:'surface',scene,mesh,stamp:scene.end,key:scene.sha256};
   }
  }catch{
   // Use the independently dated infrared image when the height retrieval is unavailable.
  }
  return infrared(observation,signal);
 }
 async function observe(when,{durationMs=0}={}){
  target=Math.min(when,Date.now());
  if(!lifecycle||!enabled)return;
  const signal=lifecycle.signal,run=++generation,observation=target;
  const current=()=>!signal.aborted&&generation===run&&enabled;
  if(rendered&&(rendered.stamp>observation||observation-rendered.stamp>(rendered.kind==='surface'?CLOUD_TOP_MAX_GAP:CLOUD_PAIR_GAP)))clearImage();
  if(!rendered)status.textContent='Checking GOES clouds…';
  let next=await prepare(observation);
  if(!current()||!next)return;
  if(next.kind===rendered?.kind&&next.stamp===rendered.stamp&&next.key===rendered.key)return;
  if(next.kind==='surface'){
   try{
   const old=rendered;
   if(old?.kind==='infrared')clearImage();
   const fade=old?.kind==='surface'&&next.stamp>old.stamp&&next.stamp-old.stamp<=CLOUD_TOP_MAX_GAP?durationMs:0;
   const finished=session.cloudTops(next.mesh.vertices,{durationMs:fade,observedAt:next.stamp,source:next.scene.source,onFailure:failSurface});
   rendered=next;sync();
   const label=`GOES-18 · ${time.format(next.stamp)} · hover/tap tops`;
   status.textContent=fade?`GOES transition · ${time.formatRange(old.stamp,next.stamp)}`:label;
   status.title=`Cloud-top geopotential altitude ${(next.mesh.min/1000).toFixed(1)}–${(next.mesh.max/1000).toFixed(1)} km. Not cloud thickness or storm severity.`;
   await finished;
   if(!signal.aborted&&enabled&&rendered===next)status.textContent=label;
   return;
   }catch{
    if(!current())return;
    surfaceFailed=true;
    try{session.cloudTops(null);}catch{/* A failed graphics context may already be gone. */}
    rendered=null;sync();
    next=await infrared(observation,signal);
    if(!current()||!next)return;
   }
  }
  try{if(next.kind==='infrared'){
   if(rendered?.kind==='surface')clearImage();
   session.cloud(next.image);rendered=next;sync();status.textContent=`Clouds (2D IR) · ${time.format(next.stamp)} · height unavailable`;
  }else{clearImage();status.textContent=next.kind==='missing'?'No GOES image near this scan':'GOES clouds unavailable';}
  }catch{rendered=null;sync();status.textContent='GOES clouds unavailable';}
 }
 function failSurface(){
  if(!lifecycle||!enabled||rendered?.kind!=='surface')return;
  surfaceFailed=true;clearImage();void observe(target);
 }
 function cancelPending(){
  generation++;lifecycle?.abort();if(lifecycle)lifecycle=new AbortController();frames.cancelPending();
  for(const [key,entry] of catalogs)if(!entry.settled)catalogs.delete(key);
  if(rendered?.kind==='surface'){
   // Settle any in-progress blend at the selected observation when paused/hidden.
   try{session.cloudTops(rendered.mesh.vertices,{observedAt:rendered.stamp,source:rendered.scene.source,onFailure:failSurface});}catch{}
   status.textContent=`GOES-18 · ${time.format(rendered.stamp)} · hover/tap tops`;
  }
 }
 button.addEventListener('click',()=>{
  enabled=!enabled;sync();
  if(enabled)void observe(target);
  else{cancelPending();clearImage();}
 });
 return {button,status,legend,observe,prepare,cancelPending,
  open(){lifecycle=new AbortController();surfaceFailed=false;button.hidden=false;sync();void observe(Date.now());},
  close(){lifecycle?.abort();lifecycle=null;button.hidden=true;frames.clear();catalogs.clear();clearImage();sync();}
 };
}
