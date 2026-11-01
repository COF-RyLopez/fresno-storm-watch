import {sourceHealthSummary} from './source-health-model.js';
import {disclosure} from './dom.js';
/** Source status events carry public diagnostics, never feature payloads or credentials. */
export function reportHealth(key,label,{checked=null,error=null,maxAgeMs=420000,detail='',state=null}={}){window.dispatchEvent(new CustomEvent('storm-source-health',{detail:{key,label,checked,error,maxAgeMs,detail,state}}));}
/** Countywide counts remain independent of workspace presentation. */
export function createCountyStrip({onOpen,exercise=false,timeZone}){
  const $=id=>document.getElementById(id),checks=new Map();let careCount=null,areaCount=null,drainageCount=null,pumpPowerCount=null,readinessCount=null,taskCounts=null,powerCount=null,alertCount=null,dialogSignature=null,briefingUpdated=false,incidentFollowups=null;
  const time=t=>Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone,dateStyle:'short',timeStyle:'long'}).format(t):'No successful check';
  function render(){const health=sourceHealthSummary(checks),issues=health.review;
    $('notify-areas').textContent=`Area reviews · ${areaCount??'checking'}${drainageCount===null?'':` river + ${drainageCount} drainage${pumpPowerCount?` · ${pumpPowerCount} pump power`:""}${readinessCount?` · ${readinessCount} pump readiness`:""}${taskCounts?` · ${taskCounts.active} assigned / ${taskCounts.overdue} overdue${taskCounts.unmatched?' · '+taskCounts.unmatched+' task rematches':''}${taskCounts.review>taskCounts.overdue?' · '+taskCounts.review+' task reviews':''}`:''}`}`;$('notify-alerts').textContent=`Weather alerts · ${alertCount??'checking'}${briefingUpdated?' · briefing updated':''}`;$('notify-power').textContent=`Power / PSPS · ${powerCount??'checking'}`;$('notify-health').textContent=exercise?'Source health · exercise':`Source health · ${checks.size?issues+' review':'checking'}`;
    $('notify-areas').textContent+=careCount===null?' · care checking':` · ${careCount} care`;
    $('notify-areas').setAttribute('aria-label',$('notify-areas').textContent+(incidentFollowups?.assessed?` · Selected incident follow-ups: ${incidentFollowups.active} active / ${incidentFollowups.overdue} overdue`:''));
    const areaDetail=$('notify-areas').getAttribute('aria-label');$('notify-areas').title=areaDetail;
    $('notify-areas').textContent=`Area reviews · ${areaCount===null||careCount===null?'checking':areaCount+careCount+(drainageCount??0)}${incidentFollowups?.overdue?' · '+incidentFollowups.overdue+' '+(incidentFollowups.overdue===1?'incident task overdue':'incident tasks overdue'):''}`;
    const pio=$('notify-pio');pio.hidden=!incidentFollowups?.assessed;pio.textContent=incidentFollowups?.pioBusy?'PIO · checking':`PIO · ${incidentFollowups?.pioReview??0} source ${incidentFollowups?.pioReview===1?'review':'reviews'}${incidentFollowups?.pioFailures?' · '+incidentFollowups.pioFailures+' unavailable':''}${incidentFollowups?.pioError?' · check interrupted':''}`;pio.setAttribute('aria-label',pio.textContent+' · private selected incident');
    $('notify-alerts').title=`Weather alerts · ${alertCount??'checking'} across five counties${briefingUpdated?' · Hanford briefing updated':''}`;$('notify-alerts').setAttribute('aria-label',$('notify-alerts').title);$('notify-alerts').textContent=`NWS · ${alertCount??'checking'}${briefingUpdated?' · new briefing':''}`;
    $('notify-health').setAttribute('icon-start',issues?'exclamation-mark-triangle':'information');
    $('notify-health').setAttribute('aria-label',exercise?'Source health · exercise':health.groups.filter(g=>g.rows.length).map(g=>`${g.label}: ${g.rows.length}`).join(' · ')||'Source checks starting');
    if(!$('source-health-dialog').hasAttribute('open'))return;const signature=JSON.stringify([exercise,health]);if(signature===dialogSignature)return;dialogSignature=signature;
    const host=$('source-health-list'),opened=new Map([...host.querySelectorAll('[data-health]')].map(n=>[n.dataset.health,n.hasAttribute('expanded')])),focused=document.activeElement?.closest?.('[data-health]')?.dataset.health;host.replaceChildren();
    if(exercise){const p=document.createElement('p');p.textContent='Live source checks are disabled in the fictional exercise.';host.append(p);return;}
    const summary=document.createElement('p');summary.textContent=`${issues} source checks need review. `+health.groups.filter(g=>g.rows.length).map(g=>`${g.label}: ${g.rows.length}`).join(' · ')+'. Not assessed and awaiting-first-check sources are listed separately; they are not confirmed available.';host.append(summary);
    for(const g of health.groups.filter(g=>g.rows.length)){const group=disclosure(`${g.label} · ${g.rows.length}`,opened.get(g.id)??g.id==='failed');group.className='source-health-group';group.dataset.health=g.id;for(const s of g.rows){const row=document.createElement('article'),name=document.createElement('h3'),p=document.createElement('p');name.textContent=s.label;p.textContent=`Last successful check: ${time(s.checked)}. ${[s.error,s.detail].filter(Boolean).join(' ')}`;row.append(name,p);group.append(row);}host.append(group);if(focused===g.id)void customElements.whenDefined('calcite-block').then(()=>group.setFocus());}
  }
  window.addEventListener('storm-mission-followups',e=>{incidentFollowups=e.detail;render();});
  window.addEventListener('storm-source-health',e=>{checks.set(e.detail.key,e.detail);render();});
  for(const [id,topic]of [['notify-areas','watch'],['notify-alerts','alerts'],['notify-power','power']])$(id).onclick=()=>{onOpen(topic);if(id==='notify-areas'&&incidentFollowups?.overdue){document.getElementById('mission-followups').setAttribute('expanded','');}};
  $('notify-health').onclick=()=>{$('source-health-dialog').setAttribute('open','');render();};
  $('notify-pio').onclick=()=>{onOpen('watch');const section=$('mission-followups');section.setAttribute('expanded','');$('mission-pio-reviews').scrollIntoView({block:'nearest'});};
  setInterval(()=>{if(!document.hidden)render();},30000);render();
  return {care:n=>{careCount=n;render();},drainage:(n,pumps=null,readiness=null,tasks=null)=>{drainageCount=n;pumpPowerCount=n===null?null:pumps;readinessCount=n===null?null:readiness;taskCounts=n===null?null:tasks;render();},briefing:n=>{briefingUpdated=!!n;render();},areas:n=>{areaCount=n;render();},alerts:n=>{alertCount=n;render();},power:n=>{powerCount=n;render();}};
}
