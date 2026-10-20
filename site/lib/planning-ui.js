import {reportHealth} from './source-health.js';
import { environmentalJson } from './environment-data.js';
import { planningPoints,evaluateAreas } from './planning-model.js';
import { fetchPlanningRain } from './planning-data.js';
import { planningExercise } from './planning-exercise.js';
import { formatTime } from './model.js';
import { riverValue } from './river-model.js';
import {appendScheduledReleases,noticeSummary} from './release-ui.js';
import {combineAreaConcerns,validateAreaConcerns} from './area-concern-model.js';
import {windCompass} from './weather-model.js';
import {POWER_STATES} from './power-model.js';
import {areaConcernExercise} from './area-concern-exercise.js';

const $=id=>document.getElementById(id);
/** @param {string} tag @param {string} text @param {string} css @returns {HTMLElement} */
function el(tag,text='',css=''){const n=document.createElement(tag);n.textContent=text;n.className=css;return n;}
/** @param {string} text @param {string} href @returns {HTMLElement} */
function link(text,href){const n=el('a',text);n.href=href;n.target='_blank';n.rel='noopener noreferrer';return n;}

/** @param {object} options @returns {object} Fixed-area review banner; separate from official NWS alerts and team acknowledgements. */
export function createPlanningWatch({config,timeZone,exercise,onOpen,onMap=()=>{},onGauge,onConditions,onPower=()=>{},onSummary=()=>{},onTrends=()=>{},onExercise=()=>{},onData=()=>{}}){
  let areaConfig=null,points=[],gaugeSettings=[],reservoirSettings=null,entries=new Map(),reservoirs={},rain=null,busy=false,next=0,map=null,signature='',scenario='combined';
  let associations=null,windSites=[],wind=null,power=null,previousRows=[],filterMode='review';
  const expanded=new Set(),clock=Date.now();
  const time=t=>Number.isFinite(t)?formatTime(t,timeZone):'Unknown';
  const button=(text,fn)=>{const b=el('calcite-button',text);b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.addEventListener('click',fn);return b;};
  const reportTime=(sample,duration)=>duration==='D'?`Report date ${sample?.reportDate||'unknown'} · PST`:time(sample?.time);
  function cueSummary(r){return [r.threshold?'NWS threshold met/forecast':null,...r.scheduled.map(n=>noticeSummary(n,time)),...r.rising.map(g=>`${g.id} observed +${riverValue(g.assessment.trend.delta,g.gauge.observed.units)} / ${g.assessment.trend.hours.toFixed(1)} h`),...r.higher.map(g=>`${g.id} forecast +${riverValue(g.assessment.delta,g.gauge.forecast.units)} above observation`),...r.increased.map(s=>`${s.station} ${s.label} +${riverValue(s.delta,'cfs')} / ${s.hours.toFixed(1)} h`),r.rainfall.maximum!==null?`Rain sample max ${r.rainfall.maximum.toFixed(2)} in`:'Rain amount unknown'].filter(Boolean).join(' · ');}
  const windSummary=r=>r.wind.gust?`72h gust sample max ${Math.round(r.wind.gust.value)} mph · ${r.wind.gust.id} · ${time(r.wind.gust.start)}`:'72h gust forecast unknown';
  function renderConcerns(r,host){
    host.append(el('h4','Wind & gust context · fixed next 72 hours'),el('p',r.association.note),el('p',`${time(r.wind.start)} → ${time(r.wind.end)} · app checked ${time(r.wind.checked)}`));
    for(const s of r.wind.samples){
      host.append(el('strong',`${s.id} · ${s.name}`),el('p',`Forecast updated ${time(s.issued)} · source collected ${time(s.lastSuccess)}`));
      for(const [key,label] of [['windGust','Gust'],['windSpeed','Sustained']]){
        const p=s[key].peak;host.append(el('p',p?`${label} maximum ${Math.round(p.value)} mph · source interval ${time(p.sourceStart)} → ${time(p.sourceEnd)} · ${s[key].hours.toFixed(1)}/72 h with values`:`${label} unknown`));
      }
      if(s.gustDirection!==null)host.append(el('p',`From ${windCompass(s.gustDirection)} (${Math.round(s.gustDirection)}°) at first gust maximum. Sustained and gust maxima may occur at different times.`));
      host.append(link('Official NWS point forecast',`https://forecast.weather.gov/MapClick.php?lat=${s.latitude}&lon=${s.longitude}`));
    }
    host.append(el('p','Wind values are forecast context, not a high-wind category. No local wind trigger is set. Coverage between points is unknown.'));
    host.append(el('h4','PSPS / outage polygons at configured watchpoints'),el('p',`${r.samplePoints.length} gauge, dam and wind points tested · app checked ${time(r.power.checked)}. Polygon containment includes boundaries; there are no proximity buffers or complete river-corridor footprints.`));
    if(!r.power.matches.length)host.append(el('p','No utility polygon match returned at these points. This is not an all-clear for the reach, power supply or facilities.'));
    for(const m of r.power.matches){
      const record=m.row,pair=r.paired.find(p=>p.key===record.key);
      host.append(el('strong',`${record.utility} · ${POWER_STATES[record.status]} · ${record.name}`),el('p',`Watchpoints: ${m.points.map(p=>p.id).join(', ')} · ${m.eligible?'Current source check; utility status retained':'Context / verification required'}`));
      host.append(el('p',`Utility updated ${time(record.updated.time)}${!record.updated.time&&record.updated.text?` · ${record.updated.text} (publisher text; time zone unconfirmed)`:''} · source retrieved ${time(Date.parse(power?.feeds.find(f=>f.id===record.feedId)?.lastSuccess))}`));
      host.append(el('p',`Published timing start ${time(record.start.time)} · end ${time(record.end.time)}. This timing window is not an expected outage duration or restoration confirmation.`));
      if(m.problem)host.append(el('p',m.problem,'watch-gap'));
      if(pair)host.append(el('p',pair.gust?`At a wind point inside this PSPS polygon, forecast gust max ${Math.round(pair.gust.value)} mph (${pair.gust.id}) during the published window · ${time(pair.gust.start)} → ${time(pair.gust.end)}.`:pair.window?'No usable gust interval at a wind point inside this polygon during its published window. Other area wind values are nearby context.':'PSPS start/end window is incomplete or unconfirmed; simultaneous timing cannot be established.'));
      host.append(link('Official utility map',record.official));
    }
    for(const m of r.power.followups)host.append(el('p',`${m.row.utility} · ${m.row.name}: a previous watchpoint match changed, moved or is no longer returned. Confirm current utility and site conditions; this is not proof of restoration. Follow-up retained in this tab only.`,'watch-gap'));
    if(r.power.pointOnly)host.append(el('p',`${r.power.pointOnly} county power records have only point geometry and cannot establish affected footprints. They are not assigned to a reach by proximity.`));
    host.append(el('p','PSPS / river co-location is a coordination cue, not proof of simultaneous conditions. River arrival times are not modeled. Suggested Planning / Operations review: confirm utility timing, river/operator guidance, facility backup power, resource lead time and staging access before recommending prepositioning.'));
  }
  function renderEvidence(r,host){
    host.append(el('p',r.area.note,'watch-context'));
    renderConcerns(r,host);
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
    if(!exercise)for(const p of points)reportHealth('wpc-point:'+p.id,'WPC rainfall sample · '+p.name,{checked:rain?.checked,error:rain?.error||rain?.points?.[p.id]?.error||(!Number.isFinite(rain?.points?.[p.id]?.value)?'Forecast amount unknown':rain?.cycle?.end<=Date.now()?'Forecast window ended':Date.now()-rain?.cycle?.issue>config.environment.qpfMaxAgeMs?'Forecast issue is old':null),maxAgeMs:config.environment.weatherCheckMaxAgeMs});
    const riverRows=evaluateAreas({areas:areaConfig.areas,points,gaugeEntries:entries,riverConfig:config.rivers,reservoirs,rain,environmentConfig:config.environment});
    const rows=combineAreaConcerns({rows:riverRows,associations,windSites,points,wind,power,previous:previousRows});previousRows=rows;
    onSummary(rows.filter(r=>r.review).length);map?.setPlanningData(rows,filterMode);
    onData({rows,points});
    const reviews=rows.filter(r=>r.review),gaps=rows.filter(r=>r.gaps.length),rainOnly=rows.filter(r=>r.rank===2);
    const overlaps=rows.filter(r=>r.pspsRiver),verification=rows.filter(r=>r.power.verification.length);
    const threshold=reviews.some(r=>r.threshold);
    const scheduleCues=[...new Map(rows.flatMap(r=>r.scheduled).map(n=>[n.key,n])).values()].sort((a,b)=>Number(b.phase==='upcoming')-Number(a.phase==='upcoming')||a.time-b.time);
    const title=overlaps.length?`${overlaps.length} river area${overlaps.length===1?' has':'s have'} PSPS + river cues to review`:reviews.length?`${reviews.length} river area${reviews.length===1?'':'s'} to review for possible prepositioning`:rainOnly.length?`${rainOnly.length} river area${rainOnly.length===1?' has':'s have'} forecast precipitation`:!rain?'Checking river-area evidence':gaps.length?'River-area review · evidence incomplete':'River-area review · no current change cue';
    const key=JSON.stringify([filterMode,title,busy,rain,reservoirs.snapshot?.generatedAt,reservoirs.error,rows.map(r=>[r.area.id,r.status,cueSummary(r),r.gaps,r.wind,r.paired,r.power.matches.map(m=>[m.row.key,m.row.revision,m.problem,m.eligible]),r.power.followups.map(m=>m.row.key),r.power.checked,r.gauges.map(g=>[g.assessment.current,g.assessment.forecastUsable,g.assessment.observed,g.assessment.peak]),r.releases.map(s=>[s.sample,s.delta,s.current])])]);
    $('watch-check-time').textContent=`${exercise?'Fictional exercise · ':''}Evaluated ${time(Date.now())} · fixed six-area scope`;
    $('watch-refresh').toggleAttribute('loading',busy);$('watch-refresh').toggleAttribute('disabled',busy||exercise);
    if(key===signature)return;signature=key;
    $('river-title').textContent=(exercise?'EXERCISE · ':'')+title;
    const focus=(overlaps.length?overlaps:reviews).slice(0,2),windPeak=rows.filter(r=>r.wind.gust).sort((a,b)=>b.wind.gust.value-a.wind.gust.value)[0];
    $('river-summary').textContent=`${focus.length?focus.map(r=>`${r.area.name}: ${windSummary(r)}`).join(' · '):windPeak?windSummary(windPeak):'Wind context unknown'}. ${scheduleCues.length?`${scheduleCues.length} scheduled release notice(s) to review. `:''}Known PSPS + river matches at watchpoints: ${overlaps.length}${rows.some(r=>r.power.gaps.length)?' (utility coverage incomplete)':''} · ${verification.length} ${verification.length===1?'area needs':'areas need'} power verification · ${gaps.length}/6 with evidence gaps. Review cues are not deployment instructions.`;
    $('river-banner').setAttribute('kind',threshold?'danger':reviews.length||gaps.length?'warning':'info');
    $('review-areas').setAttribute('text',`Review areas${reviews.length?' ('+reviews.length+')':''}`);
    $('view-watch').setAttribute('text',reviews.length?`Area watch · ${reviews.length}`:'Area watch');
    $('view-watch').toggleAttribute('indicator',reviews.length>0);
    $('watch-rule-summary').textContent=`${reviews.length} review · ${overlaps.length} PSPS + river · ${verification.length} power verification · ${gaps.length} with gaps`;
    const host=$('area-watch-list');host.replaceChildren();if(filterMode==='review'&&!reviews.length)host.append(el('p','No current review cues returned. Check source issues or choose All areas; this is not an all-clear.','empty-state'));
    for(const r of rows.filter(r=>filterMode==='all'||r.review)){
      const card=el('calcite-block','','area-watch-card');card.dataset.tone=r.threshold?'threshold':r.review?'review':r.gaps.length?'gap':'monitor';
      const heading=el('h3');const location=button(r.area.name,()=>{onMap();map?.focusPlanningPoints(r.samplePoints);});location.setAttribute('icon-start','cube');location.toggleAttribute('disabled',!map);location.title='Locate river watchpoints in 3D';heading.append(location);card.append(heading,el('p',r.status));card.setAttribute('expanded','');
      card.setAttribute('icon-start',r.threshold?'exclamation-mark-triangle':r.review?'exclamation-mark-circle':r.gaps.length?'information':'water-drop');
      card.append(el('p',cueSummary(r),'area-watch-summary'));
      const compound=el('div','','area-concern-summary');compound.append(el('strong',windSummary(r)),el('p',`River: ${r.riverReview?'review cue':'no current cue; check gaps'} · PSPS: ${r.power.psps.length} polygon record(s) at watchpoints · outages: ${r.power.outages.length} polygon record(s) · power verification: ${r.power.verification.length}${r.power.gaps.length?' · utility coverage incomplete':''}`));
      if(r.pspsRiver)compound.append(el('p',r.windContext?'PSPS + river cues with wind forecast context. Verify timing and local impacts.':'PSPS + river cues; wind forecast context is unknown.','watch-threshold'));
      card.append(compound);
      const actions=el('div','','environment-actions');
      const mapButton=button('Map watchpoints',()=>{onMap();map?.focusPlanningPoints(r.samplePoints);});mapButton.setAttribute('icon-start','extent');mapButton.toggleAttribute('disabled',!map);
      actions.append(mapButton);
      actions.append(button('Wind forecasts',onConditions));
      if(r.power.matches.length||r.power.followups.length)actions.append(button('Power / PSPS records',onPower));
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
  function applyExercise(){const fixture=planningExercise(gaugeSettings,points,reservoirSettings,['overlap','timing'].includes(scenario)?'combined':scenario,clock);entries=fixture.entries;rain=fixture.rain;reservoirs=fixture.reservoirs;({wind,power}=areaConcernExercise(windSites,scenario,clock));previousRows=[];onExercise(entries,reservoirs);render();}
  $('area-filter').addEventListener('calciteSelectChange',e=>{filterMode=e.target.value;render();});
  $('review-areas').addEventListener('click',onOpen);
  $('watch-refresh').addEventListener('click',()=>void refreshRain());
  $('watch-conditions').addEventListener('click',onConditions);
  $('watch-exercise').hidden=!exercise;
  for(const b of document.querySelectorAll('[data-watch-scenario]'))b.addEventListener('click',()=>{scenario=b.dataset.watchScenario;for(const control of document.querySelectorAll('[data-watch-scenario]'))control.setAttribute('aria-pressed',String(control===b));applyExercise();});
  const tick=()=>{if(document.hidden)return;render();if(!exercise&&Date.now()>=next)void refreshRain();};
  setInterval(tick,30_000);document.addEventListener('visibilitychange',tick);
  window.addEventListener('online',()=>{next=0;tick();});
  window.addEventListener('offline',()=>{rain={...rain,error:'Browser offline'};reservoirs={...reservoirs,error:'Browser offline'};wind={...wind,error:'Browser offline'};power={...power,error:'Browser offline'};for(const [id,e]of entries)entries.set(id,{...e,error:'Browser offline'});render();});
  void Promise.all(['river-areas','river-watchlist','reservoir-watchlist','wind-watchlist','area-concerns'].map(name=>environmentalJson(new URL(`../data/${name}.json`,import.meta.url)))).then(([areas,gauges,res,winds,concerns])=>{
    points=planningPoints(areas,gauges.stations,res.stations);associations=validateAreaConcerns(concerns,areas.areas,winds.sites);windSites=winds.sites;areaConfig=areas;gaugeSettings=gauges.stations;reservoirSettings=res;
    if(exercise)applyExercise();else{render();void refreshRain();}
  }).catch(error=>{$('river-title').textContent='River-area review unavailable';$('river-summary').textContent=error.message;$('watch-rule-summary').textContent=error.message;});
  return {selectArea:id=>{filterMode='all';for(const o of $('area-filter').children)o.selected=o.getAttribute('value')==='all';expanded.add(id);signature='';render();$('evidence-'+id)?.scrollIntoView({block:'nearest'});const row=previousRows.find(r=>r.area.id===id);if(row){onMap();map?.focusPlanningPoints(row.samplePoints);}},setMap:controller=>{map=controller;signature='';render();},setRiverData:data=>{if(!exercise){entries=new Map(data.entries);render();}},setReservoirData:data=>{if(!exercise){reservoirs=data;render();}},setWindData:data=>{if(!exercise){wind=data;render();}},setPowerData:data=>{if(!exercise){power=data;render();}}};
}
