import {validateBriefingContext,correlateBriefingContext,LOOKUP_KM} from './briefing-context-model.js?v=0.74.0-population';
import {POWER_STATES} from './power-model.js';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(text,action)=>{const n=el('calcite-button',text);n.scale='s';n.appearance='outline';n.onclick=action;return n;};
/** @param {object} options @returns {object} Private asset data stays in this controller's memory and is cleared with its source session. */
export function createBriefingContextView({timeZone,exercise=false,onBriefing,onArea,onRoad,onFacility,onConnect,onMap,onData=()=>{}}){
  const host=document.getElementById('briefing-context-list'),status=document.getElementById('briefing-context-status'),block=document.getElementById('briefing-context-block');
  let associations=null,briefing={rows:[]},planning=null,roads=null,facilities=null,radiusKm=5,history=false,error=null,map=null,selected=null,signature='',model=null;
  const expanded=new Set(),limits=new Map(),dateFormat=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}),time=value=>Number.isFinite(value)?dateFormat.format(value):'Not supplied';
  const distance=i=>`≈ ${(i.meters/1000).toFixed(1)} km from ${i.pointId} · straight line to source geometry`;
  const controls=document.getElementById('briefing-context-radius');
  for(const km of LOOKUP_KM){const o=el('calcite-option',`${km} km`);o.value=String(km);o.selected=km===radiusKm;controls.append(o);}
  function updateMap(){if(!map||!selected)return;const g=model?.groups.find(g=>g.id===selected);map.setBriefingContext(g?{id:g.id,points:g.points,roads:g.roads.map(i=>i.row),facilities:g.facilities.map(i=>i.row)}:{points:[],roads:[],facilities:[]});}
  function render(){
    model=correlateBriefingContext({associations,briefing,planning,roads,facilities,radiusKm,history});
    onData(model);const key=JSON.stringify([model,error,exercise],(k,v)=>k==='geometry'?undefined:v);if(key===signature)return;signature=key;updateMap();
    for(const item of host.querySelectorAll('[data-context-area]'))item.expanded?expanded.add(item.dataset.contextArea):expanded.delete(item.dataset.contextArea);
    block.description=exercise?'Live briefing associations disabled':`${model.groups.filter(g=>g.contextReview).length} groups with context to review · not impact predictions`;
    status.textContent=exercise?'Exercise · live briefings are not mixed with fictional records':error||(!associations?'Loading reviewed briefing associations…':!planning?'Waiting for river watch areas…':`Roads ${model.roadCurrent?'checked':'unavailable / overdue / failed'} ${time(model.roadChecked)}. ${model.facilityConnected?'Authorized connected asset layers only':'Facilities not assessed · sign in and load county layers'}.`);
    host.replaceChildren();if(exercise)return;
    if(model.briefingUnreviewed)host.append(el('p','A new public briefing needs Fresno impact and river-association review. Previous public summaries are withheld; read the current NWS source.'));
    if(model.unassociated)host.append(el('p',`${model.unassociated} briefing outlook(s) lack a reviewed river association for this PDF revision. No association is inferred.`));
    if(model.roadRejected||model.facilityRejected||model.facilityGaps)host.append(el('p',`Coverage gaps: ${model.roadRejected} road geometries and ${model.facilityRejected} asset geometries unavailable for lookup; ${model.facilityGaps} connected asset sources need review. Nearby lists are incomplete.`));
    if(!model.facilityConnected)host.append(button('Open county asset connections',onConnect));
    const accordion=el('calcite-accordion');accordion.scale='s';host.append(accordion);
    for(const g of model.groups){
      const card=el('calcite-accordion-item');card.heading=g.name;card.description=`${g.current.length} current public / ${g.impacts.length} total briefing contexts · river ${g.riverReview?'review cue':'check evidence'} · ${g.roads.length} nearby road / ${model.facilityConnected?g.facilities.length:'unassessed'} asset records`;
      card.dataset.contextArea=g.id;card.expanded=expanded.has(g.id);
      card.append(el('p',g.contextReview?'Briefing context and local records warrant review together; exposure and simultaneous impacts remain unconfirmed.':'Context is incomplete or no combined review cue returned. This does not establish safe conditions.'));
      card.append(el('p',`River evidence: ${g.river.status} · ${g.river.gaps.length} coverage gaps. Reference points: ${g.points.map(p=>p.id).join(', ')}.`));
      const actions=el('div');actions.className='environment-actions';const locate=button('Map area + nearby records',()=>{selected=g.id;updateMap();onMap();map?.focusBriefingContext(g.points,radiusKm);});locate.disabled=!map;actions.append(locate,button('Review river evidence',()=>onArea(g.id)));card.append(actions);
      card.append(el('h4','Associated briefing evidence'));
      if(!g.impacts.length)card.append(el('p','No reviewed briefing association available for this group / source revision.'));
      for(const b of g.impacts){const section=el('section');section.className='briefing-context-evidence';section.append(el('strong',b.area),el('p',`${b.status} · ${b.association.relation==='headwater-context'?'Upstream headwater context only':'Regional context only'}`),el('p',b.impact),el('p',`Timing: ${b.timing}`),el('p',`Confidence: ${b.confidence}`),el('p',`Probability: ${b.probability}`),el('p',b.association.note),el('small',`${b.document.label} · page ${b.page}`),button(`Read briefing page ${b.page}`,()=>onBriefing(b.document.kind,b.page,b.document.sha256)));card.append(section);}
      const limit=limits.get(g.id)||10;
      card.append(el('h4',`Nearby road records · ${g.roads.length}`),el('p','Proximity to gauge / dam points only. These roads are not established facility access routes; detours are not confirmed usable.'));
      if(!g.roads.length)card.append(el('p',model.roadCurrent?'No road records returned in this lookup. This is not proof of open roads or complete reach coverage.':'Road lookup unavailable or no retained records nearby. Verify the county source.'));
      for(const i of g.roads.slice(0,limit)){const r=i.row,s=el('section');s.className='briefing-context-evidence';s.append(el('strong',`${r.kind} · ${r.name}`),el('p',`${r.status}${i.history?' · reported inactive history':''}${i.verification?' · verify current status':''}`),el('p',distance(i)),el('p',`Source updated ${time(r.sourceTime)} · edited ${time(r.edited)}`),el('p',`Start ${time(r.start)} · end ${time(r.end)}`),el('p',i.timing),button('Review county road record',()=>onRoad(r.key)));card.append(s);}
      card.append(el('h4',`Nearby county assets · ${model.facilityConnected?g.facilities.length:'not assessed'}`));
      if(model.facilityConnected&&!g.facilities.length)card.append(el('p','No loaded asset geometry matched this distance lookup. Other inventory layers or river locations may be missing.'));
      for(const i of g.facilities.slice(0,limit)){const r=i.row,s=r.site,section=el('section');section.className='briefing-context-evidence';section.append(el('strong',`${s.kind} · ${s.name}`),el('p',distance(i)),el('p',`Owner / department: ${s.owner||'Unassigned'} · site status: ${s.status||'Not supplied'}`),el('p',`Backup power: ${s.backup||'Unknown — verify with owner'}`),el('p',`Inventory retrieved ${time(s.fetched)} · source updated ${time(s.updated)}${i.siteCurrent?'':' · inventory check requires verification'}`),el('p',r.label));
        for(const p of i.power)section.append(el('p',`Utility geometry overlap: ${p.row.utility} · ${POWER_STATES[p.row.status]||'Status unconfirmed'} · updated ${time(p.row.updated?.time)}${p.row.health?' · feed needs verification':''}. ${p.timing}.`));
        section.append(el('p','Confirm facility mission, current power, fuel/runtime and approved access with the owner. A nearby generator does not establish backup service for this facility.'),button('Review authorized asset',()=>onFacility(s.key)));card.append(section);}
      if(g.roads.length>limit||g.facilities.length>limit)card.append(button(`Show more records (${limit} per list shown)`,()=>{limits.set(g.id,limit+20);expanded.add(g.id);signature='';render();}));
      card.append(el('p',`Lookup covers only ${radiusKm} km from the listed gauge / dam points. The full river reach and high-elevation roads are not surveyed by these points. Resource location, need and timing require owner / EOC verification.`));
      accordion.append(card);
    }
  }
  controls.addEventListener('calciteSelectChange',()=>{radiusKm=Number(controls.value);render();});document.getElementById('briefing-context-history').addEventListener('calciteCheckboxChange',e=>{history=e.target.checked;render();});
  if(!exercise)void(async()=>{try{const r=await fetch('./data/briefing-river-context.json?v=0.22.0',{credentials:'omit',signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`River association register HTTP ${r.status}`);associations=validateBriefingContext(await r.json());}catch(e){error=e.message;}render();})();
  setInterval(()=>{if(!document.hidden)render();},30000);render();
  return {setBriefings:v=>{briefing=v;render();},setPlanning:v=>{planning=v;render();},setRoads:v=>{roads=v;render();},setFacilities:v=>{facilities=v;render();},setMap:v=>{map=v;signature='';render();}};
}
