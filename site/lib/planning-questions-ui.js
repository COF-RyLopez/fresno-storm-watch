import {el,button,dataTable} from './dom.js';
import {QUESTION_KINDS,QUESTION_LAYERS,COUNTY,validateQuestions,gaugeQuestions,questionOwner,questionScenarios,questionsFor,questionEvidence,questionsCsv} from './planning-questions-model.js';

const $=id=>document.getElementById(id);
const PAGE=12;
/** Planning panel: open questions by place and topic, the place's exposure, and hand-off to follow-ups or the briefing draft.
 * Nothing here contacts an agency; assigning creates a private follow-up through the existing mission workflow. */
export function createPlanningQuestions({onAssign,onBriefing,followupSnapshot=()=>null}){
  let data=null,error=null,live=[],scenarios=[],place=COUNTY,kind='all',shown=PAGE,map=null,note='';
  const time=t=>new Date(t).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric',year:'numeric'});
  const all=()=>[...(data?.questions||[]),...live];
  function status(q){const s=followupSnapshot(questionEvidence(q));if(!s?.assessed)return '';const r=s.rows[0];return r?`${r.status}${r.overdue?' · overdue':''} · ${r.owner}`:'Not assigned in this incident';}
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
    const s=status(q);if(s){const p=el('p',`Follow-up: ${s}`);p.className='plan-question-status';c.append(p);}
    const actions=el('div'),form=el('div');actions.className='mission-actions';
    if(Number.isFinite(q.lon))actions.append(button('Map',()=>{for(const key of QUESTION_LAYERS[q.kind])map?.setLayerPreference(key,true);void map?.focusReferenceGeometry({x:q.lon,y:q.lat,spatialReference:{wkid:4326}},q.kind==='dams'?24000:12000);}));
    actions.append(button('Assign follow-up',()=>{form.replaceChildren();void onAssign(questionEvidence(q),form);}),
      button('Add to briefing',()=>{note=onBriefing(questionEvidence(q))?`Added to the briefing draft: ${q.title}`:'County sign-in is required to add private evidence to the briefing draft.';$('plan-status').textContent=note;}));
    for(const s of questionScenarios(q,scenarios)){const a=el('a',`Play ${s.variant.toLowerCase()} failure`);a.href=`#scenario=${encodeURIComponent(s.id)}`;actions.append(a);}
    c.append(actions,form);return c;
  }
  function render(){
    const list=$('plan-questions');if(!list)return;
    const places=data?.places||[COUNTY],placePick=$('plan-place');
    if(placePick.childElementCount!==places.length){placePick.replaceChildren(...places.map(p=>{const o=el('calcite-option',p);o.value=p;o.selected=p===place;return o;}));}
    exposure();
    const rows=questionsFor(all(),place,kind);
    $('plan-status').textContent=error?`Planning questions unavailable: ${error}`:!data?'Loading planning questions…':note||`${rows.length} open question${rows.length===1?'':'s'}${kind==='all'?'':` about ${QUESTION_KINDS[kind].toLowerCase()}`} for ${place}.`;
    list.replaceChildren(...rows.slice(0,shown).map(card));
    if(data&&!rows.length)list.append(el('p','No questions for this place and topic.'));
    $('plan-more').hidden=rows.length<=shown;$('plan-more').textContent=`Show ${Math.min(PAGE,rows.length-shown)} more`;
    $('plan-csv').disabled=!rows.length;
    $('plan-built').textContent=data?`Questions built ${time(data.generatedAt)} from public data (dams, levees, FEMA zones, parcels, County buildings and sandbag sites); river-gauge questions update live. Rules: no sandbag site within ${data.rules.sandbagReachMiles} mi of ${data.rules.minParcels}+ flood-zone parcels.`:'';
  }
  $('plan-place').addEventListener('calciteSelectChange',e=>{place=e.target.value;shown=PAGE;note='';render();});
  $('plan-kind').addEventListener('calciteSelectChange',e=>{kind=e.target.value;shown=PAGE;note='';render();});
  $('plan-more').onclick=()=>{shown+=PAGE;render();};
  $('plan-csv').onclick=()=>{const rows=questionsFor(all(),place,kind),url=URL.createObjectURL(new Blob([questionsCsv(rows,status)],{type:'text/csv'})),a=el('a');a.href=url;a.download=`planning-questions-${place.toLowerCase().replaceAll(' ','-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  window.addEventListener('storm-mission-followups',render);
  const get=path=>fetch(new URL(path,import.meta.url),{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();});
  void get('../data/planning/questions.json').then(d=>{data=validateQuestions(d);}).catch(e=>{error=e.message;}).finally(render);
  void get('../data/flood-scenarios/index.json').then(d=>{scenarios=d.scenarios||[];render();}).catch(()=>{/* Scenario links are optional. */});
  render();
  return {setMap(controller){map=controller;},setAreas(rows){live=gaugeQuestions(rows);render();}};
}
