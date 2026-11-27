import {loadMosaicCatalog,loadMosaicImage,MOSAIC_URL} from './regional-radar-data.js';
import {regionalForecastBounds} from './watch-watershed-data.js';
import {createForecastPlayback} from './command-weather-player.js';
import {installWatchClouds} from './watch-cloud-ui.js';
const stamp=t=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(t);
/** Dated NWS mosaic images; one bounded three-frame cache, no volumetric reconstruction. */
export function installRegionalRadar({session,info,items,renderColors,visible,source,
 loadCatalog=loadMosaicCatalog,loadImage=loadMosaicImage,cloudFactory=installWatchClouds,stepControls=false}){
 const controls=document.createElement('div');controls.className='watershed-player-controls';
 const play=document.createElement('button'),latest=document.createElement('button'),slider=document.createElement('input');
 play.textContent='Play';play.setAttribute('aria-label','Play recent radar observations');latest.textContent='Latest';
 const step=(label,icon,offset)=>{const b=document.createElement('button');b.setAttribute('aria-label',label);b.disabled=true;
  const glyph=document.createElement('calcite-icon');glyph.setAttribute('icon',icon);glyph.setAttribute('scale','s');b.append(glyph);
  b.onclick=()=>{if(!player||!frames.length)return;stopFollow();void player.select(Math.max(0,Math.min(frames.length-1,index+offset)));};return b;};
 const previous=step('Previous radar scan','chevron-left',-1),next=step('Next radar scan','chevron-right',1);
 slider.type='range';slider.min='0';slider.step='1';slider.setAttribute('aria-label','NWS radar observation');
 controls.append(...(stepControls?[play,previous,slider,next,latest]:[play,slider,latest]));
 play.disabled=true;slider.disabled=true;
 const clouds=cloudFactory(session,{allowSurface:false});
 let active=false,suspended=false,following=true,request,timer,expiry,player,frames=[],displayed=null,index=-1,epoch=0;
 let coverage=[...regionalForecastBounds],gaps=false,cloudOpen=false;
 const fresh=()=>displayed&&Date.now()-displayed.time<=120*60000;
 function clear(){session.regionalRadar(null);displayed=null;clearTimeout(expiry);clouds.close();cloudOpen=false;}
 function pairClouds(time){if(!cloudOpen){clouds.open();cloudOpen=true;}void clouds.observe(time);}
 function stopFollow(){following=false;request?.abort();request=null;clearTimeout(timer);}
 function extendCoverage(){
  const b=session.viewBounds?.();if(!Array.isArray(b)||b.length!==4||b.some(v=>!Number.isFinite(v))||b[0]>=b[2]||b[1]>=b[3])return false;
  if(b[0]>=coverage[0]&&b[1]>=coverage[1]&&b[2]<=coverage[2]&&b[3]<=coverage[3])return false;
  coverage=[Math.max(-179,Math.min(coverage[0],b[0]-2)),Math.max(-79,Math.min(coverage[1],b[1]-2)),Math.min(179,Math.max(coverage[2],b[2]+2)),Math.min(79,Math.max(coverage[3],b[3]+2))];
  return true;
 }
 function report(phase='paused'){
  previous.disabled=index<=0;next.disabled=index>=frames.length-1||!frames.length;
  play.textContent=player?.playing?'Pause':'Play';play.setAttribute('aria-pressed',String(!!player?.playing));play.disabled=frames.length<2;
  slider.disabled=!frames.length;slider.max=String(Math.max(0,frames.length-1));slider.value=String(Math.max(0,index));
  slider.setAttribute('aria-valuetext',displayed?stamp(displayed.time):'No radar observation');
  if(phase==='error'){clear();info.textContent='NWS radar image unavailable · playback stopped';return;}
  if(fresh())info.textContent=`${following?'Observed':'Replay'} radar · ${stamp(displayed.time)}${Date.now()-displayed.time>20*60000?' · delayed':''}${gaps?' · observation gaps':''}`;
 }
 async function mount(at,autoplay=false){
  player?.destroy();const run=++epoch;extendCoverage();const footprint=[...coverage];
  player=createForecastPlayback({frames,dwell:1200,available:()=>active&&!suspended&&visible()&&!document.hidden,
   load:(frame,signal)=>loadImage(frame,signal,{bounds:footprint}),
   changed:({status})=>{if(run===epoch)report(status);},
   render:async(image,frame,i)=>{if(run!==epoch||!active||suspended)return;
    if(await session.regionalRadar(image)===false)throw Error('Radar frame could not be displayed');
    if(run!==epoch||!active||suspended)return;displayed=frame;index=i;
    clearTimeout(expiry);expiry=setTimeout(()=>{clear();info.textContent='NWS radar observation expired';},Math.max(1,frame.time+120*60000-Date.now()));
    pairClouds(frame.time);report();}
  });
  const ok=await player.select(at);if(run!==epoch||!active||suspended)return;
  if(footprint.some((v,i)=>v!==coverage[i])){await mount(at,autoplay);return;}
  if(ok&&autoplay){stopFollow();await player.play({automatic:true});}
 }
 async function refresh(autoplay=false){
  clearTimeout(timer);if(!active||suspended||document.hidden)return;
  request?.abort();const current=request=new AbortController();
  try{
   const catalog=await loadCatalog(current.signal);if(current.signal.aborted||request!==current||!active||suspended)return;
   frames=catalog.frames;gaps=catalog.gaps;renderColors('NWS radar reflectivity · dBZ',catalog.legend);
   const animate=autoplay&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
   await mount(animate?0:frames.length-1,animate);
  }catch{if(!current.signal.aborted){if(!fresh())clear();info.textContent=fresh()?`Radar update unavailable · retained ${stamp(displayed.time)}`:'NWS radar unavailable';}}
  finally{if(request===current){request=null;if(active&&following&&!suspended)timer=setTimeout(()=>void refresh(),60000);}}
 }
 play.onclick=()=>{if(!player||!frames.length)return;if(player.playing){player.pause();report();}else{stopFollow();void player.play();}};
 slider.oninput=()=>{if(!player||!frames.length)return;stopFollow();void player.select(Number(slider.value));};
 latest.onclick=()=>{following=true;void refresh();};
 return {controls,cloudButton:clouds.button,cloudStatus:clouds.status,cloudLegend:clouds.legend,
  open({autoplay=false}={}){active=true;suspended=false;following=true;info.textContent='Loading NWS radar mosaic…';
   items.replaceChildren(document.createTextNode('Observed multi-radar reflectivity. Blank areas may lack radar coverage; this is not a rain/no-rain guarantee. Colors use the publisher scale. Playback uses actual advertised times and stops at the latest scan.'),source('NWS mosaic service',MOSAIC_URL));void refresh(autoplay);},
  close(){active=false;epoch++;request?.abort();request=null;player?.destroy();player=null;play.disabled=true;slider.disabled=true;clearTimeout(timer);clear();},
  suspend(){suspended=true;request?.abort();request=null;player?.pause();clearTimeout(timer);clouds.cancelPending();},
  resume(){if(!active)return;suspended=false;if(following)void refresh();else if(!fresh()){clear();info.textContent='Radar observation expired';}else pairClouds(displayed.time);},
  viewportChanged(){
   if(!active||suspended||!extendCoverage()||!displayed)return;
   player?.pause();info.textContent='Loading radar coverage for this view…';void mount(index);
  }
 };
}
