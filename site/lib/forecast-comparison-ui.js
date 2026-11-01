import {comparisonWindow,compareForecasts} from './forecast-comparison-model.js';
import {fetchComparison,loadComparisonAreas} from './forecast-comparison-data.js';
import {formatTime} from './model.js';
import {REVIEW_MAX_AGE as MAX_AGE,pointDifferences} from './forecast-review-model.js';
import {el,link,dataTable} from './dom.js';
const $=id=>document.getElementById(id);
const num=(v,unit)=>Number.isFinite(v)?`${v.toFixed(unit==='in'?2:1)} ${unit}`:'Unknown';

/** Public point forecasts in tab memory only; no private assets or action thresholds. */
export function createForecastComparison({timeZone,exercise,onMap=()=>{},onLocate=()=>{},getSnapshot=()=>null,onPointUpdate=()=>{}}){
  const pane=$('forecast-comparison'),host=$('comparison-results'),cache=new Map();
  let areas=[],areaId='san-joaquin-lower',pointId=null,request=0,abort=null,busy=false,snapshot=null,error=null;
  const time=t=>Number.isFinite(t)?formatTime(t,timeZone):'Unknown';
  const area=()=>areas.find(a=>a.id===areaId);
  const point=()=>area()?.points.find(p=>p.id===pointId)||area()?.points[0];
  const option=(label,value,selected)=>{const n=el('calcite-option',label);n.setAttribute('value',value);n.toggleAttribute('selected',selected);return n;};
  function controls(){
    pointId=point()?.id;
    $('comparison-area').replaceChildren(...areas.map(a=>option(a.name,a.id,a.id===areaId)));
    $('comparison-point').replaceChildren(...(area()?.points||[]).map(p=>option(p.name,p.id,p.id===pointId)));
    $('comparison-scope').textContent=area()?.note||'Loading configured river watch areas…';
  }
  function render(){
    host.replaceChildren();$('comparison-refresh').toggleAttribute('loading',busy);$('comparison-refresh').toggleAttribute('disabled',busy||exercise||!point());
    $('comparison-locate').toggleAttribute('disabled',!point());
    $('comparison-health').textContent=exercise?'Exercise mode · live model comparisons disabled':busy?'Checking NWS and Dynamical for the selected point…':error?`Comparison unavailable · ${error}`:snapshot?`Checked ${time(snapshot.checked)} · ${Date.now()-snapshot.checked>MAX_AGE?'collection overdue; check sources again':'public point forecasts'}`:'Choose a river area to compare forecasts.';
    if(!snapshot)return;
    const w=snapshot.window,stale=Date.now()-snapshot.checked>MAX_AGE;
    $('comparison-window').textContent=`Common 24-hour window: ${time(w.start)} → ${time(w.end)}. Starts at the next full UTC six-hour boundary; not a rolling next-24-hour total. Independent of the map slider.`;
    if(stale){host.append(el('p','Forecast check overdue. Previous values are withheld until checked again.'));return;}
    const rows=compareForecasts(pointDifferences(snapshot).rows,w),nws=rows.find(r=>r.id==='nws');
    host.append(dataTable('Same-window comparison · full coverage required',['Source','Precip. in','Wind mph','Gust mph'],rows.map(row=>[row.id==='nws'?'NWS':row.id.includes('hrrr')?'HRRR':'GFS',...[['rain',2],['wind',1],['gust',1]].map(([key,places])=>row.error?'Unavailable':key==='gust'&&!row.gustProvided?'Not supplied':Number.isFinite(row.summary[key].value)?row.summary[key].value.toFixed(places):'Unknown')]),{rowHeader:true,end:[1,2,3]}));
    for(const row of rows){
      const block=el('calcite-block');block.heading=row.label;block.setAttribute('heading-level','3');block.setAttribute('expanded','');block.setAttribute('collapsible','');
      if(row.error){block.append(el('p',`Unavailable · ${row.error}. Other sources remain independent.`));host.append(block);continue;}
      const s=row.summary;
      block.append(el('p',`${row.id==='nws'?'NWS forecast updated':'Model initialized'} ${time(row.issued)}${row.resolution?` · grid ${row.resolution}`:''}`));
      block.append(el('p',`24h liquid-equivalent precipitation: ${num(s.rain.value,'in')} · complete intervals ${s.rain.hours.toFixed(0)}/24 h`));
      block.append(el('p',`10 m wind maximum: ${num(s.wind.value,'mph')} · ${row.id==='nws'?'interval coverage':'hourly samples'} ${s.wind.hours.toFixed(0)}/24${row.id==='nws'?' h':''}`));
      block.append(el('p',`Gust maximum: ${row.gustProvided?num(s.gust.value,'mph'):'Not provided by this GFS product'}${row.gustProvided?` · ${row.id==='nws'?'interval coverage':'hourly samples'} ${s.gust.hours.toFixed(0)}/24${row.id==='nws'?' h':''}`:''}`));
      if(row.id!=='nws'&&nws?.summary){
        const delta=(a,b,unit)=>Number.isFinite(a)&&Number.isFinite(b)?`${a-b>=0?'+':''}${(a-b).toFixed(unit==='in'?2:1)} ${unit}`:'Unknown';
        block.append(el('p',`Difference from NWS in this window: precipitation ${delta(s.rain.value,nws.summary.rain.value,'in')}; wind maximum ${delta(s.wind.value,nws.summary.wind.value,'mph')}. These are model differences, not forecast errors or confidence.`));
      }
      block.append(el('p',row.wettest?`Wettest six-hour period (first if tied): ${time(row.wettest.start)} → ${time(row.wettest.end)}`:s.rain.value===0?'No precipitation in this complete forecast window.':'Wettest period unknown; one or more precipitation periods are missing.'));
      if(s.wind.peak)block.append(el('p',`First maximum wind ${row.id==='nws'?'overlapping interval':'hourly sample'}: ${time(s.wind.peak.start)}${row.id==='nws'?` → ${time(s.wind.peak.end)}`:''}`));
      if(s.gust.peak)block.append(el('p',`First gust maximum ${row.id==='nws'?'overlapping interval':'hourly sample'}: ${time(s.gust.peak.start)}${row.id==='nws'?` → ${time(s.gust.peak.end)}`:''}`));
      block.append(dataTable('Six-hour timing · precipitation / maximum wind',['Valid period','Precip.','Wind'],row.periods.map(p=>[`${time(p.start)} → ${time(p.end)}`,num(p.rain.value,'in'),num(p.wind.value,'mph')]),{rowHeader:true,end:[1,2]}));
      const details=el('details');details.append(el('summary','Grid, method & source'));
      details.append(el('p',row.windMeaning),el('p',row.id==='nws'?`Requested point ${snapshot.point.latitude.toFixed(4)}, ${snapshot.point.longitude.toFixed(4)} · NWS grid ${row.grid.office} ${row.grid.x},${row.grid.y}. NWS and numerical models use different grids.`:`Nearest model cell ${row.selected.latitude.toFixed(4)}, ${row.selected.longitude.toFixed(4)}; requested ${snapshot.point.latitude.toFixed(4)}, ${snapshot.point.longitude.toFixed(4)}. Snapshot ${row.snapshotId||'not supplied'}.`));
      details.append(link('Source forecast data',row.source));if(row.catalog)details.append(el('p',row.attribution),link('Dataset metadata & license',row.catalog));block.append(details);host.append(block);
    }
  }
  async function load(force=false){
    if(exercise||!point())return render();
    const p=point(),w=comparisonWindow(),key=`${p.id}:${w.start}`,prior=cache.get(key);
    abort?.abort();const generation=++request;
    error=null;snapshot=null;$('comparison-window').textContent='Forecast windows are being checked for this point.';
    const shared=force?null:getSnapshot(p.id);
    const hit=shared&&Date.now()-shared.checked<MAX_AGE?{...shared,window:w}:!force&&prior&&Date.now()-prior.checked<MAX_AGE?prior:null;
    if(hit){snapshot=hit;busy=false;render();return;}
    abort=new AbortController();busy=true;render();
    try{
      const result=await fetchComparison(p,{signal:abort.signal});if(generation!==request)return;
      snapshot={...result,window:w};cache.set(key,snapshot);if(cache.size>24)cache.delete(cache.keys().next().value);
      onPointUpdate(result);
    }catch(e){if(generation===request)error=e.message;}
    finally{if(generation===request){busy=false;render();}}
  }
  async function open(id,requestedPoint){
    onMap();pane.setAttribute('open','');
    try{await ready;if(id&&areas.some(a=>a.id===id)){areaId=id;pointId=area()?.points.some(p=>p.id===requestedPoint)?requestedPoint:null;}controls();if(pane.hasAttribute('open'))await load();}catch(e){error=e.message;render();}
  }
  const ready=loadComparisonAreas('Comparison inventory unavailable.').then(a=>{areas=a;controls();});
  // Catch startup failure immediately; open() still reports the rejection to the user.
  void ready.catch(()=>{});
  for(const button of document.querySelectorAll('[data-open-comparison]'))button.addEventListener('click',()=>void open());
  $('comparison-area').addEventListener('calciteSelectChange',e=>{areaId=e.target.value;pointId=null;controls();void load();});
  $('comparison-point').addEventListener('calciteSelectChange',e=>{pointId=e.target.value;void load();});
  $('comparison-refresh').addEventListener('click',()=>void load(true));
  $('comparison-locate').addEventListener('click',()=>{const p=point();if(p){onMap();onLocate(p);}});
  pane.addEventListener('stormEvidenceClose',()=>{abort?.abort();request++;busy=false;});
  setInterval(()=>{
    if(document.hidden||!pane.hasAttribute('open')||busy)return;
    const shared=getSnapshot(point()?.id),revision=p=>JSON.stringify(p?.rows.map(r=>[r.id,r.error,r.issued]));
    if(shared&&(!snapshot||shared.checked!==snapshot.checked||revision(shared)!==revision(snapshot)||snapshot.window.start!==comparisonWindow().start)){snapshot={...shared,window:comparisonWindow()};render();}
    if(snapshot&&Date.now()-snapshot.checked>MAX_AGE)void load();
  },60000);
  return {open};
}
