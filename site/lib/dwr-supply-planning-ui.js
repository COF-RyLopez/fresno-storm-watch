import {loadSdk} from './map.js?v=0.74.0-shell';
import {correlateDwrSupplies,SUPPLY_CONTEXT_KM} from './dwr-supply-planning-model.js?v=0.73.1';
import {inspectionDate,inventoryQuantity} from './dwr-flood-fight-model.js?v=0.61.0';

const KEY='dwrSupplyContext';
const mapSignature=row=>JSON.stringify([row.site.key,[...new Map(row.areas.flatMap(a=>a.points).map(p=>[p.id,p])).values()],row.roads.map(r=>[r.row.key,r.row.revision])]);
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const distance=meters=>(meters/1000).toFixed(1)+' km';
const button=(text,action)=>{const b=node('calcite-button',text);b.scale='s';b.appearance='outline';b.addEventListener('click',action);return b;};
const external=(text,url)=>{const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};

/** Public, memory-only supply context. Proximity never assigns supplies or establishes a usable route. */
export function createDwrSupplyPlanning({exercise=false,timeZone='America/Los_Angeles',onLoad=()=>{},onArea=()=>{},onRoad=()=>{},onSource=()=>{},onMap=()=>{}}={}){
  const $=id=>document.getElementById(id),root=$('dwr-supply-watch'),pane=$('dwr-supply-evidence');
  let supplies=null,planning=null,roads=null,controller=null,result=null,selected=null,layer=null,layerPromise=null,drawGeneration=0,requested=false,busy=false,cardSignature='',detailSignature='',optionsSignature='',drawSignature='';
  const formatter=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone});
  const time=value=>Number.isFinite(value)?formatter.format(value):'Unknown';
  function calculate(){return correlateDwrSupplies({supplies,planning,roads,radiusKm:Number($('dwr-supply-radius').value),areaId:$('dwr-supply-area').value});}
  function sourceHealth(host){
    host.append(node('p',`Supply feed checked ${time(result.supplyChecked)} · ${result.supplyCurrent?'query current; inspection inventory is historical':'feed not current / unavailable'}.`));
    host.append(node('p',`County road feed checked ${time(result.roadChecked)} · ${result.roadCurrent?'source query current':'unavailable or overdue; road status needs verification'}${result.roadError?' · '+result.roadError:''}.`));
    if(result.roadRejected||result.roadConflicts)host.append(node('p',`${result.roadRejected} road records have unusable geometry / identity; ${result.roadConflicts} conflicting duplicate records excluded. Nearby coverage is incomplete.`));
  }
  function inspection(host,row){
    const p=node('p',`Inspection: ${inspectionDate(row.site.inspection)} (UTC date) · ${row.inspection.label}.`);p.className='dwr-inspection';host.append(p);
  }
  function areas(host,row,detailed=false){
    if(!row.areas.length){host.append(node('p',`No configured river watchpoint within ${result.radiusKm} km. Other supply arrangements may exist.`));return;}
    for(const a of row.areas){
      const p=node('p',`${a.name} · ${distance(a.meters)} to ${a.pointName}`);host.append(p);
      if(detailed){
        host.append(node('p',`Existing review cue: ${a.status}.`));
        host.append(node('p',a.rainfall.maximum===null?'Rainfall amount / timing not currently usable; inspect the published forecast.':`WPC rain sample maximum ${a.rainfall.maximum.toFixed(2)} in · valid ${time(a.rainfall.start)} → ${time(a.rainfall.end)} · issued ${time(a.rainfall.issue)}. Point samples, not basin-average rainfall or runoff.`));
        host.append(button('Inspect '+a.name,()=>onArea(a.id)));
      }
    }
  }
  function renderDetail(){
    if(!selected||!pane.hasAttribute('open'))return;
    const row=result.rows.find(r=>r.site.key===selected),host=$('dwr-supply-details');
    const signature=JSON.stringify([selected,row,result.supplyCurrent,result.roadCurrent,result.supplyChecked,result.roadChecked,result.supplyError,result.roadError,result.roadRejected,result.roadConflicts]);if(signature===detailSignature)return;detailSignature=signature;host.replaceChildren();
    if(!row){drawGeneration++;layer?.removeAll();host.append(node('p',result.supplyError?'Supply query failed; previous inventory is not shown as current. Recheck the source.':'This supply location is outside the selected context. Select another location.'));return;}
    pane.heading=row.site.name+' · supply planning';
    host.append(node('p',row.site.address));inspection(host,row);
    host.append(node('p','Current stock, allocation and pickup arrangements are unverified. Confirm with DWR before committing resources.'));
    const stock=node('details');stock.append(node('summary','Reported inspection inventory'));
    const dl=node('dl');for(const [key,label]of [['burlap','Burlap sandbags (each)'],['plasticBags','Plastic sandbags (each)'],['plasticRolls','Plastic (rolls)'],['containers','Containers']])dl.append(node('dt',label),node('dd',inventoryQuantity(row.site.inventory[key])));stock.append(dl);host.append(stock);
    host.append(node('h3','River watchpoint context'));areas(host,row,true);
    host.append(node('h3','Nearby road records'));
    host.append(node('p','Within 5 km of this supply location or its nearby river watchpoints. Straight-line context; these are not delivery routes. Source-inactive records remain in Roads history.'));
    if(!row.roads.length)host.append(node('p',result.roadCurrent?'No matching road records returned. This does not establish open roads or safe access.':'Nearby road status is unknown because the feed is unavailable or overdue.'));
    for(const r of row.roads){
      const section=node('section');section.className='dwr-road-context';
      section.append(node('h4',`${r.row.kind} · ${r.row.name}`),node('p',r.verification&&r.row.status!=='Verification needed'?'Verification needed · '+r.row.status:r.row.status));
      const basis=[];if(r.siteMeters!==null)basis.push(`${distance(r.siteMeters)} from supply site`);if(r.areaMeters!==null)basis.push(`${distance(r.areaMeters)} from ${r.pointName}`);section.append(node('p',basis.join(' · ')));
      if(r.row.location)section.append(node('p',r.row.location));
      for(const issue of r.row.issues||[])section.append(node('p',issue));
      section.append(node('p',`Source update ${time(r.row.sourceTime||r.row.edited)} · starts ${time(r.row.start)} · ends ${time(r.row.end)}. An elapsed end date is not a reopening confirmation.`),button('Inspect road record',()=>onRoad(r.row.key)));host.append(section);
    }
    const notes=node('details');notes.append(node('summary','Sources, map key & coverage'));sourceHealth(notes);
    notes.append(node('p',`Watchpoints within ${result.radiusKm} km of the supply site are linked by proximity only. They are not DWR service areas, resource commitments or verified access. White hollow circle: selected supply; cyan hollow circles: associated watchpoints. No route is drawn. County road symbols retain their source-status meanings.`));
    notes.append(external('DWR flood-fight dashboard','https://www.arcgis.com/apps/dashboards/e2ef0f8a2100424b8fb6ab0e9bd7faf6'));
    if(supplies?.source)notes.append(node('p',''),external('Publisher supply layer',supplies.source));host.append(notes);
  }
  async function draw(row,fit=false){
    const generation=++drawGeneration;if(!controller)return;
    try{
      layerPromise??=loadSdk().then(async sdk=>{const [GraphicsLayer,Graphic]=await sdk.import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js']);layer=new GraphicsLayer({title:'Selected DWR supply, watchpoints & road references · proximity only',elevationInfo:{mode:'on-the-ground'},popupEnabled:false});controller.registerLayer(KEY,layer,true);return Graphic;});
      const Graphic=await layerPromise;if(generation!==drawGeneration||!pane.hasAttribute('open'))return;
      layer.removeAll();
      const points=[...new Map(row.areas.flatMap(a=>a.points).map(p=>[p.id,p])).values()];
      for(const [i,p]of [row.site,...points].entries())layer.add(new Graphic({geometry:{type:'point',longitude:p.longitude,latitude:p.latitude},symbol:{type:'simple-marker',style:'circle',size:i===0?24:17,color:[0,0,0,0],outline:{color:i===0?'#ffffff':'#60dcdf',width:2.5}}}));
      // Include the selected context's elapsed/uncertain records without changing the Roads history filter.
      // Retain the existing county road palette, geometry and click-through identity.
      for(const {row:r}of row.roads){const shade=r.layer===2?'#65cad1':'#f6a777';layer.add(new Graphic({attributes:{roadKey:r.key},geometry:{...r.geometry,type:r.layer===0?'point':'polyline'},symbol:r.layer===0?{type:'simple-marker',style:'x',size:13,color:shade,outline:{color:shade,width:2}}:{type:'simple-line',color:shade,width:3,style:r.layer===2?'dash':'solid'}}));}
      drawSignature=mapSignature(row);
      if(fit){
        for(const key of [KEY,'dwrFloodFight','roads','gauges','reservoirs'])controller.setLayerPreference(key,true);
        // Let the evidence pane resize the map before computing the fitted view.
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(generation===drawGeneration&&pane.hasAttribute('open'))await controller.inspectPlanningPoints([row.site,...points]);
      }
    }catch{if(generation===drawGeneration)$('dwr-supply-map-status').textContent='Map context unavailable; the source records remain in the pane.';}
  }
  function inspect(key){selected=key;onMap();pane.setAttribute('open','');renderDetail();const row=result.rows.find(r=>r.site.key===key);if(row){$('dwr-supply-map-status').textContent='White ring: supply · cyan rings: watchpoints · orange: road block / closure records · dashed teal: detours. Road dates and status require review; no route is drawn.';void draw(row,true);}}
  function render(){
    result=calculate();const host=$('dwr-supply-cards');
    $('dwr-supply-summary').textContent=exercise?'DWR supply planning · live inventory disabled':`DWR supply planning · ${result.loaded&&!result.supplyError?result.total+' sites · historical inspections':result.supplyError?'source unavailable':'checking source'}`;
    $('dwr-supply-health').textContent=exercise?'Open the live workspace for DWR resources.':result.supplyError?'Supply inventory unavailable · '+result.supplyError:!result.loaded?'Loading public DWR inventory…':`${result.rows.length} of ${result.total} sites in selected context · ${result.supplyCurrent?'feed query current':'feed check overdue'} · stock availability unverified.`;
    const signature=JSON.stringify([result.rows,result.planningReady,result.roadCurrent,result.loaded,result.supplyError,result.radiusKm]);
    if(signature!==cardSignature){cardSignature=signature;host.replaceChildren();
      if(!result.planningReady)host.append(node('p','River watchpoint context is still loading.'));
      if(result.loaded&&!result.supplyError&&!result.rows.length)host.append(node('p','No supply sites match this watchpoint context. This does not establish that supplies are unavailable.'));
      for(const row of result.rows){const card=node('section');card.className='dwr-supply-card';card.append(node('h3',row.site.name));inspection(card,row);areas(card,row);
      card.append(node('p',`${row.roads.length} nearby road record${row.roads.length===1?'':'s'}${result.roadCurrent?'':' · road feed needs verification'}`),button('Inspect supply context',()=>inspect(row.site.key)));host.append(card);}
    }
    renderDetail();if(selected&&pane.hasAttribute('open')){const row=result.rows.find(r=>r.site.key===selected);if(row&&mapSignature(row)!==drawSignature)void draw(row);}
  }
  async function request(options){
    if(exercise||busy)return;requested=true;busy=true;
    const refresh=$('dwr-supply-refresh');refresh.loading=true;refresh.disabled=true;
    try{await onLoad(options);}catch(error){supplies={loaded:true,rows:[],checked:null,error:error.message||'Inventory unavailable'};render();}
    finally{busy=false;refresh.loading=false;refresh.disabled=false;}
  }
  root.addEventListener('toggle',()=>{if(root.open&&!requested)request();});
  $('dwr-supply-refresh').addEventListener('click',()=>void request({refresh:true}));
  $('dwr-supply-source').addEventListener('click',onSource);
  for(const km of SUPPLY_CONTEXT_KM){const option=node('option',km+' km');option.value=String(km);option.selected=km===25;$('dwr-supply-radius').append(option);}
  for(const id of ['dwr-supply-area','dwr-supply-radius'])$(id).addEventListener('change',render);
  pane.addEventListener('stormEvidenceClose',()=>{selected=null;drawGeneration++;drawSignature='';layer?.removeAll();});
  setInterval(()=>{if(requested&&!document.hidden)render();},30000);
  render();
  const deepLink=new URLSearchParams(location.search).get('dwrSupplies')==='1';if(deepLink)root.open=true;
  return {setMap(map){controller=map;if(!exercise&&(root.open||new URLSearchParams(location.search).get('view')==='watch'||!new URLSearchParams(location.search).has('view')))request();},setSupplies(data){supplies=data;render();},setPlanning(data){planning=data;const options=data.rows.map(r=>({id:r.area.id,name:r.area.name})),signature=JSON.stringify(options);if(signature!==optionsSignature){optionsSignature=signature;const select=$('dwr-supply-area'),value=select.value;select.replaceChildren(node('option','All river watch areas'));select.firstElementChild.value='all';for(const r of options){const o=node('option',r.name);o.value=r.id;select.append(o);}select.value=[...select.options].some(o=>o.value===value)?value:'all';}render();},setRoads(data){roads=data;render();},selectArea(id){const select=$('dwr-supply-area');if([...select.options].some(o=>o.value===id)){select.value=id;render();}}};
}
