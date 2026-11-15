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
 let reservoir,basin,abort,timer;

 function close(returnToConcern=false){
  abort?.abort();abort=null;clearTimeout(timer);basin=null;panel.hidden=true;legend.hidden=true;
  button.textContent='Upstream watershed';button.setAttribute('aria-pressed','false');
  session.rain(null);session.watershed(null);
  if(returnToConcern){repaint();const bounds=localBounds();if(bounds)session.focus(bounds);}
 }

 async function updateRain(current){
  const {signal}=current;
  try{
   const rain=await loadWatershedRain(basin.bounds,{signal});
   if(signal.aborted)return;
   session.rain(rain);
   const {issue,start,end}=rain.cycle;
   info.textContent=`${basin.feature.properties.name} watershed · dashed outline. WPC 72-hour precipitation, ${time.format(start)} to ${time.format(end)}. ${rain.legend.length?'':'No contours ≥0.01 in returned for this map extent.'}`;
   const date=document.createElement('p');date.textContent=`Issued ${time.format(issue)}. Contours show forecast liquid-equivalent inches across the map extent. River response depends on runoff, storage and operations.`;
   const row=document.createElement('div');row.className='briefing-layer-symbols';
   for(const {value,color} of rain.legend){const label=document.createElement('span'),swatch=document.createElement('i');swatch.className='legend-swatch';swatch.style.backgroundColor=color;label.append(swatch,`${value} in`);row.append(label);}
   items.replaceChildren(date,row,source('WPC precipitation forecast','https://www.wpc.ncep.noaa.gov/#page=qpf'),document.createTextNode(' · '),source('USGS watershed boundary',basin.feature.properties.source));legend.hidden=false;
  }catch(error){
   if(signal.aborted)return;
   session.rain(null);legend.hidden=true;
   info.textContent=`${basin.feature.properties.name} watershed · dashed outline. WPC forecast unavailable. Check the Weather workspace for forecast status.`;
  }finally{
   if(!signal.aborted)timer=setTimeout(()=>void updateRain(current),10*60_000);
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
   if(!exercise)void updateRain(current);
  }catch(error){
   if(current.signal.aborted)return;
   close();panel.hidden=false;info.textContent='Upstream watershed boundary unavailable.';
  }
 }
 button.onclick=()=>abort?close(true):void open();

 return {open,get feature(){return basin?.feature;},show(key){reservoir=upstreamReservoir(key);button.hidden=!reservoir;},hide(){close();button.hidden=true;}};
}

function source(label,href){const link=document.createElement('a');link.textContent=label;link.href=href;link.target='_blank';link.rel='noopener noreferrer';return link;}
