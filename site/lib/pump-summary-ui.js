import {pumpReadinessSummary,filterPumpSummary} from './pump-summary-model.js?v=0.45.0';
const PAGE_SIZE=3;
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** No private records persist outside this tab. Counts always use the full loaded inventory. */
export function createPumpSummary({host,timeZone,onInspect=()=>{},exercise=false}){
  let groups=[],connected=false,busy=false,error=null,unmatched=0,readinessState=null,summary=pumpReadinessSummary(),page=0,signature='';
  const date=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone,timeZoneName:'short'});
  const stamp=t=>Number.isFinite(t)?date.format(t):'Unknown';
  host.classList.add('pump-summary');
  const heading=el('h4','Pump readiness summary'),status=el('p'),counts=el('p'),window=el('details'),windowLabel=el('summary'),windowDates=el('p'),qualification=el('small','Reported needs require a current owner confirmation and inventory match. Utility / rainfall overlap appears first, then reported resource needs and remaining reviews; within each group, earlier review deadlines appear first. This is a review order, not a resource assignment. Categories can overlap.');
  window.className='pump-summary-weather';window.append(windowLabel,windowDates);
  status.setAttribute('role','status');counts.setAttribute('role','status');
  const controls=el('details');controls.className='pump-summary-controls';controls.append(el('summary','Find or filter pumps'));
  const filterLabel=el('calcite-label','Show pumps'),filter=el('calcite-select');filter.label='Pump readiness summary filter';filter.scale='s';
  for(const [value,label]of [['attention','Needs attention'],['backup','Backup power needed'],['refuel','Refueling requested'],['followup','Follow-up / unknown'],['all','All existing pumps']]){const o=el('calcite-option',label);o.value=value;filter.append(o);}filter.value='attention';filterLabel.append(filter);
  const searchLabel=el('calcite-label','Find pump or responsible contact'),search=el('calcite-input');search.placeholder='Pump, drainage code or contact';search.clearable=true;search.autocomplete='off';searchLabel.append(search);controls.append(filterLabel,searchLabel);
  const list=el('div'),pages=el('div'),range=el('span'),before=el('calcite-button','Previous pumps'),after=el('calcite-button','Next pumps');pages.className='drainage-actions';
  for(const b of [before,after]){b.scale='s';b.appearance='outline';}pages.append(before,range,after);
  const note=el('details'),sourceTimes=el('p');note.append(el('summary','Source times and review order'),sourceTimes,qualification);
  host.append(heading,status,counts,window,controls,list,pages,note);
  function render(){
    controls.hidden=!connected||busy||!!error||!summary.rows.length;counts.hidden=!connected||busy||!!error;window.hidden=!connected||busy||!!error||!summary.rows.length;note.hidden=!connected;pages.hidden=true;
    const c=summary.counts;
    const reportsCurrent=readinessState?.connected&&!readinessState.error&&Number.isFinite(readinessState.checked)&&Date.now()-readinessState.checked<=120000&&readinessState.checked<=Date.now()+60000;
    if(!reportsCurrent)controls.hidden=true;
    status.textContent=!connected?'Sign in and load FMFCD to assess private pump readiness.':busy?'Checking pump readiness and rainfall context…':error||`${exercise?'EXERCISE · ':''}${c.attention} / ${c.total} pump records need review · ${c.unconfirmed} unconfirmed.${unmatched?` ${unmatched} saved association(s) need GIS / FMFCD rematching; not transferred to another pump.`:''}`;
    counts.textContent=`Needs backup · ${c.backup} / Refuel · ${c.refuel} / Follow-up · ${c.followup}`;
    if(connected&&!busy&&!error&&!reportsCurrent){status.textContent='Private readiness reports unavailable / overdue. Refresh county AGOL; reported needs and contacts are unassessed.';counts.textContent='Backup, refueling and follow-up totals unknown. Inventory and utility evidence remain separate.';}
    const first=summary.rows[0],cycle=first?.rain.cycle;
    const day=t=>Number.isFinite(t)?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone}).format(t):'Unknown';
    windowLabel.textContent=cycle?`Rainfall window: ${day(cycle.start)} → ${day(cycle.end)}${first.rain.current?'':' · overdue / unavailable'}`:'Rainfall timing unavailable';
    windowDates.textContent=cycle?`WPC 72-hour accumulation: ${stamp(cycle.start)} → ${stamp(cycle.end)}. This is not rain onset or peak timing; verify with NWS Hanford.`:'Verify rainfall timing with NWS Hanford.';
    sourceTimes.textContent=cycle?`Rainfall issued ${stamp(cycle.issue)} · checked ${stamp(first.rain.checked)}. Readiness records checked ${stamp(readinessState?.checked)}.`:'Rainfall source times unknown.';
    const rows=connected&&!busy&&!error&&reportsCurrent?filterPumpSummary(summary.rows,{filter:filter.value||'attention',search:search.value}):[];
    page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1)));
    pages.hidden=rows.length<=PAGE_SIZE;before.disabled=page===0;after.disabled=(page+1)*PAGE_SIZE>=rows.length;range.textContent=`${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,rows.length)} of ${rows.length}`;
    const key=JSON.stringify([connected,busy,error,reportsCurrent,page,filter.value,search.value,rows]);if(key===signature)return;signature=key;list.replaceChildren();
    if(!connected||busy||error||!reportsCurrent)return;
    if(!rows.length){list.append(el('p','No pump records returned in this filter. Missing confirmations or coverage do not establish readiness.'));return;}
    for(const r of rows.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE)){
      const row=el('article');row.className='pump-summary-row';
      const inspect=el('calcite-button',r.name);inspect.scale='s';inspect.appearance='outline';inspect.onclick=()=>onInspect(r.groupId,r.key);row.append(inspect,el('strong',r.labels.join(' · ')));
      if(r.name!==r.sourceName)row.append(el('small',r.sourceName));
      row.append(el('p',r.contact?`${r.contact.current?'Responsible':'Last reported contact · reconfirm'}: ${r.contact.owner} · ${r.contact.method}`:'Responsible contact unconfirmed · inspect and confirm with FMFCD.'));
      row.append(el('p',`Rainfall at pump: ${r.rain.value===null?'amount unknown':r.rain.value.toFixed(2)+' in liquid equivalent (polygon label)'}${r.rain.current?'':' · source overdue / unavailable'}.${r.powerRain?' Utility-area concern overlaps rainfall context; verify timing.':r.utilityConcern?' Utility-area concern needs verification.':''}`));
      row.append(el('p',`Runtime: ${r.runtimeHours===null?'unknown':r.runtimeHours+' h (owner estimate)'} · next readiness review: ${stamp(r.reviewDue)}.`));
      for(const t of r.tasks||[])row.append(el('p',`${t.type}: ${t.status}${t.overdue?' · OVERDUE':''} · ${t.assigneeType}: ${t.owner} · due ${stamp(t.due)}${t.changed?' · readiness changed; review assignment':''}`));
      if(r.reasons.length||r.contact){const details=el('details');details.append(el('summary','Confirmation and follow-up evidence'));if(r.contact)details.append(el('small',`Confirmed ${stamp(r.contact.observed)} · saved by ${r.contact.author} at ${stamp(r.contact.submitted)}${r.current?'':' · confirmation / inventory match needs rechecking'}.`));for(const reason of r.reasons)details.append(el('p',reason));row.append(details);}
      list.append(row);
    }
  }
  filter.addEventListener('calciteSelectChange',()=>{page=0;render();});search.addEventListener('calciteInputInput',()=>{page=0;render();});
  before.onclick=()=>{page--;render();};after.onclick=()=>{page++;render();};
  render();return {setData(value){({groups=[],connected=false,busy=false,error=null,unmatched=0,readinessState=null}=value);summary=pumpReadinessSummary(groups);render();}};
}
