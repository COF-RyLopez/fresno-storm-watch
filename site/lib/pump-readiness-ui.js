import {EOC_CONFIG} from '../eoc-config.js';
import {createPrivateStore,createExerciseStore} from './eoc-store.js?v=0.74.0-helpers';
import {emptyRecords,makeEvent,heads,digest,canonical} from './eoc-model.js?v=0.74.0-helpers';
import {PUMP_READINESS_SCOPE,PUMP_READINESS_TEST_SCOPE,BACKUP_OPTIONS,CONNECTION_OPTIONS,FUEL_OPTIONS,pumpBinding,bindingKey,validatePumpReadiness} from './pump-readiness-contract.js';
import {pumpReadiness} from './pump-readiness-model.js';
import {openPumpTask,renderPumpTasks} from './pump-task-ui.js?v=0.74.0-helpers';
import {reportHealth} from './source-health.js?v=0.73.1';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const local=ms=>{const d=new Date(ms);return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};

/** Private append-only confirmations in the existing restricted checklist views. No browser persistence. */
export function createPumpReadiness({exercise=false,exerciseData=null,timeZone,scope=PUMP_READINESS_SCOPE,onData=()=>{},onSaved=()=>{},onClosed=()=>{}}){
  if(![PUMP_READINESS_SCOPE,PUMP_READINESS_TEST_SCOPE].includes(scope))throw Error('Unknown readiness workspace.');
  let session=null,store=exercise?createExerciseStore(exerciseData?.readinessRecords):null,state={connected:exercise,records:[],tasks:[],checked:exercise?Date.now():null,error:null},epoch=0,loading=null,activeForm=null;
  const stamp=v=>new Date(v).toLocaleString('en-US',{timeZone,timeZoneName:'short'});
  const publish=()=>{const status=document.getElementById('pump-readiness-status');if(status)status.textContent=exercise?'Pump readiness · fictional rehearsal in this tab only':!session?'Pump readiness · county AGOL sign-in required':state.error||!state.connected?'Pump readiness · '+(state.error||'checking private exercise storage…'):`Private exercise pump readiness connected · ${store?.allowed.has('checklists')?'submission access':'read-only access'} · checked ${stamp(state.checked)}. Open a pump to confirm readiness or assign follow-up.`;onData({...state});if(!exercise)reportHealth('pump-readiness','Private pump readiness / assignments',{checked:session?state.checked:null,error:session?state.error:null,state:session?null:'unassessed',detail:session?'Private exercise records; query access does not confirm pump operation.':'County AGOL sign-in required; readiness not assessed.',maxAgeMs:120000});};
  const clearForm=()=>{activeForm?.replaceChildren();activeForm=null;};
  async function refresh(){
    if(loading)return loading;if(!exercise&&!session)return;
    const version=epoch;
    loading=(async()=>{try{
      if(!store){const opened=await createPrivateStore(EOC_CONFIG,session);if(version!==epoch){opened.close();return;}store=opened;}
      const [records,tasks]=await Promise.all([store.loadCollection('checklists',scope),store.loadCollection('coordination',scope)]);if(version!==epoch)return;
      if(records.some(r=>r.payload.kind!=='pump-readiness'))throw Error('Unexpected record in the pump-readiness scope.');
      if(tasks.some(r=>!r.payload.pumpTask))throw Error('Unexpected pump assignment record.');
      state={connected:true,records,tasks,checked:Date.now(),error:null};publish();
    }catch{if(version===epoch){state={connected:false,records:[],tasks:[],checked:null,error:'Private readiness / assignment query failed. Reconnect county AGOL and refresh; previous details are not current.'};publish();}}
    finally{if(version===epoch)loading=null;}})();return loading;
  }
  function renderSummary(host,pump,{includeTasks=true}={}){
    const r=pump.readiness;host.append(el('p',r.label));
    if(r.event){const e=r.event,p=e.payload;host.append(el('p',`${p.pumpLabel} · backup ${p.backup.toLowerCase()} · connection ${p.connection.toLowerCase()} · fuel ${p.fuel.toLowerCase()} · runtime ${p.runtimeHours===null?'unknown':p.runtimeHours+' hours (estimate)'}`),el('p',`Responsible: ${p.owner} · ${p.contact}`),el('p',`Confirmed ${stamp(p.observed)} · next review ${stamp(p.validUntil)}. Recorded by ${e.author} at ${stamp(e.created)}.`));if(p.runtimeHours!==null)host.append(el('p','Runtime basis: '+p.runtimeBasis));}
    for(const reason of r.reasons)host.append(el('p',reason));
    const details=el('details');details.append(el('summary',`Readiness history · ${r.history.length} saved update(s)`));
    for(const e of [...r.history].sort((a,b)=>b.created-a.created))details.append(el('p',`${stamp(e.created)} · ${e.author} · ${e.payload.backup} backup · fuel ${e.payload.fuel} · runtime ${e.payload.runtimeHours??'unknown'}${e.payload.runtimeHours===null?'':' hours'} · review ${stamp(e.payload.validUntil)} · ${e.payload.evidence}`));
    host.append(details);if(includeTasks)renderPumpTasks(host,pump,stamp);
  }
  async function open(host,record,current=()=>true){
    clearForm();activeForm=host;const version=epoch;host.replaceChildren(el('p','Checking private readiness access…'));await refresh();
    if(version!==epoch||activeForm!==host||!host.isConnected)return;
    if(!current()){host.replaceChildren(el('p','Pump inventory changed or is overdue. Refresh FMFCD and reopen this pump before confirming readiness.'));return;}
    host.replaceChildren();
    if(!store||!state.connected){host.append(el('p',state.error||'County AGOL sign-in is required for the private readiness form.'));return;}
    if(!store.allowed.has('checklists')){host.append(el('p','Read-only access. A county GIS administrator must assign an eligible named FMFCD account to the existing EOC viewers and coordinators groups before it can submit readiness updates.'));return;}
    const binding=pumpBinding(record),key=bindingKey(binding),existing=state.records.filter(e=>bindingKey(e.payload.binding)===key),versions=heads(existing),r=pumpReadiness(record,state),prior=r.event?.payload;
    if(versions.length>1){host.append(el('p','Multiple saved identities reference this pump. GIS / FMFCD must reconcile those associations before another confirmation; existing history is preserved.'));return;}
    const originalHeads=versions.flatMap(h=>h.heads.map(e=>e.id)).sort();
    const form=el('form');form.className='pump-readiness-form';form.autocomplete='off';form.setAttribute('aria-label','Pump readiness confirmation');
    form.append(el('h4',exercise?'EXERCISE · Confirm pump readiness':'Confirm pump readiness · private exercise'),el('p',`Selected: ${record.name}. Verify its map location and actual pump identity. Source ObjectIDs can change; an inventory change will require a new confirmation. This does not change FMFCD’s source layer.`));
    const fields={},field=(name,label,type='text',options=null,value='')=>{const l=el('label',label),n=el(type==='select'?'select':type==='textarea'?'textarea':'input');n.name=name;n.autocomplete='off';n.setAttribute('aria-label',label);if(n.tagName==='INPUT')n.type=type;if(options)for(const value of options){const o=el('option',value);o.value=value;n.append(o);}n.value=value??'';n.required=!['runtimeHours','runtimeBasis'].includes(name);if(type==='text'||type==='textarea')n.maxLength=1500;l.append(n);form.append(l);fields[name]=n;return n;};
    field('pumpLabel','Pump / station identification','text',null,prior?.pumpLabel||record.name);
    field('backup','Backup power availability','select',BACKUP_OPTIONS,prior?.backup||'Unknown');
    field('connection','Backup connection / compatibility','select',CONNECTION_OPTIONS,prior?.connection||'Unknown');
    field('fuel','Fuel availability','select',FUEL_OPTIONS,prior?.fuel||'Unknown');
    const runtime=field('runtimeHours','Estimated remaining runtime (hours; blank = unknown)','number',null,prior?.runtimeHours??'');runtime.min='0';runtime.max='100000';runtime.step='any';
    field('runtimeBasis','Runtime basis / fuel amount and load assumptions (required when runtime is entered)','textarea',null,prior?.runtimeBasis||'');
    field('owner','Responsible contact / team','text',null,prior?.owner||'');
    field('contact','Work phone, radio call sign or work email (private)','text',null,prior?.contact||'');
    field('observed','Confirmed / checked at (your local time)','datetime-local',null,local(Date.now()));
    field('validUntil','Review readiness again by (your local time)','datetime-local');
    field('evidence','Confirmation source / outstanding work','textarea');
    const identityLabel=el('label'),identity=el('input');identity.type='checkbox';identity.required=true;identityLabel.className='pump-readiness-identity';identityLabel.append(identity,document.createTextNode('I checked the selected map location and pump identity, and reviewed all prior versions shown above.'));form.append(identityLabel);
    const feedback=el('p');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
    const save=el('calcite-button',exercise?'Save fictional readiness':'Save private exercise readiness');save.scale='s';save.type='button';
    const cancel=el('calcite-button','Close form');cancel.scale='s';cancel.appearance='outline';cancel.onclick=()=>{if(activeForm===host){clearForm();onClosed();}};
    const actions=el('div');actions.className='drainage-actions';actions.append(save,cancel);form.append(feedback,actions,el('small',exercise?'Fictional rehearsal only. Saved in this tab; no AGOL write.':'EXERCISE dataset. Updates are visible to authorized EOC viewers. AGOL records the signed-in author and server submission time. Each correction keeps the earlier record.'));
    fields.backup.onchange=()=>{if(fields.backup.value!=='Available')fields.connection.value='Unknown';};
    let pending=null,saving=false;
    save.onclick=async()=>{
      if(saving||!form.reportValidity())return;
      if(version!==epoch||!current()){feedback.textContent='Sources or sign-in changed. Reopen this pump before saving.';return;}
      try{
        if(!pending){
          const payload={kind:'pump-readiness',schema:1,binding,identityConfirmed:identity.checked,pumpLabel:fields.pumpLabel.value.trim(),backup:fields.backup.value,connection:fields.connection.value,fuel:fields.fuel.value,runtimeHours:fields.runtimeHours.value===''?null:Number(fields.runtimeHours.value),runtimeBasis:fields.runtimeBasis.value.trim(),owner:fields.owner.value.trim(),contact:fields.contact.value.trim(),observed:Date.parse(fields.observed.value),validUntil:Date.parse(fields.validUntil.value),evidence:fields.evidence.value.trim()};
          validatePumpReadiness(payload);if(payload.validUntil<=Date.now())throw Error('Choose a future next-review time.');
          // Deterministic association ID prevents two first submissions silently creating separate records.
          const entity=versions[0]?.record.entity||'pump-'+await digest(binding);if(version!==epoch||!current())throw Error('Sources changed. Reopen this pump.');
          pending=makeEvent('checklists',payload,{incident:scope,entity,supersedes:originalHeads});
        }
        saving=true;save.loading=true;save.disabled=true;cancel.disabled=true;for(const input of [...Object.values(fields),identity])input.disabled=true;
        await session?.getToken();await refresh();if(version!==epoch||!current()||!state.connected)throw Error('Private readiness connection or source changed. Reopen the pump.');
        const data=emptyRecords();data.checklists=state.records;
        const already=state.records.find(e=>e.id===pending.id);
        if(already&&canonical(already.payload)!==canonical(pending.payload))throw Error('The write receipt has conflicting content. Contact GIS.');
        await (already||store.append(pending,data));if(version!==epoch)return;
        await refresh();if(!state.connected)throw Error('Write may have succeeded but verification failed. Retry to reconcile the same saved update.');
        feedback.textContent='Readiness saved. Area Watch and the banner now use this version; utility alerts remain visible.';pending=null;save.hidden=true;cancel.disabled=false;onSaved(record.key);
      }catch(e){feedback.textContent=(e.privateDiagnostic?'Private readiness save failed. Verify county sign-in and editing access, then retry the same update.':e.message);}
      finally{saving=false;if(version===epoch){save.loading=false;save.disabled=false;cancel.disabled=false;}}
    };
    form.onsubmit=e=>{e.preventDefault();save.click();};host.append(form);fields.pumpLabel.focus();
  }
  const controller={clearForm,openTask(host,record,current=()=>true){clearForm();activeForm=host;return openPumpTask({host,record,current:()=>activeForm===host&&current(),access:()=>({store,state,epoch,session}),refresh,scope,exercise,onSaved});},open,renderSummary,refresh,setSession(value){if(exercise)return;epoch++;session=value;clearForm();store?.close();store=null;loading=null;state={connected:false,records:[],tasks:[],checked:null,error:null};publish();if(value)void refresh();}};
  setInterval(()=>{if(!document.hidden&&(session||exercise))void refresh();},60000);
  window.addEventListener('pagehide',()=>{epoch++;session=null;clearForm();store?.close();store=null;state={connected:false,records:[],tasks:[],checked:null,error:null};publish();});publish();if(exercise)void refresh();return controller;
}
