import {drainageReviewGroups,drainageVicinity,assessDrainageReviews,freezeDrainageReview} from './drainage-review-model.js';
import {fetchDrainageRain} from './drainage-review-data.js';
import {drainageReviewExercise} from './drainage-review-exercise.js';
import {reportHealth} from './source-health.js?v=0.41.0';
import {DRAINAGE_URL} from './drainage-model.js';
import {ROAD_MAP} from './roads.js';
const $=id=>document.getElementById(id),el=(tag,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const button=(label,fn)=>{const b=el('calcite-button',label);b.scale='s';b.appearance='outline';b.onclick=fn;return b;};

/** Private inventory and correlation results live in this tab only, including during asynchronous joins. */
export function createDrainageReviews({config,timeZone,exercise=false,onSummary=()=>{},onConnect=()=>{},onFacilities=()=>{},onMap=()=>{},onRecord=()=>{},onRoad=()=>{},onFacility=()=>{},onRainfall=()=>{},onCapture=()=>{},onAssign=()=>{},onClear=()=>{}}){
  let snapshot=null,roads=null,facilities=null,rain=null,map=null,model=[],generation=0,queued=false,busy=false,error=null,selected=null,facilitySignature='',rainPromise=null,rainAbort=null,listSignature='';
  // Legacy closure dates can be several years old; always show the year beside the forecast window.
  const dateFormat=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',timeZone,timeZoneName:'short'});
  const time=v=>Number.isFinite(v)?dateFormat.format(v):'Unknown',miles=v=>(v/1609.344).toFixed(2);
  const capture=row=>({...freezeDrainageReview(row),exercise,classification:exercise?'Fictional exercise planning cue':'Private planning review cue'});
  const sourceButton=(label,fn)=>{const b=button(label,fn);b.disabled=exercise;return b;};
  if(exercise)({snapshot,roads,facilities,rain}=drainageReviewExercise());
  function clear(){generation++;rainAbort?.abort();rainPromise=null;model=[];cachedGroups=[];cachedVicinity=null;selected=null;busy=false;error=null;listSignature='';$('drainage-review-detail').replaceChildren();$('drainage-review-feedback').textContent='';$('drainage-review-evidence').removeAttribute('open');onClear();onSummary(null);render();}
  async function ensureRain(force=false){
    if(exercise)return rain;
    if(!force&&rain&&!rain.error&&Date.now()-rain.checked<300000)return rain;
    if(rainPromise)return rainPromise;
    const controller=new AbortController();rainAbort=controller;
    const request=fetchDrainageRain({clip:shape=>map.clipDrainageRain(shape),signal:controller.signal}).then(value=>{if(!controller.signal.aborted)rain=value;return value;}).catch(e=>{if(controller.signal.aborted)throw e;rain={cycle:null,features:[],checked:null,error:e.message};return rain;}).finally(()=>{if(rainPromise===request)rainPromise=null;});
    rainPromise=request;return request;
  }
  function assess(){if(!snapshot?.connected){model=[];onSummary(null);return;}try{model=assessDrainageReviews({groups:cachedGroups,vicinity:cachedVicinity,snapshot,rain,roads,facilities,config},exercise?snapshot.checked:Date.now());onSummary(model.filter(r=>r.review).length);}catch(e){model=[];error=e.message;onSummary(null);}}
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
    $('drainage-review-status').textContent=exercise?'EXERCISE · fictional basin, pump, road, facility and rainfall records':!connected?(snapshot?.error||'Private review is not assessed. Sign in and load the FMFCD inventory; proposed assets are excluded.'):error||!map?'Drainage map / review is initializing.':busy?'Matching rainfall and nearby records. Private review count is checking.':`${review.length} drainage groups to review / ${model.length} existing inventory groups · evaluated ${time(Date.now())}. Group counts are not physical basin / pump counts.`;
    if(error)$('drainage-review-status').textContent=error;
    if(snapshot?.busy&&!connected)$('drainage-review-status').textContent='Loading FMFCD; complete the county Enterprise sign-in if prompted.';
    $('drainage-review-connect').textContent=connected?'Recheck drainage review':'Load FMFCD for Area Watch';$('drainage-review-connect').disabled=exercise||busy||snapshot?.busy;$('drainage-review-connect').loading=busy||!!snapshot?.busy;
    $('drainage-review-facilities').hidden=!!facilities?.connected;$('drainage-review-facilities').disabled=exercise;
    $('drainage-review-controls').hidden=!model.length;
    const query=String($('drainage-review-search').value||'').trim().toLowerCase(),all=$('drainage-review-filter').value==='all';
    if(connected&&!exercise)reportHealth('drainage-rain','WPC rainfall geometry for drainage review',{checked:rain?.checked,error:rain?.error||null,maxAgeMs:config.weatherCheckMaxAgeMs});
    const visible=model.filter(r=>(all||r.review)&&r.name.toLowerCase().includes(query)),host=$('drainage-review-list'),key=JSON.stringify([query,all,busy,connected,model.map(r=>[r.id,r.change,r.cycle?.issue,r.cycle?.start,r.cycle?.end,r.records.length,r.roads.length,r.facilities.length,r.gaps,r.combined])]);if(key===listSignature)return;listSignature=key;host.replaceChildren();
    for(const row of visible.slice(0,6)){const section=el('article');section.className='drainage-review-row';const action=button(row.name,()=>inspect(row.id));action.disabled=!map;section.append(action,el('p',row.change),el('p',row.cycle?`Rainfall accumulation window: ${time(row.cycle.start)} → ${time(row.cycle.end)}`:'Rainfall timing unknown'),el('p',`${row.records.filter(r=>r.kind==='basin').length} existing basin polygon(s) · ${row.records.filter(r=>r.kind==='pump').length} existing pump record(s) · ${row.roads.length} nearby road / ${facilities?.connected?row.facilities.length:'unassessed'} facility records`),el('small',row.gaps.length?`${row.gaps.length} evidence gaps · ${row.combined?'readiness review; timing and impacts unconfirmed':'verify before planning resources'}`:'Review source dates; current operation remains unconfirmed'));host.append(section);}
    if(visible.length>6)host.append(el('p',`Showing six of ${visible.length} groups. Search an inventory code to narrow the list. Groups with rainfall and nearby records appear first, then alphabetically; this is not a risk ranking.`));
    if(connected&&!busy&&!visible.length)host.append(el('p','No review groups returned in this display filter. This is not an all-clear; check inventory and forecast coverage.'));
  }
  function inspect(id){
    const row=model.find(r=>r.id===id);if(!row)return;selected=id;const epoch=generation,host=$('drainage-review-detail');host.replaceChildren();$('drainage-review-evidence').heading=(exercise?'EXERCISE · ':'')+row.name;$('drainage-review-evidence').description='Private planning review · no deployment decision';
    host.append(el('p',`Evidence captured ${time(Date.now())}. Reopen this group after sources refresh.`),el('p',row.change),el('h3','Rainfall timing'),el('p',`WPC Days 1–3 · issued ${time(row.cycle?.issue)} · valid ${time(row.cycle?.start)} → ${time(row.cycle?.end)} · checked ${time(row.checked)}`),el('p',row.maximum===null?'Intersecting rainfall amount unknown.':`Highest intersecting WPC polygon label: ${row.maximum.toFixed(2)} inches liquid equivalent${row.rainCurrent?'':' · stale / unavailable'}.`),el('p','This is a 72-hour accumulation window, not storm onset or peak timing. Polygon labels are not basin averages, runoff, water level or flood depth.'),sourceButton('Show this rainfall window',()=>{onRainfall();map?.setLayerPreference('weather',true);}));
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
    const actions=el('div');actions.className='drainage-actions';actions.append(button('Assign verification',()=>onAssign(capture(row),host,()=>epoch===generation&&snapshot?.connected)),button('Add to briefing',()=>{if(onCapture(capture(row)))$('drainage-review-feedback').textContent='Private evidence captured in the tab’s unapproved briefing draft.';}));host.append(actions);
    $('drainage-review-evidence').setAttribute('open','');onMap();if(!exercise){onRainfall();map?.setLayerPreference('weather',true);void map?.focusDrainageGroup(row.records.map(r=>r.key));}else void map?.focusSearchSelection(row.records[0].geometry);
  }
  $('drainage-review-connect').onclick=async()=>{if(!snapshot?.connected){await onConnect();return;}rain=null;await onConnect();schedule();};
  $('drainage-review-facilities').onclick=async()=>{await onFacilities();};
  $('drainage-review-search').addEventListener('calciteInputInput',render);$('drainage-review-filter').addEventListener('calciteSelectChange',render);
  setInterval(()=>{if(document.hidden)return;if(snapshot?.connected&&!busy){assess();render();if(!exercise&&(!rain?.checked||Date.now()-rain.checked>=300000))void ensureRain().then(()=>{if(snapshot?.connected){assess();render();}}).catch(()=>{});}},30000);
  window.addEventListener('pagehide',()=>{snapshot=null;clear();});render();
  return {setMap(value){map=value;schedule();},setSnapshot(value){if(exercise)return;const changed=snapshot?.rows!==value.rows||snapshot?.checked!==value.checked||snapshot?.error!==value.error||snapshot?.connected!==value.connected,loading=snapshot?.busy!==value.busy;snapshot=value;if(changed)schedule();else if(loading)render();},setRoads(value){if(exercise)return;const changed=roads?.snapshot!==value.snapshot||roads?.error!==value.error;roads=value;if(changed&&snapshot?.connected)schedule();},setFacilities(value){if(exercise)return;const key=JSON.stringify([value.connected,value.sourceGaps,value.sites.map(i=>[i.site.key,i.site.fetched,i.site.sourceError,i.site.backup,i.review,i.tone])]);facilities=value;if(key!==facilitySignature){facilitySignature=key;if(snapshot?.connected)schedule();}},inspect};
}
