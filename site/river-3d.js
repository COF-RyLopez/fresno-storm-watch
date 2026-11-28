// 3D river view on the shared county scene (three.js, docs/county-3d-plan.md phase 5): the Storm now river network draped on
// streamed terrain, and illustrative surge pulses as tubes moving downstream. Same data (data/river-network.json) and model
// (lib/river-network-model.js) as the 2D layer; the ArcGIS SceneView version is replaced. Planning aid, not a forecast.
import * as THREE from './vendor/three-0.187.0/three.module.js';
import {CONFIG} from './config.js';
import {fetchRiverWatch} from './lib/nwps.js';
import {assessGauge} from './lib/river-model.js';
import {fetchUsgs,parseUsgsIv,usgsReading} from './lib/usgs-gauges.js';
import {indexNetwork,surgeSources,surgeFrames,frontKm,routeSlice,routeLine,profilePath,timelineRange,startOffset,SURGE_CONFIG} from './lib/river-network-model.js';
import {SURGE_COLORS} from './lib/river-network-map.js';
import {formatTime} from './lib/model.js';
import {createCountyScene} from './lib/county3d/core.js';
import {createDrape} from './lib/county3d/drape.js';
import {COUNTY_BOUNDS,createFrame} from './lib/county3d/frame.js';

const $=id=>document.getElementById(id);
const exercise=new URLSearchParams(location.search).get('exercise')==='1';
const json=url=>fetch(url,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`${url} HTTP ${r.status}`);return r.json();});
const time=t=>formatTime(t,CONFIG.timeZone);
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;

const lists=Promise.all([json('./data/river-watchlist.json'),json('./data/usgs-watchlist.json')]);
const data=Promise.all([json('./data/river-network.json'),lists,
  // Measured gauge-to-gauge travel times (optional; the assumed speed applies without them).
  fetch('./data/travel-times.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)]);
const gaugeFetch=(w,u)=>Promise.allSettled([fetchRiverWatch(w.stations,CONFIG.rivers),fetchUsgs(u.sites.map(s=>s.site))]);
let firstGauges=exercise?null:lists.then(([w,u])=>gaugeFetch(w,u));
const [doc,[watch,usgsWatch],travel]=await data;
const net=indexNetwork(doc,travel);

// ---------- scene: county terrain with the river network draped on it ----------
const frame=createFrame(COUNTY_BOUNDS),k=frame.k;
const drape=createDrape({frame,paint(ctx,{project,linePx}){
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const p of net.paths.values()){
    const w=p.order>=8?3.2:p.order>=6?2.2:1.2;
    ctx.strokeStyle=p.order>=6?'rgba(130,205,250,.95)':'rgba(110,190,240,.7)';ctx.lineWidth=linePx(w);
    for(const q of p.parts){ctx.beginPath();q.c.forEach(([lon,lat],i)=>{const [x,y]=project(lon,lat);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  }
}});
const county=createCountyScene({container:$('view'),nightFloor:0.6,terrain:{decorate:drape.decorate,detail:1}});
const {scene,camera,controls}=county;
setInterval(()=>county.setTime(new Date()),60_000);

// screen-sized markers standing on the ground
const textures=new Map(),markers=[];
const tex=(key,draw)=>{let t=textures.get(key);if(!t){const c=document.createElement('canvas');draw(c);t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;textures.set(key,t);}return t;};
const dotTex=color=>tex('dot:'+color,c=>{c.width=c.height=56;const g=c.getContext('2d');g.beginPath();g.arc(28,28,20,0,7);g.fillStyle=color;g.fill();g.lineWidth=6;g.strokeStyle='#1b1f23';g.stroke();});
const pinTex=(title,sub,color)=>tex(`pin:${color}:${title}:${sub}`,c=>{
  const g=c.getContext('2d'),s=2,fa=`700 ${13*s}px "Avenir Next",system-ui,sans-serif`,fb=`500 ${11*s}px "Avenir Next",system-ui,sans-serif`;
  g.font=fa;const wa=g.measureText(title).width;g.font=fb;const wb=g.measureText(sub).width,w=Math.ceil(Math.max(wa,wb))+24*s,box=40*s,stem=30*s;
  c.width=w;c.height=box+stem;g.fillStyle='rgba(23,33,38,.92)';g.strokeStyle=color;g.lineWidth=2*s;g.beginPath();g.roundRect(s,s,w-2*s,box-2*s,6*s);g.fill();g.stroke();
  g.fillStyle=color;g.fillRect(w/2-1.5*s,box-s,3*s,stem-4*s);g.beginPath();g.arc(w/2,box+stem-4*s,4*s,0,7);g.fill();
  g.textAlign='center';g.textBaseline='top';g.fillStyle='#f4f8fa';g.font=fa;g.fillText(title,w/2,6*s);g.fillStyle='#c3d2d8';g.font=fb;g.fillText(sub,w/2,23*s);
});
function marker(texture,lon,lat,{px,anchor=[0.5,0.5],order=0}){
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,sizeAttenuation:false,transparent:true}));
  sprite.center.set(...anchor);sprite.renderOrder=10+order;scene.add(sprite);
  const m={sprite,lon,lat,px,aspect:texture.image.width/texture.image.height};markers.push(m);return m;
}
const removeMarker=m=>{scene.remove(m.sprite);m.sprite.material.dispose();markers.splice(markers.indexOf(m),1);};
const worldAt=(lon,lat,lift=0)=>{const [x,z]=frame.project(lon,lat);return new THREE.Vector3(x,(county.terrain.groundAt(x,z)??0)+lift*k,z);};
county.onFrame(()=>{
  const d=camera.position.distanceTo(controls.target);
  drape.track(controls.target.x,controls.target.z,d,(2*d*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2))/($('view').clientHeight||1));
  const unit=2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)/($('view').clientHeight||1);
  for(const m of markers){m.sprite.position.copy(worldAt(m.lon,m.lat,2));m.sprite.scale.set(m.px*m.aspect*unit,m.px*unit,1);}
});

// ---------- pulses: a tube along the moving reach, a dot at its front ----------
const live=new Map();
function tubeFor(lines,color){
  const path=new THREE.CurvePath();
  for(const line of lines){const pts=line.map(([lon,lat])=>worldAt(lon,lat,25));for(let i=1;i<pts.length;i++)path.add(new THREE.LineCurve3(pts[i-1],pts[i]));}
  if(!path.curves.length)return null;
  // thick enough to read from a county view, never thinner than about 120 m on the ground
  const radius=Math.max(60*k,camera.position.distanceTo(controls.target)*0.0035);
  return new THREE.TubeGeometry(path,Math.min(600,path.curves.length*2),radius,6,false);
}

// Live inputs, as in Storm now: NWPS assessments shaped like area rows, USGS readings by site.
let areas=[],usgs=null,checked=null,problems=[],offset=0,playTimer=null,markerSig='',listSig='',sourceMarkers=[];
async function refresh(){
  problems=[];
  if(exercise){
    const parsed=parseUsgsIv(await json('./data/usgs-iv-exercise.json')),shift=Date.now()-10*60_000-Math.max(...[...parsed.values()].flatMap(s=>s.stage.map(p=>p.time)));
    for(const s of parsed.values())for(const key of ['stage','flow'])s[key]=s[key].map(p=>({...p,time:p.time+shift}));
    usgs={readings:new Map([...parsed].map(([id,s])=>[id,usgsReading(s)]))};areas=[];
  }else{
    const now=Date.now();
    const [nwps,us]=await (firstGauges||gaugeFetch(watch,usgsWatch));firstGauges=null;
    if(nwps.status==='fulfilled')areas=[{gauges:nwps.value.map(o=>({id:o.id,gauge:o.gauge,assessment:assessGauge(o.gauge,CONFIG.rivers,72,now,o.error)}))}];else problems.push('NWS river gauges: '+nwps.reason.message);
    if(us.status==='fulfilled')usgs={readings:us.value};else problems.push('USGS gauges: '+us.reason.message);
  }
  net.flowCfs=usgs?.readings?.get('11251000')?.flow?.value??null; // live flow below Friant picks measured flow-band speeds
  checked=Date.now();sources=surgeSources({areas,usgs,net,now:checked});range=timelineRange(sources,checked);
  $('surge-slider').min=range.min;$('surge-slider').max=range.max;draw();
}
let range=timelineRange([]),sources=[];
function draw(){
  const now=Date.now(),t=now+offset*60_000,frames=surgeFrames(net,sources,t);
  const sig=sources.map(s=>`${s.key}:${t>=s.t0}`).join('|');
  if(sig!==markerSig){markerSig=sig;sourceMarkers.forEach(removeMarker);sourceMarkers=[];
    for(const s of sources){const pt=net.points.get(s.id);if(pt)sourceMarkers.push(marker(pinTex(s.name,t>=s.t0?'pulse moving':(s.kind==='forecast'?'forecast crest ':'rise ')+time(s.t0),SURGE_COLORS[s.kind]),pt.longitude,pt.latitude,{px:56,anchor:[0.5,0],order:2}));}}
  const seen=new Set();
  for(const f of frames){
    const pt=f.lines.at(-1)?.at(-1);if(!pt)continue;seen.add(f.key);
    let g=live.get(f.key);
    if(!g){const color=new THREE.Color(SURGE_COLORS[f.kind]);
      g={tube:new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:0.55,roughness:0.5})),head:marker(dotTex(SURGE_COLORS[f.kind]),pt[0],pt[1],{px:20,order:3})};
      scene.add(g.tube);live.set(f.key,g);}
    const geom=tubeFor(f.lines);if(geom){g.tube.geometry.dispose();g.tube.geometry=geom;}
    g.head.lon=pt[0];g.head.lat=pt[1];
  }
  for(const [key,g] of live)if(!seen.has(key)){scene.remove(g.tube);g.tube.geometry.dispose();g.tube.material.dispose();removeMarker(g.head);live.delete(key);}
  profileMarker(t);
  const m=Math.round(offset);
  $('surge-time').textContent=m===0?'now':`${m>0?'+':'−'}${Math.floor(Math.abs(m)/60)} h ${Math.abs(m)%60} min · ${time(t)}`;
  const moving=frames.filter(f=>f.lines.length).length,next=sources.filter(s=>s.t0>t).sort((a,b)=>a.t0-b.t0)[0];
  $('surge-status').textContent=(exercise?'FICTIONAL EXERCISE gauge data. ':'')+(sources.length?(moving?`${moving} of ${sources.length} pulses moving at this time.`:next?`Nothing moving yet. Next: ${next.name}, ${next.kind==='forecast'?'forecast crest':'rise'} ${time(next.t0)}. Select it below to jump there, then press Play.`:'All pulses have passed the mapped network.')
    :'No gauge is rising 0.2 ft/h or more and no forecast crest is ahead: nothing to trace. Not an all-clear.')+(problems.length?` Source problems: ${problems.join('; ')}.`:'')+` Gauges checked ${checked?time(checked):'—'}.`;
  const ls=sources.map(s=>s.key+s.t0).join('|');if(ls===listSig)return;listSig=ls;
  const list=$('surge-list');list.replaceChildren();
  for(const s of sources){const it=document.createElement('calcite-list-item');it.label=s.name;it.description=`${s.kind==='forecast'?'Forecast':'Observed'} · ${s.label} · starts ${time(s.t0)}`;it.value=s.key;list.append(it);}
}
const headingAlong=(a,z)=>a&&z?(Math.atan2((z[0]-a[0])*Math.cos(a[1]*Math.PI/180),z[1]-a[1])*180/Math.PI+360)%360:0;
$('surge-list').addEventListener('calciteListItemSelect',e=>{const s=sources.find(x=>x.key===e.target.value),pt=s&&net.points.get(s.id);
  if(s){setProfile(s);stop();set(Math.max(range.min,Math.min(range.max,startOffset(s))));}
  // Frame the reach the pulse covers in its first 6 hours, facing downstream, so Play keeps it in view.
  const ahead=s&&routeSlice(net,s.path,s.km,frontKm(net,s,6)),pts=ahead?.flat()||[],a=pts[0],z=pts.at(-1),mid=pts[Math.floor(pts.length/2)];
  if(mid)county.view(mid[0],mid[1],18_000,60,headingAlong(a,z));
  else if(pt)county.view(pt.longitude,pt.latitude,9_000,65,0);});
const stop=()=>{clearInterval(playTimer);playTimer=null;$('surge-play').textContent='Play';$('surge-play').setAttribute('icon-start','play');};
const set=v=>{offset=v;$('surge-slider').value=Math.round(v/SURGE_CONFIG.stepMinutes)*SURGE_CONFIG.stepMinutes;draw();};
$('surge-slider').addEventListener('calciteSliderInput',e=>{stop();set(Number(e.target.value));});
$('surge-now').addEventListener('click',()=>{stop();set(0);});
$('surge-play').addEventListener('click',()=>{if(playTimer)return stop();$('surge-play').textContent='Pause';$('surge-play').setAttribute('icon-start','pause');
  // One 15-minute step per 400 ms in quarter steps, so the front slides ~250 m at a time instead of jumping 1 km.
  const step=SURGE_CONFIG.stepMinutes/4;playTimer=setInterval(()=>set(offset+step>range.max?range.min:offset+step),reduced()?400:100);});
$('google-switch').toggleAttribute('disabled',true);
$('google-note').textContent='Shown on the shared three.js county scene (streamed Terrarium elevation and Esri World Imagery). Google 3D tiles are not available in this view yet.';
if(exercise)$('notice').hidden=false;

// ---------- river profile: ground elevation sampled from the scene's terrain along the route ----------
let profileTarget=null,profileShape=null,profileTimer=0;
function setProfile(target){
  const line=target?.path&&Number.isFinite(target.km)?routeLine(net,target.path,target.km):[];
  profileTarget=line.length>1?{...target,line}:null;profileShape=null;$('profile-line').setAttribute('d','');$('profile-marker').setAttribute('visibility','hidden');
  if(!profileTarget){$('profile-status').textContent='No mapped route below this gauge to profile.';return;}
  $('profile-title').textContent=`Elevation profile below ${target.name}`;$('profile-status').textContent=`Sampling ground elevation below ${target.name}…`;
  clearTimeout(profileTimer);sampleProfile();
  // terrain detail streams in: sample again once more tiles have arrived
  profileTimer=setTimeout(sampleProfile,4000);setTimeout(sampleProfile,12000);
}
function sampleProfile(){
  const s=profileTarget;if(!s)return;
  const R=6371008.8,rad=Math.PI/180,dist=(a,b)=>2*R*Math.asin(Math.sqrt(Math.sin((b[1]-a[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin((b[0]-a[0])*rad/2)**2));
  const cum=[0];for(let i=1;i<s.line.length;i++)cum.push(cum[i-1]+dist(s.line[i-1],s.line[i]));
  const total=cum.at(-1),n=200,samples=[];
  for(let j=0,i=0;j<=n;j++){const d=total*j/n;while(i<cum.length-2&&cum[i+1]<d)i++;const f=(d-cum[i])/((cum[i+1]-cum[i])||1),a=s.line[i],b=s.line[i+1]||a;
    const [x,z]=frame.project(a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f),g=county.terrain.groundAt(x,z);if(g!==null)samples.push({distance:d,elevation:g/k});}
  const shape=profilePath(samples,300,110);if(!shape){$('profile-status').textContent='Elevation profile unavailable for this route yet.';return;}
  profileShape={...shape,samples};$('profile-line').setAttribute('d',shape.d);
  const ft=m=>Math.round(m*3.28084).toLocaleString(),mi=(shape.maxD/1609.344).toFixed(0);
  $('profile-status').textContent=`${s.name} → end of mapped network · ${mi} mi · ${ft(shape.hi)} ft to ${ft(shape.lo)} ft (drop ${ft(shape.hi-shape.lo)} ft). Ground elevation from the scene's streamed terrain (about 38 m cells in the valley), not the water surface.`;
  profileMarker(Date.now()+offset*60_000);
}
function profileMarker(t){
  const s=profileTarget,m=$('profile-marker');
  if(!profileShape||!Number.isFinite(s?.t0)||t<s.t0){m.setAttribute('visibility','hidden');return;}
  const d=(s.km-frontKm(net,s,(t-s.t0)/3_600_000))*1000;if(d>profileShape.maxD){m.setAttribute('visibility','hidden');return;}
  const i=profileShape.samples.findIndex(p=>p.distance>=d),p=profileShape.samples[Math.max(0,i)];
  m.setAttribute('cx',profileShape.x(d).toFixed(1));m.setAttribute('cy',profileShape.y(p.elevation).toFixed(1));m.setAttribute('visibility','visible');
}

await refresh();
const mil=net.points.get('MIL');setProfile(sources[0]||(mil&&{name:'Millerton Lake (San Joaquin River)',path:mil.path,km:mil.km}));
// Open on the first pulse source when there is one, looking downstream; otherwise over the valley rivers.
const first=sources[0],fp=first&&net.points.get(first.id);
if(fp)county.view(fp.longitude,fp.latitude,36_000,50,210);else county.view(-119.55,36.70,40_000,62,300);
window.river3d=county; // for checks from DevTools
setInterval(()=>{if(!document.hidden)void refresh();},300_000);
