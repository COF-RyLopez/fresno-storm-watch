import {loadSdk} from './map.js?v=0.74.0-infra-weather';
import {SANDBAG_APP,SANDBAG_SOURCE,SANDBAG_GUIDANCE,SANDBAG_STATES,SANDBAG_MAX_AGE,validateSandbagSnapshot,sandbagContext,sandbagHealth,sandbagHours} from './county-sandbag-model.js?v=0.74.0-planning';
import {reportHealth} from './source-health.js?v=0.73.1';
import {roadGraphic,fillAreaSelect,selectAreaOption} from './dwr-supply-planning-ui.js?v=0.74.0-planning';
const KEY='countySandbags',node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const button=(text,fn)=>{const b=node('calcite-button',text);b.scale='s';b.appearance='outline';b.addEventListener('click',fn);return b;};
const external=(label,url)=>{const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const km=m=>(m/1000).toFixed(1)+' km';

/** Public pickup references, separate from DWR stock inspection inventories and private operating records. */
export function createCountySandbags({exercise=false,timeZone='America/Los_Angeles',onMap=()=>{},onArea=()=>{},onRoad=()=>{},onData=()=>{}}={}){
  const $=id=>document.getElementById(id),root=$('county-sandbag-watch'),pane=$('county-sandbag-evidence'),formatter=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone});
  const time=value=>{const ms=typeof value==='string'?Date.parse(value):value;return Number.isFinite(ms)?formatter.format(ms):'Unknown';};
  let snapshot=null,error=null,planning=null,roads=null,map=null,base=null,context=null,Graphic=null,busy=false,selected=null,view=null,listSignature='',detailSignature='',optionsSignature='';
  function calculate(){return sandbagContext(snapshot,planning,roads,{filter:$('county-sandbag-status').value,query:$('county-sandbag-query').value,areaId:$('county-sandbag-area').value});}
  function selection(){const r=selected&&pane.hasAttribute('open')?snapshot?.rows.find(r=>r.key===selected):undefined;return [r,r?.geometry?sandbagContext({...snapshot,rows:[r]},planning,roads,{filter:'all'}).rows[0]:null];}
  function detail(r,matched){
    if(!selected||!pane.hasAttribute('open'))return;
    const health=sandbagHealth(snapshot);
    const signature=JSON.stringify([r,matched,health,error,snapshot?.lastSuccess]);if(signature===detailSignature)return;detailSignature=signature;
    const host=$('county-sandbag-details');host.replaceChildren();if(!r){host.append(node('p','Selected county record is no longer returned. Verify its disposition; no closure or opening is inferred.'));context?.removeAll();return;}
    pane.heading=r.name+' · county sandbag site';host.append(node('p',[r.address,r.city].filter(Boolean).join(' · ')),node('p',SANDBAG_STATES[r.state]));
    const note=node('p',`Published site status does not confirm sand, bags, staffing or access. ${error||!health.current?'Collection unavailable / overdue; retained source references require verification.':'Prepared source snapshot; verify current stock and access before travel.'}`);note.className='dwr-inspection';host.append(note,node('p',`Stored edit field: ${time(r.edited)} · maintenance field: ${time(r.maintained)}. These are not stock inspections or event-readiness checks.`));
    if(r.locationIssue)host.append(node('p',r.locationIssue+'. No inferred map point or route is shown.'));
    const hours=sandbagHours(r);host.append(node('p',hours?`County page lists ${hours} for this road yard (local time). Confirm current hours, eligibility and stock.`:'Site hours, eligibility and current stock are not supplied in this layer. Confirm with the site operator.'));
    if(hours)host.append(node('p','County road-yard guidance: bring a shovel and fill the bags yourself. Road Maintenance information: (559) 600-4240, Monday–Friday, 8 AM–5 PM. Guidance reviewed Oct 28, 2026; the source page controls current instructions.'));
    host.append(external('County sandbag instructions & yard hours',SANDBAG_GUIDANCE));
    host.append(node('h3','Nearby river watchpoints'));
    if(!matched?.areas.length)host.append(node('p',r.geometry?'No configured river watchpoint within 25 km. This does not establish that the site or community is outside flood risk.':'River proximity cannot be determined without source coordinates.'));
    for(const a of matched?.areas||[]){host.append(node('p',`${a.name} · ${km(a.meters)} to ${a.pointName}. Existing river cue: ${a.status}.`),node('p',a.rainfall.maximum===null?'Rainfall timing / amount not currently usable.':`WPC river-area point sample maximum ${a.rainfall.maximum.toFixed(2)} in · valid ${time(a.rainfall.start)} → ${time(a.rainfall.end)} · issued ${time(a.rainfall.issue)}. Not basin-average rainfall or runoff.`),button('Inspect '+a.name,()=>onArea(a.id)));}
    host.append(node('h3','Nearby road records'),node('p','Within 5 km of this site or its nearby watchpoints, using full road geometry. Straight-line context, not a pickup route.'));
    if(!matched?.roads.length)host.append(node('p',!r.geometry?'Road proximity cannot be determined without coordinates.':!view.roadCurrent?'Road feed unavailable / overdue; nearby status unknown.':'No matching road records returned; open roads and safe access are not established.'));
    for(const near of matched?.roads||[]){const section=node('section');section.className='dwr-road-context';const row=near.row,basis=[];if(near.siteMeters!==null)basis.push(`${km(near.siteMeters)} from site`);if(near.areaMeters!==null)basis.push(`${km(near.areaMeters)} from ${near.pointName}`);section.append(node('h4',row.kind+' · '+row.name),node('p',(near.verification&&row.status!=='Verification needed'?'Verification needed · ':'')+row.status),node('p',basis.join(' · ')),node('p',row.location),node('p',`Source update ${time(row.sourceTime||row.edited)} · starts ${time(row.start)} · ends ${time(row.end)}.`));for(const issue of row.issues||[])section.append(node('p',issue));section.append(button('Inspect road record',()=>onRoad(row.key)));host.append(section);}
    const sources=node('details');sources.append(node('summary','Source dates, map key & coverage'),node('p',`Prepared collection ${time(snapshot.lastSuccess)} · ${snapshot.appSubtitle||'County app update label not supplied'}. The old app label and record dates are distinct from the collection time.`),node('p',`Road feed checked ${time(view.roadChecked)} · ${view.roadCurrent?'query current':'verification needed'}. Site-to-watchpoint distance is at most 25 km; road context is at most 5 km. Neither distance establishes service assignment or drivable access.`),node('p','County shovel/bag icon: source-active location; hollow gray diamond: status unknown; gray x: source inactive. White selection ring: selected site; cyan rings: associated watchpoints. Orange road references / dashed teal detours retain the existing road palette. Current inventory is unverified for every site.'),external('County interactive sandbag map',SANDBAG_APP),node('p'),external('Publisher feature service',SANDBAG_SOURCE));host.append(sources);
  }
  function draw(r,matched){
    if(!base)return;base.removeAll();context.removeAll();
    for(const {site:r}of view.rows){if(!r.geometry)continue;base.add(new Graphic({attributes:{countySandbagKey:r.key},geometry:{...r.geometry,type:'point'},symbol:r.state==='active'?{type:'picture-marker',url:new URL('../assets/county-sandbag.png',import.meta.url).href,width:25,height:25}:{type:'simple-marker',style:r.state==='inactive'?'x':'diamond',size:15,color:[0,0,0,0],outline:{color:'#b9c1c9',width:2,style:r.state==='inactive'?'solid':'dash'}}}));}
    if(!selected||!pane.hasAttribute('open'))return;
    if(!r?.geometry)return;
    for(const [i,p]of [{longitude:r.geometry.x,latitude:r.geometry.y},...matched?.points||[]].entries()){const geometry={type:'point',longitude:p.longitude,latitude:p.latitude};context.add(new Graphic({geometry,symbol:{type:'simple-marker',size:i?18:30,color:[0,0,0,0],outline:{color:'#17212a',width:5}}}));context.add(new Graphic({geometry,symbol:{type:'simple-marker',size:i?18:30,color:[0,0,0,0],outline:{color:i?'#60dcdf':'#ffffff',width:2.5}}}));}
    for(const {row}of matched?.roads||[])context.add(roadGraphic(Graphic,row));
  }
  function render(){
    view=calculate();const health=view.health,a=snapshot?.accounting;
    $('county-sandbag-summary').textContent=exercise?'County sandbag locations · live data disabled':`County sandbag locations · ${a?a.active+' source-active':error?'unavailable':'loading'}`;
    $('county-sandbag-health').textContent=exercise?'Live county records are disabled in the fictional exercise.':a?`${a.active} source-active · ${a.unknown} status unknown · ${a.inactive} inactive · ${a.unmapped} address-only. ${health.current&&!error?'Prepared collection':'Collection overdue / failed; retained references'} ${time(snapshot.lastSuccess)}.`:error||'Loading county source snapshot…';
    $('county-sandbag-age').textContent=snapshot?`${snapshot.appSubtitle||'App update label unknown'} · site edit / maintenance dates appear in the evidence pane. A recent collection does not confirm stock or operating hours.`:'Source dates and availability will appear with the records.';
    $('county-sandbag-result').textContent=`${view.rows.length} records in this filter. ${view.unmappedInFilter?'Address-only sites have no spatial match; choose All river watch areas to view them. ':''}Proximity is not a service area or usable route.`;
    const signature=JSON.stringify(view.rows);if(signature!==listSignature){listSignature=signature;const list=$('county-sandbag-list');list.replaceChildren();for(const {site:r,areas}of view.rows){const item=node('calcite-list-item');item.label=r.name;item.description=[r.address,r.city,SANDBAG_STATES[r.state],r.locationIssue,areas[0]?areas[0].name+' · '+km(areas[0].meters):null].filter(Boolean).join(' · ');item.value=r.key;const inspect=()=>void select(r.key);item.addEventListener('click',inspect);item.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();inspect();}});list.append(item);}}
    const [r,matched]=selection();detail(r,matched);draw(r,matched);
    if(!exercise)reportHealth('county-sandbags','County sandbag locations',{checked:health.checked,error:error||snapshot?.error,state:!snapshot?'checking':!health.current?'stale':a.unmapped||a.unknown?'coverage':null,maxAgeMs:SANDBAG_MAX_AGE,detail:'Source-active is not stock confirmation; some records have unknown status / missing coordinates and historical dates.'});
  }
  async function select(key){
    const r=snapshot?.rows.find(r=>r.key===key);if(!r)return;selected=key;detailSignature='';
    if($('county-sandbag-status').value!=='all'&&$('county-sandbag-status').value!==r.state)$('county-sandbag-status').value=r.state;
    $('county-sandbag-query').value='';$('county-sandbag-area').value='all';onMap();pane.setAttribute('open','');render();
    if(!r.geometry||!map)return;map.setLayerPreference(KEY,true);
    const points=view.rows.find(row=>row.site.key===key)?.points||[];
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    if(selected!==key||!pane.hasAttribute('open'))return;
    await map.inspectPlanningPoints([{longitude:r.geometry.x,latitude:r.geometry.y},...points]);
  }
  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;$('county-sandbag-refresh').loading=true;
    try{const r=await fetch('./data/county-sandbags-latest.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Prepared county feed HTTP '+r.status);snapshot=validateSandbagSnapshot(await r.json());error=null;onData(snapshot);}
    catch(e){error=e.message||'County sandbag feed unavailable';onData(snapshot?{...snapshot,error}:null);}
    finally{busy=false;$('county-sandbag-refresh').loading=false;render();}
  }
  for(const id of ['county-sandbag-status','county-sandbag-area'])$(id).addEventListener('change',render);
  $('county-sandbag-query').addEventListener('input',render);$('county-sandbag-refresh').addEventListener('click',()=>void refresh());
  pane.addEventListener('stormEvidenceClose',()=>{selected=null;context?.removeAll();});
  root.addEventListener('toggle',()=>{if(root.open&&!snapshot)void refresh();});
  setInterval(()=>{if(!document.hidden)void refresh();},300000);setInterval(()=>{if(!document.hidden)render();},60000);
  const params=new URLSearchParams(location.search);if(params.get('sandbags')==='1')root.open=true;
  render();queueMicrotask(()=>void refresh());
  return {select,setPlanning(data){planning=data;const signature=JSON.stringify(data.rows.map(r=>({id:r.area.id,name:r.area.name})));if(optionsSignature!==signature){optionsSignature=signature;fillAreaSelect($('county-sandbag-area'),data.rows);}render();},setRoads(data){roads=data;render();},selectArea(id){if(selectAreaOption($('county-sandbag-area'),id))render();},async setMap(controller){map=controller;try{const sdk=await loadSdk();const [GraphicsLayer,GraphicClass]=await sdk.import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);Graphic=GraphicClass;base=new GraphicsLayer({title:'County sandbag locations · source status / stock unconfirmed',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});context=new GraphicsLayer({title:'Selected county sandbag context · not a route',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});map.registerLayer(KEY,base,true);map.registerLayer(KEY,context,true);draw(...selection());}catch{$('county-sandbag-result').textContent='Sandbag map unavailable; source addresses remain in the list.';}}};
}
