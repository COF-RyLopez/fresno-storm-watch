import {comparisonAreas} from './forecast-comparison-model.js';
import {currentComparisonSnapshot} from './forecast-review-data.js';
import {areaDifferences,rankDifferences,REVIEW_MAX_AGE} from './forecast-review-model.js';
import {formatTime} from './model.js';
import {reportHealth} from './source-health.js?v=0.73.1';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const short={nws:'NWS','noaa-hrrr-forecast-48-hour':'HRRR','noaa-gfs-forecast':'GFS'};
export const differenceText=a=>!a?'Forecast comparisons are being checked.':`Precipitation spread ${a.rain?`${a.rain.rainSpread.toFixed(2)} in at ${a.rain.point.name}`:'unknown'} · wettest-period separation ${a.rainTiming?`${a.rainTiming.rainTiming.hours} h at ${a.rainTiming.point.name}`:'unknown / no positive peak'} · wind peak-period separation ${a.wind?`${a.wind.windTiming.hours} h at ${a.wind.point.name}`:'unknown / no positive peak'}${a.complete?'':' · comparison coverage incomplete'}.`;

/** Fixed six-area queue; refreshed independently of tabs, selections and map extent. */
export function createForecastReview({timeZone,exercise,onData=()=>{},onCompare=()=>{},onMap=()=>{},onArea=()=>{}}){
  let areas=[],snapshot=null,error=null,busy=false,checked=null,next=0,metric='rain',drawKey='';
  const expanded=new Set();
  const time=t=>Number.isFinite(t)?formatTime(t,timeZone):'Unknown';
  const pane=$('forecast-review'),host=$('forecast-review-list');
  const button=(label,fn)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.addEventListener('click',fn);return b;};
  const periodText=periods=>periods.map(p=>`${time(p.start)} → ${time(p.end)}`).join(' or ');
  function render(){
    const assessed=error&&snapshot?{...snapshot,points:snapshot.points.map(p=>({...p,rows:p.rows.map(r=>({...r,error:'Latest comparison check failed; prior values withheld'}))}))}:snapshot;
    const differences=areaDifferences(areas,assessed),ranked=rankDifferences(differences,metric),reviews=differences.filter(a=>a.review),incomplete=differences.filter(a=>!a.complete);
    $('notify-forecast').textContent=exercise?'Forecast differences · exercise':!snapshot?`Forecast differences · ${error?'unavailable':'checking'}`:`Forecast differences · ${reviews.length} areas${incomplete.length?' · incomplete':''}`;
    $('notify-forecast').title=$('notify-forecast').textContent;$('notify-forecast').setAttribute('aria-label',$('notify-forecast').textContent);$('notify-forecast').textContent=exercise?'Models · exercise':!snapshot?`Models · ${error?'unavailable':'checking'}`:`Model review · ${reviews.length}${incomplete.length?' · limited':''}`;
    const firstRain=rankDifferences(differences,'rain').find(a=>a.rain),firstWind=rankDifferences(differences,'wind').find(a=>a.wind);
    const rainTies=firstRain?differences.filter(a=>a.rain&&a.rain.rainSpread.toFixed(2)===firstRain.rain.rainSpread.toFixed(2)).length:0,windTies=firstWind?differences.filter(a=>a.wind?.windTiming.hours===firstWind.wind.windTiming.hours).length:0;
    $('forecast-watch-summary').textContent=exercise?'Live forecast comparisons disabled in exercise.':`${firstRain?`Largest available precipitation spread: ${firstRain.name} · ${firstRain.rain.rainSpread.toFixed(2)} in${rainTies>1?` (${rainTies} areas tied)`:''}.`:'Precipitation differences unknown.'} ${firstWind?`Largest available wind peak-period separation: ${firstWind.name} · ${firstWind.wind.windTiming.hours} h${windTies>1?` (${windTies} areas tied)`:''}.`:'Wind timing differences unknown / no positive peak.'} ${areas.length?incomplete.length:6}/6 areas have incomplete comparison coverage. Differences require planning review, not deployment.`;
    $('forecast-review-status').textContent=exercise?'Exercise · no live comparison collection':busy?'Checking all configured public forecast samples…':error?`Comparison check failed · ${error}`:snapshot?`App checked ${time(checked)} · earliest sample check ${time(Math.min(...snapshot.points.map(p=>p.checked)))} · ${reviews.length}/6 areas with available differences · ${incomplete.length}/6 incomplete`:'Waiting for forecast comparison collection.';
    $('forecast-review-refresh').toggleAttribute('loading',busy);$('forecast-review-refresh').toggleAttribute('disabled',busy||exercise||!areas.length);
    onData(differences);
    if(!exercise)reportHealth('forecast-comparisons','River-area forecast comparisons',{checked:snapshot?Math.min(...snapshot.points.map(p=>p.checked)):null,error,state:snapshot&&incomplete.length?'coverage':null,maxAgeMs:REVIEW_MAX_AGE,detail:`${incomplete.length}/6 areas have incomplete precipitation/wind comparison coverage. One check for the shared collection; inspect comparison evidence for individual source failures and gaps.`});
    if(!pane.hasAttribute('open'))return;
    const key=JSON.stringify([metric,ranked.map(a=>[a.id,a.review,a.complete,a.samples.map(p=>[p.point.id,p.checked,p.rainSpread,p.rainTiming,p.windTiming,p.rows.map(r=>[r.id,r.error,r.issued,r.summary?.rain.value,r.summary?.wind.value])])])]);
    if(key===drawKey)return;drawKey=key;
    host.replaceChildren();
    for(const a of ranked){
      const card=el('calcite-block');card.heading=a.name;card.setAttribute('heading-level','3');card.expanded=true;card.append(el('p',a.review?'Forecast differences · planning review':a.complete?'No difference cue at the configured display precision':'Comparison coverage incomplete · differences unknown or partial'),el('p',differenceText(a)));
      const selected=metric==='wind'?a.wind:metric==='rainTiming'?a.rainTiming:a.rain;
      card.append(button('Review comparison evidence',()=>onCompare(a.id,selected?.point.id||a.samples[0]?.point.id)),button('Map river watchpoints',()=>onArea(a.id)));
      for(const p of a.samples){
        const d=el('details'),key=a.id+':'+p.point.id;d.open=expanded.has(key);d.addEventListener('toggle',()=>{if(d.isConnected){if(d.open)expanded.add(key);else expanded.delete(key);}});d.append(el('summary',p.point.name));
        d.append(el('p',`Checked ${time(p.checked)} · same valid window ${time(p.window.start)} → ${time(p.window.end)}`));
        d.append(el('p',`Complete source coverage: precipitation ${p.rainSources}/3; sustained wind ${p.windSources}/3. NWS plus at least one model is required for a difference cue.`));
        for(const r of p.rows)d.append(el('p',r.error?`${short[r.id]}: ${r.error}`:`${short[r.id]} · ${r.id==='nws'?'updated':'initialized'} ${time(r.issued)} · 24h precipitation ${r.summary.rain.value===null?'unknown':r.summary.rain.value.toFixed(2)+' in'} · wind maximum ${r.summary.wind.value===null?'unknown':r.summary.wind.value.toFixed(1)+' mph'}`));
        for(const [key,label]of [['rainTiming','Precipitation'],['windTiming','Wind']]){
          const t=p[key];d.append(el('p',t?`${label} peak-period start separation: ${t.hours} h · NWS: ${periodText(t.nwsPeriods)} · ${t.source}: ${periodText(t.modelPeriods)}. All tied periods retained.`:`${label} peak timing unknown or no positive peak; not assumed simultaneous.`));
        }
        d.append(button('Open this sample',()=>onCompare(a.id,p.point.id)));card.append(d);
      }
      host.append(card);
    }
  }
  async function refresh(force=false){
    if(busy||exercise||document.hidden||!areas.length)return;busy=true;error=null;render();
    try{snapshot=await currentComparisonSnapshot(areas,{force});checked=Date.now();}
    catch(e){error=e.message;/* Prior samples retain their original checks and expire independently. */}
    finally{busy=false;next=Date.now()+(snapshot?5:15)*60000;render();}
  }
  function open(){onMap();pane.setAttribute('open','');render();}
  const ready=Promise.all(['river-areas','area-concerns','wind-watchlist','river-watchlist'].map(async name=>{const r=await fetch(new URL(`../data/${name}.json`,import.meta.url),{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Forecast review inventory unavailable.');return r.json();})).then(([a,c,w,g])=>{areas=comparisonAreas(a.areas,c.areas,w.sites,g.stations);render();void refresh();}).catch(e=>{error=e.message;render();});
  $('notify-forecast').addEventListener('click',open);$('forecast-review-open').addEventListener('click',open);
  $('forecast-review-sort').addEventListener('calciteSelectChange',e=>{metric=['rain','wind','rainTiming'].includes(e.target.value)?e.target.value:'rain';render();});
  $('forecast-review-refresh').addEventListener('click',()=>void refresh(true));
  const tick=()=>{if(document.hidden)return;render();if(Date.now()>=next)void refresh();};
  setInterval(tick,60000);document.addEventListener('visibilitychange',tick);window.addEventListener('online',()=>{next=0;tick();});
  render();
  return {open,getPoint:id=>{const p=snapshot?.points.find(p=>p.point.id===id);return p&&error?{...p,rows:p.rows.map(r=>({...r,error:'Latest comparison check failed; prior values withheld'}))}:p||null;},updatePoint:point=>{if(snapshot){snapshot={...snapshot,points:snapshot.points.map(p=>p.point.id===point.point.id?point:p)};render();}},ready};
}
