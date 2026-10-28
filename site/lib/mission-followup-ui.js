import {EOC_CONFIG} from '../eoc-config.js';
import {createPrivateStore} from './eoc-store.js';
import {missionFollowups,followupsForEvidence} from './mission-followup-model.js?v=0.59.0';
import {reportHealth} from './source-health.js?v=0.59.0';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** Named-account, read-only incident follow-ups. No persistence and no automatic dispatch. */
export function createMissionFollowups({openStore=createPrivateStore}={}){
  let session=null,store=null,epoch=0,incident='',choices=new Map(),records=[],checked=null,error=null,busy=false,requested=false;
  const time=t=>Number.isFinite(t)?new Date(t).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'}):'Unknown';
  function render(){
    const rows=missionFollowups(records),active=rows.filter(r=>r.active),overdue=rows.filter(r=>r.overdue);
    $('mission-followups-load').disabled=!session||busy;$('mission-followups-load').textContent=busy?'Checking follow-ups…':requested?'Refresh follow-ups':'Choose private incident';
    $('mission-followups-status').textContent=!session?'County sign-in required · incident follow-ups unassessed.':error?'Private follow-up check failed; retained details cleared. Reconnect and retry.':!requested?'Choose a private exercise incident to review its saved follow-ups.':busy?'Checking private exercise follow-ups…':!choices.size?'No exercise incidents returned. Record an incident in the EOC workspace first.':`${choices.get(incident)||incident} · ${active.length} active / ${overdue.length} overdue · checked ${time(checked)}. Updates are checked each minute while this tab is visible.`;
    const picker=$('mission-followups-incident');$('mission-followups-incident-label').hidden=!choices.size;picker.hidden=!choices.size;picker.disabled=busy;const selected=picker.value;picker.replaceChildren(...[...choices].map(([id,name])=>{const o=el('option',name);o.value=id;return o;}));picker.value=incident||selected;
    const host=$('mission-followups-list');host.replaceChildren();
    const shown=$('mission-followups-history').checked?rows:active;$('mission-followups-history-label').hidden=!checked||!rows.length;
    if(checked&&!shown.length)host.append(el('p',rows.length?'No active follow-ups. Include completed / canceled records to review history.':'No general follow-ups returned for this incident. Pump assignments use the separate pump-readiness workflow.'));
    for(const r of shown){const card=el('article');card.className='mission-card';card.append(el('h3',r.title),el('p',`${r.status}${r.overdue?' · OVERDUE':''} · ${r.location}`),el('p',`Owner: ${r.owner} · due ${time(r.due)}`),el('p',r.nextReview));const details=el('details');details.append(el('summary','Record & evidence link'),el('p',`${r.key?'Stored evidence identity; location impacts still require verification.':'No stored evidence link; not automatically attached to a map concern.'} Recorded by ${r.author} at ${time(r.recorded)} · ${r.event}${r.conflict?' · versions '+r.versions.join(', '):''}`));card.append(details);host.append(card);}
    reportHealth('mission-followups','Private incident follow-ups',{checked,error:error?'Private follow-up query failed; sign in and retry.':null,state:!session||!requested?'unassessed':null,detail:'Only the selected incident is assessed. Pump assignments remain separate.',maxAgeMs:120000});
    window.dispatchEvent(new CustomEvent('storm-mission-followups',{detail:{assessed:!!checked&&!error,active:active.length,overdue:overdue.length}}));
  }
  async function refresh(next=incident){
    if(!session||busy)return;const version=++epoch,activeSession=session;busy=true;requested=true;error=null;checked=null;records=[];render();
    try{
      if(!store){const opened=await openStore(EOC_CONFIG,activeSession);if(version!==epoch){opened.close();return;}store=opened;}
      const list=await store.incidents();if(version!==epoch)return;
      const available=new Map(list.map(r=>[r.incident,r.payload.name]));const target=available.has(next)?next:available.keys().next().value||'';
      const loaded=target?await store.loadCollection('coordination',target):[];if(version!==epoch)return;
      choices=available;incident=target;records=loaded;checked=Date.now();
    }catch{if(version===epoch){store?.close();store=null;choices.clear();records=[];checked=null;error=true;}}
    finally{if(version===epoch){busy=false;render();}}
  }
  $('mission-followups-load').onclick=()=>void refresh();$('mission-followups-incident').onchange=e=>void refresh(e.target.value);$('mission-followups-history').onchange=render;
  setInterval(()=>{if(!document.hidden&&session&&requested&&!busy)void refresh();},60000);
  render();return {
    setSession(value){epoch++;session=value;store?.close();store=null;incident='';choices.clear();records=[];checked=null;error=null;busy=false;requested=false;render();},
    async selectIncident(id){if(busy){epoch++;busy=false;store?.close();store=null;}return refresh(id);},
    snapshot(item){const current=!!checked&&!error&&Date.now()-checked<=120000;return {assessed:current,incident:current?incident:null,checked:current?checked:null,rows:current?followupsForEvidence(item,missionFollowups(records)):[]};}
  };
}
