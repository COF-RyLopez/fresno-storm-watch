import {validateBriefingSnapshot,briefingState,BRIEFING_CHECK_MAX_AGE,HNX_BRIEFING_PAGE,HNX_BRIEFING_PDF} from './briefing-model.js';
import {formatTime} from './model.js';
import {reportHealth} from './source-health.js';
import {PARTNER_BRIEFING} from './briefing-impact-model.js?v=0.21.0';
import {createBriefingImpactView} from './briefing-impact-ui.js?v=0.22.0';
const $=id=>document.getElementById(id);
const ARCHIVE=PARTNER_BRIEFING;
/** @param {string} tag @param {string} text @returns {HTMLElement} All source metadata is displayed as text. */
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
/** @param {object} options @returns {object} Public documents only; update markers live in memory and are not team acknowledgements. */
export function createHanfordBriefing({timeZone,exercise=false,onUpdate=()=>{},onImpacts=()=>{},onMapTour=()=>{},onSlide=()=>{}}){
  let snapshot=null,error=null,busy=false,baseline=null,updated=false,pdfBlob=null,generation=0,initialLinkHandled=false,pages=[],pageIndex=0,pdfController=null;
  const time=t=>formatTime(Number.isFinite(Date.parse(t))?Date.parse(t):null,timeZone),state=()=>briefingState(error?{...snapshot,error}:snapshot);
  let currentDocument=null,follow=true;
  function announceSlide(){onSlide(currentDocument?{...currentDocument,page:pageIndex+1,follow}:null);}
  const impacts=createBriefingImpactView({exercise,onOpen:(...args)=>void show(...args),onData:onImpacts});
  const cardViews=new WeakMap();
  function cardView(host){
    if(cardViews.has(host))return cardViews.get(host);
    const status=el('p'),date=el('p'),reason=el('p'),actions=el('div');status.className='briefing-status';actions.className='environment-actions';
    const open=el('calcite-button','Read public briefing');open.scale='s';open.appearance='outline';open.iconStart='file-text';open.onclick=()=>void show('latest');
    const archive=el('calcite-button','Oct 19 partner slides');archive.scale='s';archive.appearance='transparent';archive.disabled=exercise;archive.onclick=()=>void show('archive');
    const tour=el('calcite-button','Explore live briefing layers');tour.scale='s';tour.appearance='outline';tour.iconStart='map';tour.disabled=exercise;tour.onclick=()=>onMapTour('ero-day-3');actions.append(open,archive,tour);
    const source=el('a','NWS Hanford briefing page ↗');source.href=HNX_BRIEFING_PAGE;source.target='_blank';source.rel='noopener noreferrer';
    const check=el('calcite-button','Check briefing');check.scale='s';check.appearance='transparent';check.onclick=()=>void refresh();
    host.append(status,date,reason,actions,source,check,el('small','Office-wide context may include areas outside Fresno County. Public summaries and partner slides are separate products; neither changes warning counts or deployment decisions.'));
    const result={status,date,reason,open,check};cardViews.set(host,result);return result;
  }
  function render(){
    const health=state(),doc=snapshot?.document;
    for(const host of document.querySelectorAll('[data-hanford-briefing]')){
      host.closest('calcite-block').description=exercise?'Live briefing checks disabled':`${updated?'New public revision · ':''}${health.label}${doc?' · '+time(doc.sourceUpdatedAt):''}`;
      const v=cardView(host);v.status.textContent=exercise?'Fictional exercise: live briefing checks disabled.':`${health.label}${updated?' · new public revision':''}`;
      v.date.hidden=!doc;if(doc)v.date.textContent=`NWS page updated ${time(doc.sourceUpdatedAt)}. PDF saved ${time(doc.collectedAt)}; source checked ${time(snapshot.lastSuccessAt||doc.collectedAt)}.`;
      v.reason.textContent=exercise?'Use the live app for NWS products.':health.reason;v.open.disabled=!doc||exercise;v.check.textContent=busy?'Checking briefing…':'Check briefing';v.check.disabled=busy||exercise;
    }
    $('hanford-briefing-open').disabled=exercise||!doc;
    if(!exercise)reportHealth('hnx-briefing','NWS Hanford public briefing',{checked:doc?Date.parse(snapshot.lastSuccessAt||doc.collectedAt):null,error:health.tone==='gap'?health.reason:null,maxAgeMs:BRIEFING_CHECK_MAX_AGE});
    onUpdate(updated);
    impacts.update(error?{...snapshot,error}:snapshot);
  }
  function clearViewer(){generation++;pdfController?.abort();pdfController=null;currentDocument=null;announceSlide();$('hanford-page-image').removeAttribute('src');$('hanford-pdf-open').removeAttribute('href');if(pdfBlob)URL.revokeObjectURL(pdfBlob);pdfBlob=null;}
  function pageView(){const page=pages[pageIndex];$('hanford-page-image').hidden=!page;$('hanford-page-controls').hidden=!pages.length;$('hanford-page-label').textContent=`Page ${pageIndex+1} of ${pages.length}`;$('hanford-page-before').disabled=pageIndex===0;$('hanford-page-after').disabled=pageIndex>=pages.length-1;if(page){$('hanford-page-image').src=page.path;$('hanford-page-open').href=page.path;$('hanford-page-image').alt=`NWS Hanford briefing · page ${pageIndex+1} of ${pages.length}. Open the PDF for its text layer and full resolution.`;if(currentDocument){const u=new URL(location.href);u.searchParams.set('briefing',currentDocument.kind==='archive'?'2026-10-19':'latest');u.searchParams.set('briefingPage',String(pageIndex+1));history.replaceState({},'',u);}}announceSlide();}
  async function show(kind,pageNumber=1,expectedHash=null){
    clearViewer();const request=generation,archive=kind==='archive',doc=snapshot?.document;
    currentDocument={kind:archive?'archive':'latest',sha256:archive?ARCHIVE.sha256:doc?.sha256,verified:false};
    if(expectedHash&&expectedHash!==(archive?ARCHIVE.sha256:doc?.sha256)){
      $('hanford-dialog').heading='Briefing revision changed';$('hanford-dialog').description='Source revision changed · previous summary withheld';$('hanford-preview-health').textContent='Revision changed · source review needed';$('hanford-dialog').querySelector('.briefing-document-details').open=true;$('hanford-document-note').textContent='The source changed after this summary was displayed. Its page citation cannot be applied to the new PDF. Read the current briefing and request a new summary review.';$('hanford-pdf-status').textContent='Previous summary withheld.';$('hanford-pdf-open').disabled=true;$('hanford-publisher-link').href=HNX_BRIEFING_PAGE;$('hanford-publisher-link').textContent='Current NWS Hanford source';pages=[];pageView();$('hanford-dialog').setAttribute('open','');return;
    }
    $('hanford-dialog').heading=archive?'NWS Hanford · October 19 partner slides':'NWS Hanford · public briefing';
    $('hanford-dialog').description=archive?'October 19, 2026 · static partner briefing':doc?`${state().label} · NWS page updated ${time(doc.sourceUpdatedAt)}`:'Public briefing unavailable · use the NWS source';
    $('hanford-document-note').textContent=archive?'Dated October 19, 2026 · 19 NWS Hanford partner slides · supplied by Fresno County OES. Static archive; read the forecast periods in the slides.':doc?`NWS page updated ${time(doc.sourceUpdatedAt)} · PDF saved ${time(doc.collectedAt)}; source checked ${time(snapshot.lastSuccessAt||doc.collectedAt)}. ${state().label}.`:'No verified public briefing is available.';
    $('hanford-preview-health').textContent='Verifying saved document…';$('hanford-pdf-status').textContent='Checking the saved PDF…';$('hanford-pdf-open').disabled=true;pages=archive?Array.from({length:19},(_,i)=>({path:`./data/briefing-previews/${ARCHIVE.sha256}/${i+1}.webp`})):(doc?.previews||[]);pageIndex=Math.max(0,Math.min(pages.length-1,Number.isInteger(pageNumber)?pageNumber-1:0));pageView();$('hanford-dialog').setAttribute('open','');
    $('hanford-publisher-link').href=archive?HNX_BRIEFING_PAGE:HNX_BRIEFING_PDF;$('hanford-publisher-link').textContent=archive?'NWS Hanford briefing page':'Original NWS public PDF';
    try{
      if(!archive&&!doc)throw new Error('Open the NWS page while the public briefing is unavailable.');
      const expected=archive?ARCHIVE:doc,url=archive?ARCHIVE.url:'./data/hanford-briefing-current.pdf?v='+doc.sha256;
      pdfController=new AbortController();const response=await fetch(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.any([pdfController.signal,AbortSignal.timeout(20_000)])});if(!response.ok)throw new Error(`Saved briefing HTTP ${response.status}`);
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>15_000_000)throw new Error('Saved PDF exceeds the size limit.');chunks.push(chunk);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
      if(size!==expected.bytes||hash!==expected.sha256)throw new Error('The PDF does not match its saved revision. Check the briefing again or use NWS directly.');
      if(request!==generation)return;pdfBlob=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));$('hanford-pdf-open').href=pdfBlob;$('hanford-pdf-open').disabled=false;
      $('hanford-preview-health').textContent='Verified saved document · static page preview';$('hanford-pdf-status').textContent=pages.length?'PDF revision verified. Page previews retain the original content; open the PDF for full resolution and its text layer.':'PDF revision verified. Page previews unavailable; open the PDF or original NWS source.';
      currentDocument.verified=true;announceSlide();
      if(!archive){updated=false;render();}
    }catch(e){if(request===generation){$('hanford-pdf-status').textContent=`PDF unavailable · ${e.message}`;$('hanford-preview-health').textContent='Document verification failed · open source details';}}
  }
  async function refresh(){
    if(busy||exercise||document.hidden)return;busy=true;render();
    try{const r=await fetch('./data/hanford-briefing.json?check='+Date.now(),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(15_000)});if(!r.ok)throw new Error(`Briefing metadata HTTP ${r.status}`);const next=validateBriefingSnapshot(await r.json());if(next.document){if(baseline&&baseline!==next.document.sha256)updated=true;baseline=next.document.sha256;}snapshot=next;error=null;
    }catch(e){error=e.message;}finally{busy=false;render();}
    if(!initialLinkHandled){const q=new URLSearchParams(location.search),requested=q.get('briefing'),page=Number(q.get('briefingPage')||1);initialLinkHandled=true;if(requested==='latest')void show('latest',page);else if(requested==='2026-10-19')void show('archive',page);}
  }
  $('hanford-page-before').onclick=()=>{if(pageIndex>0){pageIndex--;pageView();$('hanford-page-controls').scrollIntoView({block:'start'});}};$('hanford-page-after').onclick=()=>{if(pageIndex<pages.length-1){pageIndex++;pageView();$('hanford-page-controls').scrollIntoView({block:'start'});}};
  $('hanford-page-image').onerror=()=>{$('hanford-preview-health').textContent='Page preview unavailable · open source details';$('hanford-pdf-status').textContent='Page preview unavailable. Use the verified PDF or the original NWS source.';};
  $('hanford-briefing-open').onclick=()=>void show('latest');
  $('hanford-dialog').addEventListener('stormEvidenceClose',()=>{clearViewer();const u=new URL(location.href);if(u.searchParams.has('briefing')){u.searchParams.delete('briefing');u.searchParams.delete('briefingPage');history.replaceState({},'',u);}});
  function setFollow(value){follow=!!value;$('hanford-follow-slides').checked=follow;announceSlide();}
  $('hanford-follow-slides').addEventListener('calciteCheckboxChange',e=>setFollow(e.target.checked));
  window.addEventListener('popstate',()=>{if(!currentDocument||!$('hanford-dialog').hasAttribute('open'))return;const q=new URLSearchParams(location.search),kind=currentDocument.kind==='archive'?'2026-10-19':'latest',requested=Number(q.get('briefingPage'));if(q.get('briefing')===kind&&Number.isInteger(requested)&&requested>=1&&requested<=pages.length&&requested!==pageIndex+1){pageIndex=requested-1;pageView();}});
  setInterval(()=>{if(!document.hidden){render();void refresh();}},60_000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});window.addEventListener('online',()=>void refresh());
  render();void refresh();return {open:show,setFollow};
}
