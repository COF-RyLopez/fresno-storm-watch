import {reportHealth} from './source-health.js?v=0.73.1';
import { loadSdk } from './map.js?v=0.73.1';
import { formatTime } from './model.js';
import { RADAR_URL,QPF_URL,QPF_PERIODS,QPF_BANDS,qpfPlanningTime,reservoirMetricState,validateReservoirSnapshot } from './environment-model.js?v=0.40.1';
import { environmentalJson,fetchRadarFrames,fetchQpfCycle } from './environment-data.js';
import {scheduleEvidence} from './release-model.js';
import {appendScheduledReleases} from './release-ui.js';
import {createWeatherTimeline} from './weather-ui.js?v=0.73.1';
import {observationAt} from './weather-model.js';

const $=id=>document.getElementById(id);
/** @param {string} tag @param {string} text @param {string} className @returns {HTMLElement} Source content is text, never executable markup. */
function el(tag,text='',className=''){const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}
/** @param {string} label @param {string} href @returns {HTMLElement} Only trusted configured publisher links. */
function link(label,href){const n=el('a',label);n.href=href;n.target='_blank';n.rel='noopener noreferrer';return n;}

/** @param {object} options @returns {object} Independent public weather/reservoir controller. */
export function createEnvironmentWatch({config,timeZone,exercise,onMap=()=>{},onTrends=()=>{},onReservoirData=()=>{},onWindData=()=>{},onOverlayChange=()=>{},onWeatherData=()=>{}}){
  let map=null,layers=null,selection=null,snapshot=null,snapshotError=null,snapshotRead=null;
  let radar=[],radarError=null,radarChecked=null,qpf=null,qpfError=null,qpfChecked=null;
  let overlay='radar',period=QPF_PERIODS[1],frameChoice='latest',busy=false,resBusy=false,layerError=null;
  let nextWeather=0,nextReservoir=0,cycleRequest=0;
  let rainfallTimeRequest=null;
  const layerErrors=new Map();
  let reservoirRenderKey='';
  const parameters=new URLSearchParams(location.search);
  if(!exercise&&['radar','qpf','satellite'].includes(parameters.get('overlay')))overlay=parameters.get('overlay');
  period=QPF_PERIODS.find(p=>String(p.id)===parameters.get('qpf'))||period;
  for(const option of $('qpf-period').children)option.toggleAttribute('selected',option.getAttribute('value')===String(period.id));
  const time=t=>formatTime(Number.isFinite(t)?t:null,timeZone);
  const newButton=(text,fn)=>{const b=el('calcite-button',text);b.setAttribute('scale','s');b.setAttribute('appearance','outline');b.addEventListener('click',fn);return b;};
  const weather=createWeatherTimeline({time,exercise,onChange:renderWeather,onMap,onWindData});
  const currentFrame=()=>{const stamp=observationAt(radar.map(f=>f.time),weather.target(),Date.now(),{maxAgeMs:config.radarMaxAgeMs});return radar.find(f=>f.time===stamp);};
  const activeLayerError=()=>layerError||(['radar','qpf'].includes(overlay)&&layerErrors.get(`${overlay==='radar'?'radar':period.id}:${map?.view.type}`));
  const checkOverdue=checked=>checked===null||Date.now()-checked>config.weatherCheckMaxAgeMs;
  const radarUsable=()=>!exercise&&!radarError&&!checkOverdue(radarChecked)&&radar[0]&&Date.now()-radar[0].time<=config.radarMaxAgeMs&&currentFrame();
  const qpfUsable=()=>!exercise&&!qpfError&&!checkOverdue(qpfChecked)&&qpf&&qpf.hours===period.hours&&Date.now()-qpf.issue<=config.qpfMaxAgeMs&&qpf.end>Date.now()&&weather.target()>=qpf.start&&weather.target()<qpf.end&&weather.target()>=qpf.issue;

  function alignRainfallTime(){
    if(rainfallTimeRequest!==period.id||overlay!=='qpf'||!qpf)return;
    rainfallTimeRequest=null;
    if(qpfError||checkOverdue(qpfChecked))return;
    const target=weather.target(),next=qpfPlanningTime(qpf,target,Date.now(),config.qpfMaxAgeMs);
    if(next!==null&&next!==target)weather.selectTime(next);
  }

  function syncLayers(){
    if(!layers)return;
    const frame=currentFrame();
    map.setLayerEligibility(layers.radar,overlay==='radar'&&!!radarUsable()&&!activeLayerError());
    if(frame&&layers.frameId!==frame.id){layers.radar.mosaicRule={method:'lock-raster',lockRasterIds:[frame.id],mosaicOperation:'first'};layers.frameId=frame.id;}
    for(const [id,layer] of layers.qpf){
      map.setLayerEligibility(layer,overlay==='qpf'&&id===period.id&&!!qpfUsable()&&!activeLayerError());
      if(id===period.id&&qpfUsable())layer.definitionExpression=`issue_time = '${qpf.issueText}' AND start_time = '${qpf.startText}' AND end_time = '${qpf.endText}' AND units = 'Inches' AND qpf >= 0.01`;
    }
  }

  function renderWeather(){
    if(!exercise){reportHealth('radar','NOAA radar',{checked:radarChecked,error:radarError,state:!radarChecked?'checking':!radar[0]?'coverage':Date.now()-radar[0].time>config.radarMaxAgeMs?'stale':null,detail:radar[0]?'Catalog check; the selected observation time remains on the map.':'No recent CONUS image returned.'});reportHealth('wpc-cycle','WPC rainfall forecast cycle',{checked:qpfChecked,error:qpfError,state:!qpfChecked?'checking':!qpf?'coverage':Date.now()-qpf.issue>config.qpfMaxAgeMs||qpf.end<Date.now()?'stale':null,detail:qpf?'Forecast issue and valid window remain on the map.':'No forecast cycle returned.'});}
    weather.setOverlay(overlay);weather.setContext({radar,radarError:radarError||(checkOverdue(radarChecked)?'Catalog check overdue':null),qpf,qpfError:qpfError||(checkOverdue(qpfChecked)?'Cycle check overdue':null)});
    for(const kind of ['off','radar','qpf','satellite']){$(`env-${kind}`).setAttribute('aria-pressed',String(overlay===kind));$(`env-${kind}`).setAttribute('appearance',overlay===kind?'solid':'outline');}
    $('radar-controls').hidden=overlay!=='radar';$('qpf-controls').hidden=overlay!=='qpf';
    const frame=currentFrame();
    frameChoice=weather.live?'latest':frame?String(frame.id):'unavailable';
    updateFramePicker();
    $('radar-time').textContent=frame?`${weather.live?'Latest available':'Selected earlier observation'} · ${time(frame.time)}`:weather.target()>Date.now()?'Observed radar hidden at future planning time.':'No matching radar frame';
    $('radar-health').textContent=exercise?'Live radar disabled in exercise':radarError?`Radar check failed · ${radarError}`:!radarChecked?'Waiting for NOAA':weather.target()>Date.now()?'Future time selected · observed radar hidden':!frame?'No matching recent frame · choose Now / live':checkOverdue(radarChecked)?'Radar check overdue · overlay hidden':Date.now()-radar[0].time>config.radarMaxAgeMs?'Newest radar frame is old · overlay hidden':`Catalog checked ${time(radarChecked)}`;
    $('radar-health').dataset.tone=radarUsable()?'normal':'gap';
    $('qpf-issued').textContent=qpf?time(qpf.issue):'Not available';
    $('qpf-window').textContent=qpf?`${time(qpf.start)} → ${time(qpf.end)}`:'Not available';
    $('qpf-health').textContent=exercise?'Live QPF disabled in exercise':qpfError?`Forecast check failed · ${qpfError}`:!qpfChecked?'Waiting for WPC':qpf&&(weather.target()<qpf.start||weather.target()>=qpf.end)?'Selected time is outside this accumulation window · overlay hidden':qpf&&weather.target()<qpf.issue?'Selected time predates this forecast update · overlay hidden':!qpfUsable()?'Forecast is old, ended or check overdue · overlay hidden':`Cycle checked ${time(qpfChecked)} · showing the full accumulation window`;
    $('qpf-health').dataset.tone=qpfUsable()?'normal':'gap';
    const usable=overlay==='radar'?radarUsable():overlay==='qpf'?qpfUsable():overlay==='satellite'?weather.satelliteReady():true;
    const selected=overlay==='off'?'Atmospheric overlay off':overlay==='satellite'?weather.status():overlay==='radar'?`Radar ${weather.live?'latest':'history'} · ${frame?time(frame.time):'no frame'}`:`WPC ${period.hours}h QPF · ${qpf?time(qpf.start)+' to '+time(qpf.end):'no valid cycle'}`;
    $('environment-map-status').textContent=selected+(overlay!=='off'?(activeLayerError()?' · map layer failed':!usable?' · unavailable/hidden':!layers?' · map initializing':''):'')+(overlay!=='satellite'?weather.status():'');
    $('environment-map-status').dataset.tone=usable&&!activeLayerError()?'normal':'gap';
    $('environment-legend').hidden=overlay==='off';$('radar-legend').hidden=overlay!=='radar';$('qpf-legend').hidden=overlay!=='qpf';
    $('environment-refresh').toggleAttribute('loading',busy);$('environment-refresh').toggleAttribute('disabled',busy||exercise);
    syncLayers();onWeatherData({overlay,period,qpf,selectedTime:weather.target(),usable:!!qpfUsable(),rainfallHealth:$('qpf-health').textContent,layerError:!!activeLayerError(),status:$('environment-map-status').textContent});
  }

  function updateFramePicker(){
    const picker=$('radar-frame');picker.replaceChildren();
    const latest=el('calcite-option','Latest available');latest.setAttribute('value','latest');latest.toggleAttribute('selected',frameChoice==='latest');picker.append(latest);
    for(const f of radar.filter((_,i)=>i%3===0).slice(0,16)){
      const o=el('calcite-option',time(f.time));o.setAttribute('value',String(f.id));o.toggleAttribute('selected',frameChoice===String(f.id));picker.append(o);
    }
    if(frameChoice!=='latest'&&![...picker.children].some(o=>o.getAttribute('value')===frameChoice)){
      const o=el('calcite-option',currentFrame()?time(currentFrame().time):'Selected historical frame expired · choose Latest');o.setAttribute('value',frameChoice);o.setAttribute('selected','');picker.append(o);
    }
  }

  async function refreshWeather(){
    if(busy||exercise||document.hidden)return;
    busy=true;renderWeather();const request=++cycleRequest,requestedPeriod=period;
    const results=await Promise.allSettled([fetchRadarFrames(),fetchQpfCycle(requestedPeriod)]);
    if(results[0].status==='fulfilled'){radar=results[0].value;radarChecked=Date.now();radarError=null;updateFramePicker();}else radarError=results[0].reason.message;
    if(request===cycleRequest&&period.id===requestedPeriod.id){if(results[1].status==='fulfilled'){if(qpf&&qpf.issue!==results[1].value.issue)map?.clearEnvironmentPopup();qpf=results[1].value;qpfChecked=Date.now();qpfError=null;alignRainfallTime();}else{rainfallTimeRequest=null;qpfError=results[1].reason.message;if(overlay==='qpf')map?.clearEnvironmentPopup();}}
    busy=false;nextWeather=Date.now()+config.pollMs;renderWeather();
    if(request!==cycleRequest)void refreshWeather();
  }

  function renderReservoirs(){
    onReservoirData({selection,snapshot,error:snapshotError,checked:snapshotRead});
    const status=$('reservoir-status'),now=Date.now();
    const generation=snapshot?Date.parse(snapshot.generatedAt):null;
    const overdue=generation!==null&&(now-generation>config.collectorMaxAgeMs||generation>now+120_000);
    status.textContent=exercise?'Reservoir feeds disabled in exercise':snapshotError?`Snapshot check failed · ${snapshotError}`:!snapshot?'Waiting for collected CDEC data':overdue?'Reservoir collection is overdue · values may be old':`${snapshot.stations.some(s=>s.error||s.scheduled?.error)?'Collection incomplete':'Collected'} ${time(generation)}`;
    status.dataset.tone=snapshotError||overdue||snapshot?.stations.some(s=>s.error||s.scheduled?.error)?'gap':'normal';
    $('reservoir-read-time').textContent=snapshotRead?`App checked ${time(snapshotRead)} · collector target 15 min`:'Collector target 15 min · app checks each minute';
    if(!selection)return;
    if(!exercise)for(const station of selection.stations){const row=snapshot?.stations.find(s=>s.id===station.id),bad=station.metrics.map(m=>({metric:m.label,...reservoirMetricState(row?.metrics?.[m.key],m,now)})).filter(m=>m.tone!=='normal');reportHealth('cdec:'+station.id,'CDEC · '+station.name,{checked:Date.parse(row?.lastSuccess),error:snapshotError||row?.error||row?.scheduled?.error,state:!snapshot?'checking':!snapshotRead||now-snapshotRead>config.weatherCheckMaxAgeMs||overdue||bad.some(m=>m.label==='Old reading')?'stale':bad.length?'coverage':null,detail:bad.length?bad.map(m=>m.metric+': '+m.label).join('; '):'Observation times, units and release schedules remain separate.',maxAgeMs:config.collectorMaxAgeMs});}
    const schedules=selection.stations.map(s=>scheduleEvidence({selection,snapshot,error:snapshotError,checked:snapshotRead,config},s.id,now));
    const key=JSON.stringify([snapshot,snapshotError,overdue,schedules,selection.stations.map(s=>s.metrics.map(m=>reservoirMetricState(snapshot?.stations.find(r=>r.id===s.id)?.metrics?.[m.key],m,now).label))]);
    if(key===reservoirRenderKey)return;reservoirRenderKey=key;
    const list=$('reservoir-list');list.replaceChildren();
    for(const station of selection.stations){
      const row=snapshot?.stations.find(s=>s.id===station.id);
      const card=el('calcite-block','','reservoir-card');const heading=el('h3');const location=newButton(station.name,()=>{onMap();map?.focusEnvironment(station.longitude,station.latitude);});location.setAttribute('icon-start','cube');location.toggleAttribute('disabled',!map);location.title='Locate reservoir in 3D';heading.append(location);card.append(heading,el('p',`${station.river} · ${station.operator} · ${station.id}`));card.setAttribute('expanded','');
      if(row?.error||snapshotError||overdue){const warning=el('p',row?.error?`Source check failed: ${row.error}. Previous values retained.`:'Collection unavailable or overdue · verify the publisher.','environment-health');warning.dataset.tone='gap';card.append(warning);}
      const grid=el('dl','','reservoir-grid');
      for(const metric of station.metrics){
        const assessment=reservoirMetricState(row?.metrics?.[metric.key],metric,now),sample=assessment.sample;
        const cell=el('div','','reservoir-metric');cell.dataset.tone=assessment.tone;
        cell.append(el('dt',metric.label));const dd=el('dd',sample?`${new Intl.NumberFormat('en-US',{maximumFractionDigits:metric.decimals,minimumFractionDigits:metric.decimals}).format(sample.value)} ${metric.displayUnits}`:'Unknown');cell.append(dd);
        cell.append(el('small',sample?(metric.duration==='D'?`Report date ${sample.reportDate} · PST`:time(sample.time)):'No valid source reading'));
        cell.append(el('small',assessment.label,'metric-state'));grid.append(cell);
      }
      card.append(grid);
      const conflicts=Object.values(row?.metrics||{}).reduce((n,m)=>n+(m.conflicts||0),0);
      if(conflicts)card.append(el('p',`${conflicts} conflicting source timestamp${conflicts===1?'':'s'} excluded; unaffected readings remain available.`,'watch-gap'));
      appendScheduledReleases(card,schedules.find(s=>s.station===station.id),time);
      const actions=el('div','','environment-actions');actions.append(newButton('Release & gauge trends',()=>onTrends(station.id)),newButton('Locate dam',()=>{onMap();map?.focusEnvironment(station.longitude,station.latitude);}),link('CDEC source',station.source));
      if(station.releaseNotices)actions.append(link('Release notices',station.releaseNotices));card.append(actions);
      const details=el('details','','environment-details');details.append(el('summary','Release meaning & source details'),el('p',station.note),el('p',`Last successful collection: ${time(row?.lastSuccess?Date.parse(row.lastSuccess):null)}. Pool elevation uses the publisher reference; datum is not specified in this feed.`),link('Station metadata',station.metadata));card.append(details);list.append(card);
    }
    if(layers)drawReservoirs();
  }

  async function refreshReservoirs(){
    if(resBusy||exercise||document.hidden)return;resBusy=true;
    try{snapshot=validateReservoirSnapshot(await environmentalJson(new URL('../data/reservoir-latest.json',import.meta.url)));snapshotError=null;snapshotRead=Date.now();}catch(error){snapshotError=error.message;}
    resBusy=false;nextReservoir=Date.now()+config.snapshotPollMs;renderReservoirs();
  }

  function drawReservoirs(){
    if(!selection||!layers)return;
    layers.reservoirs.removeAll();
    for(const s of selection.stations)layers.reservoirs.add(new layers.Graphic({geometry:{type:'point',longitude:s.longitude,latitude:s.latitude,spatialReference:{wkid:4326}},symbol:{type:'picture-marker',url:new URL('../assets/reservoir-pin.svg',import.meta.url).href,width:25,height:25},attributes:{name:s.name,river:s.river},popupTemplate:{title:'{name}',content:'{river}. Select Reservoirs for dated pool, storage, inflow and release readings. This point is the CDEC reporting location, not a water-surface elevation.'}}));
  }

  function selectOverlay(kind,notify=true){if(!['off','radar','qpf','satellite'].includes(kind))return;if(kind!=='qpf')rainfallTimeRequest=null;map?.clearEnvironmentPopup();overlay=kind;if(notify)onOverlayChange(kind);renderWeather();}
  for(const kind of ['off','radar','qpf','satellite'])$(`env-${kind}`).addEventListener('click',()=>selectOverlay(kind));
  $('radar-frame').addEventListener('calciteSelectChange',e=>{const frame=radar.find(f=>String(f.id)===e.target.value);if(e.target.value==='latest')weather.selectTime(null);else if(frame)weather.selectTime(frame.time);});
  $('qpf-period').addEventListener('calciteSelectChange',e=>{
    const requested=QPF_PERIODS.find(p=>String(p.id)===e.target.value);if(!requested||requested.id===period.id)return;
    rainfallTimeRequest=null;map?.clearEnvironmentPopup();period=requested;qpf=null;qpfError=null;qpfChecked=null;cycleRequest++;renderWeather();void refreshWeather();
  });
  $('environment-refresh').addEventListener('click',()=>void refreshWeather());
  $('reservoir-refresh').addEventListener('click',()=>void refreshReservoirs());
  $('environment-extent').addEventListener('click',()=>{onMap();map?.fitEnvironment();});
  $('qpf-band-list').replaceChildren(...QPF_BANDS.map(b=>{const n=el('span',`${b.label} in`);const swatch=el('i');swatch.style.background=b.color;n.prepend(swatch);return n;}));
  if(exercise){for(const id of ['env-radar','env-qpf','env-satellite','radar-frame','qpf-period','reservoir-refresh'])$(id).setAttribute('disabled','');}
  void environmentalJson(new URL('../data/reservoir-watchlist.json',import.meta.url)).then(s=>{selection=s;renderReservoirs();}).catch(error=>{snapshotError=error.message;renderReservoirs();});
  void refreshWeather();void refreshReservoirs();renderWeather();renderReservoirs();
  const tick=()=>{if(document.hidden)return;renderWeather();renderReservoirs();if(!exercise&&Date.now()>=nextWeather)void refreshWeather();if(!exercise&&Date.now()>=nextReservoir)void refreshReservoirs();};
  setInterval(tick,30_000);document.addEventListener('visibilitychange',tick);
  window.addEventListener('online',()=>{nextWeather=0;nextReservoir=0;tick();});
  window.addEventListener('offline',()=>{radarError='Browser offline';qpfError='Browser offline';snapshotError='Browser offline';renderWeather();renderReservoirs();});
  return {selectRainfall(id,{selectValidTime=false}={}){const requested=QPF_PERIODS.find(p=>p.id===id);if(requested&&requested.id!==period.id){period=requested;qpf=null;qpfError=null;qpfChecked=null;cycleRequest++;$('qpf-period').value=String(period.id);void refreshWeather();}rainfallTimeRequest=selectValidTime?period.id:null;selectOverlay('qpf');alignRainfallTime();},selectOverlay,focusReservoir:id=>{const station=selection?.stations.find(s=>s.id===id);if(station){onMap();map?.focusEnvironment(station.longitude,station.latitude);}},async setMap(controller){
    map=controller;reservoirRenderKey='';renderReservoirs();
    void weather.setMap(controller);
    try{
      const sdk=await loadSdk();const [ImageryLayer,FeatureLayer,GraphicsLayer,Graphic]=await sdk.import(['@arcgis/core/layers/ImageryLayer.js','@arcgis/core/layers/FeatureLayer.js','@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);
      const radarLayer=new ImageryLayer({url:RADAR_URL,title:'NOAA radar reflectivity — selected frame',format:'png32',opacity:0.72,visible:false,popupEnabled:false});
      const forecasts=new Map(QPF_PERIODS.map(p=>[p.id,new FeatureLayer({url:`${QPF_URL}/${p.id}`,title:`WPC ${p.hours}-hour QPF — inches liquid equivalent`,visible:false,opacity:0.7,definitionExpression:'1=0',outFields:['qpf','units','issue_time','start_time','end_time'],
        renderer:{type:'class-breaks',field:'qpf',defaultSymbol:{type:'simple-fill',color:'#99999955',outline:{color:'#666',width:0.5}},classBreakInfos:QPF_BANDS.map(b=>({minValue:b.min,maxValue:b.max,label:`${b.label} in`,symbol:{type:'simple-fill',color:b.color,outline:{color:'#234b6c',width:0.35}}}))},
        popupTemplate:{title:'WPC forecast polygon · {qpf} {units}',content:[{type:'text',text:'Publisher QPF polygon value (liquid equivalent), not a basin average, runoff amount or flood depth. Source times below are UTC.'},{type:'fields',fieldInfos:[{fieldName:'issue_time',label:'Issued (UTC)'},{fieldName:'start_time',label:'Period starts (UTC)'},{fieldName:'end_time',label:'Period ends (UTC)'}]}]}})]));
      const reservoirs=new GraphicsLayer({title:'CDEC reservoir reporting locations',elevationInfo:{mode:'relative-to-ground'}});
      layers={radar:radarLayer,qpf:forecasts,reservoirs,Graphic,frameId:null};
      for(const [id,layer] of [['radar',radarLayer],...forecasts]){
        layer.on('layerview-create-error',event=>{layerErrors.set(`${id}:${event.view.type}`,true);renderWeather();});
        layer.on('layerview-create',event=>{layerErrors.delete(`${id}:${event.view.type}`);renderWeather();});
      }
      map.onViewChanged(renderWeather);
      map.registerLayer('weather',radarLayer,false,1);for(const l of forecasts.values())map.registerLayer('weather',l,false,1);map.registerLayer('reservoirs',reservoirs);drawReservoirs();renderWeather();
      $('environment-extent').removeAttribute('disabled');
    }catch(error){layerError=error.message;renderWeather();}
  }};
}
