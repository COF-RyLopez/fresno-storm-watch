import {BRIEFING_LAYERS,BRIEFING_LAYER_CHECK_MS,briefingLayerCycle,briefingLayerLegend} from './briefing-layer-model.js';
import {loadSdk} from './map.js';
import {formatTime} from './model.js';
import {reportHealth} from './source-health.js';
const $=id=>document.getElementById(id);
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** Public live services only. Tour state, source revisions and features stay in page memory. */
export function createBriefingLayers({timeZone,exercise=false,onOpen=()=>{},onMap=()=>{},onStart=()=>{},onStop=()=>{},onBriefing=()=>{}}){
  let map=null,FeatureLayer=null,index=0,active=false,busy=false,cycle=null,checked=null,error=null,generation=0,abort=null,next=0,legend=[];
  const layers=new Map(),failed=new Set(),step=()=>BRIEFING_LAYERS[index],time=t=>formatTime(t,timeZone);
  const picker=$('briefing-layer-select');
  for(const s of BRIEFING_LAYERS){const o=el('calcite-option',s.label);o.value=s.id;picker.append(o);}
  function disableLayers(){for(const l of layers.values())map?.setLayerEligibility(l,false);}
  function render(){
    const s=step(),l=layers.get(s.id),stale=!checked||Date.now()-checked>BRIEFING_LAYER_CHECK_MS,expired=cycle&&(Date.now()>=cycle.end||Date.now()-cycle.issue>s.maxAge),bad=!!error||stale||expired||failed.has(`${s.id}:${map?.view?.type}`);
    disableLayers();if(active&&cycle&&l&&!bad&&!busy)map?.setLayerEligibility(l,true);
    picker.value=s.id;$('briefing-layer-before').disabled=index===0||exercise;$('briefing-layer-after').disabled=index===BRIEFING_LAYERS.length-1||exercise;
    $('briefing-layer-start').textContent=active?'Show selected map':'Start map tour';$('briefing-layer-start').disabled=exercise;$('briefing-layer-stop').hidden=!active;$('briefing-layer-refresh').disabled=!active||busy||exercise;
    $('briefing-layer-meaning').textContent=s.meaning;$('briefing-layer-relation').textContent=s.relationship;
    $('briefing-layer-source').href=s.source;$('briefing-layer-service').href=`${s.service}/${s.layer}`;
    $('briefing-layer-times').textContent=cycle?`Issued ${time(cycle.issue)} · valid ${time(cycle.start)} → ${time(cycle.end)}. Checked ${time(checked)}.`:'Source forecast window will appear after checking the selected layer.';
    const status=exercise?'Live briefing layers disabled in exercise.':!active?'Tour off · select a step and start.':busy?'Checking source cycle and publisher legend…':error?`Map withheld · ${error}`:expired||stale?'Forecast ended or source check overdue · map withheld.':!map||!FeatureLayer||!l?'Map initializing…':failed.has(`${s.id}:${map.view.type}`)?'Map layer failed · use the official source.':'Latest source cycle · one briefing layer selected. No shading does not establish safe conditions.';
    $('briefing-layer-status').textContent=status;$('briefing-layer-status').dataset.tone=active&&bad&&!busy?'gap':'normal';
    $('briefing-layer-map-note').textContent=`${s.label} · ${status} ${cycle?`Valid ${time(cycle.start)} → ${time(cycle.end)}.`:''} Uses its own forecast window, not the shared slider.`;
    $('briefing-layer-legend-title').textContent=s.label+' · official NOAA legend';
    $('briefing-layer-legend').hidden=!active||bad||busy||!l;
    if(active&&!exercise)reportHealth('briefing-map','NWS briefing map layer',{checked,error:error||(expired?'Source forecast ended or issue overdue':failed.has(`${s.id}:${map?.view?.type}`)?'Map rendering failed':null),maxAgeMs:BRIEFING_LAYER_CHECK_MS,detail:s.label});
  }
  async function json(url,signal){const r=await fetch(url,{cache:'no-store',credentials:'omit',signal});if(!r.ok)throw new Error(`NOAA HTTP ${r.status}`);const d=await r.json();if(d.error)throw new Error(d.error.message||'NOAA service error');return d;}
  async function refresh(){
    if(!active||exercise||document.hidden)return;
    const request=++generation,s=step();abort?.abort();abort=new AbortController();const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(25_000)]);busy=true;error=null;render();
    try{
      const q=new URL(`${s.service}/${s.layer}/query`);q.search=new URLSearchParams({f:'json',where:'1=1',outFields:'product,issue_time,start_time,end_time'+(s.field==='qpf'?',units':''),returnGeometry:'false',returnDistinctValues:'true'});
      const [payload,metadata,legendPayload]=await Promise.all([json(q,signal),json(`${s.service}/${s.layer}?f=json`,signal),json(`${s.service}/legend?f=json`,signal)]);
      const candidate=briefingLayerCycle(payload,s),symbols=briefingLayerLegend(legendPayload,s);
      if(metadata.geometryType!=='esriGeometryPolygon'||metadata.drawingInfo?.renderer?.field1!==s.field)throw new Error('Source geometry or renderer changed; verification required.');
      if(request!==generation)return;
      if(FeatureLayer&&map){
        let layer=layers.get(s.id);
        if(!layer){layer=new FeatureLayer({url:`${s.service}/${s.layer}`,title:'NWS briefing · '+s.label,visible:false,definitionExpression:'1=0',opacity:0.72,outFields:['*'],popupTemplate:{title:s.label,content:[{type:'text',text:s.meaning+' Source times below are UTC.'},{type:'fields',fieldInfos:[{fieldName:s.field,label:s.field==='qpf'?'Liquid precipitation (inches)':s.field==='dn'?'Risk category code':'Winter impact'},...['issue_time','start_time','end_time'].map(fieldName=>({fieldName,label:fieldName.replaceAll('_',' ')+' (UTC)'}))]}]}});layers.set(s.id,layer);map.registerLayer('briefingLayers',layer,false);layer.on('layerview-create-error',e=>{failed.add(`${s.id}:${e.view.type}`);render();});layer.on('layerview-create',e=>{failed.delete(`${s.id}:${e.view.type}`);render();});}
        await layer.load();if(request!==generation)return;
        layer.definitionExpression=candidate.where;layer.refresh();
      }
      if(request!==generation)return;cycle=candidate;legend=symbols;checked=Date.now();
      const host=$('briefing-layer-symbols');host.replaceChildren(...legend.map(r=>{const n=el('span',r.label),img=el('img');img.src=r.image;img.alt='';img.width=24;img.height=24;n.prepend(img);return n;}));
    }catch(e){if(request===generation)error=e.message;}
    finally{if(request===generation){busy=false;next=Date.now()+5*60_000;render();}}
  }
  function route(){const u=new URL(location.href);if(active)u.searchParams.set('briefingLayer',step().id);else u.searchParams.delete('briefingLayer');if(u.href!==location.href)history.pushState({},'',u);}
  function open(id=step().id,{history:push=true,fit=true}={}){
    const i=BRIEFING_LAYERS.findIndex(s=>s.id===id);if(i<0||exercise)return;index=i;active=true;cycle=null;checked=null;error=null;onOpen();onStart();map?.setLayerPreference('briefingLayers',true);map?.clearEnvironmentPopup();$('briefing-layer-block').expanded=true;if(push)route();void refresh();if(fit){onMap();map?.fitEnvironment();}render();
  }
  function stop(resume=true,push=true){active=false;generation++;abort?.abort();busy=false;disableLayers();map?.setLayerPreference('briefingLayers',false);map?.clearEnvironmentPopup();if(resume)onStop();if(push)route();render();reportHealth('briefing-map','NWS briefing map layer',{checked:Date.now(),detail:'Tour off; live layer not requested.'});}
  picker.addEventListener('calciteSelectChange',e=>open(e.target.value));
  $('briefing-layer-start').onclick=()=>open();$('briefing-layer-before').onclick=()=>open(BRIEFING_LAYERS[Math.max(0,index-1)].id);$('briefing-layer-after').onclick=()=>open(BRIEFING_LAYERS[Math.min(BRIEFING_LAYERS.length-1,index+1)].id);
  $('briefing-layer-stop').onclick=()=>stop();$('briefing-layer-refresh').onclick=()=>void refresh();$('briefing-layer-slide').onclick=()=>onBriefing('archive',step().page);
  function tick(){if(document.hidden||!active)return;render();if(Date.now()>=next&&!busy)void refresh();}
  setInterval(tick,30_000);document.addEventListener('visibilitychange',tick);window.addEventListener('online',()=>{if(active)void refresh();});window.addEventListener('offline',()=>{if(active){generation++;abort?.abort();busy=false;error='Browser offline';render();}});
  window.addEventListener('popstate',()=>{const q=new URLSearchParams(location.search),id=q.get('briefingLayer');if(['weather','conditions'].includes(q.get('view'))&&BRIEFING_LAYERS.some(s=>s.id===id))open(id,{history:false,fit:false});else if(active)stop(true,false);});
  if(exercise)picker.disabled=true;
  render();const initialQuery=new URLSearchParams(location.search),initial=initialQuery.get('briefingLayer');if(['weather','conditions'].includes(initialQuery.get('view'))&&BRIEFING_LAYERS.some(s=>s.id===initial))open(initial,{history:false,fit:false});
  return {open,stop,async setMap(controller){map=controller;try{const sdk=await loadSdk();[FeatureLayer]=await sdk.import(['@arcgis/core/layers/FeatureLayer.js']);map.onViewChanged(render);if(active){map.setLayerPreference('briefingLayers',true);void refresh();}}catch(e){error=e.message;}render();}};
}
