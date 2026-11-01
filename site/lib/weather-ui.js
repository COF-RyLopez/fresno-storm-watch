import {svgNode} from './river-chart.js';
import {reportHealth} from './source-health.js';
import {createHrrrWeather} from './hrrr-ui.js';
import {loadSdk} from './map.js';
import {fetchSatelliteCatalog,fetchCurrentWind} from './weather-data.js';
import {GOES_URL,GOES_PRODUCTS,HOUR,weatherStops,observationAt,windAt,windCompass} from './weather-model.js';
import {elClass as el,classLink} from './dom.js';

const $=id=>document.getElementById(id);
const value=n=>Number.isFinite(n)?Math.round(n).toLocaleString('en-US'):'Unknown';

/** @param {object} options @returns {object} One selected time, with explicit per-source availability. */
export function createWeatherTimeline({time,exercise,onChange,onMap,onWindData=()=>{}}){
  let fixed=null,stops=weatherStops(),context={},product=GOES_PRODUCTS[0].id,overlay='off';
  let catalog=null,satelliteError=null,satelliteChecked=null,wind=null,windError=null,windChecked=null;
  let busy=false,next=0,controller=null,layers=null,selected='SJ41',mapErrors=new Map(),drawKey='';
  const target=(now=Date.now())=>fixed??now;
  const overdue=()=>!wind||Date.now()-Date.parse(wind.generatedAt)>45*60_000||Date.parse(wind.generatedAt)>Date.now()+120_000;
  const satelliteFrame=()=>!satelliteError&&satelliteChecked&&Date.now()-satelliteChecked<=7*60_000?observationAt(catalog?.[product]||[],target(),Date.now(),{maxGapMs:20*60_000,maxAgeMs:30*60_000}):null;
  const windVisible=()=>!exercise;
  const sourceLink=site=>`https://forecast.weather.gov/MapClick.php?lat=${site.latitude}&lon=${site.longitude}`;
  const selectTime=stamp=>{fixed=stamp;render();onChange();};
  const hrrr=createHrrrWeather({time,exercise,target,onTime:selectTime,onMap});

  function chart(site){
    const host=$('wind-chart');host.replaceChildren();
    if(!site?.forecast||windAt(site,Date.now(),Date.now(),overdue()).reason)return;
    const start=Math.ceil(Date.now()/HOUR)*HOUR,end=start+72*HOUR;
    const samples=Array.from({length:73},(_,i)=>({at:start+i*HOUR,...windAt(site,start+i*HOUR,Date.now(),overdue())}));
    const ymax=Math.max(10,Math.ceil(Math.max(0,...samples.flatMap(r=>[r.speed??0,r.gust??0]))/5)*5);
    const x=t=>35+(t-start)/(end-start)*270,y=v=>125-v/ymax*102;
    const svg=svgNode('svg',{viewBox:'0 0 320 155',role:'img','aria-label':`${site.name}, wind and gust forecast in miles per hour for the next 72 hours`});
    for(const n of [0,ymax/2,ymax]){svg.append(svgNode('line',{x1:35,y1:y(n),x2:305,y2:y(n),stroke:'var(--chart-grid)'}),svgNode('text',{x:30,y:y(n)+4,'text-anchor':'end',fill:'var(--chart-text)','font-size':10},String(n)));}
    for(const h of [0,24,48,72])svg.append(svgNode('text',{x:x(start+h*HOUR),y:144,'text-anchor':'middle',fill:'var(--chart-text)','font-size':10},`+${h}h`));
    svg.append(svgNode('text',{x:4,y:12,fill:'var(--chart-text)','font-size':10},'mph'));
    for(const [key,color,dash] of [['speed','var(--chart-observed)',''],['gust','var(--chart-forecast)','4 2']]){
      let d='',prior=null;
      for(const sample of samples){const n=sample[key];if(n===null){prior=null;continue;}d+=prior===null?`M${x(sample.at)},${y(n)}`:`H${x(sample.at)}V${y(n)}`;prior=n;}
      svg.append(svgNode('path',{d,fill:'none',stroke:color,'stroke-width':2,'stroke-dasharray':dash}));
    }
    if(target()>=start&&target()<=end)svg.append(svgNode('line',{x1:x(target()),x2:x(target()),y1:18,y2:125,stroke:'var(--chart-now)','stroke-dasharray':'3 3'}));
    host.append(svg,el('figcaption','Latest forecast · sustained wind (solid), gust (dashed) · hourly samples, next 72h. Gaps are unknown.'));
  }

  function drawWind(){
    if(!layers)return;
    controller.setLayerEligibility(layers.wind,windVisible());controller.setLayerEligibility(layers.windLabels,windVisible());
    const now=Date.now(),rows=(wind?.sites||[]).map(site=>({site,state:windAt(site,target(),now,overdue()||!!windError)}));
    const key=JSON.stringify([rows,windVisible()]);if(key===drawKey)return;drawKey=key;
    layers.wind.removeAll();layers.windLabels.removeAll();
    if(!windVisible())return;
    for(const {site,state:s} of rows){
      if(s.reason||(s.speed===null&&s.gust===null))continue;
      const geometry={type:'point',longitude:site.longitude,latitude:site.latitude,spatialReference:{wkid:4326}};
      const text=`${site.name}\n${value(s.speed)} · G ${value(s.gust)} mph`;
      const popup=()=>{const n=el('div');n.append(el('p',`Forecast at a sampled NWS grid cell · 10-meter winds. Sustained ${value(s.speed)} mph; gust ${value(s.gust)} mph; from ${windCompass(s.direction)}.`),el('p',`Selected ${time(target())}; forecast updated ${time(site.forecast.issued)}.`));for(const [k,label] of [['windSpeed','Sustained'],['windGust','Gust'],['windDirection','Direction']]){const sample=s.samples[k];n.append(el('p',`${label} interval: ${sample?`${time(sample.start)} → ${time(sample.end)}`:'Unknown'}`));}n.append(classLink('Official NWS point forecast',sourceLink(site)));return n;};
      layers.wind.add(new layers.Graphic({geometry,attributes:{weatherSiteId:site.id},symbol:{type:'simple-marker',style:'diamond',size:12,color:'#6fcbd9',outline:{color:'#172c35',width:1.5}},popupTemplate:{title:site.name,content:popup}}));
      layers.windLabels.add(new layers.Graphic({geometry,symbol:{type:'text',text,color:'#e7f5f8',haloColor:'#172c35',haloSize:1.5,yoffset:18,font:{family:'Arial',size:9}},popupEnabled:false}));
    }
  }

  function render(){
    const now=Date.now(),stamp=target(now),future=stamp>now;
    if(!exercise){reportHealth('goes','NOAA GOES catalog',{checked:satelliteChecked,error:satelliteError,state:!catalog?'checking':!catalog[product]?.length?'coverage':now-Math.max(...catalog[product])>30*60000?'stale':null,detail:'Catalog check; observed imagery is not a future forecast.'});for(const site of wind?.sites||[]){const state=windAt(site,now,now,overdue());reportHealth('wind:'+site.id,'NWS wind · '+site.name,{checked:windChecked,error:windError||site.error,state:overdue()?'stale':!site.forecast?'coverage':state.reason?'stale':state.speed===null||state.gust===null?'coverage':null,detail:state.reason||'NWS point forecast; missing wind or gust values remain unknown.'});}}
    $('weather-selected-time').textContent=`${fixed===null?'Now · follows clock':future?'Forecast planning time':'Past planning time'} · ${time(stamp)}`;
    $('weather-live').setAttribute('appearance',fixed===null?'solid':'outline');
    $('weather-time').value=String(fixed===null?12:stops.reduce((best,t,i)=>Math.abs(t-stamp)<Math.abs(stops[best]-stamp)?i:best,0));
    $('weather-time').setAttribute('aria-valuetext',time(stamp));
    const radar=observationAt((context.radar||[]).map(f=>f.time),stamp,now,{maxAgeMs:20*60_000});
    $('timeline-radar').textContent=exercise?'Exercise · live feed disabled':context.radarError?'Source check failed':future?'No future radar observation':radar?`Observed ${time(radar)}`:'No matching recent observation';
    const frame=satelliteFrame();
    $('timeline-satellite').textContent=exercise?'Exercise · live feed disabled':satelliteError?'Source check failed':future?'No future satellite observation':frame?`Observed ${time(frame)}`:'No matching recent observation';
    const cycle=context.qpf;
    $('timeline-rainfall').textContent=exercise?'Exercise · live feed disabled':context.qpfError?'Source check failed':cycle?`${cycle.hours}h total · ${stamp<cycle.issue?'selected time predates forecast update':stamp>=cycle.start&&stamp<cycle.end?'contains selected time':'outside selected time'} · ${time(cycle.start)} → ${time(cycle.end)}`:'Waiting for WPC forecast';
    $('satellite-time').textContent=frame?`Observed ${time(frame)} · ${GOES_PRODUCTS.find(p=>p.id===product).label}`:future?'Observed imagery is hidden at future planning times.':'No matching GOES image for this time.';
    const imageError=mapErrors.get(`${product}:${controller?.view.type}`);
    $('satellite-health').textContent=exercise?'Live GOES disabled in exercise':satelliteError?`GOES check failed · ${satelliteError}`:imageError?'GOES map image failed · overlay hidden':!satelliteChecked?'Waiting for NOAA':now-satelliteChecked>7*60_000?'GOES catalog check overdue · overlay hidden':`Catalog checked ${time(satelliteChecked)} · newest ${time(catalog?.[product]?.[0])}`;
    $('satellite-health').dataset.tone=frame&&!imageError?'normal':'gap';
    $('satellite-controls').hidden=overlay!=='satellite';$('satellite-legend').hidden=overlay!=='satellite';
    const productInfo=GOES_PRODUCTS.find(p=>p.id===product);$('satellite-meaning').textContent=productInfo.meaning;
    const legend=new URL(GOES_URL);legend.search=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetLegendGraphic',format:'image/png',layer:product});
    const img=$('satellite-legend-image');if(overlay==='satellite'&&!exercise&&img.getAttribute('src')!==legend.href)img.src=legend.href;
    img.alt=`NOAA publisher legend for ${productInfo.label}`;
    if(layers){controller.setLayerEligibility(layers.satellite,overlay==='satellite'&&!!frame&&!imageError);const layerKey=`${product}:${frame}`;if(frame&&layers.satelliteKey!==layerKey){layers.satelliteKey=layerKey;layers.satellite.sublayers=[{name:product}];layers.satellite.customLayerParameters={TIME:new Date(frame).toISOString()};layers.satellite.refresh();}}
    const sites=wind?.sites||[],states=sites.map(s=>windAt(s,stamp,now,overdue()||!!windError)),available=states.filter(s=>!s.reason&&(s.speed!==null||s.gust!==null)).length;
    $('timeline-wind').textContent=exercise?'Exercise · live feed disabled':`${available}/9 forecast samples available at selected time`;
    const failed=sites.filter(s=>s.error).length;
    $('wind-health').textContent=exercise?'Live wind forecasts disabled in exercise':windError?`Wind check failed · ${windError}`:!wind?'Waiting for NWS forecast collection':overdue()?'Wind collection overdue · map samples hidden':`${failed?failed+' source checks failed · ':''}${available}/9 samples available · ${wind.sourceMode==='browser-direct'?'direct NWS check':'collected'} ${time(Date.parse(wind.generatedAt))} · app checked ${time(windChecked)}`;
    $('wind-health').dataset.tone=available===9&&!overdue()&&!windError?'normal':'gap';
    $('wind-map-legend').hidden=!windVisible();$('wind-map-legend').textContent=`◆ Cyan diamonds: NWS wind / gust forecasts · mph · ${available}/9 samples · select for values`;
    if(sites.length&&$('wind-site').children.length!==sites.length){$('wind-site').replaceChildren(...sites.map(s=>{const o=el('calcite-option',s.name);o.setAttribute('value',s.id);o.toggleAttribute('selected',s.id===selected);return o;}));}
    const site=sites.find(s=>s.id===selected),s=site?windAt(site,stamp,now,overdue()||!!windError):null;
    hrrr.update(site);
    $('wind-speed').textContent=s?`${value(s.speed)}${s.speed===null?'':' mph'}`:'Unknown';$('wind-gust').textContent=s?`${value(s.gust)}${s.gust===null?'':' mph'}`:'Unknown';$('wind-direction').textContent=s&&s.direction!==null?`${windCompass(s.direction)} · ${Math.round(s.direction)}°`:'Unknown';
    $('wind-issued').textContent=site?.forecast?`Forecast updated ${time(site.forecast.issued)} · 10 m above ground`:'No forecast update available';
    $('wind-intervals').textContent=s?.reason||(['windSpeed','windGust'].map(k=>`${k==='windSpeed'?'Wind':'Gust'}: ${s?.samples[k]?`${time(s.samples[k].start)} → ${time(s.samples[k].end)}`:'No value for selected time'}`).join(' · '));
    $('wind-source').href=site?sourceLink(site):'https://www.weather.gov/hnx/';
    $('wind-locate').toggleAttribute('disabled',!site);chart(site);
    const all=$('wind-all-sites');all.replaceChildren();
    for(const [i,site] of sites.entries()){const row=el('p'),a=el('button',site.name,'weather-site-button');a.type='button';a.addEventListener('click',()=>{selected=site.id;onMap();controller?.focusWind(site.longitude,site.latitude);for(const o of $('wind-site').children)o.toggleAttribute('selected',o.getAttribute('value')===selected);render();});const s=states[i];row.append(a,el('span',s.reason?` · ${s.reason}`:` · ${value(s.speed)} / gust ${value(s.gust)} mph`));all.append(row);}
    $('weather-refresh').toggleAttribute('loading',busy);$('weather-refresh').toggleAttribute('disabled',busy||exercise);
    drawWind();
  }

  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;render();
    await Promise.allSettled([
      fetchSatelliteCatalog().then(data=>{catalog=data;satelliteChecked=Date.now();satelliteError=null;mapErrors.clear();}).catch(error=>{satelliteError=error.message;}).finally(()=>{render();onChange();}),
      fetchCurrentWind({previous:wind}).then(data=>{wind=data;windChecked=Date.now();windError=null;}).catch(error=>{windError=error.message;}).finally(()=>{onWindData({snapshot:wind,checked:windChecked,error:windError});render();onChange();})
    ]);
    busy=false;next=Date.now()+300_000;render();onChange();
  }

  $('weather-time').addEventListener('input',e=>selectTime(stops[Number(e.target.value)]));
  $('weather-live').addEventListener('click',()=>{stops=weatherStops();selectTime(null);});
  $('weather-before').addEventListener('click',()=>{const index=Math.max(0,Number($('weather-time').value)-1);selectTime(stops[index]);});
  $('weather-after').addEventListener('click',()=>{const index=Math.min(stops.length-1,Number($('weather-time').value)+1);selectTime(stops[index]);});
  $('satellite-product').addEventListener('calciteSelectChange',e=>{if(GOES_PRODUCTS.some(p=>p.id===e.target.value)){product=e.target.value;render();onChange();}});
  $('wind-map-toggle').addEventListener('calciteCheckboxChange',()=>{controller?.setLayerPreference('wind',$('wind-map-toggle').checked);render();onChange();});
  $('wind-site').addEventListener('calciteSelectChange',e=>{selected=e.target.value;render();const site=wind?.sites.find(s=>s.id===selected);if(site){onMap();controller?.focusWind(site.longitude,site.latitude);}});
  $('wind-locate').addEventListener('click',()=>{const s=wind?.sites.find(s=>s.id===selected);if(s){onMap();controller?.focusWind(s.longitude,s.latitude);}});
  $('weather-refresh').addEventListener('click',()=>{void refresh();void hrrr.refresh();});
  $('satellite-legend-image').addEventListener('error',()=>{$('satellite-legend-note').textContent='Publisher legend unavailable; verify the NOAA source before interpreting image colors.';});
  const tick=()=>{if(document.hidden)return;render();if(Date.now()>=next)void refresh();};
  setInterval(tick,60_000);document.addEventListener('visibilitychange',tick);
  window.addEventListener('offline',()=>{windError='Browser offline';satelliteError='Browser offline';onWindData({snapshot:wind,checked:windChecked,error:windError});render();onChange();});
  window.addEventListener('online',()=>{next=0;tick();});
  if(exercise)for(const id of ['wind-map-toggle','satellite-product'])$(id).setAttribute('disabled','');
  queueMicrotask(()=>{render();void refresh();});
  return {
    target,get live(){return fixed===null;},selectTime,
    satelliteReady(){return !!satelliteFrame()&&!mapErrors.get(`${product}:${controller?.view.type}`);},
    setContext(data){context=data;render();},
    setOverlay(kind){overlay=kind;},
    status(){return `${overlay==='satellite'?`${GOES_PRODUCTS.find(p=>p.id===product).label} · ${satelliteFrame()?time(satelliteFrame()):'no matching observation'}`:''}${windVisible()?' · wind/gust samples · '+time(target()):''}`;},
    async setMap(map){
      controller=map;
      void hrrr.setMap(map);
      try{
        const sdk=await loadSdk();const [WMSLayer,GraphicsLayer,Graphic]=await sdk.import(['@arcgis/core/layers/WMSLayer.js','@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);
        const satellite=new WMSLayer({url:GOES_URL,title:'NOAA GOES observed imagery · selected frame',copyright:'NOAA nowCOAST · GOES imagery',sublayers:[{name:product}],opacity:0.65,visible:false,imageFormat:'image/png'});
        satellite.on('layerview-create-error',event=>{mapErrors.set(`${product}:${event.view.type}`,true);console.warn('GOES map layer failed:',event.error?.name,event.error?.message,JSON.stringify(event.error?.details));render();onChange();});
        satellite.on('layerview-create',event=>{mapErrors.delete(`${product}:${event.view.type}`);render();onChange();});
        const windLayer=new GraphicsLayer({title:'NWS wind / gust forecast samples · mph',elevationInfo:{mode:'relative-to-ground'}});
        const windLabels=new GraphicsLayer({title:'Wind forecast labels · zoom to view',minScale:250_000,elevationInfo:{mode:'relative-to-ground'}});
        layers={satellite,wind:windLayer,windLabels,Graphic,satelliteKey:null};
        map.registerLayer('weather',satellite,false);map.registerLayer('wind',windLayer);map.registerLayer('wind',windLabels);map.onViewChanged(()=>{render();onChange();});
        if(!exercise)void satellite.load().catch(error=>{satelliteError=`Map service unavailable: ${error.message}`;render();onChange();});
        render();
      }catch(error){satelliteError=`Map initialization failed: ${error.message}`;render();onChange();}
    }
  };
}
