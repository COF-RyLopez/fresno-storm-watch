import {makeEvent,heads,digest,canonical,emptyRecords} from './eoc-model.js?v=0.45.0';
import {pumpBinding,bindingKey} from './pump-readiness-contract.js';
import {pumpReadiness} from './pump-readiness-model.js';
import {pumpTasks} from './pump-task-model.js';
import {PUMP_TASK_TYPES,PUMP_TASK_STATUSES} from './pump-task-contract.js';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const local=ms=>{const d=new Date(ms);return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export function renderPumpTasks(host,pump,stamp){
  const tasks=pump.tasks;host.append(el('h4','Assigned follow-ups'));
  if(!tasks?.current){host.append(el('p','Assignments unavailable / overdue. Recheck county AGOL; no task status is assumed.'));return;}
  if(!tasks.rows.length)host.append(el('p','No saved pump assignment returned. Confirm who will follow up.'));
  for(const t of tasks.rows){host.append(el('p',`${t.type} · ${t.status}${t.overdue?' · OVERDUE':''} · ${t.assigneeType}: ${t.owner} · due ${stamp(t.due)}`));if(t.changed)host.append(el('p','Readiness has a different version from this task’s basis. Review the task and explicitly reopen or update it; completion has not confirmed the new report.'));host.append(el('small',`Saved by ${t.event.author} at ${stamp(t.event.created)} · ${t.event.payload.nextReview}`));}
  const history=el('details');history.append(el('summary',`Assignment history · ${tasks.history.length} saved version(s)`));for(const e of [...tasks.history].sort((a,b)=>b.created-a.created))history.append(el('p',`${e.payload.pumpTask.type} · ${e.payload.status} · ${e.payload.owner} · due ${stamp(e.payload.due)} · ${e.author}, ${stamp(e.created)} · ${e.payload.evidence}`));host.append(history);
}
/** Uses the same private coordination views and append receipts as the EOC workspace. */
export async function openPumpTask({host,record,current,access,refresh,scope,exercise,onSaved}){
  host.replaceChildren(el('p','Checking private assignment access…'));await refresh();let a=access();const originalEpoch=a.epoch;
  const live=()=>host.isConnected&&access().epoch===originalEpoch&&current();
  if(!live())return;
  if(!a.state.connected||!a.store?.allowed.has('coordination')){host.replaceChildren(el('p','County AGOL coordination editing access is required to assign or update a pump follow-up. Viewers can read saved assignments.'));return;}
  const binding=pumpBinding(record),key=bindingKey(binding),form=el('form');form.className='pump-task-form';form.setAttribute('aria-label','Pump follow-up assignment');host.replaceChildren(form);
  form.append(el('h4',exercise?'EXERCISE · Assign pump follow-up':'Pump follow-up · private exercise'),el('p',record.name),el('p','One task per pump and work type. Reassign, reopen or complete that task here; every change preserves history. This records work for coordination and does not dispatch resources or notify the assignee.'));
  const fields={},field=(key,label,type,values=null)=>{const wrap=el('label',label),n=el(type==='select'?'select':type==='textarea'?'textarea':'input');if(n.tagName==='INPUT')n.type=type;n.setAttribute('aria-label',label);n.name=key;n.required=true;if(type==='text'||type==='textarea')n.maxLength=1500;if(values)for(const value of values){const o=el('option',value);o.value=value;n.append(o);}wrap.append(n);form.append(wrap);fields[key]=n;return n;};
  field('type','Work type','select',PUMP_TASK_TYPES);field('assigneeType','Assign to a','select',['Person','Team']);field('owner','Responsible person or team','text');field('due','Due by (your local time)','datetime-local');field('status','Assignment status','select',PUMP_TASK_STATUSES);field('nextReview','Requested work / next follow-up','textarea');field('evidence','Update notes / completion evidence','textarea');
  const identityLabel=el('label'),identity=el('input');identity.type='checkbox';identity.required=true;identityLabel.className='pump-readiness-identity';identityLabel.append(identity,document.createTextNode('I confirmed this pump location and identity and reviewed the saved assignment versions.'));form.append(identityLabel);
  const feedback=el('p');feedback.setAttribute('role','status');const save=el('calcite-button',exercise?'Save fictional assignment':'Save private assignment'),close=el('calcite-button','Close assignment');save.scale=close.scale='s';close.appearance='outline';close.onclick=()=>host.replaceChildren();const actions=el('div');actions.className='drainage-actions';actions.append(save,close);form.append(feedback,actions);
  let versions=[],originalHeads=[],pending=null,saving=false;
  function choose(){
    const s=access().state,tasks=pumpTasks(record,s,pumpReadiness(record,s).event),history=tasks.history.filter(e=>e.payload.pumpTask.type===fields.type.value);versions=heads(history);originalHeads=versions.flatMap(h=>h.heads.map(e=>e.id)).sort();
    const prior=versions.length===1?versions[0].record.payload:null;
    fields.assigneeType.value=prior?.pumpTask.assigneeType||'Team';fields.owner.value=prior?.owner||'';fields.due.value=local(prior?.due||Date.now()+3600000);fields.status.value=prior?.status||'Open';fields.nextReview.value=prior?.nextReview||`Confirm ${fields.type.value.toLowerCase()} needs, availability and lead time with the pump owner.`;fields.evidence.value='';identity.checked=false;
    feedback.textContent=versions.length>1?'Multiple task identities need GIS reconciliation; history is preserved.':versions.some(h=>h.conflict)?'Conflicting updates exist. Review all versions in the evidence pane before saving a resolution.':'Completion does not confirm pump readiness or clear a utility alert.';save.disabled=versions.length>1;
  }
  fields.type.onchange=choose;choose();
  save.onclick=async()=>{
    if(saving||!form.reportValidity()||!live())return;
    try{
      if(!pending){const readiness=pumpReadiness(record,access().state),payload={kind:'Follow-up',title:`${fields.type.value} · ${record.name}`,location:record.name,owner:fields.owner.value.trim(),due:Date.parse(fields.due.value),status:fields.status.value,nextReview:fields.nextReview.value.trim(),evidence:fields.evidence.value.trim(),sourceKey:'pump:'+record.key,pumpTask:{schema:1,binding,type:fields.type.value,assigneeType:fields.assigneeType.value,readinessEvent:readiness.event?.id||null,identityConfirmed:identity.checked}};pending=makeEvent('coordination',payload,{incident:scope,entity:versions[0]?.record.entity||'pump-task-'+await digest([binding,fields.type.value]),supersedes:originalHeads});}
      saving=true;save.loading=true;save.disabled=close.disabled=true;for(const n of [...Object.values(fields),identity])n.disabled=true;
      await access().session?.getToken();await refresh();a=access();if(!live()||!a.state.connected)throw Error('Sign-in, inventory or private records changed. Reopen the pump to review.');
      const records=emptyRecords();records.coordination=a.state.tasks;const already=a.state.tasks.find(e=>e.id===pending.id);if(already&&canonical(already.payload)!==canonical(pending.payload))throw Error('Conflicting write receipt. Contact GIS.');await (already||a.store.append(pending,records));if(!live())return;
      await refresh();if(!access().state.connected)throw Error('Save may have succeeded; retry to reconcile the same assignment version.');
      pending=null;feedback.textContent='Assignment saved. Area Watch and the banner use this version. Add updated evidence to your briefing; no message was sent to the assignee.';save.hidden=true;onSaved(record.key);
    }catch(e){feedback.textContent=e.privateDiagnostic?'Private assignment save failed. Reconnect county AGOL and retry the same update.':e.message;}
    finally{saving=false;if(live()){save.loading=false;save.disabled=false;close.disabled=false;}}
  };form.onsubmit=e=>{e.preventDefault();save.click();};fields.owner.focus();
}
