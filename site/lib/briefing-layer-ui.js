import {BRIEFING_LAYERS,BRIEFING_LAYER_CHECK_MS,briefingLayerCycle,briefingLayerLegend} from './briefing-layer-model.js?v=0.25.0';
import {loadSdk} from './map.js?v=0.74.0-infra-weather';
import {formatTime} from './model.js';
import {reportHealth} from './source-health.js?v=0.73.1';
import {probabilityRecord,PROBABILITY_MAX_CHECK_AGE} from './precip-probability-model.js';
import {slideMapping,chooseSlideLayer} from './briefing-follow-model.js';
const $=id=>document.getElementById(id);
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const cycleQuery=s=>{const q=new URL(`${s.service}/${s.layer}/query`);q.search=new URLSearchParams({f:'json',where:'1=1',outFields:'product,issue_time,start_time,end_time'+(s.field==='qpf'?',units':''),returnGeometry:'false',returnDistinctValues:'true'});return q;};
/** Public live services only. Tour state, source revisions and features stay in page memory. */
export function createBriefingLayers({timeZone,exercise=false,onOpen=()=>{},onMap=()=>{},onStart=()=>{},onStop=()=>{},onBriefing=()=>{},onManual=()=>{}}){
  let map=null,FeatureLayer=null,MediaLayer=null,ImageElement=null,ExtentAndRotationGeoreference=null,Extent=null,index=0,active=false,busy=false,cycle=null,checked=null,error=null,generation=0,abort=null,next=0,legend=[];
  const imageUrls=new Map();
  let slideGeneration=0,slideAbort=null,slideContext=null,followingBusy=false,slideNote='Select a slide to compare its source with the live map.';
  const layers=new Map(),failed=new Set(),step=()=>BRIEFING_LAYERS[index],time=t=>formatTime(t,timeZone);
  const compactTime=t=>new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(t);
  const picker=$('briefing-layer-select');
  for(const s of BRIEFING_LAYERS){const o=el('calcite-option',s.label);o.value=s.id;picker.append(o);}
  function watchLayer(layer,id){layer.on('layerview-create-error',e=>{failed.add(`${id}:${e.view.type}`);render();});layer.on('layerview-create',e=>{failed.delete(`${id}:${e.view.type}`);render();});}
  function disableLayers(){for(const l of layers.values())map?.setLayerEligibility(l,false);}
  function render(){
    const s=step(),l=layers.get(s.id),stale=!checked||Date.now()-checked>BRIEFING_LAYER_CHECK_MS||(cycle?.collected&&Date.now()-cycle.collected>PROBABILITY_MAX_CHECK_AGE),expired=cycle&&(Date.now()>=cycle.end||Date.now()-cycle.issue>s.maxAge),bad=!!error||stale||expired||failed.has(`${s.id}:${map?.view?.type}`);
    disableLayers();if(active&&cycle&&l&&!bad&&!busy)map?.setLayerEligibility(l,true);
    picker.value=s.id;$('briefing-layer-before').disabled=index===0||exercise;$('briefing-layer-after').disabled=index===BRIEFING_LAYERS.length-1||exercise;
    $('briefing-layer-start').textContent=active?'Show selected map':'Start map tour';$('briefing-layer-start').disabled=exercise;$('briefing-layer-stop').hidden=!active;$('briefing-layer-refresh').disabled=!active||busy||exercise;
    $('briefing-layer-meaning').textContent=s.meaning;$('briefing-layer-relation').textContent=s.relationship;
    $('briefing-layer-source').href=s.source;$('briefing-layer-service').href=s.kind==='probability'?(cycle?.source||s.source):`${s.service}/${s.layer}`;
    $('briefing-layer-service').textContent=s.kind==='probability'?'Original WPC map image':'Live map service';
    $('briefing-layer-times').textContent=cycle?`${s.kind==='probability'?'Source cycle':'Issued'} ${time(cycle.issue)} · valid ${time(cycle.start)} → ${time(cycle.end)}.${cycle.collected?` Collected ${time(cycle.collected)}.`:''} Checked ${time(checked)}.`:'Source forecast window will appear after checking the selected layer.';
    const status=exercise?'Live briefing layers disabled in exercise.':!active?'Tour off · select a step and start.':busy?'Checking source cycle and publisher legend…':error?`Map withheld · ${error}`:expired||stale?'Forecast ended or source check overdue · map withheld.':!map||!FeatureLayer||!l?'Map initializing…':failed.has(`${s.id}:${map.view.type}`)?'Map layer failed · use the official source.':'Latest source cycle · one briefing layer selected. No shading does not establish safe conditions.';
    $('briefing-layer-status').textContent=status;$('briefing-layer-status').dataset.tone=active&&bad&&!busy?'gap':'normal';
    $('briefing-layer-map-note').textContent=`${s.label} · ${status} ${cycle?`Valid ${time(cycle.start)} → ${time(cycle.end)}.`:''} Uses its own forecast window, not the shared slider.`;
    $('briefing-layer-legend-title').textContent=s.label+' · official NOAA legend';
    $('briefing-layer-legend').hidden=!active||bad||busy||!l;
    $('hanford-live-note').textContent=slideNote;
    $('hanford-live-times').textContent=active?`${s.label} · ${cycle?`Valid ${compactTime(cycle.start)} → ${compactTime(cycle.end)}. Source cycle ${compactTime(cycle.issue)}.`:'Checking source dates.'}${bad||busy?` ${status}`:''}`:'No live briefing forecast selected.';
    $('hanford-live-symbols').replaceChildren(...(!active||bad||busy||!l?[]:[...$('briefing-layer-symbols').children].map(n=>n.cloneNode(true))));
    if(active&&!exercise)reportHealth('briefing-map','NWS briefing map layer',{checked,error:error||(failed.has(`${s.id}:${map?.view?.type}`)?'Map rendering failed':null),state:expired||stale?'stale':null,maxAgeMs:BRIEFING_LAYER_CHECK_MS,detail:s.label+(expired?' · forecast ended or issue overdue':'')});
  }
  async function json(url,signal){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal});if(!r.ok)throw new Error(`NOAA HTTP ${r.status}`);const d=await r.json();if(d.error)throw new Error(typeof d.error==='string'?d.error:d.error.message||'NOAA service error');return d;}
  function verifyFollowWindow(s,candidate){if(!slideContext?.follow)return;const {mapping}=slideMapping(slideContext);if(mapping)chooseSlideLayer(mapping,[{id:s.id,start:candidate.start,end:candidate.end}]);}
  async function probability(s,signal,request){
    const snapshot=await json('./data/precip-probability.json',signal),r=probabilityRecord(snapshot,s);
    verifyFollowWindow(s,{start:Date.parse(r.start),end:Date.parse(r.end)});
    const response=await fetch('./data/'+r.file,{cache:'no-store',credentials:'omit',signal});
    if(!response.ok)throw new Error(`Probability image HTTP ${response.status}`);
    const bytes=await response.arrayBuffer();if(bytes.byteLength!==r.bytes)throw new Error('Probability image size changed.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==r.sha256)throw new Error('Probability image revision could not be verified.');
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));let installed=false;
    try{
      const image=new Image();image.src=url;await image.decode();
      if(image.naturalWidth!==r.width||image.naturalHeight!==r.height)throw new Error('Probability image dimensions changed.');
      if(request!==generation||signal.aborted)return null;
      if(map&&MediaLayer){
        let layer=layers.get(s.id);
        const mercator=(lon,lat)=>[6378137*lon*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
        const b=snapshot.bounds,[xmin,ymin]=mercator(b.xmin,b.ymin),[xmax,ymax]=mercator(b.xmax,b.ymax);
        const element=new ImageElement({image,georeference:new ExtentAndRotationGeoreference({extent:new Extent({xmin,ymin,xmax,ymax,spatialReference:{wkid:3857}})})});
        if(!layer){layer=new MediaLayer({title:'WPC probability · '+s.label,visible:false,opacity:1,source:[element],copyright:'NOAA / National Weather Service / Weather Prediction Center'});layers.set(s.id,layer);map.registerLayer('briefingLayers',layer,false,1);watchLayer(layer,s.id);}
        else{layer.source.elements.removeAll();layer.source.elements.add(element);}
        const old=imageUrls.get(s.id);imageUrls.set(s.id,url);installed=true;if(old)URL.revokeObjectURL(old);
      }
      return {candidate:{issue:Date.parse(snapshot.issue),start:Date.parse(r.start),end:Date.parse(r.end),collected:Date.parse(snapshot.checkedAt),source:r.source},symbols:snapshot.legend.map(([label,color])=>({label,color}))};
    }finally{if(!installed)URL.revokeObjectURL(url);}
  }
  async function refresh(){
    if(!active||exercise||document.hidden)return;
    const request=++generation,s=step();abort?.abort();abort=new AbortController();const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(25_000)]);busy=true;error=null;render();
    try{
      if(s.kind==='probability'){
        const result=await probability(s,signal,request);if(!result||request!==generation)return;
        cycle=result.candidate;legend=result.symbols;checked=Date.now();
      }else{
      const [payload,metadata,legendPayload]=await Promise.all([json(cycleQuery(s),signal),json(`${s.service}/${s.layer}?f=json`,signal),json(`${s.service}/legend?f=json`,signal)]);
      const candidate=briefingLayerCycle(payload,s),symbols=briefingLayerLegend(legendPayload,s);
      verifyFollowWindow(s,candidate);
      if(metadata.geometryType!=='esriGeometryPolygon'||metadata.drawingInfo?.renderer?.field1!==s.field)throw new Error('Source geometry or renderer changed; verification required.');
      if(request!==generation)return;
      if(FeatureLayer&&map){
        let layer=layers.get(s.id);
        if(!layer){layer=new FeatureLayer({url:`${s.service}/${s.layer}`,title:'NWS briefing · '+s.label,visible:false,definitionExpression:'1=0',opacity:0.72,outFields:['*'],popupTemplate:{title:s.label,content:[{type:'text',text:s.meaning+' Source times below are UTC.'},{type:'fields',fieldInfos:[{fieldName:s.field,label:s.field==='qpf'?'Liquid precipitation (inches)':s.field==='dn'?'Risk category code':'Winter impact'},...['issue_time','start_time','end_time'].map(fieldName=>({fieldName,label:fieldName.replaceAll('_',' ')+' (UTC)'}))]}]}});layers.set(s.id,layer);map.registerLayer('briefingLayers',layer,false);watchLayer(layer,s.id);}
        await layer.load();if(request!==generation)return;
        layer.definitionExpression=candidate.where;layer.refresh();
      }
      if(request!==generation)return;cycle=candidate;legend=symbols;checked=Date.now();
      }
      const host=$('briefing-layer-symbols');host.replaceChildren(...legend.map(r=>{const n=el('span',r.label),img=el(r.color?'i':'img');if(r.color){img.style.backgroundColor=r.color;img.style.cssText+=';display:inline-block;width:24px;height:18px;border:1px solid var(--calcite-color-border-2)';img.setAttribute('aria-hidden','true');}else{img.src=r.image;img.alt='';img.width=24;img.height=24;}n.prepend(img);return n;}));
    }catch(e){if(request===generation)error=e.message;}
    finally{if(request===generation){busy=false;next=Date.now()+5*60_000;render();}}
  }
  function route(replace=false){const u=new URL(location.href);if(active)u.searchParams.set('briefingLayer',step().id);else u.searchParams.delete('briefingLayer');if(u.href!==location.href)history[replace?'replaceState':'pushState']({},'',u);}
  function open(id=step().id,{history:push=true,fit=true,origin='manual'}={}){
    const i=BRIEFING_LAYERS.findIndex(s=>s.id===id);if(i<0||exercise)return;if(origin==='manual')onManual();index=i;active=true;cycle=null;checked=null;error=null;onOpen();if(origin==='slide')onMap();onStart();map?.setLayerPreference('briefingLayers',true);map?.clearEnvironmentPopup();$('briefing-layer-block').expanded=true;if(push)route();void refresh();if(fit){onMap();map?.fitEnvironment();}render();
  }
  function stop(resume=true,push=true){active=false;generation++;abort?.abort();busy=false;disableLayers();map?.setLayerPreference('briefingLayers',false);map?.clearEnvironmentPopup();if(resume)onStop();if(push)route();render();reportHealth('briefing-map','NWS briefing map layer',{state:'unassessed',detail:'Tour off; live layer not requested.'});}
  picker.addEventListener('calciteSelectChange',e=>open(e.target.value));
  $('briefing-layer-start').onclick=()=>open();$('briefing-layer-before').onclick=()=>open(BRIEFING_LAYERS[Math.max(0,index-1)].id);$('briefing-layer-after').onclick=()=>open(BRIEFING_LAYERS[Math.min(BRIEFING_LAYERS.length-1,index+1)].id);
  $('briefing-layer-stop').onclick=()=>{onManual();stop();};$('briefing-layer-refresh').onclick=()=>void refresh();$('briefing-layer-slide').onclick=()=>onBriefing('archive',step().page);
  /** Resolve source periods anew on page changes; cancelled pages cannot replace the selected map. */
  async function followSlide(context){
    const request=++slideGeneration;slideAbort?.abort();slideContext=context;followingBusy=false;
    if(!context)return;
    if(!context.follow){slideNote='Slide following off · the live map selection is independent of this page.';render();return;}
    stop(false,false);cycle=null;checked=null;onStart();route(true);
    const {mapping,reason}=slideMapping(context);
    if(!mapping||exercise){slideNote=exercise?'Live slide following disabled in exercise.':reason;render();return;}
    slideNote=`Slide ${context.page} · checking current source windows…`;followingBusy=true;render();
    slideAbort=new AbortController();const signal=AbortSignal.any([slideAbort.signal,AbortSignal.timeout(25_000)]);
    try{
      const choices=BRIEFING_LAYERS.filter(s=>mapping.ids.includes(s.id));
      let candidates;
      if(choices[0].kind==='probability'){
        const snapshot=await json('./data/precip-probability.json',signal);
        candidates=choices.flatMap(s=>{try{const r=probabilityRecord(snapshot,s);return [{id:s.id,start:Date.parse(r.start),end:Date.parse(r.end)}];}catch{return [];}});
      }else{
        const results=await Promise.allSettled(choices.map(async s=>({id:s.id,...briefingLayerCycle(await json(cycleQuery(s),signal),s)})));
        candidates=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
      }
      const selected=chooseSlideLayer(mapping,candidates);
      if(request!==slideGeneration)return;
      slideNote=`Slide ${context.page} · ${mapping.note}`;open(selected.id,{history:false,fit:false,origin:'slide'});route(true);
    }catch(e){if(request===slideGeneration){slideNote=`Slide ${context.page} · ${e.message} Live overlay withheld.`;render();reportHealth('briefing-map','NWS briefing map layer',{checked:Date.now(),error:e.message,maxAgeMs:BRIEFING_LAYER_CHECK_MS,detail:'Automatic slide match unavailable'});}}
    finally{if(request===slideGeneration){followingBusy=false;next=Date.now()+5*60_000;}}
  }
  $('hanford-live-refresh').onclick=()=>{if(slideContext?.follow)void followSlide(slideContext);else if(active)void refresh();};
  const inWeather=()=>['weather','conditions'].includes(new URLSearchParams(location.search).get('view'));
  function tick(){if(document.hidden)return;if(slideContext?.follow&&slideMapping(slideContext).mapping){render();if(inWeather()&&Date.now()>=next&&!followingBusy)void followSlide(slideContext);return;}if(!active)return;render();if(Date.now()>=next&&!busy)void refresh();}
  setInterval(tick,30_000);document.addEventListener('visibilitychange',tick);window.addEventListener('online',()=>{if(slideContext?.follow&&inWeather())void followSlide(slideContext);else if(active)void refresh();});window.addEventListener('offline',()=>{slideGeneration++;slideAbort?.abort();followingBusy=false;if(active){generation++;abort?.abort();busy=false;error='Browser offline';render();}});
  window.addEventListener('popstate',()=>{const q=new URLSearchParams(location.search),id=q.get('briefingLayer');if(inWeather()&&slideContext?.follow)void followSlide(slideContext);else if(inWeather()&&BRIEFING_LAYERS.some(s=>s.id===id))open(id,{history:false,fit:false,origin:'route'});else if(active)stop(true,false);});
  if(exercise)picker.disabled=true;
  render();const initialQuery=new URLSearchParams(location.search),initial=initialQuery.get('briefingLayer');if(['weather','conditions'].includes(initialQuery.get('view'))&&BRIEFING_LAYERS.some(s=>s.id===initial))open(initial,{history:false,fit:false,origin:'route'});
  return {open,stop,followSlide,async setMap(controller){map=controller;try{const sdk=await loadSdk();[FeatureLayer,MediaLayer,ImageElement,ExtentAndRotationGeoreference,Extent]=await sdk.import(['@arcgis/core/layers/FeatureLayer.js','@arcgis/core/layers/MediaLayer.js','@arcgis/core/layers/support/ImageElement.js','@arcgis/core/layers/support/ExtentAndRotationGeoreference.js','@arcgis/core/geometry/Extent.js']);map.onViewChanged(render);if(active){map.setLayerPreference('briefingLayers',true);void refresh();}}catch(e){error=e.message;}render();}};
}
