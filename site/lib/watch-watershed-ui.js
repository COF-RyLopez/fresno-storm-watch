import {loadWatershed,loadWatershedRain,upstreamReservoir} from './watch-watershed-data.js';
import {createWatershedPlayback} from './watershed-playback.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const key=window=>window?`${window.layer}:${window.issue}:${window.start}:${window.end}`:'';

/** One optional basin view for the selected river concern. Requests end when it closes. */
export function installWatchWatershed({session,repaint,localBounds,exercise=false}){
 const button=document.createElement('button');
 button.id='watch-terrain-upstream';button.type='button';button.hidden=true;button.textContent='Upstream watershed';
 button.setAttribute('aria-pressed','false');
 document.querySelector('#watch-map-heading').append(button);
 const panel=document.createElement('section');panel.className='watershed-player';panel.hidden=true;
 panel.setAttribute('aria-label','Watershed forecast playback');
 const controls=document.createElement('div');controls.className='watershed-player-controls';
 const play=document.createElement('calcite-button');play.scale='s';play.iconStart='play';play.textContent='Play';play.disabled=true;
 const picker=document.createElement('select');picker.setAttribute('aria-label','Precipitation forecast window');
 picker.append(new Option('72-hour overview',''));picker.disabled=true;
 const radar=source('Live 3D radar ↗','https://frog-demo.ryanlopez.tech/?view=storm');
 radar.title='Observed Hanford radar reflectivity at different heights. Opens in a new tab.';
 controls.append(play,picker);
 const info=document.createElement('p');info.setAttribute('role','status');info.setAttribute('aria-atomic','true');
 const colors=document.createElement('div');colors.className='watershed-player-colors';colors.hidden=true;
 const legend=document.createElement('details'),legendTitle=document.createElement('summary'),items=document.createElement('div');
 legendTitle.textContent='Sources';legend.append(legendTitle,items);legend.hidden=true;
 const links=document.createElement('div');links.className='watershed-player-links';links.append(radar,legend);
 panel.append(controls,info,colors,links);document.querySelector('#map-wrap').append(panel);
 let reservoir,basin,abort,timer,rainRequest,selectedWindow=null,displayedUntil=0;
 let windows=[],onFrame,autoplay=false,sequence='';
 const currentWindows=()=>windows.filter(row=>row.end>Date.now());
 const player=createWatershedPlayback({canAdvance:()=>!!basin&&!document.hidden&&panel.getClientRects().length>0,
  changed(playing){play.iconStart=playing?'pause':'play';play.textContent=playing?'Pause':'Play';},
  async advance(){
   const next=currentWindows().find(row=>!selectedWindow||row.start>selectedWindow.start);
   if(!next)return false;
   await showFrame(next);
   return true;
  }});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)player.pause();});

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
  abort?.abort();abort=null;rainRequest?.abort();rainRequest=null;clearTimeout(timer);
  player.pause();autoplay=false;displayedUntil=0;
  basin=null;if(!returnToConcern){selectedWindow=null;setWindows([]);onFrame=null;}
  panel.hidden=true;legend.hidden=true;colors.hidden=true;play.disabled=picker.disabled=true;
  button.textContent='Upstream watershed';button.setAttribute('aria-pressed','false');
  session.rain(null);session.watershed(null);
  if(returnToConcern){repaint();const bounds=localBounds();if(bounds)session.focus(bounds);}
 }

 async function updateRain(replace=false,notify=false){
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
   const rain=await loadWatershedRain(basin.bounds,{signal,window});
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
   const date=document.createElement('p');date.textContent=`WPC issued ${time.format(issue)}. Colors show expected liquid-equivalent accumulation. The dashed line marks the ${name} watershed. Radar shows observed echoes above ground in dBZ.`;
   const row=document.createElement('div');row.className='briefing-layer-symbols';
   for(const {value,color} of rain.legend){const label=document.createElement('span'),swatch=document.createElement('i');swatch.className='legend-swatch';swatch.style.backgroundColor=color;label.append(swatch,`${value}`);row.append(label);}
   const units=document.createElement('strong');units.textContent='Forecast inches';
   colors.replaceChildren(units,row);colors.hidden=!rain.legend.length;
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
  if(navigate)player.pause();
  if(key(selectedWindow)!==key(window)){
   player.pause();selectedWindow=window;picker.value=key(window);
   if(basin&&!play)void updateRain(true);
  }
  if(play){if(basin)start();else autoplay=true;}
  if(!abort&&openIfClosed)void open();
  return true;
 }

 controls.hidden=exercise;radar.hidden=exercise;
 return {open,selectWindow,get feature(){return basin?.feature;},show(key){reservoir=upstreamReservoir(key);button.hidden=!reservoir;},hide(){close();button.hidden=true;}};
}

function source(label,href){const link=document.createElement('a');link.textContent=label;link.href=href;link.target='_blank';link.rel='noopener noreferrer';return link;}
