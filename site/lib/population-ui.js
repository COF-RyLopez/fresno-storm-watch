import {loadSdk} from './map.js?v=0.64.0';
import {readCareCollection} from './care-data.js?v=0.56.0-r1';
import {CARE_SOURCES,ZONE_STATUS} from './care-model.js?v=0.56.0-r1';
import {POPULATION_SOURCES,POPULATION_METHOD,POPULATION_LIMIT,approximatePopulation,populationZoneRows} from './population-model.js?v=0.64.0';
import {readPopulationBlocks,calculateZonePopulation} from './population-data.js?v=0.64.0';
import {reportHealth} from './source-health.js?v=0.59.0';
const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const link=(text,url)=>{const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const number=v=>new Intl.NumberFormat('en-US').format(v);

/** Anonymous, read-only population planning. Nothing writes to ArcGIS or persistent browser storage. */
export function createPopulationWatch({exercise=false,onMap=()=>{},onOpenWatch=()=>{}}={}){
  const root=$('population-watch'),pane=$('population-evidence'),params=new URLSearchParams(location.search);
  const time=v=>Number.isFinite(v)?new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'long'}).format(v):'Unknown';
  let county=null,map=null,tools=null,zones=null,zoneError=null,busy=false,selected=null,result=null,collection=null,problem=null,epoch=0,abort=null,graphics=null,blocksLayer=null,density=null,operators=null,pendingTools=null,legendError=null;
  const cache=new Map();let zonePending=null;
  const isWatch=()=>$('storm-shell').dataset.workspace==='watch'&&$('storm-shell').dataset.destination==='watch';
  function share(){const u=new URL('https://cof-rylopez.github.io/fresno-storm-watch/');u.searchParams.set('view','watch');u.searchParams.set('population','1');if(selected)u.searchParams.set('zone',selected.name);u.searchParams.set('v','0.64.0');$('population-share').href=u.href;}
  function list(){
    const rows=populationZoneRows(zones?.rows||[],{query:$('population-query').value,status:$('population-filter').value}),picker=$('population-zone'),value=selected?.key||'';picker.replaceChildren();
    const empty=node('option',rows.length?'Choose a county zone…':'No matching county zones');empty.value='';picker.append(empty);
    for(const r of rows){const o=node('option',`${r.name} · ${ZONE_STATUS[r.status]||'Status unknown'}`);o.value=r.key;picker.append(o);}picker.value=rows.some(r=>r.key===value)?value:'';picker.disabled=!rows.length;
    const all=zones?.rows||[],orders=all.filter(z=>z.status==='Order').length,warnings=all.filter(z=>z.status==='Warn').length;
    $('population-status').textContent=exercise?'Live population is disabled in the fictional exercise.':zoneError?`County zone check failed: ${zoneError}. ${zones?'Retained boundaries require verification.':'Use the official county map.'}`:zones?`${all.length} county-published zone records · ${orders} published orders / ${warnings} warnings · ${rows.length} match this filter. Checked ${time(zones.checked)}. Individual issue times are unavailable; confirm current orders with the county.`:'Open to check public county zones. No sign-in required.';
    $('population-summary').textContent=selected?`${selected.name}: ${result?approximatePopulation(result.estimate)+' baseline residents (2020)':problem?'population unavailable':'checking population…'}${rows.some(r=>r.key===selected.key)?'':' · selected zone is outside this display filter'}`:'Choose a zone to estimate baseline residents. Counts are assessed one zone at a time; overlapping zones are not added together.';
    $('population-retry').disabled=!selected;
    share();
  }
  function legend(){
    const host=$('population-density-key');host.replaceChildren();host.hidden=!$('population-density').checked;
    host.append(node('strong','ACS 2020–2024 · residents / square mile'));
    const key=node('div');key.className='population-swatches';
    for(const [label,color]of [['0–100','#e4f1f5'],['>100–500','#b4d5e6'],['>500–2,000','#74a9cf'],['>2,000–5,000','#3685b5'],['>5,000','#145a87'],['No data','#949ca4']]){const row=node('div'),swatch=node('span');swatch.style.backgroundColor=color;row.append(swatch,document.createTextNode(label));key.append(row);}host.append(key);
    if(legendError)host.append(node('p','ACS map unavailable: '+legendError+'. Zone estimates use a separate 2020 block source.'));
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
    if(problem){const notice=node('calcite-notice');notice.open=true;notice.kind='warning';const text=node('div',`Population unavailable: ${problem}. Retry the selected zone; no zero or current affected-person count is inferred.`);text.slot='message';notice.append(text);host.append(notice);}
    else if(!result)host.append(node('p','Retrieving complete 2020 Census block polygons and checking overlaps…'));
    else{
      host.append(node('h3',`${approximatePopulation(result.estimate)} baseline residents`),node('p','2020 Census · Fresno County residents within the selected zone, estimated from block overlap. This does not mean the zone is under an active order.'));
      const table=node('table'),caption=node('caption','Population evidence for this zone');table.append(caption);const body=node('tbody');
      for(const [label,value]of [['Residents in fully contained blocks',number(result.wholePopulation)],['Residents in whole boundary-crossing blocks',number(result.boundaryPopulation)],['Whole / boundary-crossing blocks',`${result.wholeBlocks} / ${result.boundaryBlocks}`],['Missing population records',number(result.missing)]]){const tr=node('tr'),th=node('th',label);th.scope='row';tr.append(th,node('td',value));body.append(tr);}table.append(body);host.append(table);
      if(!result.blocks)host.append(node('p','No positive-area census overlap returned; population is unavailable, not confirmed zero.'));
      if(result.missing)host.append(node('p','Some population values are missing or suppressed; no complete zone estimate is displayed.'));
      host.append(node('p',`Census polygons queried ${result.accounting.queried} / retained ${result.accounting.retained} · checked ${time(result.checked)}.`));
      const methods=node('details');methods.append(node('summary','Estimate method, uncertainty & sources'),node('p',POPULATION_METHOD),node('p','Only Fresno County blocks are counted, including for shared-border zone records. The boundary-crossing row counts all residents of those entire census blocks. It is context for allocation uncertainty, not additional residents to add to the estimate. Block counts are distinct from ACS tract estimates.'),node('p',POPULATION_LIMIT),link('County 2020 Census population viewer',POPULATION_SOURCES.countyMap),node('br'),link('2020 block source',POPULATION_SOURCES.blocks),node('br'),link('Fresno COG ACS 2020–2024 source',POPULATION_SOURCES.cogItem));host.append(methods);
    }
    host.append(node('p',POPULATION_LIMIT),node('p','Cyan: selected county zone outline. Optional dashed outlines: whole queried census blocks, including portions outside the zone.'),link('County evacuation source',CARE_SOURCES.zoneItem));
  }
  async function ensureTools(){
    if(tools&&(!map||graphics))return tools;if(pendingTools)return pendingTools;
    pendingTools=(async()=>{const sdk=await loadSdk();const [GraphicsLayer,Graphic,FeatureLayer,Polygon,intersection,area]=await sdk.import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/layers/FeatureLayer.js','@arcgis/core/geometry/Polygon.js','@arcgis/core/geometry/operators/intersectionOperator.js','@arcgis/core/geometry/operators/geodeticAreaOperator.js']);if(!area.isLoaded())await area.load();operators={Polygon,intersection,area};tools={GraphicsLayer,Graphic,FeatureLayer};
      if(map){graphics=new GraphicsLayer({title:'Selected county evacuation zone · population reference',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});blocksLayer=new GraphicsLayer({title:'Queried 2020 census block boundaries · not zone boundaries',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});
        density=new FeatureLayer({url:POPULATION_SOURCES.acs,title:'Fresno COG ACS 2020–2024 population density',definitionExpression:"GEOID LIKE '06019%'",outFields:['GEOID','tot_pop','popdens'],opacity:.65,renderer:{type:'class-breaks',field:'popdens',defaultSymbol:{type:'simple-fill',color:'#949ca4',outline:{color:'#343d45',width:.3}},defaultLabel:'No usable density',classBreakInfos:[[0,100,'#e4f1f5'],[100,500,'#b4d5e6'],[500,2000,'#74a9cf'],[2000,5000,'#3685b5'],[5000,1e12,'#145a87']].map(([minValue,maxValue,color])=>({minValue,maxValue,symbol:{type:'simple-fill',color,outline:{color:'#536775',width:.3}}}))},popupTemplate:{title:'Census tract {GEOID}',content:[{type:'text',text:'Fresno COG ACS 2020–2024 five-year estimates. Values describe the entire tract, not the selected evacuation zone. Margins of error are not supplied in this service.'},{type:'fields',fieldInfos:[{fieldName:'tot_pop',label:'Estimated tract residents',format:{places:0,digitSeparator:true}},{fieldName:'popdens',label:'Residents per square mile',format:{places:1,digitSeparator:true}}]}]}});
        map.registerLayer('populationDensity',density,true,1);map.registerLayer('populationZones',blocksLayer);map.registerLayer('populationZones',graphics);draw();
        void density.load().then(()=>{legendError=null;legend();reportHealth('population:acs','Fresno COG ACS tract context',{checked:Date.now(),maxAgeMs:Infinity,detail:'ACS 2020–2024 five-year estimates; not current occupancy. Margins of error are not supplied.'});}).catch(()=>{legendError='Publisher layer could not load';legend();reportHealth('population:acs','Fresno COG ACS tract context',{error:legendError});});
      }return tools;
    })().catch(e=>{tools=null;throw e;}).finally(()=>{pendingTools=null;});return pendingTools;
  }
  async function select(key){
    const row=zones?.rows.find(r=>r.key===key);if(!row||exercise)return;
    abort?.abort();abort=new AbortController();const generation=++epoch;selected=row;result=null;collection=null;problem=null;list();detail();onMap();pane.setAttribute('open','');
    try{
      await ensureTools();if(generation!==epoch||!isWatch())return;
      map?.setLayerPreference('populationZones',true);map?.setLayerPreference('populationDensity',$('population-density').checked);draw();void map?.focusReferenceGeometry(row.geometry);
      const signature=JSON.stringify(row.geometry),saved=cache.get(row.key);
      if(saved?.signature===signature&&Date.now()-saved.result.checked<600000){result=saved.result;collection=saved.collection;}
      else{const records=await readPopulationBlocks(row.geometry,{signal:abort.signal});const summary=await calculateZonePopulation(row,records,{...operators,current:()=>generation===epoch&&isWatch()});if(generation!==epoch||!isWatch())return;collection=records;result=summary;cache.set(row.key,{signature,collection,result});if(cache.size>5)cache.delete(cache.keys().next().value);}
      if(generation!==epoch)return;reportHealth('population:blocks','Selected zone · 2020 Census population',{checked:result.checked,state:result.missing||!result.blocks?'coverage':null,maxAgeMs:Infinity,detail:'2020 baseline; boundary allocation is approximate, not live occupancy. Assessed only for the selected zone.'});list();detail();draw();
    }catch(e){if(generation!==epoch||e.name==='AbortError')return;problem=e.message||'Source or geometry calculation failed';result=null;collection=null;list();detail();draw();reportHealth('population:blocks','Selected zone · 2020 Census population',{error:problem,detail:'Selected zone population remains unknown; retry or consult the source.'});}
  }
  async function refreshZones(){
    if(busy||exercise||!county)return;busy=true;$('population-refresh').loading=true;
    try{const next=await readCareCollection('zones',{county});zones=next;zoneError=null;const old=selected;if(old){const current=next.rows.find(r=>r.key===old.key);if(!current){epoch++;abort?.abort();selected=null;result=null;collection=null;problem='The selected county zone is no longer returned; its current status is unknown. Choose a current source record.';draw();detail();}else if(JSON.stringify(current.geometry)!==JSON.stringify(old.geometry)){epoch++;abort?.abort();cache.delete(old.key);selected=current;result=null;collection=null;problem='The zone boundary changed. Retry the selected zone to calculate its revised population baseline.';draw();detail();}else{selected=current;detail();}}
      list();if(!selected&&params.get('zone')){const match=next.rows.find(r=>r.name===params.get('zone'));if(match)void select(match.key);}
      reportHealth('care:zones','County evacuation-zone query',{checked:next.checked,maxAgeMs:420000,detail:'Individual condition times unavailable; verify current orders with the county.'});
    }catch(e){zoneError=e.message;list();detail();reportHealth('care:zones','County evacuation-zone query',{checked:zones?.checked,error:zoneError,detail:'Retained zone boundaries/status require verification.'});}
    finally{busy=false;$('population-refresh').loading=false;}
  }
  function refresh(){if(zonePending)return zonePending;zonePending=refreshZones().finally(()=>{zonePending=null;});return zonePending;}
  async function showContext(){if(!map||exercise||!isWatch())return;try{await ensureTools();if(!isWatch())return;map.setLayerPreference('populationDensity',$('population-density').checked);if(selected)map.setLayerPreference('populationZones',true);}catch(e){legendError=e.message;legend();}}
  function open(){onOpenWatch();root.open=true;root.scrollIntoView({block:'nearest'});if(!zones||zoneError)void refresh();else list();void showContext();}
  $('population-query').addEventListener('input',list);$('population-filter').addEventListener('change',list);$('population-zone').addEventListener('change',()=>{if($('population-zone').value)void select($('population-zone').value);else{epoch++;abort?.abort();selected=null;result=null;collection=null;problem=null;draw();detail();list();}});
  $('population-refresh').addEventListener('click',()=>void refresh());$('population-retry').addEventListener('click',()=>{if(selected){cache.delete(selected.key);void select(selected.key);}});
  $('population-density').addEventListener('change',async()=>{legend();if(!isWatch())return;try{await ensureTools();if(isWatch())map?.setLayerPreference('populationDensity',$('population-density').checked);}catch(e){legendError=e.message;legend();}});
  $('population-blocks').addEventListener('change',draw);
  document.addEventListener('frogLayerPreference',e=>{if(e.detail?.key==='populationDensity'){$('population-density').checked=e.detail.wanted;legend();}});
  root.addEventListener('toggle',()=>{if(root.open){if(!zones)void refresh();void showContext();}});
  pane.addEventListener('stormEvidenceClose',()=>{epoch++;abort?.abort();if(selected&&!result){problem='Selection closed before the calculation completed';list();}});
  window.addEventListener('frogPopulationZoneSelect',e=>{if(zones?.rows.some(r=>r.key===e.detail?.key))void select(e.detail.key);});
  window.addEventListener('pagehide',()=>{epoch++;abort?.abort();cache.clear();collection=null;});
  setInterval(()=>{if(root.open&&isWatch()&&!document.hidden)void refresh();},300000);
  if(exercise){$('population-refresh').disabled=true;$('population-density').disabled=true;$('population-zone').disabled=true;}
  list();legend();
  return {open,async selectZone(key){open();if(!zones)await refresh();if(zones?.rows.some(r=>r.key===key))await select(key);},setCounty(value){county=value;if(params.get('population')==='1')open();},async setMap(value){map=value;if(root.open){await showContext();if(selected&&isWatch())void map.focusReferenceGeometry(selected.geometry);}}};
}
