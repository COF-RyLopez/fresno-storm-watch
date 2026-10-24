import {drainageReviewGroups,drainageVicinity,assessDrainageReviews,freezeDrainageReview} from './drainage-review-model.js?v=0.43.0';
import {unmatchedPumpReadiness,pumpBinding,bindingKey} from './pump-readiness-model.js';
import {createPumpSummary} from './pump-summary-ui.js?v=0.44.0';
import {fetchDrainageRain} from './drainage-review-data.js';
import {drainageReviewExercise} from './drainage-review-exercise.js?v=0.42.0';
import {reportHealth} from './source-health.js?v=0.42.0';
import {DRAINAGE_URL,DRAINAGE_MAX_AGE} from './drainage-model.js';
import {ROAD_MAP} from './roads.js';
import {POWER_STATES,POWER_LINKS} from './power-model.js';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(label,fn)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};

/** Private inventory and correlation results live in this tab only, including during asynchronous joins. */
export function createDrainageReviews({config,timeZone,exercise=false,exerciseData=null,onSummary=()=>{},onConnect=()=>{},onFacilities=()=>{},onMap=()=>{},onRecord=()=>{},onRoad=()=>{},onFacility=()=>{},onPower=()=>{},onRainfall=()=>{},onCapture=()=>{},onAssign=()=>{},onClear=()=>{},onReadiness=()=>{},renderReadiness=()=>{}}){
  let snapshot=null,roads=null,facilities=null,rain=null,map=null,model=[],generation=0,queued=false,busy=false,error=null,selected=null,facilitySignature='',rainPromise=null,rainAbort=null,listSignature='';
  let power=null,previousPower=new Map(),powerSignature='',powerEpoch=0;
  let readinessState=null,readinessEpoch=0,unmatchedReadiness=0,selectedPump=null;
  // Legacy closure dates can be several years old; always show the year beside the forecast window.
  const dateFormat=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZone,timeZoneName:'short'});
  const time=v=>Number.isFinite(v)?dateFormat.format(v):'Unknown',miles=v=>(v/1609.344).toFixed(2);
  const capture=row=>({...freezeDrainageReview(row),exercise,classification:exercise?'Fictional exercise planning cue':'Private planning review cue'});
  const sourceButton=(label,fn)=>{const b=button(label,fn);b.disabled=exercise;return b;};
  const pumpSummary=createPumpSummary({host:$('pump-readiness-summary'),timeZone,exercise,onInspect:(groupId,key)=>inspect(groupId,key)});
  $('pump-summary-jump').onclick=()=>{const target=snapshot?.connected?$('pump-readiness-summary'):$('drainage-area-watch');target.scrollIntoView({block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});};
  if(exercise)({snapshot,roads,facilities,rain,power}=exerciseData||drainageReviewExercise());
  function clear(){generation++;powerEpoch++;rainAbort?.abort();rainPromise=null;model=[];previousPower.clear();map?.setDrainagePowerKeys([]);cachedGroups=[];cachedVicinity=null;selected=null;selectedPump=null;busy=false;error=null;listSignature='';$('drainage-review-detail').replaceChildren();$('drainage-review-feedback').textContent='';$('drainage-review-evidence').removeAttribute('open');onClear();onSummary(null);render();}
  async function ensureRain(force=false){
    if(exercise)return rain;
    if(!force&&rain&&!rain.error&&Date.now()-rain.checked<300000)return rain;
    if(rainPromise)return rainPromise;
    const controller=new AbortController();rainAbort=controller;
    const request=fetchDrainageRain({clip:shape=>map.clipDrainageRain(shape),signal:controller.signal}).then(value=>{if(!controller.signal.aborted)rain=value;return value;}).catch(e=>{if(controller.signal.aborted)throw e;rain={cycle:null,features:[],checked:null,error:e.message};return rain;}).finally(()=>{if(rainPromise===request)rainPromise=null;});
    rainPromise=request;return request;
  }
  function assess(){if(!snapshot?.connected){model=[];onSummary(null);return;}try{model=assessDrainageReviews({groups:cachedGroups,vicinity:cachedVicinity,snapshot,rain,roads,facilities,power,previousPower,readinessState,config},Date.now());previousPower=new Map(model.flatMap(r=>r.pumpPower.map(p=>[p.key,p])));unmatchedReadiness=unmatchedPumpReadiness(snapshot.rows,readinessState);map?.setDrainagePowerKeys([...new Set(model.flatMap(r=>r.pumpPower.flatMap(p=>p.reviews.filter(m=>m.returned).map(m=>m.row.key))))],[...previousPower.values()].filter(p=>p.review||p.readinessReview).map(p=>p.key));onSummary(model.filter(r=>r.review).length,[...previousPower.values()].filter(p=>p.review).length,[...previousPower.values()].filter(p=>p.readiness.needsReview||!p.inventoryCurrent).length+unmatchedReadiness);}catch(e){model=[];map?.setDrainagePowerKeys([]);error=e.message;onSummary(null);}}
  let cachedGroups=[],cachedVicinity=null;
  function schedule(){generation++;if(!snapshot?.connected){clear();return;}model=[];cachedVicinity=null;onSummary(null);busy=true;render();if(queued)return;queued=true;queueMicrotask(()=>{queued=false;void rebuild();});}
  async function rebuild(){
    if(!snapshot?.connected||!map)return;
    const epoch=generation,current=()=>generation===epoch&&!!snapshot?.connected;busy=true;error=null;render();
    try{cachedGroups=drainageReviewGroups(snapshot.rows);const groups=cachedGroups;const [vicinity]=await Promise.all([drainageVicinity(groups,roads,facilities,(...args)=>map.findNearbySearch(...args),current),ensureRain()]);if(!current()||!vicinity)return;cachedVicinity=vicinity;assess();if(selected&&$('drainage-review-evidence').hasAttribute('open'))$('drainage-review-evidence').description='Sources refreshed · reopen Inspect for updated evidence';}
    catch(e){if(current()){error='Drainage review unavailable. '+e.message;model=[];onSummary(null);}}
    finally{if(current()){busy=false;render();}}
  }
  function render(){
    const connected=!!snapshot?.connected,review=model.filter(r=>r.review);
    pumpSummary.setData({groups:model,connected,busy:busy||!map,error,unmatched:unmatchedReadiness,readinessState});
    $('drainage-review-status').textContent=exercise?'EXERCISE · fictional basin, pump, utility, road, facility and rainfall records':!connected?(snapshot?.error||'Private review is not assessed. Sign in and load the FMFCD inventory; proposed assets are excluded.'):error||!map?'Drainage map / review is initializing.':busy?'Matching rainfall and nearby records. Private review count is checking.':`${review.length} drainage groups to review / ${model.length} existing inventory groups · ${[...previousPower.values()].filter(p=>p.review).length} pump records need power verification · ${[...previousPower.values()].filter(p=>p.readiness.needsReview||!p.inventoryCurrent).length} readiness follow-ups${unmatchedReadiness?` + ${unmatchedReadiness} saved associations need source rematching`:''} · evaluated ${time(Date.now())}. Group counts are not physical basin / pump counts.`;
    if(error)$('drainage-review-status').textContent=error;
    if(snapshot?.busy&&!connected)$('drainage-review-status').textContent='Loading FMFCD; complete the county Enterprise sign-in if prompted.';
    $('drainage-review-connect').textContent=connected?'Recheck drainage review':'Load FMFCD for Area Watch';$('drainage-review-connect').disabled=exercise||busy||snapshot?.busy;$('drainage-review-connect').loading=busy||!!snapshot?.busy;
    $('drainage-review-facilities').hidden=!!facilities?.connected;$('drainage-review-facilities').disabled=exercise;
    $('drainage-review-controls').hidden=!model.length;
    const query=String($('drainage-review-search').value||'').trim().toLowerCase(),all=$('drainage-review-filter').value==='all';
    if(connected&&!exercise)reportHealth('drainage-rain','WPC rainfall geometry for drainage review',{checked:rain?.checked,error:rain?.error||null,maxAgeMs:config.weatherCheckMaxAgeMs});
    const visible=model.filter(r=>(all||r.review)&&r.name.toLowerCase().includes(query)),host=$('drainage-review-list'),key=JSON.stringify([query,all,busy,connected,model.map(r=>[r.id,r.change,r.cycle?.issue,r.cycle?.start,r.cycle?.end,r.records.length,r.roads.length,r.facilities.length,r.gaps,r.combined,r.pumpPower.map(p=>[p.label,p.maximum,p.readiness.label,p.readiness.event?.id,p.readinessReview,p.reviews.map(m=>[m.row.key,m.row.revision,m.problem,m.timing.relation,m.followup])])])]);if(key===listSignature)return;listSignature=key;host.replaceChildren();
    for(const row of visible.slice(0,6)){const section=el('article');section.className='drainage-review-row';const action=button(row.name,()=>inspect(row.id));action.disabled=!map;section.append(action,el('p',row.change),el('p',row.cycle?`Rainfall accumulation window: ${time(row.cycle.start)} → ${time(row.cycle.end)}`:'Rainfall timing unknown'),el('p',`${row.records.filter(r=>r.kind==='basin').length} existing basin polygon(s) · ${row.records.filter(r=>r.kind==='pump').length} existing pump record(s) · ${row.roads.length} nearby road / ${facilities?.connected?row.facilities.length:'unassessed'} facility records`));if(row.powerReview)section.append(el('p',`${row.pumpPower.filter(p=>p.review).length} pump record(s) need power / backup verification · operating state unknown`));if(row.readinessReview)section.append(el('p',`${row.pumpPower.filter(p=>p.readinessReview).length} pump readiness confirmation(s) need follow-up`));section.append(el('small',row.gaps.length?`${row.gaps.length} evidence gaps · ${row.combined||row.powerRain?'readiness review; timing and impacts unconfirmed':'verify before planning resources'}`:'Review source dates; current operation remains unconfirmed'));host.append(section);}
    if(visible.length>6)host.append(el('p',`Showing six of ${visible.length} groups. Search an inventory code to narrow the list. Pump power / readiness reviews, rainfall and nearby records are ordered for review, not ranked by risk.`));
    if(connected&&!busy&&!visible.length)host.append(el('p','No review groups returned in this display filter. This is not an all-clear; check inventory and forecast coverage.'));
  }
  function renderPumpPower(host,row,pumpKey=null){
    host.append(el('h3','Pump power and backup readiness'));
    if(!row.pumpPower.length){host.append(el('p','No existing pump record in this group. A basin overlap does not establish a pump power impact.'));return;}
    host.append(el('p','Only utility polygons containing the mapped pump point are matched, using the next 72 hours for the review queue. Later published windows remain separate context. No electrical circuit or service relationship is confirmed. Readiness confirmations are separate owner reports in private exercise storage; pump operation remains unconfirmed.'));
    const stamp=value=>Number.isFinite(value?.time)?time(value.time):value?.text?`${value.text} · publisher text / time zone unverified`:'Unknown';
    for(const pump of [...row.pumpPower].sort((a,b)=>Number(b.key===pumpKey)-Number(a.key===pumpKey))){
      host.append(el('h4',pump.name),el('p',pump.label),el('p',`Pump operation: unconfirmed. Rainfall label at this pump: ${pump.maximum===null?'unknown':pump.maximum.toFixed(2)+' inches liquid equivalent'}${pump.rainCurrent?'':' · rainfall check unavailable / stale'}.`));
      renderReadiness(host,pump);
      const record=row.records.find(r=>r.key===pump.key),formHost=el('div'),association=bindingKey(pumpBinding(record));
      const current=()=>snapshot?.connected&&!snapshot.error&&Date.now()-snapshot.checked<=DRAINAGE_MAX_AGE&&snapshot.rows.some(r=>r.key===record.key&&r.category==='existing'&&bindingKey(pumpBinding(r))===association);
      host.append(button('Confirm pump readiness',()=>onReadiness(formHost,record,current)),formHost);
      if(!exercise)host.append(sourceButton('Inspect pump inventory',()=>onRecord(pump.key)));
      if(!pump.inventoryCurrent)host.append(el('p','FMFCD location retrieval is overdue / unavailable; recheck before using this match.'));
      if(!pump.reviews.length)host.append(el('p','No current utility-area review returned at this pump. This does not establish electrical service or available power.'));
      for(const match of pump.reviews){
        const utility=match.row,label=`${utility.utility} · ${POWER_STATES[utility.status]} · ${utility.name}`;
        host.append(el('p',label+(match.returned?'':' · no longer returned at this pump')),el('p',match.timing.label));
        if(match.returned&&!exercise)host.append(sourceButton('Inspect utility record',()=>onPower(utility.key)));
        host.append(el('p',`Utility updated ${stamp(utility.updated)} · source retrieved ${time(Date.parse(match.sourceRetrieved))}. Start ${stamp(utility.start)} · end ${stamp(utility.end)} · estimated restoration ${stamp(utility.restoration)}. An estimate does not confirm restored pump power.`));
        if(match.problem)host.append(el('p','Verification needed: '+match.problem));
        if(match.followup)host.append(el('p','A previous overlap changed or disappeared. Keep the power follow-up open until the pump owner verifies conditions.'));
        const source=el('a','Official '+utility.utility+' power source');source.href=Object.values(POWER_LINKS).includes(utility.official)?utility.official:POWER_LINKS[utility.utility==='PG&E'?'pge':'sce'];source.target='_blank';source.rel='noopener noreferrer';host.append(source);
      }
    }
    const gaps=[...new Set(row.pumpPower.flatMap(p=>p.evidence.gaps))],pointOnly=Math.max(...row.pumpPower.map(p=>p.evidence.pointOnly));
    if(gaps.length){const details=el('details');details.append(el('summary',`Utility coverage checks · ${gaps.length} unresolved`));for(const gap of gaps)details.append(el('p',gap));host.append(details);}
    if(pointOnly)host.append(el('p',`${pointOnly} active point-only utility record(s) in the county feed cannot establish pump coverage; no distance buffer is inferred.`));
    host.append(el('p','Review resource lead time against the full rainfall accumulation window with NWS. The window start is not a predicted rain arrival time. Nearby generator or fuel records do not confirm backup supply to a pump.'));
  }
  function inspect(id,pumpKey=null){
    const row=model.find(r=>r.id===id);if(!row)return;selected=id;selectedPump=pumpKey;const epoch=generation,powerVersion=powerEpoch,readinessVersion=readinessEpoch,host=$('drainage-review-detail');host.replaceChildren();$('drainage-review-evidence').heading=(exercise?'EXERCISE · ':'')+row.name;if(pumpKey)$('drainage-review-evidence').heading=(exercise?'EXERCISE - ':'')+(row.pumpPower.find(p=>p.key===pumpKey)?.name||row.name);$('drainage-review-evidence').description='Private planning review · no deployment decision';
    host.append(el('p',`Evidence captured ${time(Date.now())}. Reopen this group after sources refresh.`),el('p',row.change));renderPumpPower(host,row,pumpKey);host.append(el('h3','Rainfall timing'),el('p',`WPC Days 1–3 · issued ${time(row.cycle?.issue)} · valid ${time(row.cycle?.start)} → ${time(row.cycle?.end)} · checked ${time(row.checked)}`),el('p',row.maximum===null?'Intersecting rainfall amount unknown.':`Highest intersecting WPC polygon label: ${row.maximum.toFixed(2)} inches liquid equivalent${row.rainCurrent?'':' · stale / unavailable'}.`),el('p','This is a 72-hour accumulation window, not storm onset or peak timing. Polygon labels are not basin averages, runoff, water level or flood depth.'),sourceButton('Show this rainfall window',()=>{onRainfall();map?.setLayerPreference('weather',true);}));
    host.append(el('h3','FMFCD inventory'),el('p',`Retrieved ${time(row.inventoryChecked)}. Source maintenance age, pump operation and available basin storage remain unconfirmed. Shared source codes do not establish hydraulic connectivity.`));
    for(const [label,href]of [['WPC forecast source','https://www.wpc.ncep.noaa.gov/#page=qpf'],['NWS Hanford','https://www.weather.gov/hnx/'],['County road map',ROAD_MAP],['FMFCD source inventory',DRAINAGE_URL]]){const a=el('a',label);a.href=href;a.target='_blank';a.rel='noopener noreferrer';host.append(a);}
    for(const record of row.records)host.append(sourceButton(record.name,()=>onRecord(record.key)),el('small',`${record.status} · modified ${time(record.updated)}`));
    host.append(el('h3',`Nearby road records · ${row.roads.length}`),el('p',`Within one mile of the full inventory geometries, using shortest horizontal distance; not travel distance or verified access routes. County source checked ${time(row.roadChecked)}${row.roadCurrent?'':' · failed / missing / overdue'}. Explicitly inactive records are excluded; elapsed-date active records remain for verification.`));
    if(!row.roads.length)host.append(el('p','No nearby road record returned. Missing records do not establish open roads.'));
    for(const i of row.roads.slice(0,12))host.append(sourceButton(`${i.record.kind} · ${i.record.name}`,()=>onRoad(i.key)),el('p',`${i.record.status} · ${miles(i.distanceMeters)} mi · ${i.verification?'verify current status':'publisher status retained'}`),el('p',`Start ${time(i.record.start)} · end ${time(i.record.end)} · ${i.timing}. Updated ${time(i.record.sourceTime)} · edited ${time(i.record.edited)}.`));
    host.append(el('h3',`Authorized county facilities · ${facilities?.connected?row.facilities.length:'unassessed'}`));
    if(!row.facilities.length)host.append(el('p',facilities?.connected?'No loaded facility geometry returned within one mile. Other facilities may be absent.':'Sign in and load the county inventory.'));
    for(const i of row.facilities.slice(0,12)){const s=i.record.site;host.append(sourceButton(s.name,()=>onFacility(i.key)),el('p',`${miles(i.distanceMeters)} mi · owner / department ${s.owner||'unassigned'} · backup power ${s.backup||'unknown; verify'} · inventory retrieved ${time(s.fetched)}${i.current?'':' · old / unverified'}`));}
    if(row.roads.length>12||row.facilities.length>12)host.append(el('p','First 12 nearest records per category shown; group counts include all matches.'));
    host.append(el('h3','Verification and possible prepositioning'),el('p',row.nextReview),el('p','Suggested lead: Planning / Operations with FMFCD and the facility owner. No person is assigned until a private follow-up is saved. No deployment or dispatch is created.'));
    for(const gap of row.gaps)host.append(el('p',gap));
    const actions=el('div');actions.className='drainage-actions';actions.append(button('Assign verification',()=>onAssign(capture(row),host,()=>epoch===generation&&powerVersion===powerEpoch&&readinessVersion===readinessEpoch&&snapshot?.connected)),button('Add to briefing',()=>{if(onCapture(capture(row)))$('drainage-review-feedback').textContent='Private evidence captured in the tab’s unapproved briefing draft.';}));host.append(actions);
    $('drainage-review-evidence').setAttribute('open','');onMap();if(row.powerReview)map?.setLayerPreference('power',true);if(!exercise){onRainfall();map?.setLayerPreference('weather',true);void map?.focusDrainageGroup(pumpKey?[pumpKey]:row.records.map(r=>r.key));}else {map?.setLayerPreference('drainage',true);void map?.focusSearchSelection((row.records.find(r=>r.key===pumpKey)||row.records[0]).geometry);}
  }
  $('drainage-review-connect').onclick=async()=>{if(!snapshot?.connected){await onConnect();return;}rain=null;await onConnect();schedule();};
  $('drainage-review-facilities').onclick=async()=>{await onFacilities();};
  $('drainage-review-search').addEventListener('calciteInputInput',render);$('drainage-review-filter').addEventListener('calciteSelectChange',render);
  setInterval(()=>{if(document.hidden)return;if(snapshot?.connected&&!busy){assess();render();if(!exercise&&(!rain?.checked||Date.now()-rain.checked>=300000))void ensureRain().then(()=>{if(snapshot?.connected){assess();render();}}).catch(()=>{});}},30000);
  window.addEventListener('pagehide',()=>{snapshot=null;clear();});render();
  return {setReadiness(value){readinessState=value;readinessEpoch++;if(snapshot?.connected&&cachedVicinity&&!busy){assess();render();if(selected&&$('drainage-review-evidence').hasAttribute('open'))$('drainage-review-evidence').description='Readiness refreshed · reopen this group for current evidence';}},refreshSelected(){if(selected)inspect(selected,selectedPump);},setPower(value){power=value;const signature=JSON.stringify([value.error,value.feeds.map(f=>[f.id,f.lastSuccess,f.error]),value.rows.map(r=>[r.key,r.revision,r.health])]);if(signature!==powerSignature){powerSignature=signature;powerEpoch++;if(snapshot?.connected&&!busy&&cachedVicinity){assess();render();if(selected&&$('drainage-review-evidence').hasAttribute('open'))$('drainage-review-evidence').description='Utility sources changed · reopen this group for current evidence';}}},setMap(value){map=value;if(exercise)map.setDrainage(snapshot.rows);schedule();},setSnapshot(value){if(exercise)return;const changed=snapshot?.rows!==value.rows||snapshot?.checked!==value.checked||snapshot?.error!==value.error||snapshot?.connected!==value.connected,loading=snapshot?.busy!==value.busy;snapshot=value;if(changed)schedule();else if(loading)render();},setRoads(value){if(exercise)return;const changed=roads?.snapshot!==value.snapshot||roads?.error!==value.error;roads=value;if(changed&&snapshot?.connected)schedule();},setFacilities(value){if(exercise)return;const key=JSON.stringify([value.connected,value.sourceGaps,value.sites.map(i=>[i.site.key,i.site.fetched,i.site.sourceError,i.site.backup,i.review,i.tone])]);facilities=value;if(key!==facilitySignature){facilitySignature=key;if(snapshot?.connected)schedule();}},inspect};
}
