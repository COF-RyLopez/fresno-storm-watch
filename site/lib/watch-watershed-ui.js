import {loadWatershed,loadWatershedRain,upstreamReservoir} from './watch-watershed-data.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});

/** One optional basin view for the selected river concern. Requests end when it closes. */
export function installWatchWatershed({session,repaint,localBounds,exercise=false}){
 const button=document.createElement('button');
 button.id='watch-terrain-upstream';button.type='button';button.hidden=true;button.textContent='Upstream watershed';
 button.setAttribute('aria-pressed','false');
 document.querySelector('#watch-map-heading').append(button);
 const panel=document.createElement('div');panel.className='environment-note';panel.hidden=true;
 const info=document.createElement('p');info.setAttribute('role','status');
 const legend=document.createElement('details'),legendTitle=document.createElement('summary'),items=document.createElement('div');
 legendTitle.textContent='Forecast colors and sources';legend.append(legendTitle,items);legend.hidden=true;
 panel.append(info,legend);document.querySelector('.legend-stack').prepend(panel);
 let reservoir,basin,abort,timer,rainRequest,selectedWindow=null;

 function close(returnToConcern=false){
  abort?.abort();abort=null;rainRequest?.abort();rainRequest=null;clearTimeout(timer);
  basin=null;if(!returnToConcern)selectedWindow=null;panel.hidden=true;legend.hidden=true;
  button.textContent='Upstream watershed';button.setAttribute('aria-pressed','false');
  session.rain(null);session.watershed(null);
  if(returnToConcern){repaint();const bounds=localBounds();if(bounds)session.focus(bounds);}
 }

 async function updateRain(replace=false){
  clearTimeout(timer);rainRequest?.abort();
  const request=rainRequest=new AbortController(),{signal}=request;
  const window=selectedWindow;
  const label=window?'6-hour':'72-hour';
  const name=basin.feature.properties.name;
  const windowLabel=window?time.formatRange(window.start,window.end):'';
  if(replace){
   session.rain(null);legend.hidden=true;
   info.textContent=`${name} watershed · Loading WPC ${label} precipitation${windowLabel?` · ${windowLabel}`:''}…`;
  }
  try{
   const rain=await loadWatershedRain(basin.bounds,{signal,window});
   if(rain.blob&&!signal.aborted){
    const decoded=await createImageBitmap(rain.blob);
    decoded.close();
   }
   if(signal.aborted)return;
   session.rain(rain);
   const {issue,start,end}=rain.cycle;
   const amount=window?.max?.[reservoir];
   const basinNote=Number.isFinite(amount)?`Highest mapped in basin ${amount.toFixed(2)} in.`:window?'No ≥0.01 in contour in this basin.':rain.legend.length?'':'No ≥0.01 in contour in the map extent.';
   info.textContent=`${name} watershed · WPC ${label} precipitation · ${time.formatRange(start,end)}. ${basinNote}`;
   const date=document.createElement('p');date.textContent=`Issued ${time.format(issue)}. Contours show forecast liquid-equivalent inches across the map extent. The dashed line marks the watershed.`;
   const row=document.createElement('div');row.className='briefing-layer-symbols';
   for(const {value,color} of rain.legend){const label=document.createElement('span'),swatch=document.createElement('i');swatch.className='legend-swatch';swatch.style.backgroundColor=color;label.append(swatch,`${value} in`);row.append(label);}
   items.replaceChildren(date,row,source('WPC precipitation forecast','https://www.wpc.ncep.noaa.gov/#page=qpf'),document.createTextNode(' · '),source('USGS watershed boundary',basin.feature.properties.source));legend.hidden=false;
  }catch(error){
   if(signal.aborted)return;
   session.rain(null);legend.hidden=true;
   info.textContent=window?`${name} watershed · WPC 6-hour map unavailable for ${windowLabel}. The source may be updating. Choose another window or the 72-hour overview.`:`${name} watershed · WPC 72-hour forecast unavailable. Check the Weather workspace for source status.`;
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
   info.textContent=`${basin.feature.properties.name} watershed · dashed outline. ${exercise?'Live WPC precipitation is disabled in exercise mode.':'Checking WPC forecast…'}`;
   items.replaceChildren(source('USGS watershed boundary',basin.feature.properties.source));
   legendTitle.textContent=exercise?'Watershed source':'Forecast colors and sources';
   legend.hidden=!exercise;
   if(!exercise)void updateRain(true);
  }catch(error){
   if(current.signal.aborted)return;
   close();panel.hidden=false;info.textContent='Upstream watershed boundary unavailable.';
  }
 }
 button.onclick=()=>abort?close(true):void open();

 function selectWindow(id,window,{openIfClosed=true}={}){
  if(exercise||reservoir!==id||!session.active||(!abort&&!openIfClosed))return false;
  if(basin&&selectedWindow===window)return true;
  selectedWindow=window;
  if(basin)void updateRain(true);
  else if(!abort)void open();
  return true;
 }

 return {open,selectWindow,get feature(){return basin?.feature;},show(key){reservoir=upstreamReservoir(key);button.hidden=!reservoir;},hide(){close();button.hidden=true;}};
}

function source(label,href){const link=document.createElement('a');link.textContent=label;link.href=href;link.target='_blank';link.rel='noopener noreferrer';return link;}
