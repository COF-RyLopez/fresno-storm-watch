import {unhealthyChecks} from './workspace-model.js';
/** Source status events carry public diagnostics, never feature payloads or credentials. */
export function reportHealth(key,label,{checked=null,error=null,maxAgeMs=420000,detail=''}={}){window.dispatchEvent(new CustomEvent('storm-source-health',{detail:{key,label,checked,error,maxAgeMs,detail}}));}
/** Countywide counts remain independent of workspace presentation. */
export function createCountyStrip({onOpen,exercise=false,timeZone}){
  const $=id=>document.getElementById(id),checks=new Map();let areaCount=null,powerCount=null,alertCount=null,dialogSignature=null,briefingUpdated=false;
  const time=t=>Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{timeZone,dateStyle:'short',timeStyle:'long'}).format(t):'No successful check';
  function render(){const now=Date.now(),list=new Map([...checks].map(([k,s])=>[k,{...s,status:s.error?'failed':!Number.isFinite(s.checked)?'unknown':s.checked>now+120000?'unknown':now-s.checked>s.maxAgeMs?'stale':'current'}]));const issues=unhealthyChecks(list);
    $('notify-areas').textContent=`Area reviews · ${areaCount??'checking'}`;$('notify-alerts').textContent=`Weather alerts · ${alertCount??'checking'}${briefingUpdated?' · briefing updated':''}`;$('notify-power').textContent=`Power / PSPS · ${powerCount??'checking'}`;$('notify-health').textContent=exercise?'Source issues · exercise':`Source issues · ${checks.size?issues.length:'checking'}`;
    $('notify-health').setAttribute('icon-start',issues.length?'exclamation-mark-triangle':'information');
    if(!$('source-health-dialog').hasAttribute('open'))return;const signature=JSON.stringify([exercise,[...list]]);if(signature===dialogSignature)return;dialogSignature=signature;
    const host=$('source-health-list');host.replaceChildren();
    if(exercise){const p=document.createElement('p');p.textContent='Live source checks are disabled in the fictional exercise.';host.append(p);return;}
    for(const s of [...list.values()].sort((a,b)=>Number(a.status==='current')-Number(b.status==='current')||a.label.localeCompare(b.label))){const block=document.createElement('calcite-block');block.heading=s.label;block.description=s.status==='current'?'Current check':s.status==='failed'?'Failed / needs verification':s.status==='stale'?'Overdue / needs verification':'Unknown / awaiting source';block.expanded=true;const p=document.createElement('p');p.textContent=`Last successful check: ${time(s.checked)}. ${s.error||s.detail||''}`;block.append(p);host.append(block);}
  }
  window.addEventListener('storm-source-health',e=>{checks.set(e.detail.key,e.detail);render();});
  for(const [id,topic]of [['notify-areas','watch'],['notify-alerts','alerts'],['notify-power','power']])$(id).onclick=()=>onOpen(topic);
  $('notify-health').onclick=()=>{$('source-health-dialog').setAttribute('open','');render();};
  setInterval(()=>{if(!document.hidden)render();},30000);render();
  return {briefing:n=>{briefingUpdated=!!n;render();},areas:n=>{areaCount=n;render();},alerts:n=>{alertCount=n;render();},power:n=>{powerCount=n;render();}};
}
