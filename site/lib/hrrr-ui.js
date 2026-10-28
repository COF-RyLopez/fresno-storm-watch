import {loadSdk} from './map.js?v=0.42.0';
import {reportHealth} from './source-health.js?v=0.59.0';
import {validateHrrrManifest,validateHrrrFrame,hrrrAt,hrrrPoint,hrrrPixels,GUST_STOPS} from './hrrr-model.js';

const $=id=>document.getElementById(id);
/** Public grid adapter, lazy frame loading, bounded cache and superseded-load protection. */
export function createHrrrWeather({time,exercise,target,onTime,onMap}){
  let manifest=null,frame=null,error=null,checked=null,map=null,group=null,sdk=null,windLayer=null;
  let enabled=true,gusts=true,animate=!matchMedia('(prefers-reduced-motion: reduce)').matches;
  let busy=false,next=0,generation=0,key='',loading=null,point=null,mapError=null;
  const cache=new Map();
  const showStatus=()=>{
    const state=hrrrAt(manifest,target()),available=!!state.frame&&!error&&!mapError;
    $('hrrr-time').textContent=state.frame?`HRRR step ${time(Date.parse(state.frame.valid))} · +${state.frame.leadHours}h · instantaneous model forecast`:state.reason;
    $('hrrr-run').textContent=manifest?`Model run ${time(Date.parse(manifest.run))} · 3 km native grid · prepared 0.03° cells`:'Waiting for public HRRR collection';
    const health=exercise?'Live HRRR disabled in exercise':error||mapError||state.reason||`Collected ${time(Date.parse(manifest.generatedAt))} · app checked ${time(checked)}`;
    $('hrrr-health').textContent=health;$('hrrr-health').dataset.tone=available?'normal':'gap';
    $('timeline-hrrr').textContent=exercise?'Exercise · live feed disabled':error||mapError||state.reason||(loading?'Loading selected HRRR field…':`Step ${time(Date.parse(state.frame.valid))} · run ${time(Date.parse(manifest.run))}`);
    $('hrrr-attribution').textContent=manifest?.attribution||'NOAA NWS NCEP HRRR · processed by Dynamical';
    $('hrrr-legend').hidden=!enabled||!map;
    $('hrrr-legend-title').textContent=gusts?'HRRR forecast · surface gusts (mph)':'HRRR forecast · 10 m wind direction';
    for(const n of $('hrrr-legend').querySelectorAll('.hrrr-color-key,.hrrr-color-labels'))n.hidden=!gusts;
    $('hrrr-legend-time').textContent=state.frame?`HRRR forecast · valid step ${time(Date.parse(state.frame.valid))} · run ${time(Date.parse(manifest.run))}`:state.reason;
    $('hrrr-legend-state').textContent=error||mapError||state.reason||(loading?'Loading selected field · previous field hidden':`${animate?'Animated':'Paused'} wind trails show flow direction; animation speed is illustrative. ${gusts?'Shading: surface gust forecast.':'Gust shading off.'}`);
    $('hrrr-sample').textContent='Select an NWS point below to compare the same planning time.';
    if(point&&frame&&frame.valid===state.frame?.valid&&!error&&!mapError&&!state.reason){const s=hrrrPoint(frame,manifest.grid,point.longitude,point.latitude);const val=v=>v===null?'Unknown':`${Math.round(v)} mph`;$('hrrr-sample').textContent=s?`${point.name} · HRRR nearest prepared cell: wind ${val(s.speed)}, gust ${val(s.gust)} · ${s.latitude.toFixed(2)}, ${s.longitude.toFixed(2)}. NWS values below use their own forecast intervals.`:'Selected NWS point is outside HRRR display coverage.';}
    $('hrrr-play').textContent=animate?'Pause wind animation':'Animate winds';$('hrrr-play').setAttribute('icon-start',animate?'pause':'play');$('hrrr-play').setAttribute('aria-pressed',String(animate));
    $('hrrr-play').toggleAttribute('disabled',exercise||!available||!windLayer);
    $('hrrr-next').toggleAttribute('disabled',exercise||!manifest?.frames.some(f=>Date.parse(f.valid)>target()));
    if(!exercise)reportHealth('hrrr-grid','HRRR regional winds / gusts',{checked,error:error||mapError||manifest?.error,state:!manifest?'checking':Date.now()-Date.parse(manifest.generatedAt)>45*60000||Date.now()-Date.parse(manifest.run)>18*3600000?'stale':null,detail:'Latest regional model collection; timeline availability is shown separately.'});
  };
  function clear(){key='';frame=null;if(group){const old=group.layers.toArray();group.removeAll();for(const layer of old)layer.destroy();}windLayer=null;}
  async function json(url){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`HRRR HTTP ${r.status}`);const text=await r.text();if(text.length>900000)throw Error('HRRR file exceeds regional size limit');return JSON.parse(text);}
  async function draw(){
    const state=hrrrAt(manifest,target());
    if(group)map.setLayerEligibility(group,!exercise&&enabled&&!error&&!mapError&&!!state.frame);
    if(exercise||!enabled||error||state.reason){generation++;loading=null;clear();showStatus();return;}
    const selected=state.frame,wanted=`${manifest.run}:${selected.file}:${gusts}`;
    if(wanted===key||wanted===loading){showStatus();return;}
    if(!group){showStatus();return;}
    const token=++generation;loading=wanted;clear();showStatus();
    const additions=[];
    try{
      let data=cache.get(selected.file);
      if(!data){data=validateHrrrFrame(await json(new URL(`../data/hrrr/${selected.file}`,import.meta.url)),manifest,selected);cache.set(selected.file,data);while(cache.size>4)cache.delete(cache.keys().next().value);}
      if(token!==generation)return;
      const [ImageryTileLayer,PixelBlock,Extent]=sdk;
      const g=manifest.grid,extent=new Extent({xmin:g.x0-g.dx/2,xmax:g.x0+(g.width-.5)*g.dx,ymax:g.y0-g.dy/2,ymin:g.y0+(g.height-.5)*g.dy,spatialReference:{wkid:4326}});
      const wind=new ImageryTileLayer({title:'HRRR 10 m winds · model forecast',source:{extent,pixelBlock:new PixelBlock(hrrrPixels(data,'wind'))},opacity:.9,visible:false,legendEnabled:false,elevationInfo:{mode:'on-the-ground'}});
      additions.push(wind);
      await wind.load();
      // Public RasterInfo keyProperties supplies the vector source convention.
      wind.serviceRasterInfo.keyProperties={...wind.serviceRasterInfo.keyProperties,DataType:'Vector-UV'};
      wind.renderer={type:'flow',density:.65,trailWidth:1.4,trailLength:110,flowSpeed:animate?4:0,color:'#d5f2f4',flowRepresentation:'flow-from'};
      if(gusts){const gust=new ImageryTileLayer({title:'HRRR surface gusts · mph · model forecast',source:{extent,pixelBlock:new PixelBlock(hrrrPixels(data,'gust'))},opacity:.48,visible:false,legendEnabled:false,renderer:{type:'raster-stretch',stretchType:'min-max',statistics:[{min:0,max:75,avg:25,stddev:20}],colorRamp:{type:'multipart',colorRamps:GUST_STOPS.slice(1).map((s,i)=>({type:'algorithmic',fromColor:GUST_STOPS[i][1],toColor:s[1],algorithm:'cie-lab'}))}}});await gust.load();additions.unshift(gust);}
      if(token!==generation){for(const l of additions)l.destroy();return;}
      for(const l of additions){l.on('layerview-create-error',event=>{if(key!==wanted)return;mapError=`HRRR map rendering failed · ${event.error?.message||'Use NWS forecasts'}`;map.setLayerEligibility(group,false);showStatus();});l.visible=true;}
      const renderer=wind.renderer.clone();renderer.flowSpeed=animate?4:0;wind.renderer=renderer;
      group.addMany(additions);windLayer=wind;frame=data;key=wanted;mapError=null;
    }catch(e){for(const l of additions)if(!group.layers.includes(l))l.destroy();if(token===generation){error=`HRRR field unavailable · ${e.message}`;clear();}}
    finally{if(token===generation){loading=null;showStatus();}}
  }
  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;
    try{const data=await json(new URL('../data/hrrr/latest.json',import.meta.url));if(data.error&&!data.frames)throw Error(data.error);manifest=validateHrrrManifest(data);checked=Date.now();error=null;mapError=null;key='';}
    catch(e){error=`HRRR collection unavailable · ${e.message}`;}
    finally{busy=false;next=Date.now()+300000;void draw();}
  }
  $('hrrr-toggle').addEventListener('calciteCheckboxChange',()=>{enabled=$('hrrr-toggle').checked;map?.setLayerPreference('hrrr',enabled);void draw();});
  $('hrrr-gusts').addEventListener('calciteCheckboxChange',()=>{gusts=$('hrrr-gusts').checked;void draw();});
  $('hrrr-play').addEventListener('click',()=>{animate=!animate;if(windLayer){const r=windLayer.renderer.clone();r.flowSpeed=animate?4:0;windLayer.renderer=r;}showStatus();});
  $('hrrr-next').addEventListener('click',()=>{const next=manifest?.frames.find(f=>Date.parse(f.valid)>target());if(next)onTime(Date.parse(next.valid));});
  $('hrrr-fit').addEventListener('click',()=>{onMap();map?.fitHrrr();});
  $('hrrr-refresh').addEventListener('click',()=>void refresh());
  const tick=()=>{if(document.hidden)return;void draw();if(Date.now()>=next)void refresh();};
  setInterval(tick,60000);document.addEventListener('visibilitychange',tick);
  window.addEventListener('offline',()=>{error='Browser offline · HRRR field hidden';void draw();});window.addEventListener('online',()=>{next=0;tick();});
  if(exercise)for(const id of ['hrrr-toggle','hrrr-gusts','hrrr-play','hrrr-next','hrrr-refresh'])$(id).setAttribute('disabled','');
  queueMicrotask(()=>{showStatus();void refresh();});
  return {update(site){point=site;void draw();},refresh,async setMap(controller){map=controller;try{const loader=await loadSdk();const classes=await loader.import(['@arcgis/core/layers/ImageryTileLayer.js','@arcgis/core/layers/support/PixelBlock.js','@arcgis/core/geometry/Extent.js','@arcgis/core/layers/GroupLayer.js']);sdk=classes.slice(0,3);group=new classes[3]({title:'HRRR forecast winds / gusts',visible:false});map.registerLayer('hrrr',group,false);map.onViewChanged(()=>{showStatus();});void draw();}catch(e){mapError=`HRRR map unavailable · ${e.message}`;showStatus();}}};
}
