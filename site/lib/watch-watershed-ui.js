import {loadWatershed,loadWatershedRain,regionalForecastBounds,upstreamReservoir} from './watch-watershed-data.js';
import {createWatershedPlayback} from './watershed-playback.js';
import {installWatchRadar} from './watch-radar-ui.js';
import {installForecastClouds} from './watch-forecast-cloud-ui.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const key=window=>window?`${window.layer}:${window.issue}:${window.start}:${window.end}`:'';
const californiaBounds=[-124.65,32.35,-113.8,42.2];

/** One optional basin view for the selected river concern. Requests end when it closes. */
export function installWatchWatershed({session,repaint,localBounds,getOverhead,setOverhead,exercise=false}){
 const button=document.createElement('button');
 button.id='watch-terrain-upstream';button.type='button';button.hidden=true;button.textContent='Upstream watershed';
 button.setAttribute('aria-pressed','false');
 document.querySelector('#watch-map-heading').append(button);
 const panel=document.createElement('section');panel.className='watershed-player';panel.hidden=true;
 panel.setAttribute('aria-label','Watershed weather');
 const modes=document.createElement('div');modes.className='watershed-weather-modes';modes.hidden=true;
 modes.setAttribute('role','group');modes.setAttribute('aria-label','Weather layer');
 const forecast=document.createElement('calcite-button'),radar=document.createElement('calcite-button');
 const forecastClouds=document.createElement('calcite-button');
 for(const [button,label] of [[forecast,'Rain forecast'],[radar,'Hanford radar'],[forecastClouds,'Forecast clouds']]){
  button.scale='s';button.textContent=label;modes.append(button);
 }
 const regional=document.createElement('calcite-button');regional.scale='s';regional.appearance='outline';regional.kind='neutral';
 regional.hidden=true;modes.append(regional);
 const controls=document.createElement('div');controls.className='watershed-player-controls';
 const play=document.createElement('calcite-button');play.scale='s';play.iconStart='play';play.textContent='Play';play.disabled=true;
 const picker=document.createElement('select');picker.setAttribute('aria-label','Precipitation forecast window');
 picker.append(new Option('72-hour overview',''));picker.disabled=true;
 controls.append(play,picker);
 const info=document.createElement('p');info.setAttribute('role','status');info.setAttribute('aria-atomic','true');
 const colors=document.createElement('div');colors.className='watershed-player-colors';colors.hidden=true;
 const legend=document.createElement('details'),legendTitle=document.createElement('summary'),items=document.createElement('div');
 legendTitle.textContent='Sources';legend.append(legendTitle,items);legend.hidden=true;
 const links=document.createElement('div');links.className='watershed-player-links';links.append(legend);
 const radarView=installWatchRadar({session,info,items,renderColors,visible:()=>panel.getClientRects().length>0,source});
 const cloudForecastView=installForecastClouds({session,info,items,source,visible:()=>panel.getClientRects().length>0});
 modes.append(radarView.cloudButton,radarView.volumeButton);
 cloudForecastView.controls.classList.add('watershed-radar-controls');
 panel.append(modes,controls,radarView.controls,cloudForecastView.controls,info,radarView.cloudStatus,radarView.cloudLegend,colors,links);document.querySelector('#map-wrap').append(panel);
 let reservoir,basin,abort,timer,rainRequest,selectedWindow=null,displayedUntil=0;
 let windows=[],onFrame,autoplay=false,sequence='';
 let mode='forecast',regionalView=false,basinOverhead=false;
 const currentWindows=()=>windows.filter(row=>row.end>Date.now());
 const player=createWatershedPlayback({canAdvance:()=>mode==='forecast'&&!!basin&&!document.hidden&&panel.getClientRects().length>0,
  changed(playing){play.iconStart=playing?'pause':'play';play.textContent=playing?'Pause':'Play';},
  async advance(){
   const next=currentWindows().find(row=>!selectedWindow||row.start>selectedWindow.start);
   if(!next)return false;
   await showFrame(next);
   return true;
  }});
 document.addEventListener('visibilitychange',()=>{
  if(document.hidden)player.pause();
 });

 function renderColors(title,bands){
  const units=document.createElement('strong');units.textContent=title;
  const row=document.createElement('div');row.className='briefing-layer-symbols';
  for(const {value,color} of bands){
   const label=document.createElement('span'),swatch=document.createElement('i');
   swatch.className='legend-swatch';swatch.style.backgroundColor=color;label.append(swatch,String(value));row.append(label);
  }
  colors.replaceChildren(units,row);colors.hidden=!bands.length;
 }
 function cancelForecast(){
  clearTimeout(timer);rainRequest?.abort();rainRequest=null;
  player.pause();autoplay=false;displayedUntil=0;session.rain(null);
 }
 function syncMode(){
  for(const [button,active] of [[forecast,mode==='forecast'],[radar,mode==='radar'],[forecastClouds,mode==='cloud-forecast']]){
   button.appearance=active?'solid':'outline';
   button.kind=active?'brand':'neutral';
   button.setAttribute('aria-pressed',String(active));
  }
  controls.hidden=exercise||mode!=='forecast';
  regional.hidden=exercise||mode!=='forecast'||!basin;
  regional.textContent=regionalView?'Watershed':'California';
  regional.setAttribute('aria-label',regionalView?'Fit selected watershed':'Fit California forecast');
 }
 function setMode(next,load=true){
  if(next===mode||exercise||!basin)return;
  if(mode==='forecast')cancelForecast();
  if(mode==='radar')radarView.close();
  if(mode==='cloud-forecast')cloudForecastView.close();
  mode=next;syncMode();colors.hidden=true;legend.open=false;legend.hidden=true;
  if(next==='radar'){
   legend.hidden=false;
   radarView.open();
  }else if(next==='cloud-forecast'){
   if(regionalView){
    regionalView=false;setOverhead(basinOverhead);session.focus(basin.bounds);
   }
   legend.hidden=false;
   cloudForecastView.open();
  }else{
   if(selectedWindow&&!currentWindows().some(row=>key(row)===key(selectedWindow)))selectedWindow=null;
   picker.value=key(selectedWindow);
   if(load)void updateRain(true,true);
  }
 }
 forecast.addEventListener('click',()=>setMode('forecast'));
 radar.addEventListener('click',()=>setMode('radar'));
 forecastClouds.addEventListener('click',()=>setMode('cloud-forecast'));
 regional.addEventListener('click',()=>{
  if(!basin||mode!=='forecast')return;
  if(!regionalView)basinOverhead=getOverhead();
  regionalView=!regionalView;
  syncMode();
  setOverhead(regionalView||basinOverhead);
  session.focus(regionalView?californiaBounds:basin.bounds,regionalView?{top:136,bottom:225,left:32,right:32}:undefined);
 });
 syncMode();

 function setWindows(next){
  const signature=next.map(key).join(',');
  windows=next;
  play.disabled=picker.disabled=!basin||!next.length;
  if(sequence===signature)return;
  sequence=signature;
  const value=picker.value;
  picker.replaceChildren(new Option('72-hour overview',''),...next.map(row=>new Option(time.formatRange(row.start,row.end),key(row))));
  picker.value=next.some(row=>key(row)===value)?value:'';
  if(!next.length)player.pause();
 }
 function start(){
  const available=currentWindows();
  if(!available.length)return;
  if(!selectedWindow||available.at(-1).start<=selectedWindow.start)selectedWindow=null;
  player.play();
 }
 function showFrame(window){
  selectedWindow=window;
  return updateRain(true,true);
 }
 play.addEventListener('click',()=>{if(player.playing)player.pause();else start();});
 picker.addEventListener('change',()=>{
  const window=currentWindows().find(row=>key(row)===picker.value);
  if(!window&&picker.value){picker.value=key(selectedWindow);return;}
  player.pause();
  void showFrame(window??null);
 });

 function close(returnToConcern=false){
  if(returnToConcern&&regionalView)setOverhead(basinOverhead);
  abort?.abort();abort=null;cancelForecast();radarView.close();cloudForecastView.close();mode='forecast';regionalView=false;
  basin=null;if(!returnToConcern){selectedWindow=null;setWindows([]);onFrame=null;}
  syncMode();
  panel.hidden=true;modes.hidden=true;legend.hidden=true;colors.hidden=true;play.disabled=picker.disabled=true;
  button.textContent='Upstream watershed';button.setAttribute('aria-pressed','false');
  session.watershed(null);
  if(returnToConcern){repaint();const bounds=localBounds();if(bounds)session.focus(bounds);}
 }

 async function updateRain(replace=false,notify=false){
  if(mode!=='forecast'||!basin)return false;
  clearTimeout(timer);rainRequest?.abort();
  const request=rainRequest=new AbortController(),{signal}=request;
  const window=selectedWindow;
  const label=window?'6-hour':'72-hour';
  const name=basin.feature.properties.name;
  const windowLabel=window?time.formatRange(window.start,window.end):'';
  const sync=()=>{if(notify){picker.value=key(window);onFrame?.(window);}};
  if(replace){
   if(!player.playing||displayedUntil-Date.now()<=25_000){
    session.rain(null);colors.hidden=true;
    info.textContent=`Loading ${label} forecast${windowLabel?` · ${windowLabel}`:''}…`;
   }
  }
  try{
   const rain=await loadWatershedRain(regionalForecastBounds,{signal,window});
   if(rain.blob&&!signal.aborted){
    const decoded=await createImageBitmap(rain.blob);
    decoded.close();
   }
   if(signal.aborted)return false;
   session.rain(rain);
   const {issue,start,end}=rain.cycle;
   displayedUntil=end;
   const amount=window?.max?.[reservoir];
   const basinNote=Number.isFinite(amount)?` · Watershed peak ${amount.toFixed(2)} in`:window?' · No watershed contours ≥0.01 in':rain.legend.length?'':' · No contours ≥0.01 in shown';
   info.textContent=`${label} forecast · ${time.formatRange(start,end)}${basinNote}`;
   const date=document.createElement('p');date.textContent=`WPC issued ${time.format(issue)}. Colors show expected liquid-equivalent accumulation across California and nearby areas. The dashed line marks the ${name} watershed.`;
   renderColors('Forecast inches',rain.legend);
   items.replaceChildren(date,source('WPC precipitation forecast','https://www.wpc.ncep.noaa.gov/qpf/about_qpf6body.html'),document.createTextNode(' · '),source('USGS watershed boundary',basin.feature.properties.source));legend.hidden=false;
   sync();
   return true;
  }catch(error){
   if(signal.aborted)return false;
   session.rain(null);displayedUntil=0;colors.hidden=true;
   info.textContent=`${label} forecast unavailable${windowLabel?` · ${windowLabel}`:''}`;
   sync();
   return false;
  }finally{
   const remaining=window?window.end-Date.now():Infinity;
   if(!signal.aborted&&remaining>0)timer=setTimeout(()=>void updateRain(remaining<=10*60_000),Math.min(10*60_000,remaining));
  }
 }

 async function open(){
  if(abort||!reservoir||!session.active)return;
  const current=abort=new AbortController();
  button.textContent='Back to concern';button.setAttribute('aria-pressed','true');
  panel.hidden=false;info.textContent='Loading upstream watershed…';
  try{
   const result=await loadWatershed(reservoir,{signal:current.signal});
   if(current.signal.aborted)return;
   basin=result;session.watershed(basin.feature);repaint();session.focus(basin.bounds);
   info.textContent=exercise?'Live forecast disabled in exercise mode.':'Checking forecast…';
   items.replaceChildren(source('USGS watershed boundary',basin.feature.properties.source));
   legend.hidden=!exercise;
   if(!exercise){
    modes.hidden=false;
    syncMode();
    setWindows(windows);
    picker.value=key(selectedWindow);
    if(autoplay&&currentWindows().length)start();
    else void updateRain(true);
    autoplay=false;
   }
  }catch(error){
   if(current.signal.aborted)return;
   close();panel.hidden=false;info.textContent='Upstream watershed boundary unavailable.';
  }
 }
 button.onclick=()=>abort?close(true):void open();

 function selectWindow(id,window,{openIfClosed=true,windows:next,onFrame:notify,play=false,navigate=false}={}){
  if(exercise||reservoir!==id||!session.active)return false;
  if(next)setWindows(next);
  if(notify)onFrame=notify;
  const wasOtherMode=mode!=='forecast';
  if(navigate){player.pause();if(basin)setMode('forecast',false);}
  if(key(selectedWindow)!==key(window)){
   player.pause();selectedWindow=window;picker.value=key(window);
   if(basin&&!play)void updateRain(true);
  }
  else if(navigate&&wasOtherMode&&basin&&!play)void updateRain(true);
  if(play){if(basin)start();else autoplay=true;}
  if(!abort&&openIfClosed)void open();
  return true;
 }

 return {open,selectWindow,get feature(){return basin?.feature;},show(key){reservoir=upstreamReservoir(key);button.hidden=!reservoir;},hide(){close();button.hidden=true;}};
}

function source(label,href){const link=document.createElement('a');link.textContent=label;link.href=href;link.target='_blank';link.rel='noopener noreferrer';return link;}
