import {makeEvent,heads,digest} from './eoc-model.js?v=0.74.0-population';
import {pioStates,pioApprovalFor,PIO_RECEIPTS,assertReadyForApproval} from './pio-model.js?v=0.74.0-population';
import {createPioSourceMonitor} from './pio-source-data.js?v=0.74.0-population';
import {pendingPioSourceReviews} from './pio-source-review.js?v=0.74.0-population';
import {capturePopulationEvidence} from './population-snapshot-data.js?v=0.74.0-population';
import {freezePopulationEvidence,populationEvidenceSummary,populationEvidenceLines} from './population-snapshot-model.js?v=0.74.0-population';
import {captureAfnEvidence} from './afn-snapshot-data.js?v=0.74.0-population';
import {AFN_TOPIC_KEYS,freezeAfnEvidence,afnEvidenceSummary,afnEvidenceLines} from './afn-snapshot-model.js?v=0.74.0-population';
import {readCareCollection} from './care-data.js?v=0.56.0-r1';
import {CARE_SOURCES,ZONE_STATUS} from './care-model.js?v=0.56.0-r1';
import {loadCounties} from './nws.js';
import {localDateValue} from './eoc-forms.js';
import {populationSourceGuide} from './population-guide.js?v=0.74.0-population';
import {loadPioZoneContext,assertPopulationMapBoundary,populationMapSummary,populationMapLines} from './pio-zone-context.js?v=0.73.0-r2';
const el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const link=(text,url)=>{const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const lines=value=>value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
const date=value=>value?new Date(value).getTime():null;
const closed=p=>['Complete','Canceled'].includes(p.status);


/** Private drafts and receipts stay in memory until appended to the existing restricted AGOL views. */
export function createPioWorkspace({host,getState,commit,message,time,onSourceChange=()=>{},onBriefing=()=>{},exercise=false,team='F.R.O.G. EOC exercise team',zoneRequest=null,zoneRequestError=null}){
  let editor=null,zones=null,zoneError=null,zonePending=null,epoch=0,abort=null,saveBusy=false,zoneNotices=[],reviewPending=null,reviewSignature=null,reviewChecked=null;
  let request=zoneRequest,entry=null,entryPending=null,entryAbort=null,requestError=zoneRequestError,entryError=requestError,entryFocusPending=!!zoneRequest;
  const monitor=createPioSourceMonitor({loadZones:({force})=>loadZones(force),exercise});
  const button=(label,fn,enabled=true)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.disabled=!enabled;b.addEventListener('click',fn);return b;};
  const currentRows=()=>pioStates(getState().records,{heads});
  const headIds=(key,entity)=>heads(getState().records[key].filter(r=>r.entity===entity)).flatMap(h=>h.heads.map(r=>r.id));
  function permitted(key){const s=getState();return !!s.incident&&s.can(key);}
  async function loadZones(force=false){
    if(zonePending)return zonePending;if(zones&&!force&&Date.now()-zones.checked<300000)return zones;
    const generation=epoch;abort?.abort();abort=new AbortController();
    zonePending=(async()=>{try{
      let data;if(exercise)data={checked:Date.now(),rows:[{key:'county-zone:99999999',oid:99999999,name:'EXERCISE ZONE A',status:'unknown',rawStatus:null,geometry:{rings:[[[-119.8,36.7],[-119.8,36.71],[-119.79,36.71],[-119.79,36.7],[-119.8,36.7]]],spatialReference:{wkid:4326}}}]};
      else{const counties=await loadCounties(new URL('../data/counties.geojson',import.meta.url));if(generation!==epoch)return null;data=await readCareCollection('zones',{county:counties.find(c=>c.properties.GEOID==='06019'),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)])});}
      if(generation!==epoch)return null;zones=data;zoneError=null;return data;
    }catch(e){if(generation===epoch&&e.name!=='AbortError')zoneError=e.message;throw e;}
    finally{if(generation===epoch)zonePending=null;}})();return zonePending;
  }
  async function zoneSnapshot(key){const z=zones?.rows.find(z=>z.key===key);if(!z)throw Error('Choose a current county zone.');return {source:CARE_SOURCES.zones,key:z.key,oid:z.oid,name:z.name,status:z.status,checked:zones.checked,revision:await digest({name:z.name,status:z.status,geometry:z.geometry})};}
  async function resolveEntry(force=false){
    if(!request||entryPending||entry&&!force)return;const generation=epoch,token={},activeRequest=request;entryPending=token;entryAbort?.abort();entryAbort=new AbortController();entryError=null;
    try{if(exercise)throw Error('A real county zone link is not applied to the fictional tabletop. Open the private workspace for county outreach.');const collection=await loadZones(force),next=await loadPioZoneContext(activeRequest,collection,{signal:entryAbort.signal});if(generation===epoch&&request===activeRequest&&entryPending===token)entry=next;}
    catch(error){if(generation===epoch&&request===activeRequest&&entryPending===token&&error.name!=='AbortError')entryError=error.message;}
    finally{if(entryPending===token){entryPending=null;if(generation===epoch)render();}}
  }
  function showAll(){entryAbort?.abort();entryPending=null;request=null;requestError=null;entry=null;entryError=null;const url=new URL(location.href);url.searchParams.delete('pioZone');url.searchParams.delete('populationMap');url.searchParams.delete('populationBuilt');history.replaceState(null,'',url);render();}
  function renderEntry(){
    if(!request&&!entryError)return;if(request&&!entry&&!entryError&&!entryPending)void resolveEntry();
    const box=el('section');box.className='pio-zone-context';box.setAttribute('aria-label','Selected zone outreach');
    box.append(el('h3',entry?'Zone '+entry.zone.name:'Selected-zone outreach'));
    if(entryError){const warning=el('p',entryError);warning.setAttribute('role','alert');box.append(warning);}
    else if(!entry)box.append(el('p','Checking the selected county zone and population map snapshot…'));
    else{box.append(el('p',entry.populationMap?populationMapSummary(entry.populationMap):'Outreach records for this county zone in the selected incident. New drafts calculate fresh population evidence.'));if(entry.populationMap)box.append(el('p',`Map calculated ${time(entry.populationMap.built)} · boundary snapshot ${time(entry.populationMap.zonesChecked)}. Source dates and uncertainty will stay with a new outreach draft.`));}
    const actions=el('div');actions.className='button-row';if(request&&entryError)actions.append(button('Retry zone context',()=>void resolveEntry(true)));actions.append(button('Show all outreach',showAll));box.append(actions);host.append(box);
    if(entry&&getState().incident&&entryFocusPending)requestAnimationFrame(()=>{if(box.isConnected&&!host.hidden&&!editor){box.tabIndex=-1;box.focus();entryFocusPending=false;}});
  }
  async function recheckPlan(record){
    await loadZones(true);const current=await zoneSnapshot(record.payload.pioOutreach.zone.key);
    if(current.revision!==record.payload.pioOutreach.zone.revision)throw Error('County zone boundary, name or published status changed. Update the outreach version and review its applicability.');return current;
  }
  function field(form,name,label,{type='text',value='',required=true,options=null,help='',max=1500}={}){
    const wrap=el('div');wrap.className='field';const l=el('label',label);l.htmlFor='pio-'+name;const input=el(options?'select':type==='textarea'?'textarea':'input');input.id='pio-'+name;input.name=name;input.autocomplete='off';input.required=required;
    if(options)for(const [v,t]of options){const o=el('option',t);o.value=v;input.append(o);}else if(type!=='textarea')input.type=type==='date'?'datetime-local':type;
    input.value=type==='date'?localDateValue(value):value;input.maxLength=max;wrap.append(l,input);if(help)wrap.append(el('small',help));form.append(wrap);return input;
  }
  function section(form,title){form.append(el('h3',title));}
  function begin(kind,record=null,distribution=null){
    const collection=kind==='approval'?'approvals':'coordination';if(!permitted(collection))return message('Your named account needs the assigned EOC editing group and a current private query.');
    editor?.populationAbort?.abort();editor?.afnAbort?.abort();const generation=++epoch;monitor.clear();reviewPending=null;abort?.abort();zonePending=null;saveBusy=false;editor={kind,record,distribution,incident:getState().incident,entity:distribution?distribution.entity:kind==='plan'&&record?record.entity:kind==='approval'?pioApprovalFor(record,getState().records,heads)?.entity||crypto.randomUUID():crypto.randomUUID(),event:null,generation,population:record?.payload.pioOutreach?.populationEvidence?structuredClone(record.payload.pioOutreach.populationEvidence):null,populationBusy:false,zoneKey:record?.payload.pioOutreach?.zone.key||entry?.zone.key||null,populationMap:record?.payload.pioOutreach?.populationMapEvidence?structuredClone(record.payload.pioOutreach.populationMapEvidence):!record&&entry?.populationMap?structuredClone(entry.populationMap):null,mapChanged:false,afn:record?.payload.pioOutreach?.afnEvidence?structuredClone(record.payload.pioOutreach.afnEvidence):null,afnBusy:false};
    renderEditor();
  }
  function renderEditor(){
    const e=editor,p=e.record?.payload||{},o=p.pioOutreach||{},receipt=e.distribution?.payload.pioDistribution,form=el('form');form.id='pio-form';form.autocomplete='off';host.replaceChildren();host.append(el('h3',e.kind==='plan'?(e.record?'Update outreach · new version':'New outreach record'):e.kind==='approval'?'Record documented message approval':'Record distribution outside this app'));
    host.append(el('p',e.kind==='approval'?'The existing EOC approvers group records documented county PIO/JIC approval for this exact outreach version. Group membership does not establish public-message authority.':e.kind==='distribution'?'Record what was sent or posted through the approved county channels. This form does not send messages or confirm public receipt.':'One message and language per outreach version. A correction preserves history and requires a fresh exact-version approval. No message is sent from this workspace.'));
    if(e.record&&e.kind!=='plan'){const preview=el('blockquote',o.message);preview.className='pio-message';host.append(el('p',`${p.location} · ${o.messageLanguage} · outreach version ${e.record.id}`),preview);}
    host.append(el('p',`Times are entered in ${Intl.DateTimeFormat().resolvedOptions().timeZone}; records display in America/Los_Angeles.`),form);const error=el('p');error.id='pio-error';error.setAttribute('role','alert');host.append(error);
    if(e.kind==='plan'){
      section(form,'Zone & responsibility');const zone=field(form,'zone','County evacuation zone',{value:o.zone?.key||e.zoneKey||'',options:[['','Checking county zones…']]});zone.disabled=true;
      const source=el('p');source.id='pio-zone-source';source.className='meta';form.append(source);
      const generation=e.generation;void loadZones().then(data=>{if(editor!==e||generation!==epoch||!data)return;zone.replaceChildren();const empty=el('option','Choose a county zone…');empty.value='';zone.append(empty);for(const r of [...data.rows].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))){const option=el('option',r.name+' · '+(ZONE_STATUS[r.status]||'Status unknown'));option.value=r.key;zone.append(option);}zone.value=o.zone?.key||e.zoneKey||'';zone.disabled=!!e.record;if(e.record&&!data.rows.some(z=>z.key===o.zone.key)){const missing=el('option',o.zone.name+' · not returned; retained history');missing.value=o.zone.key;zone.append(missing);zone.value=o.zone.key;error.textContent='The recorded county zone is no longer returned. Preserve this history and create outreach for a verified current zone.';}
        const describe=()=>{const row=data.rows.find(z=>z.key===zone.value);source.textContent=row?`${row.name} · published ${ZONE_STATUS[row.status]||'Unknown'} · queried ${time(data.checked)}. Individual order issue/update time is unavailable. Confirm message applicability with the county.`:'Choose a zone; the source status does not establish a current order or safe access.';};zone.addEventListener('change',()=>{describe();e.population=null;e.populationMap=null;e.afn=null;void captureForEditor(e,zone.value);void captureAfnForEditor(e,zone.value);});describe();renderPopulationEditor(e);if(zone.value&&!e.population&&!e.populationMap)void captureForEditor(e,zone.value);if(zone.value&&!e.afn)void captureAfnForEditor(e,zone.value);
      }).catch(()=>{if(editor===e)error.textContent='County zone check failed: '+zoneError+'. Retry by reopening the form. No current status is inferred.';});
      field(form,'title','Outreach purpose / title',{value:p.title||'',max:240});field(form,'owner','Responsible PIO / team',{value:p.owner||'',max:200});
      const population=el('section');population.id='pio-population';population.setAttribute('aria-label','Saved population planning evidence');form.append(population);renderPopulationEditor(e);
      const afn=el('section');afn.id='pio-afn';afn.setAttribute('aria-label','Saved AFN and language planning evidence');form.append(afn);renderAfnEditor(e);
      section(form,'Confirmed languages & message');field(form,'languages','Confirmed languages · one per line',{type:'textarea',value:(o.languages||[]).join('\n'),required:false,help:'Leave blank while unconfirmed. Census groups are planning context, not confirmation of preferred languages.'});
      field(form,'confirmedBy','Languages confirmed by',{value:o.confirmedBy||'',required:false,max:200});field(form,'confirmedAt','Language confirmation time',{type:'date',value:o.confirmedAt,required:false});field(form,'languageEvidence','Language confirmation source / partner reference',{type:'textarea',value:o.languageEvidence||'',required:false});
      field(form,'messageLanguage','Language of this message',{value:o.messageLanguage||'',max:100});field(form,'message','Message text · draft until exact-version approval',{type:'textarea',value:o.message||'',max:8000,help:'Record a separate outreach message for each translated version. Do not include credentials or recipient lists.'});
      section(form,'Distribution plan');field(form,'channels','Channels · one per line',{type:'textarea',value:(o.channels||[]).join('\n'),help:'Name approved platforms or methods; for example county alerting, radio, accessible web or partner outreach. This is a plan, not a delivery receipt.'});field(form,'partners','Community partners / reach method · one per line',{type:'textarea',value:(o.partners||[]).join('\n'),required:false});field(form,'nextUpdate','Next update / review due',{type:'date',value:currentRows().find(s=>s.record.entity===e.record?.entity)?.nextUpdate||p.due||Date.now()+3600000});
      const verification=el('details');verification.open=!!o.zoneVerifiedBy;verification.append(el('summary','County applicability confirmation · required before approval'));form.append(verification);
      field(verification,'zoneVerifiedBy','County applicability confirmed by',{value:o.zoneVerifiedBy||'',required:false,max:200});field(verification,'zoneVerifiedAt','Applicability confirmation time',{type:'date',value:o.zoneVerifiedAt,required:false});field(verification,'zoneEvidence','Authority / confirmation reference',{type:'textarea',value:o.zoneEvidence||'',required:false});
      field(form,'analysisNotes','Planning evidence and remaining gaps',{type:'textarea',value:o.analysisNotes||'',required:false,max:2000});field(form,'status','Outreach follow-up status',{value:p.status||'Open',options:['Open','In progress','Complete','Canceled'].map(v=>[v,v])});field(form,'evidence','Progress / closeout evidence',{type:'textarea',value:p.evidence||'',required:false,help:'Required to close or cancel outreach. Closing does not clear the hazard or prove receipt.'});
    }else if(e.kind==='approval'){
      field(form,'decision','Recorded decision',{value:'Approved',options:[['Approved','Approval documented'],['Withdrawn','Approval withdrawn']]});field(form,'decisionBy','Documented county approver',{max:200});field(form,'decidedAt','Decision time',{type:'date',value:Date.now()});field(form,'evidence','Approval / withdrawal reference',{type:'textarea',help:'Identify the county approval and translation review. This entry is signed by your ArcGIS account.'});
    }else{
      field(form,'distributedAt','Actual distribution time',{type:'date',value:receipt?.distributedAt||Date.now()});field(form,'channels','Channels used · one per line',{type:'textarea',value:(receipt?.channels||o.channels).join('\n'),help:'Use only channels in this approved version.'});field(form,'partners','Partners used · one per line',{type:'textarea',value:(receipt?.partners||o.partners).join('\n'),required:false});field(form,'receipt','Distribution / receipt status',{value:receipt?.receipt||PIO_RECEIPTS[0],options:PIO_RECEIPTS.map(v=>[v,v])});field(form,'nextUpdate','Next update due',{type:'date',value:receipt?.nextUpdate||Date.now()+3600000});field(form,'owner','Distributed by / responsible team',{value:e.distribution?.payload.owner||p.owner,max:200});field(form,'evidence','Distribution evidence / delivery issue',{type:'textarea',value:e.distribution?.payload.evidence||'',help:'Record the platform reference, posting or partner confirmation. Do not include passwords, tokens or public recipient lists.'});
    }
    host.append(populationSourceGuide());const actions=el('div');actions.className='button-row';actions.append(button(e.kind==='plan'?'Save outreach record':e.kind==='approval'?'Save approval record':'Save distribution record',()=>form.requestSubmit()),button('Cancel',()=>{editor?.populationAbort?.abort();editor?.afnAbort?.abort();epoch++;editor=null;render();}));host.append(actions);
    form.addEventListener('submit',event=>{event.preventDefault();void save(form,error,e);});
  }
  function populationDetails(snapshot,zone){const details=el('details');details.append(el('summary','Saved population sources, dates & uncertainty'));for(const line of populationEvidenceLines(snapshot,zone,time))details.append(el('p',line));if(snapshot)for(const source of Object.values(snapshot.sources))if(source.url)details.append(link(source===snapshot.sources.acs?'ACS population source':source===snapshot.sources.blocks?'2020 Census block source':'Census analysis boundaries',source.url),el('br'));return details;}
  function afnDetails(snapshot,zone){const details=el('details');details.append(el('summary','Saved AFN sources, dates, MOEs & whole-area limits'));for(const line of afnEvidenceLines(snapshot,zone,time))details.append(el('p',line));if(snapshot)for(const source of Object.values(snapshot.sources))details.append(link(source.title,source.item||source.url),el('br'));return details;}
  function renderAfnEditor(e){const box=document.getElementById('pio-afn');if(!box||editor!==e)return;box.replaceChildren(el('h3','AFN & language evidence'));const status=el('p',e.afnBusy?'Checking public AFN and language context for the selected zone…':e.afnError||afnEvidenceSummary(e.afn));status.id='pio-afn-status';status.setAttribute('role','status');box.append(status,el('p','Saved with this outreach version and its briefings. Refreshing changes this draft; save a new version for fresh exact-version approval. Demographics do not confirm preferred languages or individual needs.'));if(e.afn)box.append(afnDetails(e.afn, e.afn.zone));box.append(button('Refresh AFN evidence',()=>void captureAfnForEditor(e,document.getElementById('pio-zone').value),!e.afnBusy&&!saveBusy&&!e.event));}
  async function captureAfnForEditor(e,key){
    if(e.event)return;
    e.afnAbort?.abort();e.afnAbort=new AbortController();const controller=e.afnAbort;e.afnBusy=true;e.afnError=null;renderAfnEditor(e);
    try{
      if(!key){e.afn=null;return;}const zone=await zoneSnapshot(key),row=zones.rows.find(row=>row.key===key);
      const current=()=>editor===e&&e.afnAbort===controller&&e.incident===getState().incident;
      if(!current())return;
      const snapshot=exercise?freezeAfnEvidence({zone,exercise:true,topics:AFN_TOPIC_KEYS.map(key=>({key,error:'EXERCISE illustrative: live AFN reads disabled; no real area values are inferred.'}))}):await captureAfnEvidence(row,zone,{signal:controller.signal,current});
      if(!current())return;e.afn=snapshot;
    }catch(error){if(editor===e&&e.afnAbort===controller&&error.name!=='AbortError')e.afnError='AFN evidence not refreshed: '+error.message+'. Existing evidence, if any, retains its original dates. Retry Refresh AFN evidence.';}
    finally{if(editor===e&&e.afnAbort===controller){e.afnBusy=false;renderAfnEditor(e);}}
  }
  function populationMapDetails(snapshot){const details=el('details');details.append(el('summary','Saved map estimate, dates & uncertainty'));for(const line of populationMapLines(snapshot,time))details.append(el('p',line));return details;}
  function renderPopulationEditor(e){
    const box=document.getElementById('pio-population');if(!box||editor!==e)return;box.replaceChildren(el('h3','Population planning evidence'));
    const status=el('p',e.populationBusy?'Calculating public population evidence for the selected zone…':e.populationMap?populationMapSummary(e.populationMap):populationEvidenceSummary(e.population));status.id='pio-population-status';status.setAttribute('role','status');box.append(status);
    box.append(el('p','Saved with this outreach version and copied into briefings. These estimates do not confirm current occupants, evacuation status or language needs.'));
    if(e.populationMap){box.append(el('p','Map calculated '+time(e.populationMap.built)+' · county boundary snapshot '+time(e.populationMap.zonesChecked)),populationMapDetails(e.populationMap));}
    else if(e.population)box.append(populationDetails(e.population,e.population.zone));
    const enabled=!e.populationBusy&&!saveBusy&&!e.event;
    box.append(button(e.populationMap?'Calculate latest population evidence':'Refresh population evidence',()=>void captureForEditor(e,document.getElementById('pio-zone').value),enabled));
    if(entry?.populationMap&&!e.populationMap&&entry.zone.key===document.getElementById('pio-zone').value)box.append(button('Use selected map estimate in this draft',()=>{e.populationAbort?.abort();e.populationBusy=false;e.population=null;e.populationMap=structuredClone(entry.populationMap);e.mapChanged=true;renderPopulationEditor(e);},enabled));
  }
  async function captureForEditor(e,key){
    if(e.event)return;e.populationMap=null;
    e.populationAbort?.abort();e.populationAbort=new AbortController();const controller=e.populationAbort;e.populationBusy=true;renderPopulationEditor(e);
    try{
      if(!key){e.population=null;return;}const zone=await zoneSnapshot(key),row=zones.rows.find(row=>row.key===key);
      const current=()=>editor===e&&e.populationAbort===controller&&e.incident===getState().incident;
      if(!current())return;
      if(exercise){const checked=Date.now();e.population=freezePopulationEvidence({zone,exercise:true,newer:{period:'2020–2024',checked,sourceChecked:checked,metadata:{modified:null,edited:null},boundaries:{checked},estimate:1000,samplingMoe:100,tracts:1,missing:0,missingMoe:0,rows:[{id:'06019000100',population:2000,moe:200,weight:.5,baselineWithin:980,baselineTotal:1960,reason:null}]},baseline:{estimate:980,blocks:2,missing:0,wholePopulation:960,boundaryPopulation:40,wholeBlocks:1,boundaryBlocks:1},baselineMeta:{checked,edited:null}});}
      else {const snapshot=await capturePopulationEvidence(row,zone,{signal:controller.signal,current});if(!current())return;e.population=snapshot;}
    }catch(error){if(editor===e&&e.populationAbort===controller&&error.name!=='AbortError'){const errorBox=document.getElementById('pio-error');if(errorBox)errorBox.textContent='Population evidence not refreshed: '+error.message+'. Existing saved evidence, if any, is retained with its original dates.';}}
    finally{if(editor===e&&e.populationAbort===controller){e.populationBusy=false;renderPopulationEditor(e);}}
  }
  async function save(form,error,e){
    if(saveBusy||editor!==e||!form.reportValidity())return;if(e.populationBusy||e.afnBusy){error.textContent='Planning evidence is still being checked. Wait for the result or cancel this draft.';return;}saveBusy=true;for(const b of host.querySelectorAll('calcite-button'))b.disabled=true;error.textContent='';const value=k=>form.elements.namedItem(k)?.value.trim()||'';
    try{
      if(e.incident!==getState().incident)throw Error('Incident changed. Reopen this form for the intended incident.');
      if(!e.event){
        if(e.kind==='plan'){
          if(e.populationMap&&(!e.record||e.mapChanged||!closed({status:value('status')}))){const collection=await loadZones(true);await assertPopulationMapBoundary(e.populationMap,collection.rows);e.populationMap={...e.populationMap,boundaryVerifiedAt:collection.checked};}
          const zone=closed({status:value('status')})&&e.record&&!zones?.rows.some(z=>z.key===value('zone'))?e.record.payload.pioOutreach.zone:await zoneSnapshot(value('zone')),o={schema:1,zone,languages:lines(value('languages')),confirmedBy:value('confirmedBy'),confirmedAt:date(value('confirmedAt')),languageEvidence:value('languageEvidence'),messageLanguage:value('messageLanguage'),message:value('message'),channels:lines(value('channels')),partners:lines(value('partners')),zoneVerifiedBy:value('zoneVerifiedBy'),zoneVerifiedAt:date(value('zoneVerifiedAt')),zoneEvidence:value('zoneEvidence'),analysisNotes:value('analysisNotes')};
          if(e.population)o.populationEvidence=e.population;
          if(e.populationMap)o.populationMapEvidence=e.populationMap;
          if(e.afn)o.afnEvidence=e.afn;
          e.event=makeEvent('coordination',{kind:'Follow-up',title:value('title'),location:zone.name,owner:value('owner'),due:date(value('nextUpdate')),nextReview:'Review PIO message, source applicability and next public update',status:value('status'),evidence:value('evidence'),pioOutreach:o},{incident:e.incident,entity:e.entity,supersedes:e.record?headIds('coordination',e.entity):[]});
        }else if(e.kind==='approval'){
          if(value('decision')==='Approved'){await recheckPlan(e.record);assertReadyForApproval(e.record.payload);}
          const prior=pioApprovalFor(e.record,getState().records,heads);e.event=makeEvent('approvals',{kind:'pio-outreach',outreachEvent:e.record.id,status:value('decision'),decisionBy:value('decisionBy'),decidedAt:date(value('decidedAt')),evidence:value('evidence')},{incident:e.incident,entity:e.entity,supersedes:prior?headIds('approvals',prior.entity):[]});
        }else{
          const p=e.record.payload,a=e.distribution?getState().records.approvals.find(a=>a.id===e.distribution.payload.pioDistribution.approvalEvent):pioApprovalFor(e.record,getState().records,heads);if(!a||a.payload.status!=='Approved')throw Error('Current exact-version approval is required.');e.event=makeEvent('coordination',{kind:'Follow-up',title:'Distribution · '+p.title,location:p.location,owner:value('owner'),due:date(value('nextUpdate')),nextReview:'Review next PIO update and delivery evidence',status:'Complete',evidence:value('evidence'),pioDistribution:{schema:1,outreachEvent:e.record.id,outreachEntity:e.record.entity,approvalEvent:a.id,distributedAt:date(value('distributedAt')),channels:lines(value('channels')),partners:lines(value('partners')),receipt:value('receipt'),nextUpdate:date(value('nextUpdate'))}},{incident:e.incident,entity:e.entity,supersedes:e.distribution?headIds('coordination',e.entity):[]});
        }
      }
      await commit(e.event);if(editor!==e||e.generation!==epoch)return;editor=null;render();message('Private PIO record saved. History is preserved; no alert was sent by this app.');
    }catch(err){if(editor===e)error.textContent=err.message+(e.event?' Retry retains this event ID. Cancel and reopen to change the contents.':'');}
    finally{if(e.generation===epoch)saveBusy=false;if(editor===e){for(const b of host.querySelectorAll('calcite-button'))b.disabled=false;renderPopulationEditor(e);renderAfnEditor(e);}}
  }
  async function reviewZones(force=false){
    if(reviewPending)return;const generation=epoch,incident=getState().incident,token={};reviewPending=token;
    const signature=currentRows().map(s=>s.record.id).join(':');
    try{const result=await monitor.check(currentRows(),{force});if(generation!==epoch||incident!==getState().incident||signature!==currentRows().map(s=>s.record.id).join(':'))return;zoneNotices=result.notices;reviewChecked=result.checked;reviewSignature=signature;reviewPending=null;onSourceChange();}
    catch(e){if(e.name!=='AbortError'&&generation===epoch)message('PIO source check interrupted. Retry Check outreach sources; applicability is unknown.');}
    finally{if(reviewPending===token)reviewPending=null;}
  }
  function render(){
    if(editor)return;host.replaceChildren();const state=getState(),bar=el('div');bar.className='section-toolbar';bar.append(button(request?'Create zone PIO handoff snapshot':'Create PIO handoff snapshot',()=>onBriefing(request?{zoneKey:request.key}:{}),permitted('briefings')&&state.periodReady&&(!request||currentRows().some(s=>s.record.payload.pioOutreach.zone.key===request.key))),button(entry?'New outreach for '+entry.zone.name:'New outreach record',()=>begin('plan'),permitted('coordination')&&(!request&&!entryError||!!entry)),button('Check outreach sources',()=>void reviewZones(true),!!state.incident&&!reviewPending));host.append(bar);renderEntry();
    host.append(el('p','Private exercise records · messages, approvals and manual distribution receipts are separate. This workspace does not send public alerts or modify evacuation orders.'));
    host.append(populationSourceGuide());if(zoneError)host.append(el('p','County zone source unavailable: '+zoneError+'. Current applicability is unknown.'));
    if(!state.incident){host.append(el('p','Connect county AGOL and select an exercise incident to save outreach. The fictional tabletop can be used to rehearse the full workflow.'));return;}
    const allRows=currentRows(),rows=request?allRows.filter(s=>s.record.payload.pioOutreach.zone.key===request.key):allRows,signature=allRows.map(s=>s.record.id).join(':');if(signature!==reviewSignature||!reviewChecked||Date.now()-reviewChecked>=300000)void reviewZones();
    const status=el('p',!allRows.some(s=>s.active)?'No active outreach to monitor. Closed outreach and its saved history remain unchanged.':reviewChecked?`Outreach sources checked ${time(reviewChecked)}. Active outreach is rechecked every five minutes while this page is visible. Approved messages and saved evidence are unchanged.`:'Checking current sources for active outreach. Approved messages and saved evidence are unchanged.');status.setAttribute('role','status');host.append(status);
    for(const n of zoneNotices.filter(n=>n.category==='Data failures'))host.append(el('strong',n.change));
    if(!rows.length)host.append(el('p',request?'No outreach records for this zone in the selected incident. Create a new draft after the zone check completes.':'No outreach records for this incident. Start with a county zone, a responsible PIO and one message language.'));
    for(const s of rows){const r=s.record,p=r.payload,o=p.pioOutreach,article=el('article');article.className='pio-record';article.append(el('h3',`${p.location} · ${p.title}`),el('p',`${s.conflict?'CONFLICT · ':''}${closed(p)?'Closed outreach':s.approved?'Exact message approval recorded':'Draft / approval required'} · ${p.status} · owner ${p.owner}`),el('p',`Next update ${time(s.nextUpdate)}${s.overdue?' · OVERDUE':''} · last distribution ${s.last?time(s.last.payload.pioDistribution.distributedAt):'Not recorded'}`));
      const allRecordNotices=zoneNotices.filter(n=>n.evidence?.outreachEvent===r.id),recordNotices=pendingPioSourceReviews(allRecordNotices,state.records.reviews,team);if(allRecordNotices.length&&!recordNotices.length)article.append(el('p','Source differences reviewed by this team for the current revision · approved message unchanged.'));if(recordNotices.length){const notice=el('calcite-notice');notice.open=true;notice.kind='warning';notice.scale='s';const title=el('span','Source review needed');title.slot='title';const detail=el('span',recordNotices.map(n=>n.change).join('; ')+'. Approved message unchanged.');detail.slot='message';notice.append(title,detail);article.append(notice);}article.append(el('p',`Confirmed languages: ${o.languages.join(', ')||'Unconfirmed'} · message language: ${o.messageLanguage}`));const more=el('details');more.append(el('summary','Message, partners & source evidence'),el('p',s.approved?'Approved text · exact current version':'Recorded text · this version has no current message approval'),el('blockquote',o.message),el('p','Channels: '+o.channels.join('; ')),el('p','Partners: '+(o.partners.join('; ')||'Not recorded')),el('p',`Language source: ${o.confirmedBy||'Unconfirmed'} · ${time(o.confirmedAt)} · ${o.languageEvidence||'No evidence'}`),el('p',`County status at query: ${ZONE_STATUS[o.zone.status]||'Unknown'} · ${time(o.zone.checked)} · issue time unavailable`),el('p',`Applicability confirmed by ${o.zoneVerifiedBy||'Unconfirmed'} · ${time(o.zoneVerifiedAt)} · ${o.zoneEvidence||'No evidence'}`),el('p',o.analysisNotes||'No additional planning evidence recorded.'),el('p',`Recorded by ${r.author} · ${time(r.created)} · version ${r.id}`));
      if(o.populationMapEvidence)article.append(el('p',populationMapSummary(o.populationMapEvidence)),populationMapDetails(o.populationMapEvidence));else article.append(el('p',populationEvidenceSummary(o.populationEvidence)));if(o.populationEvidence){if(o.populationEvidence.zone.revision!==o.zone.revision)article.append(el('strong','Population evidence uses an older county zone revision; review before applying it to the current boundary/status.'));article.append(populationDetails(o.populationEvidence,o.zone));}
      article.append(el('p',afnEvidenceSummary(o.afnEvidence)));if(o.afnEvidence){if(o.afnEvidence.zone.revision!==o.zone.revision)article.append(el('strong','AFN evidence uses an older county zone revision; verify applicability before using it.'));article.append(afnDetails(o.afnEvidence,o.zone));}
      const query=new URL('https://cof-rylopez.github.io/fresno-storm-watch/');query.search=new URLSearchParams({view:'watch',population:'1',zone:o.zone.name});more.append(link('Open latest population calculation for this zone',query.href),el('br'),link('Official county evacuation reference',CARE_SOURCES.zoneItem));if(s.approval)more.append(el('p',`${s.approval.payload.status} · documented approver ${s.approval.payload.decisionBy} · ${time(s.approval.payload.decidedAt)} · recorded by ${s.approval.author} · ${s.approval.payload.evidence}`));
      for(const dh of s.distributionHeads){const d=dh.record,v=d.payload.pioDistribution;more.append(el('p',`${s.distributions.some(r=>r.id===d.id)?'Recorded distribution':'VERIFICATION NEEDED'} · ${time(v.distributedAt)} · ${v.receipt} · ${v.channels.join('; ')} · ${d.payload.evidence} · exact message ${v.outreachEvent} · recorded by ${d.author}`));const plan=state.records.coordination.find(r=>r.id===v.outreachEvent);if(plan)more.append(button('Correct distribution record',()=>begin('distribution',plan,d),permitted('coordination')));}if(s.unverifiedDistributions)more.append(el('p','Some distribution records have conflicts or cannot be linked to documented approval; they do not establish distribution.'));article.append(more);
      const controls=el('div');controls.className='button-row';controls.append(button('Update outreach',()=>begin('plan',r),permitted('coordination')),button('Record approval / withdrawal',()=>begin('approval',r),permitted('approvals')&&!s.conflict&&!closed(p)),button('Record distribution',()=>begin('distribution',r),permitted('coordination')&&s.approved&&!closed(p)),button('Create zone PIO handoff',()=>onBriefing({zoneKey:o.zone.key}),permitted('briefings')&&state.periodReady));article.append(controls);host.append(article);
    }
  }
  setInterval(()=>{if(!document.hidden&&getState().incident&&!editor)void reviewZones();},300000);
  return {render,checkSources(){if(!editor)return reviewZones();},sourceNotifications(){return zoneNotices;},clear(){epoch++;entryAbort?.abort();entryPending=null;entry=null;entryError=requestError;entryFocusPending=!!request;monitor.clear();abort?.abort();zones=null;zoneError=null;editor?.populationAbort?.abort();editor?.afnAbort?.abort();zonePending=null;reviewPending=null;reviewSignature=null;reviewChecked=null;zoneNotices=[];editor=null;saveBusy=false;host.replaceChildren();}};
}
