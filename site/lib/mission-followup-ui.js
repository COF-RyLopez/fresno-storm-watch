import {EOC_CONFIG} from '../eoc-config.js';
import {createPrivateStore} from './eoc-store.js';
import {missionFollowups,followupsForEvidence} from './mission-followup-model.js?v=0.71.1';
import {emptyRecords,heads} from './eoc-model.js?v=0.74.0-eoc';
import {pioStates} from './pio-model.js?v=0.73.1';
import {createPioSourceMonitor} from './pio-source-data.js?v=0.74.0-eoc';
import {pioReviewCount,pendingPioSourceReviews} from './pio-source-review.js?v=0.74.0-eoc';
import {reportHealth} from './source-health.js?v=0.73.1';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** Named-account, read-only incident follow-ups. No persistence and no automatic dispatch. */
export function createMissionFollowups({openStore=createPrivateStore,sourceMonitor=createPioSourceMonitor()}={}){
  let session=null,store=null,epoch=0,incident='',choices=new Map(),records=[],checked=null,error=null,busy=false,requested=false;
  let pioNotices=[],pioChecked=null,pioBusy=false,pioError=false;
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
    const pioHost=$('mission-pio-reviews'),pioCount=pioReviewCount(pioNotices),pioFailures=pioNotices.filter(n=>n.category==='Data failures').length;
    pioHost.replaceChildren();pioHost.hidden=!session||!requested;
    if(session&&requested){
      pioHost.append(el('h3','PIO source reviews'),el('p',pioError?'PIO source check interrupted. Refresh follow-ups to retry; applicability is unknown.':pioBusy?'Checking evacuation zones and AFN evidence…':!pioChecked?'PIO source checks not assessed.':`${pioCount} outreach ${pioCount===1?'record needs':'records need'} source review${pioFailures?' · '+pioFailures+' source checks unavailable':''} · checked ${time(pioChecked)}.`));
      if(pioChecked&&!pioNotices.length)pioHost.append(el('p',heads(records).some(h=>h.record.payload.pioOutreach&&!['Complete','Canceled'].includes(h.record.payload.status))?'No unacknowledged source differences for active outreach in this incident. Team reviews apply only to the exact source revision.':'No active outreach to monitor. Closed outreach and its saved history remain unchanged.'));
      const groups=new Map();for(const n of pioNotices){const key=n.evidence?.outreachEvent||n.key;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);}
      for(const group of groups.values()){const n=group[0],article=el('article');article.className='mission-card';article.append(el('h4',n.location),...group.map(n=>el('p',n.change)),el('p',`Owner: ${n.owner} · ${group.some(n=>n.category==='Data failures')?'Comparison unavailable':'Source applicability needs review'}`));const detail=el('details');detail.append(el('summary','Source review & next step'),...[...new Set(group.map(n=>n.nextReview))].map(text=>el('p',text)),el('p',`Compared ${time(n.sourceTime)}. Whole-area AFN context is not a zone population or confirmed support need. Source query/edit dates are not evacuation-order issue times.`));article.append(detail);pioHost.append(article);}
      pioHost.append(el('p','Approved messages, confirmed languages and saved evidence remain unchanged. Review sources every five minutes while this page is visible.'));
      const a=el('a','Record source review in private EOC review queue');a.href='./eoc.html#notifications';a.target='_blank';a.rel='noopener noreferrer';pioHost.append(a);
    }
    reportHealth('mission-followups','Private incident follow-ups',{checked,error:error?'Private follow-up query failed; sign in and retry.':null,state:!session||!requested?'unassessed':null,detail:'Only the selected incident is assessed. Pump assignments remain separate.',maxAgeMs:120000});
    reportHealth('mission-pio-sources','Private PIO source comparisons',{checked:pioChecked,error:pioError||pioFailures?'Some PIO sources could not be compared; current applicability is unknown.':null,state:!session||!requested?'unassessed':null,detail:'Selected incident only. Approved messages remain unchanged.',maxAgeMs:420000});
    window.dispatchEvent(new CustomEvent('storm-mission-followups',{detail:{assessed:!!checked&&!error,active:active.length,overdue:overdue.length,pioReview:pioCount,pioFailures,pioError,pioAssessed:!!pioChecked,pioBusy}}));
  }
  async function refresh(next=incident,{force=false}={}){
    if(!session||busy)return;const version=++epoch,activeSession=session;busy=true;requested=true;error=null;checked=null;records=[];pioNotices=[];pioChecked=null;pioBusy=false;pioError=false;render();
    try{
      if(!store){const opened=await openStore(EOC_CONFIG,activeSession);if(version!==epoch){opened.close();return;}store=opened;}
      const list=await store.incidents();if(version!==epoch)return;
      const available=new Map(list.map(r=>[r.incident,r.payload.name]));const target=available.has(next)?next:available.keys().next().value||'';
      if(target!==incident)sourceMonitor.clear();
      const [loaded,approvals,reviews]=target?await Promise.all([store.loadCollection('coordination',target),store.loadCollection('approvals',target),store.loadCollection('reviews',target)]):[[],[],[]];if(version!==epoch)return;
      choices=available;incident=target;records=loaded;checked=Date.now();
      busy=false;pioBusy=!!target;render();
      if(target){const state={...emptyRecords(),coordination:loaded,approvals};try{const result=await sourceMonitor.check(pioStates(state,{heads}),{force});if(version!==epoch)return;pioNotices=pendingPioSourceReviews(result.notices,reviews,EOC_CONFIG.teamLabel||'F.R.O.G. EOC exercise team');pioChecked=result.checked;}catch(e){if(version===epoch&&e.name!=='AbortError')pioError=true;}finally{if(version===epoch)pioBusy=false;}}
    }catch{if(version===epoch){sourceMonitor.clear();store?.close();store=null;choices.clear();records=[];pioNotices=[];pioChecked=null;pioBusy=false;checked=null;error=true;}}
    finally{if(version===epoch){busy=false;render();}}
  }
  $('mission-followups-load').onclick=()=>void refresh(incident,{force:true});$('mission-followups-incident').onchange=e=>void refresh(e.target.value);$('mission-followups-history').onchange=render;
  setInterval(()=>{if(!document.hidden&&session&&requested&&!busy&&!pioBusy)void refresh();},60000);
  render();return {
    setSession(value){epoch++;sourceMonitor.clear();session=value;store?.close();store=null;incident='';choices.clear();records=[];pioNotices=[];pioChecked=null;pioBusy=false;pioError=false;checked=null;error=null;busy=false;requested=false;render();},
    async selectIncident(id){if(busy||pioBusy){epoch++;sourceMonitor.clear();busy=false;pioBusy=false;store?.close();store=null;}return refresh(id);},
    snapshot(item){const current=!!checked&&!error&&Date.now()-checked<=120000;return {assessed:current,incident:current?incident:null,checked:current?checked:null,rows:current?followupsForEvidence(item,missionFollowups(records)):[]};}
  };
}
