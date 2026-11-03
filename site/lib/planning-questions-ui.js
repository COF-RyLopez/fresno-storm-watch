import {el,button,dataTable} from './dom.js';
import {loadSdk} from './map.js';
import {createLabelLayer} from './map-labels.js';
import {badgeSymbol} from './badge-symbols.js';
import {QUESTION_KINDS,QUESTION_LAYERS,COUNTY,PARCELS_URL,nearbyBadge,validateQuestions,gaugeQuestions,fleetQuestions,questionOwner,questionScenarios,questionsFor,questionsByState,questionAnswer,questionEvidence,questionsCsv} from './planning-questions-model.js';

const $=id=>document.getElementById(id);
const PAGE=12;
/** Planning panel: open questions by place and topic, the place's exposure, and hand-off to follow-ups or the briefing draft.
 * Nothing here contacts an agency; assigning creates a private follow-up through the existing mission workflow. */
export function createPlanningQuestions({onAssign,onBriefing,followupSnapshot=()=>null}){
  let data=null,error=null,live=[],fleetLive=[],scenarios=[],place=COUNTY,kind='all',state='open',shown=PAGE,map=null,note='',focus=null,focusedId=null,focusEpoch=0;
  const time=t=>new Date(t).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric'});
  const all=()=>[...(data?.questions||[]),...fleetLive,...live];
  /** Follow-ups for this question in the selected EOC incident; null when not signed in or not checked recently. */
  const followups=q=>{const s=followupSnapshot(questionEvidence(q));return s?.assessed?s:null;};
  const answerOf=q=>questionAnswer(q,followups(q)?.rows);
  function status(q){const s=followups(q);if(!s)return '';const r=s.rows[0];return r?`${r.status}${r.overdue?' · overdue':''} · ${r.owner}`:'Not assigned in this incident';}
  function exposure(){
    const host=$('plan-exposure');host.replaceChildren();const e=data?.exposure?.[place];if(!e)return;
    const rows=[['Area',`${e.sqMi.toLocaleString()} sq mi`],['FEMA 1% flood zone',`${e.sfhaSqMi} sq mi`],['FEMA 0.2% zone',`${e.moderateSqMi} sq mi`],
      ['Parcels touching the 1% zone',e.sfhaParcels.toLocaleString()],['Active County sandbag sites',e.sandbagSites],['Fire stations',e.fireStations],['County buildings in the 1% zone',e.countyBuildingsInSfha]];
    if(Number.isFinite(e.highHazardDams))rows.push(['High-hazard dams',e.highHazardDams],['Levee systems FEMA does not accredit',e.leveeSystems]);
    host.append(dataTable(`${place} at a glance`,['Measure','Value'],rows,{rowHeader:true,end:[1]}));
    if(e.note)host.append(el('small',e.note));
  }
  function card(q){
    const c=el('article');c.className='mission-card plan-question';
    const meta=el('p',`${QUESTION_KINDS[q.kind]} · ${q.place} · answer from ${questionOwner(q)}`);meta.className='plan-question-meta';
    c.append(el('h4',q.title),el('p',q.detail),meta);
    if(q.nearby?.length){const list=el('ul');list.className='plan-nearby';list.setAttribute('aria-label','Nearby options, straight-line distance');
      for(const n of q.nearby)list.append(el('li',`${n.miles.toFixed(1)} mi · ${n.name} (${n.kind})`));c.append(el('p','Nearby options (straight-line, confirm with the owner):'),list);}
    const s=status(q);if(s){const p=el('p',`Follow-up: ${s}`);p.className='plan-question-status';c.append(p);}
    const {state:answered,row}=answerOf(q);
    if(row&&answered!=='open'){const p=el('p',`${row.status==='Canceled'?'Closed without an answer':'Answer'}: ${row.answer||'(no evidence text)'}\n— ${row.author||row.owner} · ${time(row.recorded)}`);p.className='plan-answer';
      if(answered==='changed'){p.dataset.changed='';p.textContent+='\nData changed since this was answered; recheck it.';}c.append(p);}
    const actions=el('div'),form=el('div');actions.className='mission-actions';
    if(q.geometry){const b=button(focusedId===q.id?'Showing parcels':'Show parcels',()=>void showPocket(q));b.appearance='solid';b.iconStart='layer-polygon';actions.append(b);}
    else if(Number.isFinite(q.lon))actions.append(button('Map',()=>{for(const key of QUESTION_LAYERS[q.kind])map?.setLayerPreference(key,true);void map?.focusReferenceGeometry({x:q.lon,y:q.lat,spatialReference:{wkid:4326}},q.kind==='dams'?24000:12000);}));
    actions.append(button('Assign follow-up',()=>{form.replaceChildren();void onAssign(questionEvidence(q),form);}),
      button('Add to briefing',()=>{note=onBriefing(questionEvidence(q))?`Added to the briefing draft: ${q.title}`:'County sign-in is required to add private evidence to the briefing draft.';$('plan-status').textContent=note;}));
    for(const s of questionScenarios(q,scenarios)){const a=el('a',`Play ${s.variant.toLowerCase()} failure`);a.href=`#scenario=${encodeURIComponent(s.id)}`;actions.append(a);}
    c.append(actions,form);return c;
  }
  /** Flood-pocket question: outline the pocket (red dash), fill the parcels it counts in white (distinct from both FEMA zone colours), and badge the nearby options, then zoom there. */
  async function showPocket(q){
    if(!map)return;const epoch=++focusEpoch;focusedId=q.id;note=`Loading parcels for: ${q.title}`;render();
    try{
      if(!focus){const [GraphicsLayer,Graphic,FeatureLayer]=await (await loadSdk()).import(['@arcgis/core/layers/GraphicsLayer.js','@arcgis/core/Graphic.js','@arcgis/core/layers/FeatureLayer.js']);
        focus={Graphic,layer:new GraphicsLayer({title:'Planning question focus · flood pocket, parcels and nearby options',elevationInfo:{mode:'on-the-ground'}}),labels:createLabelLayer({FeatureLayer,Graphic},{title:'Nearby option names',minScale:120_000})};
        map.registerLayer('planningFocus',focus.layer);map.registerLayer('planningFocus',focus.labels.layer);}
      const {Graphic,layer,labels}=focus,ring={rings:q.geometry.rings,spatialReference:{wkid:4326}};
      const body=new URLSearchParams({where:'1=1',geometry:JSON.stringify(ring),geometryType:'esriGeometryPolygon',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'apn',returnGeometry:'true',outSR:'4326',resultRecordCount:'2000',f:'json'});
      let parcels=[],parcelError=null;
      try{const r=await fetch(`${PARCELS_URL}/query`,{method:'POST',body,signal:AbortSignal.timeout(25000)});const j=await r.json();if(!r.ok||j.error)throw Error(j.error?.message||`HTTP ${r.status}`);parcels=j.features||[];}
      catch(e){parcelError=e.message;}
      if(epoch!==focusEpoch)return;
      layer.removeAll();
      for(const f of parcels)if(f.geometry?.rings)layer.add(new Graphic({geometry:{type:'polygon',rings:f.geometry.rings,spatialReference:{wkid:4326}},attributes:{apn:f.attributes?.apn},
        symbol:{type:'simple-fill',color:[255,255,255,.34],outline:{color:'#ffffff',width:1.4}},popupTemplate:{title:'Parcel in the flood pocket',content:`APN ${f.attributes?.apn??'not listed'}. Touches the FEMA 1% annual-chance zone counted by this planning question; not a forecast that it floods.`}}));
      layer.add(new Graphic({geometry:{type:'polygon',...ring},symbol:{type:'simple-fill',color:[0,0,0,0],outline:{color:'#e4572e',width:2.6,style:'dash'}},popupTemplate:{title:q.title,content:q.detail}}));
      for(const n of q.nearby||[])layer.add(new Graphic({geometry:{type:'point',longitude:n.lon,latitude:n.lat,spatialReference:{wkid:4326}},symbol:badgeSymbol(nearbyBadge(n.kind),24),
        popupTemplate:{title:n.name,content:`${n.kind}${n.address?` · ${n.address}`:''} · ${n.miles.toFixed(1)} mi straight-line from the flood pocket. A possible sandbag site only if the owner agrees; check access, parking and staffing.`}}));
      void labels.set((q.nearby||[]).map(n=>({longitude:n.lon,latitude:n.lat,label:n.name})));
      map.setLayerPreference('planningFocus',true);map.setLayerPreference('fema',true);
      void map.focusReferenceGeometry(ring);
      note=parcelError?`Flood pocket shown; parcels unavailable (${parcelError}).`:`Showing ${parcels.length} parcels in the flood pocket and ${(q.nearby||[]).length} nearby options: ${q.title}`;
      $('plan-clear').hidden=false;render();
    }catch(e){if(epoch===focusEpoch){note=`Could not show the flood pocket: ${e.message}`;render();}}
  }
  function clearPocket(){focusEpoch++;focusedId=null;focus?.layer.removeAll();void focus?.labels.set([]);map?.setLayerPreference('planningFocus',false);$('plan-clear').hidden=true;note='';render();}
  function render(){
    const list=$('plan-questions');if(!list)return;
    const places=data?.places||[COUNTY],placePick=$('plan-place');
    if(placePick.childElementCount!==places.length){placePick.replaceChildren(...places.map(p=>{const o=el('calcite-option',p);o.value=p;o.selected=p===place;return o;}));}
    exposure();
    const rows=questionsByState(questionsFor(all(),place,kind),q=>answerOf(q).state,state);
    $('plan-status').textContent=error?`Planning questions unavailable: ${error}`:!data?'Loading planning questions…':note||`${rows.length} ${state==='all'?'':`${state} `}question${rows.length===1?'':'s'}${kind==='all'?'':` about ${QUESTION_KINDS[kind].toLowerCase()}`} for ${place}.`;
    list.replaceChildren(...rows.slice(0,shown).map(card));
    if(data&&!rows.length)list.append(el('p',state==='answered'&&!followupSnapshot({})?.assessed?'Sign in to the EOC workspace to see answers recorded in the selected incident.':'No questions for this place, topic and status.'));
    $('plan-more').hidden=rows.length<=shown;$('plan-more').textContent=`Show ${Math.min(PAGE,rows.length-shown)} more`;
    $('plan-csv').disabled=!rows.length;
    $('plan-built').textContent=data?`Questions built ${time(data.generatedAt)} from public data (dams, levees, FEMA zones, parcels, County buildings and sandbag sites); river-gauge questions update live. Rules: no sandbag site within ${data.rules.sandbagReachMiles} mi of ${data.rules.minParcels}+ flood-zone parcels. Answers are the completion evidence on each question's follow-up in the selected EOC incident; keep them together in one standing planning incident (for example "2026–27 Winter Readiness").`:'';
  }
  $('plan-place').addEventListener('calciteSelectChange',e=>{place=e.target.value;shown=PAGE;note='';render();});
  $('plan-kind').addEventListener('calciteSelectChange',e=>{kind=e.target.value;shown=PAGE;note='';render();});
  $('plan-state').addEventListener('calciteSelectChange',e=>{state=e.target.value;shown=PAGE;note='';render();});
  $('plan-more').onclick=()=>{shown+=PAGE;render();};
  $('plan-clear').onclick=clearPocket;
  $('plan-csv').onclick=()=>{const rows=questionsByState(questionsFor(all(),place,kind),q=>answerOf(q).state,state),url=URL.createObjectURL(new Blob([questionsCsv(rows,q=>{const a=answerOf(q);return [status(q),a.row&&a.state!=='open'?`Answer: ${a.row.answer}${a.state==='changed'?' (data changed since)':''}`:''].filter(Boolean).join(' · ');})],{type:'text/csv'})),a=el('a');a.href=url;a.download=`planning-questions-${place.toLowerCase().replaceAll(' ','-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  window.addEventListener('storm-mission-followups',render);
  window.addEventListener('storm-snow-fleet',e=>{fleetLive=fleetQuestions(e.detail.fleet);render();});
  const get=path=>fetch(new URL(path,import.meta.url),{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();});
  void get('../data/planning/questions.json').then(d=>{data=validateQuestions(d);}).catch(e=>{error=e.message;}).finally(render);
  void get('../data/flood-scenarios/index.json').then(d=>{scenarios=d.scenarios||[];render();}).catch(()=>{/* Scenario links are optional. */});
  render();
  return {setMap(controller){map=controller;},setAreas(rows){live=gaugeQuestions(rows);render();}};
}
