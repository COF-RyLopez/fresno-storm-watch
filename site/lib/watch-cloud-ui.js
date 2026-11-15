import {CLOUD_PAIR_GAP,loadCloudTimes,loadCloudImage,matchCloudObservation} from './watch-cloud-data.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

/** The satellite overlay follows the radar observation, with its own time and failure state. */
export function installWatchClouds(session){
 const button=document.createElement('calcite-button');
 button.scale='s';button.textContent='Clouds';button.hidden=true;
 const status=document.createElement('p');
 status.className='watch-cloud-time';status.hidden=true;
 let enabled=true,lifecycle,target,rendered=null,generation=0,checked=0,times=[],pending;
 const images=new Map();
 function sync(){
  button.appearance=enabled?'solid':'outline';button.kind='neutral';
  button.setAttribute('aria-pressed',String(enabled));
  status.hidden=!lifecycle||!enabled;
 }
 function clearImage(){if(rendered!==null)session.cloud(null);rendered=null;}
 function catalog(signal){
  if(times.length&&Date.now()-checked<5*60_000)return times;
  if(pending)return pending;
  const task=loadCloudTimes({signal}).then(result=>{if(!signal.aborted){times=result;checked=Date.now();}return result;})
   .finally(()=>{if(pending===task)pending=null;});
  pending=task;
  return task;
 }
 function image(stamp,signal){
  if(images.has(stamp))return images.get(stamp);
  const task=loadCloudImage(stamp,{signal}).catch(error=>{if(images.get(stamp)===task)images.delete(stamp);throw error;});
  images.set(stamp,task);
  if(images.size>8)images.delete(images.keys().next().value);
  return task;
 }
 async function observe(when){
  target=Math.min(when,Date.now());
  if(!lifecycle||!enabled)return;
  const signal=lifecycle.signal,run=++generation,observation=target;
  const current=()=>!signal.aborted&&generation===run;
  if(rendered!==null&&(rendered>observation||observation-rendered>CLOUD_PAIR_GAP))clearImage();
  if(rendered===null)status.textContent='Checking GOES clouds…';
  try{
   const frames=await catalog(signal);
   if(!current())return;
   const newTime=matchCloudObservation(frames,observation,Date.now());
   if(newTime===null){clearImage();status.textContent='No GOES image near this scan';return;}
   if(newTime===rendered)return;
   clearImage();status.textContent='Loading GOES clouds…';
   const frame=await image(newTime,signal);
   if(!current())return;
   session.cloud(frame);rendered=newTime;status.textContent=`Clouds · GOES IR ${time.format(newTime)}`;
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
  close(){lifecycle?.abort();lifecycle=null;button.hidden=true;pending=null;images.clear();times=[];checked=0;clearImage();sync();}
 };
}
