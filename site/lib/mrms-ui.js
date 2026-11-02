import {loadSdk} from './map.js';
import {reportHealth} from './source-health.js';
import {validateMrmsManifest,validateMrmsGrid,mrmsReason,mrmsPixels,RAIN_STOPS,TOTAL_STOPS} from './mrms-model.js';

const $=id=>document.getElementById(id);
const ramp=stops=>({type:'multipart',colorRamps:stops.slice(1).map((s,i)=>({fromColor:stops[i][1],toColor:s[1],algorithm:'cie-lab'}))});
/** Observed rainfall (MRMS): 24-hour total or the last 24 hours one by one. Its own clock: the shared weather timeline only reaches back 3 h. */
export function createMrmsRainfall({time,exercise}){
  let manifest=null,error=null,checked=null,map=null,group=null,sdk=null,busy=false,next=0;
  let view='24-h total',hour=23,playing=null,key='',loading=null,generation=0;
  const cache=new Map();
  async function json(name){const r=await fetch(new URL(`../data/mrms/${name}`,import.meta.url),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`MRMS HTTP ${r.status}`);const text=await r.text();if(text.length>900000)throw Error('MRMS file exceeds regional size limit');return JSON.parse(text);}
  async function load(entry,isTotal){
    let data=cache.get(entry.file);
    if(!data){data=validateMrmsGrid(await json(entry.file),manifest,entry.valid,isTotal);cache.set(entry.file,data);while(cache.size>6)cache.delete(cache.keys().next().value);}
    return data;
  }
  const selected=()=>view==='Hourly'?{entry:manifest.frames[hour],isTotal:false}:{entry:{file:manifest.total,valid:manifest.frames.at(-1).valid},isTotal:true};
  function showStatus(){
    const reason=exercise?'Exercise · live MRMS disabled':error||mrmsReason(manifest);
    const f=manifest?.frames;
    $('mrms-time').textContent=reason||(view==='Hourly'?`Hour ending ${time(Date.parse(f[hour].valid))} · ${hour-23?`${23-hour}h before latest`:'latest hour'}`:`24 hours ending ${time(Date.parse(f.at(-1).valid))}`);
    $('mrms-health').textContent=reason||`Collected ${time(Date.parse(manifest.generatedAt))} · app checked ${time(checked)} · MRMS runs about an hour behind`;
    $('mrms-health').dataset.tone=reason?'gap':'normal';
    $('mrms-hour').disabled=!!reason||view!=='Hourly';$('mrms-hour').value=hour;
    $('mrms-play').toggleAttribute('disabled',!!reason||view!=='Hourly');
    $('mrms-play').textContent=playing?'Stop':'Play last 24 hours';$('mrms-play').setAttribute('icon-start',playing?'stop':'play');$('mrms-play').setAttribute('aria-pressed',String(!!playing));
    $('mrms-attribution').textContent=manifest?.attribution||'NOAA NWS NCEP MRMS · processed by Dynamical';
    $('mrms-legend-title').textContent=view==='Hourly'?'MRMS observed · rain in the hour (in)':'MRMS observed · 24-hour total (in)';
    $('mrms-legend-time').textContent=reason||$('mrms-time').textContent;
    $('mrms-legend').hidden=!map;// map.js hides it with workspace-layer-off while the layer is off
    $('mrms-hourly-labels').hidden=view!=='Hourly';$('mrms-total-labels').hidden=view==='Hourly';
    if(!exercise)reportHealth('mrms','MRMS observed rainfall',{checked,error:error||manifest?.error,state:!manifest?'checking':mrmsReason(manifest)?'stale':null,detail:'Radar + gauge analysis, about an hour behind.'});
  }
  async function draw(){
    const reason=exercise||error||mrmsReason(manifest);
    if(group)map.setLayerEligibility(group,!reason);
    if(reason||!group){showStatus();return;}
    const {entry,isTotal}=selected(),wanted=`${entry.file}:${view}`;
    if(wanted===key||wanted===loading){showStatus();return;}
    const token=++generation;loading=wanted;showStatus();
    try{
      const data=await load(entry,isTotal);if(token!==generation)return;
      const [ImageryTileLayer,PixelBlock,Extent]=sdk,g=manifest.grid;
      const extent=new Extent({xmin:g.x0-g.dx/2,xmax:g.x0+(g.width-.5)*g.dx,ymax:g.y0-g.dy/2,ymin:g.y0+(g.height-.5)*g.dy,spatialReference:{wkid:4326}});
      const stops=isTotal?TOTAL_STOPS:RAIN_STOPS,max=stops.at(-1)[0];
      const layer=new ImageryTileLayer({title:isTotal?'MRMS observed 24-hour rainfall · in':'MRMS observed hourly rainfall · in',source:{extent,pixelBlock:new PixelBlock(mrmsPixels(data))},opacity:.7,legendEnabled:false,elevationInfo:{mode:'on-the-ground'},
        renderer:{type:'raster-stretch',stretchType:'min-max',statistics:[{min:0,max,avg:max/5,stddev:max/5}],colorRamp:ramp(stops)}});
      await layer.load();if(token!==generation){layer.destroy();return;}
      // Swap after the new field is ready so playback never flashes blank.
      const previous=group.layers.toArray();group.add(layer);group.removeMany(previous);for(const l of previous)l.destroy();key=wanted;
      if(view==='Hourly'&&manifest.frames[hour+1])void load(manifest.frames[hour+1],false).catch(()=>{});
    }catch(e){if(token===generation){error=`MRMS field unavailable · ${e.message}`;group.removeAll();key='';}}
    finally{if(token===generation){loading=null;showStatus();}}
  }
  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;
    try{const data=await json('latest.json');if(data.error&&!data.frames)throw Error(data.error);manifest=validateMrmsManifest(data);checked=Date.now();error=null;key='';cache.clear();}
    catch(e){error=`MRMS collection unavailable · ${e.message}`;}
    finally{busy=false;next=Date.now()+300000;void draw();}
  }
  const stop=()=>{clearInterval(playing);playing=null;showStatus();};
  $('mrms-toggle').addEventListener('calciteCheckboxChange',e=>map?.setLayerPreference('mrms',e.target.checked));
  $('mrms-view').addEventListener('calciteSegmentedControlChange',e=>{view=e.target.value;if(view!=='Hourly')stop();void draw();});
  $('mrms-hour').addEventListener('calciteSliderInput',e=>{hour=Number(e.target.value);void draw();});
  // ponytail: 1 s per hour, fixed; make it a control if people want it slower.
  $('mrms-play').addEventListener('click',()=>{if(playing)return stop();if(hour===23)hour=0;playing=setInterval(()=>{if(document.hidden)return stop();hour=(hour+1)%24;void draw();},1000);void draw();});
  $('mrms-refresh').addEventListener('click',()=>void refresh());
  setInterval(()=>{if(!document.hidden&&Date.now()>=next)void refresh();},60000);
  if(exercise)for(const id of ['mrms-toggle','mrms-view','mrms-hour','mrms-play','mrms-refresh'])$(id).setAttribute('disabled','');
  queueMicrotask(()=>{showStatus();void refresh();});
  return {async setMap(controller){map=controller;try{const loader=await loadSdk();const c=await loader.import(['@arcgis/core/layers/ImageryTileLayer.js','@arcgis/core/layers/support/PixelBlock.js','@arcgis/core/geometry/Extent.js','@arcgis/core/layers/GroupLayer.js']);sdk=c.slice(0,3);group=new c[3]({title:'MRMS observed rainfall',visible:false});map.registerLayer('mrms',group,false);void draw();}catch(e){error=`MRMS map unavailable · ${e.message}`;showStatus();}}};
}
