import {stormFocus,ageLabel,TIERS,FOCUS,STORM_CONFIG} from './storm-focus-model.js';
import {fetchUsgs,parseUsgsIv,usgsReading} from './usgs-gauges.js';
import {reportHealth} from './source-health.js';
import {el,elAttrs,link} from './dom.js';
import {indexNetwork,surgeSources,surgeFrames,SURGE_CONFIG} from './river-network-model.js';
import {wazeReports,wazeTraffic,WAZE_NOTE,WAZE_MAX_AGE} from './waze-model.js';
import {CAMERA_FEED,nearbyCameras} from './camera-model.js';

const $=id=>document.getElementById(id);
const RAIN=Object.freeze({'Off':'off','Radar':'radar','72-h forecast':'qpf'});
/** Storm now panel: renders stormFocus() rows and its visible controls. Rows open existing evidence through onOpen. */
export function createStormNow({exercise=false,timeZone,onOpen=()=>{},onRain=()=>{},onCameras=()=>{}}={}){
  const inputs={alerts:[],alertCheck:null,areas:[],drainage:null,signedIn:false,roads:null,usgs:null,watchlist:[]};
  let wazeSnap=null,wazeError=null,catalog=null,wazeOpen=0;
  let focus='all',map=null,signature='',rows=[];
  let net=null,netError=null,surgeOffset=0,playTimer=null;
  const clock=new Intl.DateTimeFormat('en-US',{timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
  const time=t=>t===null?'source time unavailable':clock.format(t);
  function render(){
    drawSurges();
    rows=stormFocus({...inputs,waze:wazeInput(),focus},Date.now());
    $('storm-waze-credit').hidden=!rows.some(r=>r.key.startsWith('waze:'));
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
    if(r.open.kind==='waze')return showWaze(r.open.id);
    onOpen(r.open);
  }
  function showGauge(id){
    const host=$('usgs-detail'),s=inputs.watchlist.find(s=>s.site===id);host.replaceChildren();
    if(!s){$('usgs-evidence').heading=id;host.append(el('p',`No live gauge in this app: ${id}. Check FMFCD and field reports.`),el('p','Add an active USGS site for a creek to data/usgs-watchlist.json to take it off this list.'));$('usgs-evidence').setAttribute('open','');map?.fitExtent(STORM_CONFIG.extents.creeks);return;}
    const r=inputs.usgs?.readings?.get(id);$('usgs-evidence').heading=s.name;
    const facts=[['USGS site',s.site],['Latest stage',r?.stage?`${r.stage.value.toFixed(2)} ft · ${time(r.stage.time)} · ${ageLabel(Date.now()-r.stage.time)}`:'Not returned'],['Latest flow',r?.flow?`${Math.round(r.flow.value).toLocaleString('en-US')} cfs · ${time(r.flow.time)}`:'Not returned'],['Rise (~3 h)',r?.rise?`${r.rise.delta>=0?'+':''}${r.rise.delta.toFixed(2)} ft in ${r.rise.hours.toFixed(1)} h · ${r.rise.rate.toFixed(2)} ft/h`:'Not computable'],['Flood stage',Number.isFinite(s.floodStageFt)?`${s.floodStageFt} ft`:'Not configured · rate of rise only'],['Last USGS check',inputs.usgs?.checked?time(inputs.usgs.checked):'None'+(inputs.usgs?.error?` · ${inputs.usgs.error}`:'')]];
    const dl=el('dl');for(const [k,v]of facts)dl.append(el('dt',k),el('dd',v));host.append(dl);
    if(exercise)host.append(el('p','Fictional exercise values from a constructed fixture, not a USGS reading.'));
    if(!s.verified)host.append(el('p','Site number and location not yet confirmed against the USGS site service.'));
    host.append(el('p','Provisional USGS data. Planning aid, not an alert service.'),link(`USGS ${s.site} monitoring location page (opens new tab) ↗`,`https://waterdata.usgs.gov/monitoring-location/USGS-${s.site}/`));
    $('usgs-evidence').setAttribute('open','');
    map?.focusReferenceGeometry({x:s.longitude,y:s.latitude,spatialReference:{wkid:4326}},35000);
  }
  // Illustrative surge travel along the river network; recomputed from live gauges on every render and timeline move.
  function drawSurges(){
    const status=$('storm-surge-status'),t=Date.now()+surgeOffset*60_000;
    $('storm-surge-time').textContent=surgeOffset===0?'now':`${surgeOffset>0?'+':'−'}${Math.floor(Math.abs(surgeOffset)/60)} h ${Math.abs(surgeOffset)%60} min · ${time(t)}`;
    if(!net){status.textContent=netError?`River network unavailable: ${netError}`:'Loading river network…';return;}
    const sources=surgeSources({areas:inputs.areas,usgs:inputs.usgs,net,now:Date.now()}),frames=surgeFrames(net,sources,t);
    map?.setRiverSurges(frames);
    const moving=frames.filter(f=>f.lines.length).length,mph=(SURGE_CONFIG.speedKmh*0.621371).toFixed(1);
    status.textContent=!sources.length?'No gauge is rising 0.2 ft/h or more and no forecast crest is ahead: nothing to trace. Not an all-clear.'
      :`${moving} of ${sources.length} pulses on the map at this time (${sources.map(s=>`${s.name}: ${s.label}`).join('; ')}). Assumed ${mph} mph travel, illustrative, not a forecast.`;
  }
  function stopPlay(){clearInterval(playTimer);playTimer=null;$('storm-surge-play').textContent='Play';$('storm-surge-play').setAttribute('icon-start','play');}
  function setOffset(v){surgeOffset=v;$('storm-surge-slider').value=v;drawSurges();}
  $('storm-surge-slider').addEventListener('calciteSliderInput',e=>{stopPlay();setOffset(Number(e.target.value));});
  $('storm-surge-now').addEventListener('click',()=>{stopPlay();setOffset(0);});
  $('storm-surge-play').addEventListener('click',()=>{
    if(playTimer)return stopPlay();
    $('storm-surge-play').textContent='Pause';$('storm-surge-play').setAttribute('icon-start','pause');
    const max=SURGE_CONFIG.aheadHours*60,min=-SURGE_CONFIG.backHours*60;
    playTimer=setInterval(()=>setOffset(surgeOffset+SURGE_CONFIG.stepMinutes>max?min:surgeOffset+SURGE_CONFIG.stepMinutes),500);
  });
  void fetch(new URL('../data/river-network.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();})
    .then(doc=>{net=indexNetwork(doc);map?.setRiverNetwork(net);drawSurges();}).catch(e=>{netError=e.message;drawSurges();});
  // A 404 means the county feed is not published (WAZE_PUBLISH off): no rows, no error.
  function wazeInput(){
    if(wazeError)return {checkedAt:null,error:wazeError,reports:[],traffic:[]};
    if(!wazeSnap)return null;
    try{return {checkedAt:wazeSnap.checkedAt,error:wazeSnap.error,reports:wazeReports(wazeSnap),traffic:wazeTraffic(wazeSnap)};}
    catch(e){return {checkedAt:null,error:e.message,reports:[],traffic:[]};}
  }
  async function refreshWaze(){
    try{const r=await fetch(new URL('../data/waze-latest.json',import.meta.url),{cache:'no-store'});
      if(r.status===404){wazeSnap=null;wazeError=null;}else if(!r.ok)throw new Error(`HTTP ${r.status}`);else{wazeSnap=await r.json();wazeError=null;}}
    catch(e){wazeError='Waze snapshot unavailable: '+e.message;}
    const w=wazeInput();if(w)reportHealth('waze','Waze partner feed',{checked:Date.parse(w.checkedAt??'')||null,error:w.error,maxAgeMs:WAZE_MAX_AGE,detail:'Unverified crowd reports.'});
    render();
  }
  function showWaze(id){
    const w=wazeInput(),host=$('waze-detail'),pane=$('waze-evidence'),token=++wazeOpen;host.replaceChildren();
    const credit=()=>{const p=el('p','Data provided by ');p.append(link('Waze App','https://www.waze.com'),'. Learn more at ',link('Waze.com','https://www.waze.com'),'.');return p;};
    const facts=list=>{const dl=el('dl');for(const [k,v]of list)if(v!==null&&v!==undefined&&v!=='')dl.append(el('dt',k),el('dd',String(v)));return dl;};
    const when=t=>`${time(Date.parse(t))} · ${ageLabel(Date.now()-Date.parse(t))}`;
    if(id==='summary'){
      pane.heading='Waze closures & road hazards';
      const other=(w?.reports||[]).filter(r=>r.category!=='Flooding'),ul=el('ul');
      for(const r of other.slice(0,50))ul.append(el('li',`${r.label}${r.city?' · '+r.city:''} · ${ageLabel(Date.now()-Date.parse(r.reportedAt))}`));
      host.append(el('p',w?.error?`Last check problem: ${w.error}`:`Feed checked ${w?.checkedAt?when(w.checkedAt):'never'}.`),other.length?ul:el('p','No closure or hazard reports in the last snapshot.'));
      if(other.length>50)host.append(el('p',`Showing the newest 50 of ${other.length}.`));
      host.append(el('p','The same closure may also be in the county road records; do not count it twice.'),el('p',WAZE_NOTE),credit());
      pane.setAttribute('open','');return;
    }
    const r=w?.reports.find(x=>x.id===id),t=w?.traffic.find(x=>x.id===id);
    if(!r&&!t){pane.heading='Waze report';host.append(el('p','This report is no longer in the latest Waze snapshot. That does not mean the road is clear.'),credit());pane.setAttribute('open','');return;}
    const line=r?[[r.lon,r.lat]]:t.line,mid=line[Math.floor(line.length/2)];
    pane.heading=(r||t).label;
    host.append(r?facts([['Type',r.category],['City',r.city],['Reported',when(r.reportedAt)],['Reliability',r.reliability===null?null:`${r.reliability}/10`],['Confidence',r.confidence],['Thumbs up',r.thumbsUp]])
      :facts([['Size',t.size],['Delay',t.delaySeconds===null?null:`${Math.round(t.delaySeconds/60)} min`],['Speed now',t.speedMph===null?null:`${t.speedMph} mph`],['Usual speed',t.regularMph===null?null:`${t.regularMph} mph`],['Length',t.lengthM===null?null:`${(t.lengthM/1609.344).toFixed(1)} mi`],['Trend',{'1':'Getting worse','0':'Steady','-1':'Improving'}[t.trend]],['Detected',when(t.detectedAt)],['Updated',when(t.updatedAt)]]));
    if(t)host.append(el('p','Waze flags traffic that is slower than usual for this road and time. It does not say why; check a camera or field report.'));
    const cams=el('div');cams.className='waze-cameras';cams.append(el('h3','Nearby Caltrans cameras'),el('p','Checking Caltrans cameras…'));
    host.append(cams,el('p',WAZE_NOTE),credit());pane.setAttribute('open','');
    map?.focusReferenceGeometry({x:mid[0],y:mid[1],spatialReference:{wkid:4326}},20000);
    if(exercise){cams.lastChild.textContent='Cameras are not loaded in the exercise.';return;}
    void (async()=>{
      try{
        if(!catalog||Date.now()-catalog.at>300_000){const res=await fetch(CAMERA_FEED,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(20_000)});if(!res.ok)throw new Error(`Caltrans HTTP ${res.status}`);catalog={at:Date.now(),data:await res.json()};}
        const near=nearbyCameras(catalog.data,line,{maxKm:2,limit:2});if(token!==wazeOpen)return;
        cams.lastChild.remove();
        if(!near.length)cams.append(el('p','No in-service Caltrans camera within 1.2 mi. Caltrans cameras are mostly on state highways.'));
        for(const c of near){const f=el('figure'),img=elAttrs('img','',{src:c.imageUrl,alt:`Caltrans camera ${c.name}. Check the time printed on the image.`,loading:'lazy',decoding:'async'});
          f.append(img,el('figcaption',`${c.name}${c.route?' · '+c.route:''}${c.direction?' · faces '+c.direction:''} · ${(c.km/1.609344).toFixed(1)} mi away`));
          cams.append(f,link(`Open current ${c.name} image (opens new tab) ↗`,c.imageUrl));}
        cams.append(el('p','Distance only: the camera may not show this spot. Use the time printed on the image, not this page, for when it was taken.'));
      }catch(e){if(token===wazeOpen)cams.lastChild.textContent='Caltrans camera list unavailable: '+(e.name==='TimeoutError'?'timed out':e.message);}
    })();
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
  // ponytail: the collector runs every 15 min; polling the static file every 2 min is cheap and catches each deploy.
  if(!exercise){void refreshWaze();setInterval(()=>{if(!document.hidden)void refreshWaze();},120_000);}
  void fetch(new URL('../data/usgs-watchlist.json',import.meta.url)).then(r=>r.json()).then(w=>{inputs.watchlist=w.sites;render();return refreshUsgs();}).catch(e=>{inputs.usgs={readings:new Map(),checked:null,error:'Watchlist unavailable: '+e.message};render();});
  render();
  return {
    set(values){Object.assign(inputs,values);render();},
    setMap(controller){map=controller;signature='';if(net)map.setRiverNetwork(net);render();},
    setIssues(n){$('storm-issues').textContent=n===null?(exercise?'Source health · exercise':'Source issues · checking'):`${n} source ${n===1?'issue':'issues'}`;$('storm-issues').setAttribute('icon-start',n?'exclamation-mark-triangle':'information');},
    setOverlay(kind){const label=Object.keys(RAIN).find(k=>RAIN[k]===kind);for(const item of $('storm-rain').children)item.checked=item.getAttribute('value')===label;}
  };
}
