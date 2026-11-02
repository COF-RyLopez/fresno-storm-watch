// 3D river view: the Storm now river network and illustrative surge pulses in a SceneView, optionally over Google
// Photorealistic 3D Tiles. Same data (data/river-network.json) and model (lib/river-network-model.js) as the 2D layer.
import {CONFIG} from './config.js';
import {fetchRiverWatch} from './lib/nwps.js';
import {assessGauge} from './lib/river-model.js';
import {fetchUsgs,parseUsgsIv,usgsReading} from './lib/usgs-gauges.js';
import {indexNetwork,surgeSources,surgeFrames,routeSlice,timelineRange,startOffset,SURGE_CONFIG} from './lib/river-network-model.js';
import {SURGE_COLORS} from './lib/river-network-map.js';
import {formatTime} from './lib/model.js';
import {glbCopyright,createCredits} from './lib/google-tiles.js';

const $=id=>document.getElementById(id);
const exercise=new URLSearchParams(location.search).get('exercise')==='1';
const json=url=>fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);return r.json();});
const time=t=>formatTime(t,CONFIG.timeZone);

const sdk=await import('https://js.arcgis.com/5.1/').then(()=>globalThis.$arcgis);
const [ArcMap,SceneView,Basemap,TileLayer,GraphicsLayer,Graphic,IntegratedMesh3DTilesLayer,esriConfig,reactiveUtils]=await sdk.import(['@arcgis/core/Map.js','@arcgis/core/views/SceneView.js',
  '@arcgis/core/Basemap.js','@arcgis/core/layers/TileLayer.js','@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/layers/IntegratedMesh3DTilesLayer.js','@arcgis/core/config.js','@arcgis/core/core/reactiveUtils.js']);
const [doc,watch,usgsWatch,tiles]=await Promise.all([json('./data/river-network.json'),json('./data/river-watchlist.json'),json('./data/usgs-watchlist.json'),
  // Written at deploy time from the GOOGLE_MAP_TILES_KEY repo variable; absent locally and until the key exists.
  fetch('./data/google-tiles.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)]);
const net=indexNetwork(doc);

// Google tiles are a full textured mesh (terrain included), so graphics sit on the scene, not the hidden ground.
const google=typeof tiles?.key==='string'&&tiles.key?new IntegratedMesh3DTilesLayer({url:'https://tile.googleapis.com/v1/3dtiles/root.json',customParameters:{key:tiles.key},title:'Google Photorealistic 3D Tiles'}):null;
// Google attribution (Map Tiles API policy): Google Maps logo plus the data providers named in loaded tiles.
const credits=createCredits(),creditBox=document.createElement('div'),logo=document.createElement('img');
creditBox.className='google-credits';logo.className='google-logo';logo.src='./assets/google-maps-logo.svg';logo.alt='Google Maps';
if(google)esriConfig.request.interceptors.push({urls:/^https:\/\/tile\.googleapis\.com\//,after(response){
  const data=response?.data;if(data instanceof ArrayBuffer&&credits.add(glbCopyright(data)))creditBox.textContent=credits.line();}});
// Over Google's mesh, place graphics 40 m above the Esri terrain rather than on the mesh itself: relative-to-scene had to
// re-query the mesh on every redraw, so pulses lagged or hid under it. On the flat valley floor the two surfaces agree closely.
// Google tiles start off: they are the slowest part of the first load. The layer is added on first use, so no tile
// session starts until someone asks for it.
let googleOn=false;
const elevationInfo=()=>googleOn?{mode:'relative-to-ground',offset:40}:{mode:'on-the-ground'};
const base=new GraphicsLayer({title:'River network · USGS 3DHP',elevationInfo:elevationInfo()}),pulses=new GraphicsLayer({title:'Illustrative surge travel',elevationInfo:elevationInfo()}),
  markers=new GraphicsLayer({title:'Pulse sources',elevationInfo:elevationInfo()});
const map=new ArcMap({basemap:new Basemap({baseLayers:[new TileLayer({url:'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'})]}),ground:'world-elevation',layers:[base,pulses,markers]});
// Medium quality, no shadows: lighter on laptop GPUs while the timeline plays.
const view=new SceneView({container:'view',map,qualityProfile:'medium',environment:{lighting:{type:'sun',directShadowsEnabled:false},atmosphereEnabled:true},
  camera:{position:{longitude:-119.55,latitude:36.70,z:26000},heading:300,tilt:68}});

base.addMany([...net.paths.values()].map(p=>new Graphic({geometry:{type:'polyline',paths:p.parts.map(q=>q.c),spatialReference:{wkid:4326}},attributes:{name:p.name},
  symbol:{type:'line-3d',symbolLayers:[{type:'line',size:p.order>=8?3.5:p.order>=6?2.4:1.4,material:{color:[110,190,240,p.order>=6?0.95:0.7]}}]}})));
const tube=kind=>({type:'line-3d',symbolLayers:[{type:'path',profile:'circle',width:350,height:350,material:{color:SURGE_COLORS[kind]},cap:'round'}]});
const marker=(s,started)=>({type:'point-3d',verticalOffset:{screenLength:36},callout:{type:'line',size:1,color:'white'},symbolLayers:[
  {type:'icon',resource:{primitive:'circle'},size:14,material:{color:SURGE_COLORS[s.kind]},outline:{color:'#1b1f23',size:1.5}},
  {type:'text',text:`${s.name}\n${started?'pulse moving':(s.kind==='forecast'?'crest ':'rise ')+time(s.t0)}`,size:10,material:{color:'white'},halo:{color:[0,0,0,0.8],size:1.2},verticalAlignment:'bottom'}]});
// Screen-sized so the pulse front stays visible from a county-wide view, not just up close.
const head=kind=>({type:'point-3d',callout:{type:'line',size:1.5,color:SURGE_COLORS[kind]},verticalOffset:{screenLength:24},symbolLayers:[{type:'icon',resource:{primitive:'circle'},size:22,material:{color:SURGE_COLORS[kind]},outline:{color:'#1b1f23',size:2}}]});
// The SDK hides a 3D icon whose anchor is behind the mesh, so point anchors sit 150 m up (z) with a callout down to the river.
const pin=(lon,lat)=>({type:'point',longitude:lon,latitude:lat,z:150,spatialReference:{wkid:4326}});

// Live inputs, as in Storm now: NWPS assessments shaped like area rows, USGS readings by site.
let areas=[],usgs=null,checked=null,problems=[],offset=0,playTimer=null,markerSig='',listSig='';
// Pulse graphics are kept per source and moved in place: removing and re-adding 3D graphics every tick made them flash
// while the SceneView rebuilt them.
const live=new Map();
async function refresh(){
  problems=[];
  if(exercise){
    const parsed=parseUsgsIv(await json('./data/usgs-iv-exercise.json')),shift=Date.now()-10*60_000-Math.max(...[...parsed.values()].flatMap(s=>s.stage.map(p=>p.time)));
    for(const s of parsed.values())for(const k of ['stage','flow'])s[k]=s[k].map(p=>({...p,time:p.time+shift}));
    usgs={readings:new Map([...parsed].map(([k,s])=>[k,usgsReading(s)]))};areas=[];
  }else{
    const now=Date.now();
    const [nwps,us]=await Promise.allSettled([fetchRiverWatch(watch.stations,CONFIG.rivers),fetchUsgs(usgsWatch.sites.map(s=>s.site))]);
    if(nwps.status==='fulfilled')areas=[{gauges:nwps.value.map(o=>({id:o.id,gauge:o.gauge,assessment:assessGauge(o.gauge,CONFIG.rivers,72,now,o.error)}))}];else problems.push('NWS river gauges: '+nwps.reason.message);
    if(us.status==='fulfilled')usgs={readings:us.value};else problems.push('USGS gauges: '+us.reason.message);
  }
  checked=Date.now();draw();
}
let range=timelineRange([]);
function draw(){
  const now=Date.now(),t=now+offset*60_000,sources=surgeSources({areas,usgs,net,now}),frames=surgeFrames(net,sources,t);
  range=timelineRange(sources,now);$('surge-slider').min=range.min;$('surge-slider').max=range.max;
  // Labelled source markers change only when a pulse starts or the sources change, so they are not rebuilt every tick.
  const sig=sources.map(s=>`${s.key}:${t>=s.t0}`).join('|');
  if(sig!==markerSig){markerSig=sig;markers.removeAll();
    for(const s of sources){const pt=net.points.get(s.id);if(pt)markers.add(new Graphic({geometry:pin(pt.longitude,pt.latitude),symbol:marker(s,t>=s.t0)}));}}
  const seen=new Set();
  for(const f of frames){
    const pt=f.lines.at(-1)?.at(-1);if(!pt)continue;seen.add(f.key);
    let g=live.get(f.key);
    if(!g){g={tube:new Graphic({symbol:tube(f.kind)}),head:new Graphic({symbol:head(f.kind)})};pulses.addMany([g.tube,g.head]);live.set(f.key,g);}
    g.tube.geometry={type:'polyline',paths:f.lines,spatialReference:{wkid:4326}};g.head.geometry=pin(pt[0],pt[1]);
  }
  for(const [k,g] of live)if(!seen.has(k)){pulses.removeMany([g.tube,g.head]);live.delete(k);}
  const m=Math.round(offset);
  $('surge-time').textContent=m===0?'now':`${m>0?'+':'−'}${Math.floor(Math.abs(m)/60)} h ${Math.abs(m)%60} min · ${time(t)}`;
  const mph=(SURGE_CONFIG.speedKmh*0.621371).toFixed(1);
  const moving=frames.filter(f=>f.lines.length).length,next=sources.filter(s=>s.t0>t).sort((a,b)=>a.t0-b.t0)[0];
  $('surge-status').textContent=(exercise?'FICTIONAL EXERCISE gauge data. ':'')+(sources.length?(moving?`${moving} of ${sources.length} pulses moving at this time.`:next?`Nothing moving yet. Next: ${next.name}, ${next.kind==='forecast'?'forecast crest':'rise'} at ${time(next.t0)}. Select it below to jump there, then press Play.`:'The pulses have left the mapped network at this time.')+` Assumed ${mph} mph travel: illustrative, not a forecast.`
    :'No gauge is rising 0.2 ft/h or more and no forecast crest is ahead: nothing to trace. Not an all-clear.')+(problems.length?` Source problems: ${problems.join('; ')}.`:'')+` Gauges checked ${checked?time(checked):'—'}.`;
  const ls=sources.map(s=>s.key+s.t0).join('|');if(ls===listSig)return;listSig=ls;
  const list=$('surge-list');list.replaceChildren();
  for(const s of sources){const it=document.createElement('calcite-list-item');it.label=s.name;it.description=`${s.kind==='forecast'?'Forecast':'Observed'} · ${s.label} · starts ${time(s.t0)}`;it.value=s.key;list.append(it);}
}
$('surge-list').addEventListener('calciteListItemSelect',e=>{const s=surgeSources({areas,usgs,net,now:Date.now()}).find(x=>x.key===e.target.value),pt=s&&net.points.get(s.id);
  if(s){stop();set(Math.max(range.min,Math.min(range.max,startOffset(s))));}
  // Frame the reach the pulse covers in its first 6 hours, not just the gauge, so Play keeps it in view.
  const ahead=s&&routeSlice(net,s.path,s.km,s.km-SURGE_CONFIG.speedKmh*6);
  // goTo only moved the camera reliably with a [lon,lat] target here (plain or unattached geometry was ignored), so aim at
  // the route's midpoint, facing downstream.
  const pts=ahead?.flat()||[],a=pts[0],z=pts.at(-1),mid=pts[Math.floor(pts.length/2)];
  const heading=a&&z?(Math.atan2((z[0]-a[0])*Math.cos(a[1]*Math.PI/180),z[1]-a[1])*180/Math.PI+360)%360:0;
  if(mid)view.goTo({target:mid,zoom:12,heading,tilt:60}).catch(()=>{});
  else if(pt)view.goTo({target:[pt.longitude,pt.latitude],zoom:13,tilt:65}).catch(()=>{});});
const stop=()=>{clearInterval(playTimer);playTimer=null;$('surge-play').textContent='Play';$('surge-play').setAttribute('icon-start','play');};
const set=v=>{offset=v;$('surge-slider').value=Math.round(v/SURGE_CONFIG.stepMinutes)*SURGE_CONFIG.stepMinutes;draw();};
$('surge-slider').addEventListener('calciteSliderInput',e=>{stop();set(Number(e.target.value));});
$('surge-now').addEventListener('click',()=>{stop();set(0);});
$('surge-play').addEventListener('click',()=>{if(playTimer)return stop();$('surge-play').textContent='Pause';$('surge-play').setAttribute('icon-start','pause');
  // Same pace as before (one 15-minute step per 400 ms) in quarter steps, so the front slides ~250 m at a time instead of jumping 1 km.
  const step=SURGE_CONFIG.stepMinutes/4;playTimer=setInterval(()=>set(offset+step>range.max?range.min:offset+step),100);});
$('google-switch').toggleAttribute('disabled',!google);
$('google-note').textContent=google?'Off by default so the scene loads faster. 3D tiles © Google. Map Tiles API; visualization only.':'Google 3D tiles are off: no browser key is configured for this site. Showing Esri World Imagery on world terrain.';
logo.hidden=creditBox.hidden=true;if(google)view.ui.add([logo,creditBox],'bottom-left');
$('google-switch').addEventListener('calciteSwitchChange',e=>{if(!google)return;googleOn=e.target.checked;if(googleOn&&!map.layers.includes(google))map.add(google,0);google.visible=googleOn;logo.hidden=creditBox.hidden=!e.target.checked;base.elevationInfo=pulses.elevationInfo=markers.elevationInfo=elevationInfo();});
if(exercise)$('notice').hidden=false;
// Preloader (Google 3D best practices): say the scene is still sharpening until it first stops loading tiles.
const loading=document.createElement('div');loading.className='scene-loading';loading.setAttribute('role','status');loading.textContent='Loading 3D imagery… the view sharpens as tiles arrive.';
view.ui.add(loading,'top-right');
// Removed once the scene first stops loading, or after 45 s so a slow device never keeps it on screen.
Promise.race([reactiveUtils.whenOnce(()=>view.ready&&!view.updating),new Promise(r=>setTimeout(r,45_000))]).then(()=>view.ui.remove(loading));
await refresh();
// Open on the first pulse source when there is one, looking downstream.
const first=surgeSources({areas,usgs,net,now:Date.now()})[0],fp=first&&net.points.get(first.id);
if(fp)view.when(()=>view.goTo({target:[fp.longitude,fp.latitude],zoom:11,heading:210,tilt:45})).catch(()=>{});
setInterval(()=>{if(!document.hidden)void refresh();},300_000);
