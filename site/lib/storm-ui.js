import {stormFocus,ageLabel,TIERS,FOCUS,STORM_CONFIG} from './storm-focus-model.js';
import {fetchUsgs,parseUsgsIv,usgsReading} from './usgs-gauges.js';
import {reportHealth} from './source-health.js';
import {el,elAttrs,link} from './dom.js';

const $=id=>document.getElementById(id);
const RAIN=Object.freeze({'Off':'off','Radar':'radar','72-h forecast':'qpf'});
/** Storm now panel: renders stormFocus() rows and its visible controls. Rows open existing evidence through onOpen. */
export function createStormNow({exercise=false,timeZone,onOpen=()=>{},onRain=()=>{},onCameras=()=>{}}={}){
  const inputs={alerts:[],alertCheck:null,areas:[],drainage:null,signedIn:false,roads:null,usgs:null,watchlist:[]};
  let focus='all',map=null,signature='',rows=[];
  const clock=new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const time=t=>t===null?'source time unavailable':clock.format(t);
  function render(){
    rows=stormFocus({...inputs,focus},Date.now());
    const next=JSON.stringify([focus,rows.map(r=>[r.key,r.tier,r.why,r.time,r.stale,r.tag,Math.floor((r.age??0)/60_000)])]);
    if(next===signature)return;signature=next;
    const list=$('storm-list');list.replaceChildren();
    $('storm-count').textContent=`${rows.length} ${rows.length===1?'place':'places'} · ${FOCUS[focus]}`;
    if(!rows.length){const p=el('p','No place meets the rules — not an all-clear. Keep checking NWS and field reports.');p.slot='empty-content';p.className='storm-empty';list.append(p);}
    for(const r of rows){
      const tier=TIERS[r.tier],row=elAttrs('calcite-list-item','',{label:r.place,description:r.why,value:r.key});
      row.append(elAttrs('calcite-chip',tier.label,{slot:'content-end',icon:tier.icon,label:`Tier: ${tier.label}`,scale:'s',kind:r.tier<=2?'brand':'neutral',class:'storm-tier storm-tier-'+r.tier}));
      const meta=el('div');meta.slot='content-bottom';meta.className='storm-meta';
      meta.append(el('span',`${r.source} · ${time(r.time)} · ${ageLabel(r.age)}`));
      if(r.stale)meta.append(elAttrs('calcite-chip','Old',{label:'Old evidence',icon:'clock',scale:'s',appearance:'outline'}));
      if(r.tag)meta.append(elAttrs('calcite-chip',r.tag,{label:r.tag,icon:'exclamation-mark-triangle',scale:'s',appearance:'outline'}));
      row.append(meta);list.append(row);
    }
    map?.setUsgsGauges(inputs.watchlist.map(s=>({...s,reading:inputs.usgs?.readings?.get(s.site)||null})));
  }
  function open(key){
    const r=rows.find(r=>r.key===key);if(!r)return;
    if(r.open.kind==='usgs'||r.open.kind==='creek')return showGauge(r.open.id);
    onOpen(r.open);
  }
  function showGauge(id){
    const host=$('usgs-detail'),s=inputs.watchlist.find(s=>s.site===id);host.replaceChildren();
    if(!s){$('usgs-evidence').heading=id;host.append(el('p',`${id} has no live gauge in this app. Check FMFCD and field reports.`),el('p','Add an active USGS site for this creek to data/usgs-watchlist.json to replace this row.'));$('usgs-evidence').setAttribute('open','');map?.fitExtent(STORM_CONFIG.extents.creeks);return;}
    const r=inputs.usgs?.readings?.get(id);$('usgs-evidence').heading=s.name;
    const facts=[['USGS site',s.site],['Latest stage',r?.stage?`${r.stage.value.toFixed(2)} ft · ${time(r.stage.time)} · ${ageLabel(Date.now()-r.stage.time)}`:'Not returned'],['Latest flow',r?.flow?`${Math.round(r.flow.value).toLocaleString('en-US')} cfs · ${time(r.flow.time)}`:'Not returned'],['Rise (~3 h)',r?.rise?`${r.rise.delta>=0?'+':''}${r.rise.delta.toFixed(2)} ft in ${r.rise.hours.toFixed(1)} h · ${r.rise.rate.toFixed(2)} ft/h`:'Not computable'],['Flood stage',Number.isFinite(s.floodStageFt)?`${s.floodStageFt} ft`:'Not configured · rate of rise only'],['Last USGS check',inputs.usgs?.checked?time(inputs.usgs.checked):'None'+(inputs.usgs?.error?` · ${inputs.usgs.error}`:'')]];
    const dl=el('dl');for(const [k,v]of facts)dl.append(el('dt',k),el('dd',v));host.append(dl);
    if(exercise)host.append(el('p','Fictional exercise values from a constructed fixture, not a USGS reading.'));
    if(!s.verified)host.append(el('p','Site number and location not yet confirmed against the USGS site service.'));
    host.append(el('p','Provisional USGS data. Planning aid, not an alert service.'),link(`USGS ${s.site} monitoring location page (opens new tab) ↗`,`https://waterdata.usgs.gov/monitoring-location/USGS-${s.site}/`));
    $('usgs-evidence').setAttribute('open','');
    map?.focusReferenceGeometry({x:s.longitude,y:s.latitude,spatialReference:{wkid:4326}},35000);
  }
  async function refreshUsgs(){
    if(!inputs.watchlist.length)return;
    try{
      let readings;
      if(exercise){const json=await fetch(new URL('../data/usgs-iv-exercise.json',import.meta.url)).then(r=>r.json()),parsed=parseUsgsIv(json),shift=Date.now()-10*60_000-Math.max(...[...parsed.values()].flatMap(s=>s.stage.map(p=>p.time)));
        for(const s of parsed.values())for(const k of ['stage','flow'])s[k]=s[k].map(p=>({...p,time:p.time+shift}));readings=new Map([...parsed].map(([k,s])=>[k,usgsReading(s)]));}
      else readings=await fetchUsgs(inputs.watchlist.map(s=>s.site));
      inputs.usgs={readings,checked:Date.now(),error:null};
    }catch(e){inputs.usgs={readings:inputs.usgs?.readings||new Map(),checked:inputs.usgs?.checked??null,error:e.message||'USGS check failed'};}
    if(!exercise)reportHealth('usgs-iv','USGS stream gauges',{checked:inputs.usgs.checked,error:inputs.usgs.error,maxAgeMs:420_000});
    render();
  }
  // Calcite 5.1.1 segmented-control items take their accessible name from `value`, so values are the visible labels.
  $('storm-focus').addEventListener('calciteSegmentedControlChange',e=>{
    focus=Object.keys(FOCUS).find(k=>FOCUS[k]===e.target.value)||'all';render();
    if(!map)return;for(const [key,on]of Object.entries(STORM_CONFIG.presets[focus]))map.setLayerPreference(key,on);
    if(focus==='all')void map.fit();else void map.fitExtent(STORM_CONFIG.extents[focus]);
  });
  $('storm-rain').addEventListener('calciteSegmentedControlChange',e=>onRain(RAIN[e.target.value]||'off'));
  for(const sw of document.querySelectorAll('#storm-layers calcite-switch'))sw.addEventListener('calciteSwitchChange',()=>sw.dataset.contextLayer==='cameras'?onCameras(sw.checked):map?.setLayerPreference(sw.dataset.contextLayer,sw.checked));
  $('storm-list').addEventListener('calciteListItemSelect',e=>open(e.target.value));
  $('storm-issues').addEventListener('click',()=>$('notify-health').click());
  window.addEventListener('frogUsgsSelect',e=>showGauge(e.detail.id));
  // Controls stay pinned above the list on desk screens; on phones / short screens they scroll with it so rows stay reachable.
  const short=matchMedia('(max-width:900px),(max-height:760px)'),place=()=>{$('storm-controls').slot=short.matches?'':'content-top';};short.addEventListener('change',place);place();
  setInterval(()=>{if(!document.hidden)render();},60_000);
  setInterval(()=>{if(!document.hidden)void refreshUsgs();},300_000);
  void fetch(new URL('../data/usgs-watchlist.json',import.meta.url)).then(r=>r.json()).then(w=>{inputs.watchlist=w.sites;render();return refreshUsgs();}).catch(e=>{inputs.usgs={readings:new Map(),checked:null,error:'Watchlist unavailable: '+e.message};render();});
  render();
  return {
    set(values){Object.assign(inputs,values);render();},
    setMap(controller){map=controller;signature='';render();},
    setIssues(n){$('storm-issues').textContent=n===null?(exercise?'Source health · exercise':'Source issues · checking'):`${n} source ${n===1?'issue':'issues'}`;$('storm-issues').setAttribute('icon-start',n?'exclamation-mark-triangle':'information');},
    setOverlay(kind){const label=Object.keys(RAIN).find(k=>RAIN[k]===kind);for(const item of $('storm-rain').children)item.checked=item.getAttribute('value')===label;}
  };
}
