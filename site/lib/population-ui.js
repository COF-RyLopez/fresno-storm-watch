import {populationSourceGuide} from './population-guide.js?v=0.67.0';
import {calculateAcsZonePopulation} from './zone-acs-data.js?v=0.67.0';
import {ZONE_ACS_METHOD,ZONE_ACS_LIMIT,ZONE_ACS_ERROR,ZONE_ACS_MOE_SOURCE,ZONE_ACS_BOUNDARIES,formatAllocationWeight} from './zone-acs-model.js?v=0.67.0';
import {loadSdk} from './map.js?v=0.65.0-r1';
import {createAcsContext} from './acs-ui.js?v=0.65.0-r1';
import {readCareCollection} from './care-data.js?v=0.56.0-r1';
import {CARE_SOURCES,ZONE_STATUS} from './care-model.js?v=0.56.0-r1';
import {POPULATION_SOURCES,POPULATION_METHOD,POPULATION_LIMIT,approximatePopulation,populationZoneRows} from './population-model.js?v=0.66.0';
import {readPopulationBlocks,calculateZonePopulation} from './population-data.js?v=0.64.0';
import {reportHealth} from './source-health.js?v=0.59.0';
const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const link=(text,url)=>{const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const number=v=>new Intl.NumberFormat('en-US').format(v);

/** Anonymous, read-only population planning. Nothing writes to ArcGIS or persistent browser storage. */
export function createPopulationWatch({exercise=false,onMap=()=>{},onOpenWatch=()=>{}}={}){
  const root=$('population-watch'),pane=$('population-evidence'),params=new URLSearchParams(location.search);
  const time=v=>Number.isFinite(v)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'long'}).format(v):'Unknown';
  let county=null,map=null,tools=null,zones=null,zoneError=null,busy=false,selected=null,result=null,collection=null,problem=null,epoch=0,abort=null,graphics=null,blocksLayer=null,operators=null,pendingTools=null;
  const cache=new Map(),acsCache=new Map(),tractBlocks=new Map();let zonePending=null,newer=null,newerProblem=null,newerPending=false,newerProgress='';
  const acs=createAcsContext({exercise,onMap,onOpenWatch});
  const isWatch=()=>$('storm-shell').dataset.workspace==='watch'&&$('storm-shell').dataset.destination==='watch';
  function share(){const u=new URL('https://cof-rylopez.github.io/fresno-storm-watch/');u.searchParams.set('view','watch');u.searchParams.set('population','1');if(selected)u.searchParams.set('zone',selected.name);u.searchParams.set('v','0.67.0');$('population-share').href=u.href;}
  function list(){
    const rows=populationZoneRows(zones?.rows||[],{query:$('population-query').value,status:$('population-filter').value}),picker=$('population-zone'),value=selected?.key||'';picker.replaceChildren();
    const empty=node('option',rows.length?'Choose a county zone…':'No matching county zones');empty.value='';picker.append(empty);
    for(const r of rows){const o=node('option',`${r.name} · ${ZONE_STATUS[r.status]||'Status unknown'}`);o.value=r.key;picker.append(o);}picker.value=rows.some(r=>r.key===value)?value:'';picker.disabled=!rows.length;
    const all=zones?.rows||[],orders=all.filter(z=>z.status==='Order').length,warnings=all.filter(z=>z.status==='Warn').length;
    $('population-status').textContent=exercise?'Live population is disabled in the fictional exercise.':zoneError?`County zone check failed: ${zoneError}. ${zones?'Retained boundaries require verification.':'Use the official county map.'}`:zones?`${all.length} county-published zone records · ${orders} published orders / ${warnings} warnings · ${rows.length} match this filter. Checked ${time(zones.checked)}. Individual issue times are unavailable; confirm current orders with the county.`:'Open to check public county zones. No sign-in required.';
    $('population-summary').textContent=selected?`${selected.name}: ${newer?.estimate!==null&&newer?approximatePopulation(newer.estimate)+' planning residents (ACS '+newer.period+')':newerProblem||newer&&!newerPending?'newer estimate unavailable':'checking newer estimate…'}${result?' · '+approximatePopulation(result.estimate)+' baseline (2020)':''}${rows.some(r=>r.key===selected.key)?'':' · selected zone is outside this display filter'}`:'Choose a zone to compare a newer ACS planning estimate with the separate 2020 block baseline. Overlapping zones are not added together.';
    $('population-retry').disabled=!selected;$('population-inspect').disabled=!selected;
    share();
  }
  function draw(){
    if(!graphics)return;graphics.removeAll();blocksLayer.removeAll();
    if(selected)for(const [color,width]of [['#17242d',6],['#73e2e6',3]])graphics.add(new tools.Graphic({geometry:{...selected.geometry,type:'polygon'},attributes:{populationZoneKey:selected.key},symbol:{type:'simple-fill',color:[0,0,0,0],outline:{color,width}}}));
    if($('population-blocks').checked&&collection)for(const r of collection.rows)blocksLayer.add(new tools.Graphic({geometry:{...r.geometry,type:'polygon'},symbol:{type:'simple-fill',color:[0,0,0,0],outline:{color:'#c6d9e9',width:.75,style:'dash'}}}));
    map?.setLayerEligibility(blocksLayer,!!collection&&$('population-blocks').checked);
  }
  function detail(){
    const host=$('population-details');host.replaceChildren();if(!selected){pane.heading='Population & evacuation-zone evidence';host.append(node('p',problem||'Choose a county evacuation zone from Area Watch.'));return;}
    pane.heading=`${selected.name} · population planning`;
    host.append(node('p',`County published status: ${ZONE_STATUS[selected.status]||'Unknown'} · zone query ${time(zones?.checked)}. Individual issue/update time is not supplied.`));
    if(zoneError){const notice=node('calcite-notice');notice.open=true;notice.kind='warning';const text=node('div','Zone check failed; the retained boundary/status requires verification.');text.slot='message';notice.append(text);host.append(notice);}
    const latest=node('section');latest.setAttribute('aria-label','Newer ACS zone planning estimate');latest.append(node('h3','Newer zone planning estimate'));
    if(newerPending){const progress=node('p',newerProgress||'Checking the published ACS period and population pattern…');progress.id='population-newer-progress';progress.setAttribute('role','status');latest.append(progress);}
    else if(newerProblem)latest.append(node('p',`Newer estimate unavailable: ${newerProblem}. Retry the selected zone or use whole-tract context. The separate 2020 baseline can still be used with its limitations.`));
    else if(newer){
      latest.append(node('p',`${approximatePopulation(newer.estimate)} planning residents · ACS ${newer.period} · allocated total population`),node('p',ZONE_ACS_LIMIT));
      if(newer.missing||!newer.tracts)latest.append(node('p',(newer.missing?`${newer.missing} tract contributions unavailable.`:'No positive-area ACS overlap returned.')+' A complete zone estimate is not shown; missing coverage is not confirmed zero.'));
      const method=node('details');method.append(node('summary','Allocation evidence & uncertainty'),node('p',ZONE_ACS_METHOD),node('p',ZONE_ACS_ERROR),node('p',newer.samplingMoe===null?'Sampling-only MOE component unavailable.':`Approximate sampling-only MOE component: ± ${number(Math.ceil(newer.samplingMoe))} residents. Total zone uncertainty is not quantified.`));
      const table=node('table');table.className='zone-acs-allocation';const caption=node('caption',`ACS ${newer.period} source totals and zone weights`),thead=node('thead'),head=node('tr');for(const label of ['Tract','Whole-tract total / 90% MOE','Share used','Zone contribution']){const th=node('th',label);th.scope='col';head.append(th);}thead.append(head);table.append(caption,thead);const body=node('tbody');
      for(const r of newer.rows){const tr=node('tr'),name=node('th',r.id);name.scope='row';tr.append(name,node('td',(r.population===null?'Unknown':number(r.population))+' / '+(r.moe===null?'Unknown':'± '+number(r.moe))),node('td',formatAllocationWeight(r.weight)),node('td',r.weight===null||r.population===null?'Unknown':approximatePopulation(r.population*r.weight)));body.append(tr);if(r.reason||r.method!=='Whole tract'){const note=node('tr'),td=node('td',r.reason||`${r.method} · ${approximatePopulation(r.baselineWithin)} / ${approximatePopulation(r.baselineTotal)} 2020 residents · ${r.blocks} positive-area blocks.`);td.colSpan=4;note.append(td);body.append(note);}}
      table.append(body);method.append(table,node('p',`${newer.accounting.returnedTracts} source tracts / ${newer.tracts} positive-area overlaps · ${newer.accounting.queriedBlockRecords} block records checked · calculated ${time(newer.checked)}. Calculation time is not a new population observation.`),node('p',`Analysis uses full Census tract boundaries (${ZONE_ACS_BOUNDARIES.vintage}); the map's water-erased density outlines are display context.`),node('p','Under-18, 65+, language, disability and household values remain whole-tract context. They are not allocated to this zone or individual buildings.'),link('Living Atlas ACS source',POPULATION_SOURCES.acsItem),node('br'),link('Full Census analysis boundaries',ZONE_ACS_BOUNDARIES.url),node('br'),link('Census guidance for derived sampling errors',ZONE_ACS_MOE_SOURCE));latest.append(method);
    }
    host.append(latest);
    if(problem){const notice=node('calcite-notice');notice.open=true;notice.kind='warning';const text=node('div',`Population unavailable: ${problem}. Retry the selected zone; no zero or current affected-person count is inferred.`);text.slot='message';notice.append(text);host.append(notice);}
    else if(!result)host.append(node('p','Retrieving complete 2020 Census block polygons and checking overlaps…'));
    else{
      host.append(node('h3',`${approximatePopulation(result.estimate)} baseline residents · 2020`),node('p','Separate 2020 Census block-overlap estimate. Its difference from the newer allocation is not a measured population change. This does not mean the zone is under an active order.'));
      const table=node('table'),caption=node('caption','Population evidence for this zone');table.append(caption);const body=node('tbody');
      for(const [label,value]of [['Residents in fully contained blocks',number(result.wholePopulation)],['Residents in whole boundary-crossing blocks',number(result.boundaryPopulation)],['Whole / boundary-crossing blocks',`${result.wholeBlocks} / ${result.boundaryBlocks}`],['Missing population records',number(result.missing)]]){const tr=node('tr'),th=node('th',label);th.scope='row';tr.append(th,node('td',value));body.append(tr);}table.append(body);host.append(table);
      if(!result.blocks)host.append(node('p','No positive-area census overlap returned; population is unavailable, not confirmed zero.'));
      if(result.missing)host.append(node('p','Some population values are missing or suppressed; no complete zone estimate is displayed.'));
      host.append(node('p',`Census polygons queried ${result.accounting.queried} / retained ${result.accounting.retained} · checked ${time(result.checked)}.`));
      const methods=node('details');methods.append(node('summary','Estimate method, uncertainty & sources'),node('p',POPULATION_METHOD),node('p','Only Fresno County blocks are counted, including for shared-border zone records. The boundary-crossing row counts all residents of those entire census blocks. It is context for allocation uncertainty, not additional residents to add to the estimate. Block counts are distinct from ACS tract estimates.'),node('p',POPULATION_LIMIT),link('County 2020 Census population viewer',POPULATION_SOURCES.countyMap),node('br'),link('2020 block source',POPULATION_SOURCES.blocks),node('br'),link('Living Atlas ACS population source',POPULATION_SOURCES.acsItem));host.append(methods,populationSourceGuide());
    }
    const context=node('details');context.append(node('summary','Newer ACS & PIO context · whole tracts'),node('p','Age counts, 90% margins of error and outreach context describe whole census tracts, not this zone. They are not combined with the 2020 estimate.'));const explore=node('calcite-button','Explore intersecting ACS tracts');explore.scale='s';explore.appearance='outline';explore.addEventListener('click',()=>void acs.open({geometry:selected.geometry,zone:selected.name}));context.append(explore);host.append(context);
    host.append(node('p',POPULATION_LIMIT),node('p','Cyan: selected county zone outline. Optional dashed outlines: whole queried census blocks, including portions outside the zone.'),link('County evacuation source',CARE_SOURCES.zoneItem));
  }
  async function ensureTools(){
    if(tools&&(!map||graphics))return tools;if(pendingTools)return pendingTools;
    pendingTools=(async()=>{const sdk=await loadSdk();const [GraphicsLayer,Graphic,Polygon,intersection,area]=await sdk.import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/geometry/Polygon.js','@arcgis/core/geometry/operators/intersectionOperator.js','@arcgis/core/geometry/operators/geodeticAreaOperator.js']);if(!area.isLoaded())await area.load();operators={Polygon,intersection,area};tools={GraphicsLayer,Graphic};
      if(map){graphics=new GraphicsLayer({title:'Selected county evacuation zone · population reference',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});blocksLayer=new GraphicsLayer({title:'Queried 2020 census block boundaries · not zone boundaries',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
        map.registerLayer('populationZones',blocksLayer);map.registerLayer('populationZones',graphics);draw();
      }return tools;
    })().catch(e=>{tools=null;throw e;}).finally(()=>{pendingTools=null;});return pendingTools;
  }
  async function focusZone(row,generation){
    // The dock and density legend change the view's dimensions. Fit after both layout frames.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(generation===epoch&&isWatch()&&map)await map.focusReferenceGeometry(row.geometry);
  }
  async function select(key){
    const row=zones?.rows.find(r=>r.key===key);if(!row||exercise)return;
    abort?.abort();abort=new AbortController();const generation=++epoch;selected=row;result=null;collection=null;problem=null;newer=null;newerProblem=null;newerPending=true;newerProgress='Checking ACS source and population pattern…';list();detail();onMap();pane.setAttribute('open','');
    try{
      await ensureTools();if(generation!==epoch||!isWatch())return;
      map?.setLayerPreference('populationZones',true);map?.setLayerPreference('populationDensity',$('population-density').checked);draw();void focusZone(row,generation);
      void calculateNewer(row,generation,abort.signal);
      const signature=JSON.stringify(row.geometry),saved=cache.get(row.key);
      if(saved?.signature===signature&&Date.now()-saved.result.checked<600000){result=saved.result;collection=saved.collection;}
      else{const records=await readPopulationBlocks(row.geometry,{signal:abort.signal});const summary=await calculateZonePopulation(row,records,{...operators,current:()=>generation===epoch&&isWatch()});if(generation!==epoch||!isWatch())return;collection=records;result=summary;cache.set(row.key,{signature,collection,result});if(cache.size>5)cache.delete(cache.keys().next().value);}
      if(generation!==epoch)return;reportHealth('population:blocks','Selected zone · 2020 Census population',{checked:result.checked,state:result.missing||!result.blocks?'coverage':null,maxAgeMs:Infinity,detail:'2020 baseline; boundary allocation is approximate, not live occupancy. Assessed only for the selected zone.'});list();detail();draw();
    }catch(e){if(generation!==epoch||e.name==='AbortError')return;problem=e.message||'Source or geometry calculation failed';result=null;collection=null;if(!operators){newerPending=false;newerProblem='Map geometry tools unavailable.';}list();detail();draw();reportHealth('population:blocks','Selected zone · 2020 Census population',{error:problem,detail:'Selected zone population remains unknown; retry or consult the source.'});}
  }
  async function calculateNewer(row,generation,signal){
    try{
      const signature=JSON.stringify(row.geometry),saved=acsCache.get(row.key);
      const value=saved?.signature===signature&&Date.now()-saved.result.checked<600000?saved.result:await calculateAcsZonePopulation(row,{...operators,signal,blockCache:tractBlocks,current:()=>generation===epoch,onProgress:text=>{if(generation===epoch){newerProgress=text;const progress=$('population-newer-progress');if(progress)progress.textContent=text;}}});
      if(generation!==epoch)return;newer=value;acsCache.set(row.key,{signature,result:value});if(acsCache.size>5)acsCache.delete(acsCache.keys().next().value);
      reportHealth('population:acs-zone','Selected zone · newer ACS allocation',{checked:value.checked,state:value.missing||!value.tracts||value.missingMoe?'coverage':null,maxAgeMs:Infinity,detail:`${value.period} five-year total with 2020 pattern weights; not current occupancy. Sampling error excludes allocation uncertainty.`});
    }catch(e){if(generation!==epoch||e.name==='AbortError')return;newerProblem=e.message;reportHealth('population:acs-zone','Selected zone · newer ACS allocation',{error:e.message,detail:'Newer zone estimate is unknown; 2020 baseline remains separate.'});}
    finally{if(generation===epoch){newerPending=false;list();detail();}}
  }
  async function refreshZones(){
    if(busy||exercise||!county)return;busy=true;$('population-refresh').loading=true;
    try{const next=await readCareCollection('zones',{county});zones=next;zoneError=null;const old=selected;if(old){const current=next.rows.find(r=>r.key===old.key);if(!current){epoch++;abort?.abort();selected=null;result=null;collection=null;newer=null;newerPending=false;problem='The selected county zone is no longer returned; its current status is unknown. Choose a current source record.';draw();detail();}else if(JSON.stringify(current.geometry)!==JSON.stringify(old.geometry)){epoch++;abort?.abort();cache.delete(old.key);acsCache.delete(old.key);selected=current;result=null;collection=null;newer=null;newerPending=false;newerProblem='The zone boundary changed. Retry to calculate a revised estimate.';problem='The zone boundary changed. Retry the selected zone to calculate its revised population baseline.';draw();detail();}else{selected=current;detail();}}
      list();if(!selected&&params.get('zone')){const match=next.rows.find(r=>r.name===params.get('zone'));if(match)void select(match.key);}
      reportHealth('care:zones','County evacuation-zone query',{checked:next.checked,maxAgeMs:420000,detail:'Individual condition times unavailable; verify current orders with the county.'});
    }catch(e){zoneError=e.message;list();detail();reportHealth('care:zones','County evacuation-zone query',{checked:zones?.checked,error:zoneError,detail:'Retained zone boundaries/status require verification.'});}
    finally{busy=false;$('population-refresh').loading=false;}
  }
  function refresh(){if(zonePending)return zonePending;zonePending=refreshZones().finally(()=>{zonePending=null;});return zonePending;}
  async function showContext(){if(!map||exercise||!isWatch())return;void acs.showContext();try{await ensureTools();if(!isWatch())return;if(selected)map.setLayerPreference('populationZones',true);}catch(e){problem='Map context unavailable: '+e.message;detail();}}
  function open(){onOpenWatch();root.open=true;root.scrollIntoView({block:'nearest'});if(!zones||zoneError)void refresh();else list();void showContext();}
  $('population-query').addEventListener('input',list);$('population-filter').addEventListener('change',list);$('population-zone').addEventListener('change',()=>{if($('population-zone').value)void select($('population-zone').value);else{epoch++;abort?.abort();selected=null;result=null;collection=null;newer=null;newerProblem=null;newerPending=false;problem=null;draw();detail();list();}});
  $('population-refresh').addEventListener('click',()=>void refresh());$('population-retry').addEventListener('click',()=>{if(selected){cache.delete(selected.key);acsCache.delete(selected.key);tractBlocks.clear();void select(selected.key);}});
  $('population-inspect').addEventListener('click',()=>{if(selected)void select(selected.key);});
  $('population-blocks').addEventListener('change',draw);
  root.addEventListener('toggle',()=>{if(root.open){if(!zones)void refresh();void showContext();}});
  pane.addEventListener('stormEvidenceClose',()=>{epoch++;abort?.abort();if(selected&&!result){problem='Selection closed before the calculation completed';list();}});
  window.addEventListener('frogPopulationZoneSelect',e=>{if(zones?.rows.some(r=>r.key===e.detail?.key))void select(e.detail.key);});
  window.addEventListener('pagehide',()=>{epoch++;abort?.abort();cache.clear();collection=null;});
  setInterval(()=>{if(root.open&&isWatch()&&!document.hidden)void refresh();},300000);
  if(exercise){$('population-refresh').disabled=true;$('population-density').disabled=true;$('population-zone').disabled=true;}
  list();
  return {open,async selectZone(key){open();if(!zones)await refresh();if(zones?.rows.some(r=>r.key===key))await select(key);},setCounty(value){county=value;if(params.get('population')==='1')open();},async setMap(value){map=value;acs.setMap(value);if(root.open){await showContext();if(selected)void focusZone(selected,epoch);}}};
}
