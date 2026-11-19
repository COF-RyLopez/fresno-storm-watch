import {loadHanfordTimeline,loadHanfordFrame,RADAR_BANDS,RADAR_MAX_AGE} from './hanford-radar-data.js';
import {createWatershedPlayback} from './watershed-playback.js';
import {installWatchClouds} from './watch-cloud-ui.js';
import {loadRadarVolumeTimeline,loadRadarVolumeFrame} from './radar-volume-data.js';
import {createWeatherFrameCache} from './weather-frame-cache.js';

const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const sameScan=(left,right)=>left?.file===right?.file&&left?.sha256===right?.sha256;

/** Empty completed-volume snapshots are unavailable data, not an empty radar observation. */
export async function radarTimelineForDisplay({volumeWanted,signal,loadVolumes=loadRadarVolumeTimeline,loadPatches=loadHanfordTimeline}){
 if(volumeWanted){
  try{const timeline=await loadVolumes({signal});if(timeline.frames.length)return {timeline,volumeIssue:false};}
  catch(error){if(signal?.aborted)throw error;}
 }
 signal?.throwIfAborted();
 return {timeline:await loadPatches({signal}),volumeIssue:volumeWanted};
}

/** Keep live-follow and replay on the same renderer. Replay holds a bounded, dated scan list. */
export function installWatchRadar({session,info,items,renderColors,visible,source,allowVolume=true}){
 const clouds=installWatchClouds(session);
 const volumeButton=document.createElement('calcite-button');volumeButton.scale='s';volumeButton.kind='neutral';
 volumeButton.textContent='Volume';volumeButton.label='Experimental volume';volumeButton.appearance='outline';volumeButton.hidden=true;
 volumeButton.setAttribute('aria-pressed','false');
 volumeButton.title='Compare a Zarr radar volume with the current echo display';
 const controls=document.createElement('div');controls.className='watershed-player-controls watershed-radar-controls';controls.hidden=true;
 const play=document.createElement('calcite-button'),latest=document.createElement('calcite-button');
 play.scale=latest.scale='s';play.textContent='Play';latest.textContent='Latest';latest.appearance='outline';latest.kind='neutral';
 const scrub=document.createElement('input');scrub.type='range';scrub.min='0';scrub.step='1';scrub.value='0';scrub.setAttribute('aria-label','Hanford radar scan');
 controls.append(play,scrub,latest);
 const weak=document.createElement('input');weak.type='checkbox';
 const weakLabel=document.createElement('label');weakLabel.append(weak,' Show weak returns (10–<20 dBZ)');
 const scanLink=source('NOAA scan file','https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar');
 const coverage=source('Hanford coverage and scan details','https://frog-demo.ryanlopez.tech/?view=storm');
 let active=false,following=true,request,timer,expiry,timeline,displayed,samples,cube,next=0,failed=false,volumeWanted=false,volumeIssue=false,gpuFailed=false;
 let warmGeneration=0,transition=null,transitionTimer;
 let autoplayPending=false,starting=false,replayGeneration=0;
 const cache=createWeatherFrameCache(12),volumeCache=createWeatherFrameCache(3);
 const frames=()=>timeline?.frames??[];
 const minimum=()=>weak.checked?10:20;
 const stillRecent=frame=>frame&&Date.now()-frame.end<=RADAR_MAX_AGE;
 const index=()=>frames().findIndex(frame=>sameScan(frame,displayed));
 const playback=createWatershedPlayback({dwell:1100,
  canAdvance:()=>active&&!document.hidden&&visible()&&next<frames().length,
  changed(){syncControls();},
  advance(){return choose(next++);}
 });

 function syncControls(){
  play.textContent=playback.playing||starting?'Pause':'Play';play.iconStart=playback.playing||starting?'pause':'play';
  play.disabled=frames().length<2;
  scrub.disabled=frames().length<2;scrub.max=String(Math.max(0,frames().length-1));scrub.value=String(Math.max(0,index()));
  scrub.setAttribute('aria-valuetext',displayed?time.format(displayed.end):'No scan selected');
  latest.disabled=following&&!failed&&!!stillRecent(displayed);
 }
 function colors(){
  renderColors('Radar reflectivity (dBZ)',RADAR_BANDS.filter(band=>band.min>=minimum())
   .map(band=>({value:band.label,color:`rgb(${band.color.join(',')})`})));
 }
 function report(observeClouds=true){
  clearTimeout(expiry);
  syncControls();
  if(observeClouds&&!document.hidden)void clouds.observe(stillRecent(displayed)?displayed.end:Date.now(),{durationMs:transition?400:0});
  if(!stillRecent(displayed)){
   session.radar(null);session.radarVolume(null);scanLink.hidden=true;
   info.textContent=failed?'Hanford radar unavailable':'No recent Hanford scans available';
   return;
  }
  const scanTime=transition?time.formatRange(transition.from,displayed.end):time.formatRange(displayed.start,displayed.end);
  expiry=setTimeout(report,Math.max(1,displayed.end+RADAR_MAX_AGE-Date.now()+1));
  const status=transition?'Transition':following?'Observed':`Replay ${index()+1}/${frames().length}`;
  const delay=following&&Date.now()-displayed.end>20*60_000?' · Stale scan':following&&timeline?.delayed?' · Feed delayed':'';
  const hasEcho=cube?cube.values.some(value=>value>=minimum()):samples?.some((value,i)=>i%4===3&&value>=minimum());
  const subset=hasEcho?'':` · No echoes ≥${minimum()} dBZ shown`;
  const mode=cube?' · Experimental volume':volumeWanted&&volumeIssue?' · Volume unavailable; echo patches shown':'';
  const message=`${status} · ${scanTime}${mode}${delay}${subset}${!following&&timeline?.gaps?' · Gaps in scans':''}${failed?' · Update unavailable':''}`;
  if(info.textContent!==message)info.textContent=message;
  scanLink.href=displayed.source;scanLink.hidden=false;
 }
 const frameKey=frame=>`${frame.sha256}:${frame.count}`;
 const loadSamples=frame=>cache.get(frameKey(frame),signal=>loadHanfordFrame(frame,{signal}));
 const loadVolume=frame=>volumeCache.get(frameKey(frame),signal=>loadRadarVolumeFrame(frame.volumeRecord,{signal}));
 async function warmFrom(start){
  const generation=++warmGeneration;
  // Two-frame lookahead, serial cube preparation bounds concurrent chunk traffic to four.
  for(const frame of frames().slice(start,start+2)){
   if(!active||document.hidden||generation!==warmGeneration)return;
   void clouds.prepare(frame.end).catch(()=>{});
   try{await (volumeWanted&&!gpuFailed&&frame.volumeRecord?loadVolume(frame):loadSamples(frame));}
   catch{/* Display retries the dated frame and reports its own failure. */}
  }
 }
 function transitionTo(frame){
  clearTimeout(transitionTimer);transition=null;
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const durationMs=displayed&&frame.end>displayed.end&&frame.end-displayed.end<=10*60_000&&!reduced?400:0;
  if(durationMs){
   transition={from:displayed.end};
   transitionTimer=setTimeout(()=>{transition=null;if(active)report();},durationMs);
  }
  return {durationMs};
 }
 async function draw(frame,signal){
  if(!frame){
   if(!signal.aborted){displayed=samples=cube=null;report();}
   return;
  }
  if(volumeWanted&&!gpuFailed&&frame.volumeRecord){
   try{
    const grid=await loadVolume(frame);
    if(signal.aborted)return;
    session.radarVolume(grid,minimum(),()=>{
     if(!active||!sameScan(displayed,frame))return;
     gpuFailed=true;volumeIssue=true;displayed=samples=cube=null;
     void run(signal=>draw(frame,signal));
    },transitionTo(frame));session.radar(null);
    displayed=frame;cube=grid;samples=null;volumeIssue=false;return;
   }catch(error){if(signal.aborted)throw error;volumeIssue=true;}
  }
  const values=await loadSamples(frame);
  if(signal.aborted)return;
  session.radar(values,minimum(),transitionTo(frame));session.radarVolume(null);displayed=frame;samples=values;cube=null;
 }
 function abortRequest(){request?.abort();request=null;}
 async function run(action){
  abortRequest();
  const current=request=new AbortController();
  try{
   await action(current.signal);
   if(current.signal.aborted)return false;
   failed=false;report();return true;
  }catch{
   if(!current.signal.aborted){failed=true;report();}
   return false;
  }finally{if(request===current)request=null;}
 }
 async function refresh(){
  clearTimeout(timer);
  if(!active||!following||document.hidden)return;
  await run(async signal=>{
   const selected=await radarTimelineForDisplay({volumeWanted,signal});
   if(signal.aborted)return;
   const updated=selected.timeline;volumeIssue=selected.volumeIssue;
   if(gpuFailed&&volumeWanted)volumeIssue=true;
   await draw(autoplayPending&&updated.frames.length>1&&!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ?updated.frames[0]:updated.frames.at(-1),signal);
   if(!signal.aborted)timeline=updated;
  });
  if(autoplayPending){autoplayPending=false;if(active&&!failed&&frames().length>1)await startReplay(true);}
  if(active&&following)void warmFrom(0);
  if(active&&following&&!request){clearTimeout(timer);timer=setTimeout(()=>void refresh(),60_000);}
 }
 function hold(){
  starting=false;replayGeneration++;autoplayPending=false;
  following=false;clearTimeout(timer);cancelPending();playback.pause();report(false);
 }
 function cancelPending(){
  abortRequest();warmGeneration++;cache.cancelPending();volumeCache.cancelPending();clouds.cancelPending();
  clearTimeout(transitionTimer);transition=null;
  if(stillRecent(displayed)){if(cube)session.radarVolume(cube,minimum());else if(samples)session.radar(samples,minimum());}
 }
 function choose(frameIndex){
  const frame=frames()[frameIndex];
  if(!stillRecent(frame))return false;
  return run(signal=>draw(frame,signal)).then(ok=>{if(ok&&active)void warmFrom(frameIndex+1);return ok;});
 }
 async function startReplay(automatic=false){
  if(frames().length<2||automatic&&globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
  const at=index();
  next=following||at===frames().length-1?0:at+1;
  hold();const generation=replayGeneration;starting=true;syncControls();
  try{
   for(const frame of frames().slice(next,next+2)){
    if(generation!==replayGeneration||!active||document.hidden||!visible())return;
    if(volumeWanted&&!gpuFailed&&frame.volumeRecord){
     try{await loadVolume(frame);}
     catch{if(generation!==replayGeneration)return;await loadSamples(frame);}
    }else await loadSamples(frame);
   }
   if(generation!==replayGeneration||!active||document.hidden||!visible())return;
   starting=false;playback.play();
  }catch{if(generation===replayGeneration){starting=false;failed=true;report(false);}}
 }
 play.addEventListener('click',()=>{
  if(playback.playing||starting){hold();return;}
  void startReplay();
 });
 scrub.addEventListener('change',()=>{
  const frameIndex=Number(scrub.value);
  hold();void choose(frameIndex);
 });
 latest.addEventListener('click',()=>{
  hold();following=true;failed=false;syncControls();void refresh();
 });
 weak.addEventListener('change',()=>{
  colors();
  if(stillRecent(displayed)){if(cube)session.radarVolume(cube,minimum());else session.radar(samples,minimum());}
  report();
 });
 volumeButton.addEventListener('click',()=>{
  if(!allowVolume)return;
  hold();
  volumeWanted=!volumeWanted;volumeButton.setAttribute('aria-pressed',String(volumeWanted));
  volumeButton.appearance=volumeWanted?'solid':'outline';
  playback.pause();cancelPending();cache.clear();volumeCache.clear();
  following=true;failed=false;volumeIssue=false;timeline=displayed=samples=cube=null;
  session.radar(null);session.radarVolume(null);syncControls();
  info.textContent=volumeWanted?'Loading experimental radar volume…':'Loading Hanford radar…';void refresh();
 });
 document.addEventListener('visibilitychange',()=>{
  if(!active)return;
  if(document.hidden){clearTimeout(timer);cancelPending();playback.pause();}
  else if(following)void refresh();
  else report();
 });
 return {controls,volumeButton,cloudButton:clouds.button,cloudStatus:clouds.status,cloudLegend:clouds.legend,
  suspend(){active=false;autoplayPending=false;starting=false;replayGeneration++;clearTimeout(timer);clearTimeout(expiry);cancelPending();playback.pause();clouds.close();session.radar(null);session.radarVolume(null);},
  resume(){
   active=true;controls.hidden=false;clouds.open();clearTimeout(timer);
   if(stillRecent(displayed)){void run(signal=>draw(displayed,signal));if(following)timer=setTimeout(()=>void refresh(),60000);}
   else{scanLink.hidden=true;info.textContent='Selected radar scan expired · use Latest to check again';syncControls();}
  },
  open({autoplay=false}={}){
   autoplayPending=autoplay;starting=false;replayGeneration++;
   active=true;following=true;failed=false;controls.hidden=false;volumeButton.hidden=!allowVolume;
   clouds.open();
   info.textContent='Loading Hanford radar…';scanLink.hidden=true;syncControls();colors();
   items.replaceChildren(document.createTextNode('Echo patches show the strongest sampled Hanford return per roughly 4 km bin. Experimental volume retains multiple heights in roughly 3 km × 3 km × 500 m bins, streamed from Zarr. Soft edges are display styling. Unsampled and filtered space is unknown. Farther echoes can appear through intervening terrain in this overview. The volume uses completed snapshots updated with the site, so its latest scan may lag the echo view. GOES cloud tops are separate geopotential-height retrievals; apparent positions can shift with satellite viewing angle. Dated 2D infrared imagery is used when matching heights are unavailable.'),
    document.createElement('br'),weakLabel,document.createElement('br'),scanLink,document.createTextNode(' '),coverage,document.createTextNode(' '),
    source('NOAA cloud-top height','https://vlab.noaa.gov/web/towr-s/goes-cloud-top-height'));
   void refresh();
  },
  close(){
   autoplayPending=false;starting=false;replayGeneration++;
   active=false;controls.hidden=true;volumeButton.hidden=true;playback.pause();clearTimeout(timer);clearTimeout(expiry);clearTimeout(transitionTimer);transition=null;warmGeneration++;abortRequest();cache.clear();volumeCache.clear();
   clouds.close();
   timeline=displayed=samples=cube=null;session.radar(null);session.radarVolume(null);
  }
 };
}
