import {loadForecastClouds,loadForecastCloudHour} from './forecast-cloud-data.js';
import {createWeatherFrameCache} from './weather-frame-cache.js';
import {createWatershedPlayback} from './watershed-playback.js';

const time=new Intl.DateTimeFormat('en-US',{
 timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'
});
const HOUR=3600000;
const FADE=700;

export function installForecastClouds({session,info,items,source,visible}){
 const controls=document.createElement('div');controls.className='watershed-player-controls';controls.hidden=true;
 const play=document.createElement('calcite-button');play.scale='s';
 const windButton=document.createElement('calcite-button');
 windButton.scale='s';windButton.textContent='Wind trails';windButton.kind='neutral';
 windButton.title='Show HRRR forecast wind direction at 10 meters above ground';
 const hours=document.createElement('input');hours.type='range';hours.min='0';hours.step='1';hours.value='0';
 hours.setAttribute('aria-label','Forecast cloud hour');
 controls.append(play,hours,windButton);
 const cache=createWeatherFrameCache(4);
 let active=false,catalog,displayed,volume,request,refreshTimer,loading=false,gpuFailed=false;
 let windWanted=true,windFailed=false;
 const player=createWatershedPlayback({
  dwell:1350,
  canAdvance:()=>active&&visible()&&!document.hidden&&displayed&&displayed.lead<catalog.frames.length,
  changed:sync,
  advance:()=>choose(displayed.lead,true)
 });

 function sync(){
  play.textContent=player.playing?'Pause':'Play';play.iconStart=player.playing?'pause':'play';
  play.disabled=!displayed||(!player.playing&&loading);hours.disabled=!catalog||gpuFailed;
  hours.max=String(Math.max(0,(catalog?.frames.length??1)-1));
  if(!loading)hours.value=String(displayed?displayed.lead-1:0);
  hours.setAttribute('aria-valuetext',displayed?time.format(displayed.valid):'No forecast hour shown');
  const windAvailable=!!volume?.wind&&!windFailed;
  windButton.disabled=!windAvailable;
  windButton.appearance=windAvailable&&windWanted?'solid':'outline';
  windButton.setAttribute('aria-pressed',String(windAvailable&&windWanted));
 }
 function label(frame){
  const wind=(!volume?.wind||windFailed)?' · Wind unavailable':'';
  return `HRRR forecast clouds · ${time.format(frame.valid)}${wind}`;
 }
 function drawWind(durationMs=0){
  if(windFailed)return;
  try{session.forecastWind(windWanted?volume?.wind:null,{durationMs});}
  catch{windFailed=true;}
  sync();
 }
 function clearWeather(){
  session.forecastClouds(null);
  session.forecastWind(null);
  catalog=displayed=volume=null;
 }
 function stopRequests(){
  request?.abort();request=null;loading=false;
  cache.cancelPending();player.pause();sync();
 }
 function renderFailure(){
  if(!active)return;
  gpuFailed=true;displayed=volume=null;stopRequests();
  session.forecastWind(null);
  info.textContent='Forecast clouds cannot render on this device';
 }
 function load(run,frame){
  return cache.get(frame.sha256,signal=>loadForecastCloudHour(run,frame,signal));
 }
 function warm(index){
  for(const frame of catalog.frames.slice(index+1,index+3))void load(catalog,frame).catch(()=>{});
 }
 async function choose(index,animate=false,nextCatalog=catalog){
  const frame=nextCatalog?.frames[index];
  if(!active||gpuFailed||!frame||document.hidden)return false;
  request?.abort();
  const current=request=new AbortController();
  loading=true;hours.value=String(index);sync();
  try{
   const next=await load(nextCatalog,frame);
   if(current.signal.aborted)return false;
   if(nextCatalog.run+12*HOUR<Date.now())throw Error('Forecast run expired');
   const previous=displayed;
   const fade=animate&&next!==volume&&previous&&catalog===nextCatalog&&frame.valid-previous.valid===HOUR&&
    !matchMedia('(prefers-reduced-motion: reduce)').matches?FADE:0;
   const onTransitionEnd=()=>{if(active&&displayed===frame)info.textContent=label(frame);};
   try{session.forecastClouds(next,renderFailure,{durationMs:fade,onTransitionEnd});}
   catch{session.forecastClouds(null);renderFailure();return false;}
   catalog=nextCatalog;displayed=frame;volume=next;
   drawWind(fade);
   info.textContent=fade?`Forecast clouds · ${time.formatRange(previous.valid,frame.valid)}`:label(frame);
   warm(index);
   items.replaceChildren(
    document.createTextNode(`HRRR run ${time.format(catalog.run)}. Cloud shading uses modeled water and ice. Wind trails show forecast direction at 10 meters above ground. Trail movement uses an illustrative speed. Trails and clouds share the forecast hour. Use rainfall forecasts for accumulation.`),
    document.createElement('br'),source('NOAA HRRR source fields','https://www.nco.ncep.noaa.gov/pmb/products/hrrr/hrrr.t00z.wrfprsf02.grib2.shtml')
   );
   return true;
  }catch{
   if(!current.signal.aborted){
    if(catalog?.run+12*HOUR<Date.now()){
     clearWeather();
    }
    info.textContent=displayed?`${label(displayed)} · Requested hour unavailable`:'HRRR forecast clouds unavailable';
   }
   return false;
  }finally{
   if(request===current){request=null;loading=false;sync();}
  }
 }
 const firstUpcoming=run=>Math.max(0,run.frames.findIndex(frame=>frame.valid>=Date.now()));
 function scheduleRefresh(){
  clearTimeout(refreshTimer);
  if(active&&!document.hidden&&!gpuFailed)refreshTimer=setTimeout(()=>void refresh(),5*60_000);
 }
 async function refresh(){
  clearTimeout(refreshTimer);
  if(!active||document.hidden||gpuFailed)return;
  if(!player.playing&&!request){
   const current=request=new AbortController();
   try{
    const next=await loadForecastClouds(current.signal);
    if(!current.signal.aborted&&catalog?.run!==next.run)await choose(firstUpcoming(next),false,next);
   }catch{
    if(!current.signal.aborted){
     if(catalog?.run+12*HOUR<Date.now()){
      clearWeather();
     }
     info.textContent=displayed?`${label(displayed)} · Update unavailable`:'HRRR forecast clouds unavailable';
    }
   }finally{if(request===current){request=null;sync();}}
  }
  scheduleRefresh();
 }
 function pause(){
  stopRequests();
  if(volume){session.forecastClouds(volume,renderFailure);drawWind();info.textContent=label(displayed);}
 }
 play.addEventListener('click',()=>{
  if(player.playing){pause();return;}
  if(!catalog||!displayed)return;
  if(displayed.lead===catalog.frames.length){
   const start=firstUpcoming(catalog);
   void choose(start===catalog.frames.length-1?0:start).then(ok=>{if(ok&&active)player.play();});
  }
  else player.play();
 });
 hours.addEventListener('change',()=>{
  const index=Number(hours.value);
  pause();void choose(index);
 });
 windButton.addEventListener('click',()=>{
  windWanted=!windWanted;drawWind();
 });
 document.addEventListener('visibilitychange',()=>{
  if(!active)return;
  if(document.hidden){pause();clearTimeout(refreshTimer);}
  else void refresh();
 });
 return {controls,
  suspend(){active=false;clearTimeout(refreshTimer);stopRequests();session.forecastWind(null);session.forecastClouds(null);},
  resume(){
   active=true;controls.hidden=false;
   if(volume&&catalog?.run+12*HOUR>=Date.now()){session.forecastClouds(volume,renderFailure);drawWind();info.textContent=label(displayed);sync();}
   else{clearWeather();info.textContent='Selected forecast run expired · waiting for the next update';sync();}
   scheduleRefresh();
  },
  open(){
   active=true;gpuFailed=windFailed=false;controls.hidden=false;sync();
   info.textContent='Loading HRRR forecast clouds…';items.replaceChildren();
   void refresh();
  },
  close(){
   if(!active)return;
   active=false;controls.hidden=true;clearTimeout(refreshTimer);stopRequests();cache.clear();
   clearWeather();
  }
 };
}
