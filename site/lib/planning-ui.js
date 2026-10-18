import { environmentalJson } from './environment-data.js';
import { planningPoints,evaluateAreas } from './planning-model.js';
import { fetchPlanningRain } from './planning-data.js';
import { planningExercise } from './planning-exercise.js';
import { formatTime } from './model.js';
import { riverValue } from './river-model.js';
import {appendScheduledReleases,noticeSummary} from './release-ui.js';

const $=id=>document.getElementById(id);
/** @param {string} tag @param {string} text @param {string} css @returns {HTMLElement} */
function el(tag,text='',css=''){const n=document.createElement(tag);n.textContent=text;n.className=css;return n;}
/** @param {string} text @param {string} href @returns {HTMLElement} */
function link(text,href){const n=el('a',text);n.href=href;n.target='_blank';n.rel='noopener noreferrer';return n;}

/** @param {object} options @returns {object} Fixed-area review banner; separate from official NWS alerts and team acknowledgements. */
export function createPlanningWatch({config,timeZone,exercise,onOpen,onMap=()=>{},onGauge,onConditions,onTrends=()=>{},onExercise=()=>{}}){
  let areaConfig=null,points=[],gaugeSettings=[],reservoirSettings=null,entries=new Map(),reservoirs={},rain=null,busy=false,next=0,map=null,signature='',scenario='combined';
  const expanded=new Set(),clock=Date.now();
  const time=t=>Number.isFinite(t)?formatTime(t,timeZone):'Unknown';
  const button=(text,fn)=>{const b=el('calcite-button',text);b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.addEventListener('click',fn);return b;};
  const reportTime=(sample,duration)=>duration==='D'?`Report date ${sample?.reportDate||'unknown'} · PST`:time(sample?.time);
  function cueSummary(r){return [r.threshold?'NWS threshold met/forecast':null,...r.scheduled.map(n=>noticeSummary(n,time)),...r.rising.map(g=>`${g.id} observed +${riverValue(g.assessment.trend.delta,g.gauge.observed.units)} / ${g.assessment.trend.hours.toFixed(1)} h`),...r.higher.map(g=>`${g.id} forecast +${riverValue(g.assessment.delta,g.gauge.forecast.units)} above observation`),...r.increased.map(s=>`${s.station} ${s.label} +${riverValue(s.delta,'cfs')} / ${s.hours.toFixed(1)} h`),r.rainfall.maximum!==null?`Rain sample max ${r.rainfall.maximum.toFixed(2)} in`:'Rain amount unknown'].filter(Boolean).join(' · ');}
  function renderEvidence(r,host){
    host.append(el('p',r.area.note,'watch-context'));
    host.append(el('h4','Rainfall forecast · WPC Days 1–3'));
    host.append(el('p',`Issued ${time(r.rainfall.cycle?.issue)} · valid ${time(r.rainfall.cycle?.start)} → ${time(r.rainfall.cycle?.end)}`));
    host.append(el('p',`Point checks ${time(r.rainfall.checked)}. Polygon labels at the listed stations; liquid equivalent, not a basin average or runoff estimate.`));
    for(const p of r.rainfall.samples)host.append(el('p',`${p.id} · ${p.name}: ${p.value===null?'Unknown':p.value.toFixed(2)+' in'} · ${p.reason}`));
    host.append(link('Official WPC forecast','https://www.wpc.ncep.noaa.gov/#page=qpf'));
    host.append(el('h4','Gauges · fixed next 72 hours'));
    if(!r.gauges.length)host.append(el('p','No downstream gauge connected. Confirm downstream observations with NWS and operators.','watch-gap'));
    for(const {id,gauge:g,assessment:a} of r.gauges){
      const section=el('section','','watch-evidence-source');section.append(el('strong',`${id} · ${g?.name||gaugeSettings.find(s=>s.id===id)?.name||id}`));
      section.append(el('p',a.observed?`Observed ${riverValue(a.observed.value,g.observed.units)} at ${time(a.observed.time)}${a.current?'':' · old/unverified'}`:'Observation unknown'));
      section.append(el('p',a.trend?`Observed change ${a.trend.delta>=0?'+':''}${riverValue(a.trend.delta,g.observed.units)} over ${a.trend.hours.toFixed(1)} h · ${time(a.trend.start)} → ${time(a.observed.time)}`:'Observed trend unknown; comparable current samples are required.'));
      section.append(el('p',a.forecastUsable?`Forecast high ${riverValue(a.peak.value,g.forecast.units)} first sampled ${time(a.peak.time)} · issued ${time(g.forecast.issued)}${a.partialWindow?' · forecast does not cover the full 72 hours':''}`:'Usable forecast unknown'));
      const published=[...(a.exceeded||[]).map(t=>`Observed ${t.level} ≥ ${riverValue(t.value,t.units)}`),...a.crossings.map(t=>`Forecast ${t.level} ≥ ${riverValue(t.value,t.units)} at sample ${time(t.time)}`)];
      if(published.length)section.append(el('p',published.join(' · '),'watch-threshold'));
      if(!a.thresholdKnown)section.append(el('p','NWS thresholds unknown.','watch-gap'));
      section.append(button('Gauge evidence',()=>onGauge(id)));host.append(section);
    }
    host.append(el('h4','Reservoir releases'));
    if(!r.releases.length)host.append(el('p','No release association configured for this area.'));
    for(const release of r.releases){
      host.append(el('strong',`${release.name} · ${release.label}`));
      host.append(el('p',release.sample?`${riverValue(release.sample.value,'cfs')} · ${reportTime(release.sample,release.duration)}${release.current?'':' · excluded from change cues'}`:'Reported release unknown'));
      host.append(el('p',release.delta===null?release.reason:`Change ${release.delta>=0?'+':''}${riverValue(release.delta,'cfs')} over ${release.hours.toFixed(1)} h; previous ${riverValue(release.prior.value,'cfs')} · ${reportTime(release.prior,release.duration)}`));
      if(release.source)host.append(link('CDEC source',release.source));
    }
    for(const schedule of r.schedules)appendScheduledReleases(host,schedule,time);
    if(r.gaps.length){host.append(el('h4','Coverage gaps'));for(const gap of r.gaps)host.append(el('p',gap,'watch-gap'));}
    host.append(el('p','County action thresholds are not configured. Small positive changes are review cues, not rapid-rise or flood-severity categories. Forecasts and observations may be related; they are not independent votes.','watch-context'));
  }
  function render(){
    if(!areaConfig)return;
    const rows=evaluateAreas({areas:areaConfig.areas,points,gaugeEntries:entries,riverConfig:config.rivers,reservoirs,rain,environmentConfig:config.environment});
    const reviews=rows.filter(r=>r.review),gaps=rows.filter(r=>r.gaps.length),rainOnly=rows.filter(r=>r.rank===2);
    const threshold=reviews.some(r=>r.threshold);
    const scheduleCues=[...new Map(rows.flatMap(r=>r.scheduled).map(n=>[n.key,n])).values()].sort((a,b)=>Number(b.phase==='upcoming')-Number(a.phase==='upcoming')||a.time-b.time);
    const title=reviews.length?`${reviews.length} river area${reviews.length===1?'':'s'} to review for possible prepositioning`:rainOnly.length?`${rainOnly.length} river area${rainOnly.length===1?' has':'s have'} forecast precipitation`:!rain?'Checking river-area evidence':gaps.length?'River-area review · evidence incomplete':'River-area review · no current change cue';
    const key=JSON.stringify([title,busy,rain,entries,reservoirs.snapshot?.generatedAt,reservoirs.error,rows.map(r=>[r.area.id,r.status,cueSummary(r),r.gaps,r.gauges.map(g=>[g.assessment.current,g.assessment.forecastUsable,g.assessment.observed,g.assessment.peak]),r.releases.map(s=>[s.sample,s.delta,s.current])])]);
    $('watch-check-time').textContent=`${exercise?'Fictional exercise · ':''}Evaluated ${time(Date.now())} · fixed six-area scope`;
    $('watch-refresh').toggleAttribute('loading',busy);$('watch-refresh').toggleAttribute('disabled',busy||exercise);
    if(key===signature)return;signature=key;
    $('river-title').textContent=(exercise?'EXERCISE · ':'')+title;
    $('river-summary').textContent=`${scheduleCues.length?`${scheduleCues.length} scheduled release notice${scheduleCues.length===1?'':'s'} to review. ${noticeSummary(scheduleCues[0],time)}. `:''}${reviews.length?reviews.slice(0,2).map(r=>r.area.name).join(' · ')+(reviews.length>2?` · +${reviews.length-2} more`:'')+' — ':''}${gaps.length}/6 areas have evidence gaps. Review cues are not deployment instructions. County action thresholds remain unset.`;
    $('river-banner').setAttribute('kind',threshold?'danger':reviews.length||gaps.length?'warning':'info');
    $('review-areas').setAttribute('text',`Review areas${reviews.length?' ('+reviews.length+')':''}`);
    $('view-watch').setAttribute('text',reviews.length?`Area watch · ${reviews.length}`:'Area watch');
    $('view-watch').toggleAttribute('indicator',reviews.length>0);
    $('watch-rule-summary').textContent=`${reviews.length} for review · ${rainOnly.length} rain-only · ${gaps.length} with gaps. Fixed six-area scope.`;
    const host=$('area-watch-list');host.replaceChildren();
    for(const r of rows){
      const card=el('calcite-block','','area-watch-card');card.dataset.tone=r.threshold?'threshold':r.review?'review':r.gaps.length?'gap':'monitor';
      card.setAttribute('heading',r.area.name);card.setAttribute('heading-level','3');card.setAttribute('description',r.status);card.setAttribute('expanded','');
      card.setAttribute('icon-start',r.threshold?'exclamation-mark-triangle':r.review?'exclamation-mark-circle':r.gaps.length?'information':'water-drop');
      card.append(el('p',cueSummary(r),'area-watch-summary'));
      const actions=el('div','','environment-actions');
      const mapButton=button('Map watchpoints',()=>{onMap();map?.focusPlanningPoints(points.filter(p=>r.area.rainPoints.includes(p.id)));});mapButton.setAttribute('icon-start','extent');mapButton.toggleAttribute('disabled',!map);
      actions.append(mapButton);
      if(r.area.id==='san-joaquin-lower'||r.area.id==='kings-lower')actions.append(button('Release & gauge trends',()=>onTrends(r.area.id==='san-joaquin-lower'?'MIL':'PNF')));
      card.append(actions);
      const evidence=el('calcite-block','','area-watch-evidence');evidence.id=`evidence-${r.area.id}`;
      evidence.setAttribute('heading','Source evidence');evidence.setAttribute('heading-level','4');evidence.setAttribute('description',`${r.gaps.length} evidence gap${r.gaps.length===1?'':'s'} · values, times and sources`);evidence.setAttribute('collapsible','');evidence.toggleAttribute('expanded',expanded.has(r.area.id));
      evidence.addEventListener('calciteBlockExpand',()=>expanded.add(r.area.id));evidence.addEventListener('calciteBlockCollapse',()=>expanded.delete(r.area.id));
      renderEvidence(r,evidence);card.append(evidence);
      host.append(card);
    }
  }
  async function refreshRain(){
    if(busy||exercise||document.hidden||!points.length)return;
    busy=true;render();
    try{rain=await fetchPlanningRain(points);}catch(error){rain={...rain,error:error.message};}
    finally{busy=false;next=Date.now()+config.environment.pollMs;render();}
  }
  function applyExercise(){const fixture=planningExercise(gaugeSettings,points,reservoirSettings,scenario,clock);entries=fixture.entries;rain=fixture.rain;reservoirs=fixture.reservoirs;onExercise(entries,reservoirs);render();}
  $('review-areas').addEventListener('click',onOpen);
  $('watch-refresh').addEventListener('click',()=>void refreshRain());
  $('watch-conditions').addEventListener('click',onConditions);
  $('watch-exercise').hidden=!exercise;
  for(const b of document.querySelectorAll('[data-watch-scenario]'))b.addEventListener('click',()=>{scenario=b.dataset.watchScenario;for(const control of document.querySelectorAll('[data-watch-scenario]'))control.setAttribute('aria-pressed',String(control===b));applyExercise();});
  const tick=()=>{if(document.hidden)return;render();if(!exercise&&Date.now()>=next)void refreshRain();};
  setInterval(tick,30_000);document.addEventListener('visibilitychange',tick);
  window.addEventListener('online',()=>{next=0;tick();});
  window.addEventListener('offline',()=>{rain={...rain,error:'Browser offline'};reservoirs={...reservoirs,error:'Browser offline'};for(const [id,e]of entries)entries.set(id,{...e,error:'Browser offline'});render();});
  void Promise.all(['river-areas','river-watchlist','reservoir-watchlist'].map(name=>environmentalJson(new URL(`../data/${name}.json`,import.meta.url)))).then(([areas,gauges,res])=>{
    points=planningPoints(areas,gauges.stations,res.stations);areaConfig=areas;gaugeSettings=gauges.stations;reservoirSettings=res;
    if(exercise)applyExercise();else{render();void refreshRain();}
  }).catch(error=>{$('river-title').textContent='River-area review unavailable';$('river-summary').textContent=error.message;$('watch-rule-summary').textContent=error.message;});
  return {setMap:controller=>{map=controller;signature='';render();},setRiverData:data=>{if(!exercise){entries=new Map(data.entries);render();}},setReservoirData:data=>{if(!exercise){reservoirs=data;render();}}};
}
