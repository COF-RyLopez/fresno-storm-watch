import {loadSdk} from './map.js';
import {el} from './dom.js';
import {createLabelLayer} from './map-labels.js';
import {SNOW_ROUTES_URL} from './snow-model.js';
import {FLEET_TYPES,FLEET_STATUS,PASS_TONES,validateFleet,fleetSummary,repairPriority,needsPass,passExpression} from './snow-fleet-model.js';

const $=id=>document.getElementById(id);
/** County snow fleet on the map: units by status (in-shop units as orange squares), readiness counts, repair priority and
 * route last-pass colours. Reads only the collector's public snapshot; `?snowfleet=sample` previews the Oct 29 export. */
export function createSnowFleet({time,exercise}){
  const sample=new URLSearchParams(location.search).get('snowfleet')==='sample';
  let fleet=null,error=null,map=null,units=null,labels=null,passLayer=null,sdk=null,checked=null;
  const ago=t=>{const h=(Date.now()-Date.parse(t))/3600000;return !Number.isFinite(h)?'unknown':h<1?`${Math.max(1,Math.round(h*60))} min ago`:h<48?`${Math.round(h)} h ago`:`${Math.round(h/24)} days ago`;};
  function counts(){
    const s=fleetSummary(fleet);
    return `${s.available} available · ${s.inShop} in shop for repair${s.notReporting===null?'':` · ${s.notReporting} not reporting GPS`}`;
  }
  function render(){
    const status=$('snow-fleet-status'),host=$('snow-fleet-readiness');host.replaceChildren();
    if(exercise){status.textContent='Exercise · live fleet positions disabled';return;}
    if(!fleet){status.textContent=error||'Checking the snow fleet feed…';$('snow-fleet-count').textContent=status.textContent;return;}
    const stamp=`${fleet.sample?'SAMPLE · Samsara export, not live · ':''}positions as of ${time(Date.parse(fleet.generatedAt)-fleet.delayMinutes*60000)} (at least ${fleet.delayMinutes} min delayed)`;
    status.textContent=fleet.error?`Snow fleet feed problem: ${fleet.error}`:stamp;
    $('snow-fleet-count').textContent=fleet.error?'Data unavailable':counts();
    if(fleet.error)return;
    const s=fleetSummary(fleet);
    host.append(el('p',`Snow fleet: ${counts()}.`));
    if(s.byType.length){const ul=el('ul');ul.className='snow-fleet-types';for(const t of s.byType)ul.append(el('li',`${t.label}s: ${t.available} available${t.inShop?` · ${t.inShop} in shop`:''}`));host.append(ul);}
    const shop=repairPriority(fleet);
    if(shop.length){host.append(el('h4','Repair priority · in the shop'));const ol=el('ol');ol.className='snow-fleet-shop';
      for(const v of shop)ol.append(el('li',`${v.id} (${FLEET_TYPES[v.type].toLowerCase()})${v.expectedBack?` · expected back ${time(Date.parse(v.expectedBack))}`:' · return date not set'}`));
      host.append(ol,el('small','Plows first, then blowers; earliest expected return first. From the fleet feed, not a work order system.'));}
    const need=needsPass(fleet.routes);
    if(fleet.routes.length&&need.length){host.append(el('h4','Needs a pass · priority 1–2 routes, none in 6 h'));const ul=el('ul');for(const r of need.slice(0,10))ul.append(el('li',`${r.name.replace(/\b\w+/g,w=>w[0]+w.slice(1).toLowerCase())}${r.lastPass?` · last ${ago(r.lastPass)}${r.by?` by ${r.by}`:''}`:' · no pass recorded'}`));host.append(ul);}
    else if(!fleet.routes.length)host.append(el('small','Route last-pass needs location history with coordinates; not in this feed yet.'));
    if(fleet.tooRecent)host.append(el('small',`${fleet.tooRecent} position(s) newer than the published delay were withheld.`));
  }
  async function draw(){
    if(!map||!sdk||!fleet)return;
    const [GraphicsLayer,Graphic,FeatureLayer]=sdk;
    units.removeAll();
    for(const v of fleet.vehicles){
      if(v.trail.length>1)units.add(new Graphic({geometry:{type:'polyline',paths:[[...v.trail.map(p=>[p[0],p[1]]),...(v.lon===null?[]:[[v.lon,v.lat]])]],spatialReference:{wkid:4326}},symbol:{type:'simple-line',color:[74,163,255,.7],width:2}}));
      if(v.lon===null)continue;
      const shop=v.status==='in-shop',st=FLEET_STATUS[v.status];
      units.add(new Graphic({geometry:{type:'point',longitude:v.lon,latitude:v.lat,spatialReference:{wkid:4326}},
        symbol:{type:'simple-marker',style:shop?'square':v.type==='snow-blower'?'diamond':'circle',size:shop?13:12,color:st.color,outline:{color:'#17232b',width:1.5}},
        attributes:{id:v.id},popupTemplate:{title:`${v.id} · ${FLEET_TYPES[v.type]}`,content:()=>{const t=document.createElement('table');t.className='esri-widget__table';
          for(const [k,val]of [['Status',`${st.label}${v.statusBasis?` (${v.statusBasis})`:''}`],['Expected back',v.expectedBack&&time(Date.parse(v.expectedBack))],['Home yard',v.yard],['On snow route',v.onRoute],['Position as of',v.seen&&`${time(Date.parse(v.seen))} · ${ago(v.seen)}`]]){if(!val)continue;const r=t.insertRow();r.insertCell().textContent=k;r.insertCell().textContent=val;}
          const wrap=document.createElement('div');wrap.append(t,Object.assign(document.createElement('p'),{textContent:`${fleet.source}. Positions are delayed at least ${fleet.delayMinutes} minutes; no driver information is published.`}));return wrap;}}}));
    }
    void labels.set(fleet.vehicles.filter(v=>v.lon!==null).map(v=>({longitude:v.lon,latitude:v.lat,label:v.status==='in-shop'?`${v.id} · in shop`:v.id})));
    const expression=passExpression(fleet.routes);
    if(expression&&!passLayer){passLayer=new FeatureLayer({url:SNOW_ROUTES_URL,title:'Snow routes · time since last plow pass',outFields:['name'],popupEnabled:false,legendEnabled:false});map.registerLayer('snowFleet',passLayer,true,1);}
    if(passLayer)passLayer.renderer={type:'unique-value',valueExpression:expression||"'none'",defaultSymbol:null,uniqueValueInfos:Object.entries(PASS_TONES).map(([value,t])=>({value,label:t.label,symbol:{type:'simple-line',color:t.color,width:4}}))};
  }
  async function refresh(){
    if(exercise)return render();
    try{
      const r=await fetch(new URL(`../data/snow-fleet/${sample?'sample':'latest'}.json`,import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(r.status===404){error='Snow fleet feed not connected yet (Samsara collector pending). Add ?snowfleet=sample to preview.';fleet=null;}
      else{if(!r.ok)throw Error(`HTTP ${r.status}`);fleet=validateFleet(await r.json());error=null;}
    }catch(e){error=`Snow fleet unavailable · ${e.message}`;fleet=null;}
    checked=Date.now();render();void draw();
    window.dispatchEvent(new CustomEvent('storm-snow-fleet',{detail:{fleet,checked}}));
  }
  $('snow-fleet-toggle').addEventListener('calciteCheckboxChange',e=>map?.setLayerPreference('snowFleet',e.target.checked));
  const key=$('snow-fleet-key');key.replaceChildren(...['working','traveling','idle','parked','off','in-shop'].map(s=>{const i=el('i');i.style.background=FLEET_STATUS[s].color;i.className=s==='in-shop'?'square':'';const span=el('span');span.append(i,FLEET_STATUS[s].label);return span;}));
  setInterval(()=>{if(!document.hidden)void refresh();},5*60000);
  queueMicrotask(()=>void refresh());
  return {async setMap(controller){map=controller;try{
    const c=await (await loadSdk()).import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/layers/FeatureLayer.js']);sdk=c;
    units=new c[0]({title:'County snow fleet · delayed positions',elevationInfo:{mode:'on-the-ground'}});map.registerLayer('snowFleet',units);
    labels=createLabelLayer({FeatureLayer:c[2],Graphic:c[1]},{title:'Snow fleet names'});map.registerLayer('snowFleet',labels.layer);
    void draw();
  }catch(e){error=`Snow fleet map unavailable · ${e.message}`;render();}}};
}
