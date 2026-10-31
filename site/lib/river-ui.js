import {reportHealth} from './source-health.js?v=0.73.1';
import { fetchJson } from './nws.js';
import { fetchRiverWatch } from './nwps.js';
import { assessGauge, riverValue, formatRiverTime } from './river-model.js';
import { riverChart } from './river-chart.js';
import { exerciseRivers } from './river-exercise.js';
import { TREND_REACHES } from './release-trend-model.js';

const $=id=>document.getElementById(id);
/** @param {string} tag @param {string} text @param {object} attributes @returns {HTMLElement} */
function el(tag,text='',attributes={}) { const n=document.createElement(tag);n.textContent=text;for(const[k,v]of Object.entries(attributes))if(v!==false&&v!==null)n.setAttribute(k,v===true?'':String(v));return n; }
/** @param {object} options @returns {Promise<object>} River feed is independent from the weather-alert feed and map. */
export async function createRiverWatch({config,timeZone,exercise,onOpen,onMap=()=>{},onTrends=()=>{},onData=()=>{}}) {
  let stations=[], entries=new Map(), busy=false, map=null, selected=null, timer, next=null, lastAttempt=null, scenario='baseline', horizon=config.defaultHorizonHours, basin='All';
  const exerciseClock=Date.now();
  const time=value=>formatRiverTime(value,timeZone);
  let lastAgeSignature='';
  const ageSignature=all=>JSON.stringify(all.map(({assessment:a})=>[a.current,a.forecastUsable,a.label,a.peak,a.partialWindow,a.gaps]));
  const updateCheckTime=()=>{$('river-check-time').textContent=`Last attempt: ${time(lastAttempt)}${exercise?' · exercise data':next?` · next check in ${Math.max(0,Math.ceil((next-Date.now())/1000))}s`:''}`;};
  const rows=()=>stations.map(station=>{
    const entry=entries.get(station.id);
    return {station,gauge:entry?.gauge??null,assessment:assessGauge(entry?.gauge,config,horizon,Date.now(),entry?.error??null)};
  });
  const paintMap=()=>{const data=rows();map?.updateGauges(data,basin);if(!exercise)for(const r of data){const a=r.assessment,g=r.gauge;reportHealth('nwps:'+r.station.id,'NWPS · '+r.station.name,{checked:g?.fetched,error:a.error,state:!g?'checking':!g.inService?'coverage':!a.current?(a.observed?'stale':'coverage'):!a.forecastUsable?(a.future.length?'stale':'coverage'):'current',detail:!a.current||!a.forecastUsable?a.gaps.join('. '):'Observation and published forecast usable in the planning window.',maxAgeMs:config.staleMs});}};
  const detail=()=>{
    const host=$('river-detail');host.replaceChildren();
    const row=rows().find(r=>r.station.id===selected);
    if(!row){host.append(el('p','Select a gauge to compare its observation, forecast and planning gaps.'));return;}
    const {gauge:g,assessment:a,station:s}=row;
    host.append(el('h3',g?.name||s.name),el('p',`${s.id} · ${s.basin} · ${s.scopeRole||'Fresno river reach'}`,{class:'muted'}),el('p',`Publisher county label: ${g?.county||s.county}`,{class:'muted'}));
    const zoom=el('calcite-button','Inspect FEMA vicinity',{scale:'s',appearance:'outline',disabled:!map,'icon-start':'extent'});
    zoom.addEventListener('click',()=>{onMap();map?.focusGauge(s.id);});
    host.append(zoom);
    if(TREND_REACHES.MIL.gauges.includes(s.id)){
      const trends=el('calcite-button','Compare with Millerton releases',{scale:'s',appearance:'outline'});trends.addEventListener('click',()=>onTrends('MIL',s.id));host.append(trends);
    }
    if(!g){
      host.append(el('p',a.error||'No successful data query for this station.',{class:'quality'}));
      if(!exercise)host.append(el('calcite-button','Open official NWS gauge',{scale:'s',appearance:'outline',href:`https://water.noaa.gov/gauges/${s.id.toLowerCase()}`,target:'_blank',rel:'noopener noreferrer','icon-end':'launch'}));
      return;
    }
    host.append(riverChart(g,a,horizon,timeZone));
    const dl=el('dl');
    const extra=[
      ['Observed',a.observed?`${riverValue(a.observed.value,g.observed.units)} · ${g.observed.name}${a.current?'':' · OLD / UNVERIFIED'}`:'Unknown'],
      ['Observed at',time(a.observed?.time)],
      ['Observed flow',g.observed.secondaryName==='Flow' && a.observed?riverValue(a.observed.secondary,g.observed.secondaryUnits):'Not supplied'],
      ['Recent change',a.trend?`${a.trend.delta>=0?'+':''}${riverValue(a.trend.delta,g.observed.units)} over ${a.trend.hours.toFixed(1)} h`:'Not enough current comparable samples'],
      ['Forecast high',a.peak?`${riverValue(a.peak.value,g.forecast.units)}${a.forecastUsable?'':' · OLD / UNUSABLE FOR CUES'}`:'Unknown'],
      ['High first sampled',time(a.peak?.time)],
      ['Forecast issued',time(g.forecast.issued)],
      ['Forecast ends',time(a.forecastEnd)],
      ['Gauge datum',g.datum],['Last station query',time(g.fetched)]
    ];
    for(const[k,v]of extra)dl.append(el('dt',k),el('dd',v));host.append(dl);
    if(a.peak && a.peak.lastTime>a.peak.time)host.append(el('p',`The highest value repeats through ${time(a.peak.lastTime)}; it is not a unique crest time.`,{class:'quality'}));
    if(a.partialWindow)host.append(el('p','The published forecast ends before the selected planning window. No values are extrapolated.',{class:'quality'}));
    host.append(el('h4','Published thresholds'));
    host.append(el('p',a.thresholds.length?a.thresholds.map(t=>`${t.level}: ${riverValue(t.value,t.units)}`).join(' · '):'Unknown in NWPS. County action thresholds have not been configured.'));
    for(const crossing of a.crossings)host.append(el('p',crossing.firstSample?`${crossing.level} threshold is already met in the first available forecast sample (${time(crossing.time)}). Crossing time is unknown.`:`First ${crossing.level} exceedance sample: ${time(crossing.time)}. Previous sample: ${time(crossing.priorTime)}; no crossing time is interpolated.`,{class:'quality'}));
    if(a.gaps.length)host.append(el('p',a.gaps.join(' · '),{class:'quality'}));
    host.append(el('p',s.note,{class:'muted'}),el('p','Gauge stage is relative to its own datum. A forecast high does not specify flood depth, an inundation boundary, travel time or a safe staging site.',{class:'muted'}));
    if(g.forecastNote)host.append(el('p',g.forecastNote,{class:'muted'}));
    host.append(el('calcite-button',exercise?'Fictional exercise record':'Open official NWS gauge',{scale:'s',appearance:'outline',href:exercise?null:g.sourceUrl,target:'_blank',rel:'noopener noreferrer',disabled:exercise,'icon-end':'launch'}));
  };
  const select=(id,open=true)=>{selected=id;if(open)onOpen();for(const item of $('river-list').querySelectorAll('calcite-list-item'))item.toggleAttribute('selected',item.getAttribute('value')===id);detail();map?.selectGauge(id);onMap();map?.focusGauge(id);$('river-detail-open').removeAttribute('disabled');$('river-dialog').setAttribute('open','');};
  const paint=()=>{
    const all=rows(), fresh=all.filter(r=>r.assessment.current).length, forecasts=all.filter(r=>r.assessment.forecastUsable).length;
    const unknown=all.filter(r=>!r.assessment.thresholdKnown).length, critical=all.filter(r=>r.assessment.tone==='threshold').length;
    onData({stations,entries});
    $('river-refresh').toggleAttribute('disabled',busy||!stations.length);$('river-refresh').toggleAttribute('loading',busy);
    updateCheckTime();
    lastAgeSignature=ageSignature(all);
    $('river-count').textContent=String(stations.length);$('river-count').setAttribute('label',`${stations.length} candidate watchpoints`);
    for(const[k,v]of Object.entries({sites:stations.length,current:fresh,forecasts,unknown}))$(`river-count-${k}`).textContent=String(v);
    const list=$('river-list');list.replaceChildren();
    for(const row of all.filter(r=>basin==='All'||r.station.basin===basin).sort((a,b)=>b.assessment.rank-a.assessment.rank||a.station.name.localeCompare(b.station.name))) {
      const {station:s,gauge:g,assessment:a}=row;
      const item=el('calcite-list-item','',{label:g?.name||s.name,description:`${s.id} · ${a.label}`,value:s.id,selected:s.id===selected,class:`river-item river-${a.tone}`,'icon-start':a.tone==='threshold'?'exclamation-mark-triangle':a.tone==='gap'?'question':'water-drop'});
      item.append(el('div',`Observed ${a.observed?riverValue(a.observed.value,g.observed.units):'Unknown'}${a.observed&&!a.current?' (old/unverified)':''}${a.observed?` · ${time(a.observed.time)}`:''}`,{slot:'content-bottom',class:'river-mini'}));
      item.append(el('div',`Next ${horizon}h high: ${a.peak?riverValue(a.peak.value,g.forecast.units):'Unknown'}${a.peak&&!a.forecastUsable?' (old/unusable)':''} · Thresholds ${a.thresholdKnown?'published':'unknown'}`,{slot:'content-bottom',class:'river-mini'}));
      list.append(item);
    }
    detail();paintMap();
  };
  const refresh=async()=>{
    if(busy||!stations.length)return;busy=true;lastAttempt=Date.now();clearTimeout(timer);paint();
    try {
      const outcomes=exercise?exerciseRivers(stations,scenario,exerciseClock):await fetchRiverWatch(stations,config);
      for(const outcome of outcomes)entries.set(outcome.id,{gauge:outcome.gauge||entries.get(outcome.id)?.gauge||null,error:outcome.error});
    } catch(error){for(const s of stations)entries.set(s.id,{gauge:entries.get(s.id)?.gauge||null,error:error.message});}
    finally{busy=false;next=Date.now()+config.pollMs;paint();if(!exercise)timer=setTimeout(()=>{if(!document.hidden)void refresh();},config.pollMs);}
  };
  $('river-list').addEventListener('calciteListChange',event=>{const id=event.target.selectedItems?.[0]?.value;if(id&&id!==selected)select(id,false);});
  $('river-horizon').addEventListener('calciteSelectChange',event=>{horizon=Number(event.target.value);paint();});
  $('river-basin').addEventListener('calciteSelectChange',event=>{basin=event.target.value;paint();});
  $('river-refresh').addEventListener('click',()=>void refresh());
  $('river-detail-open').addEventListener('click',()=>{detail();$('river-dialog').setAttribute('open','');});
  $('river-exercise').hidden=!exercise;
  document.querySelectorAll('[data-river-scenario]').forEach(button=>button.addEventListener('click',()=>{scenario=button.dataset.riverScenario;void refresh();}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&(!next||Date.now()>=next))void refresh();});
  window.addEventListener('online',()=>{if(!document.hidden)void refresh();});
  window.addEventListener('offline',()=>{for(const s of stations)entries.set(s.id,{gauge:entries.get(s.id)?.gauge||null,error:'This browser is offline.'});paint();});
  // Age checks can change cue eligibility even when no new request has completed.
  setInterval(()=>{if(!document.hidden){if(ageSignature(rows())!==lastAgeSignature)paint();else updateCheckTime();}},60_000);
  try {
    const watch=await fetchJson(new URL('../data/river-watchlist.json',import.meta.url));stations=watch.stations;
    if(!Array.isArray(stations))throw new Error('River watchlist could not be read.');
    for(const name of new Set(stations.map(s=>s.basin)))$('river-basin').append(el('calcite-option',name,{value:name}));
    void refresh();
  }catch(error){$('river-check-time').textContent=`River watch unavailable: ${error.message}`;onData({stations,entries});}
  return {select,setMap:controller=>{map=controller;paintMap();detail();if(selected)map.focusGauge(selected);},refresh,setExerciseEntries:external=>{if(exercise){entries=new Map(external);paint();}}};
}
