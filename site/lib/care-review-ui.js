import {assessCareReviews,careRoadVicinity,freezeCareReview,CARE_ROAD_MILES,careTime} from './care-review-model.js';
import {CARE_SOURCES,ZONE_STATUS} from './care-model.js';
import {POWER_STATES} from './power-model.js';
import {ROAD_MAP} from './roads.js';
import {reportHealth} from './source-health.js';
import {button,el,link,disclosure} from './dom.js';
const $=id=>document.getElementById(id);

/** One countywide assessment, independent of map extent and display filters. */
export function createCareReviews({exercise=false,exerciseNow=Date.now(),onSelect=()=>{},onChange=()=>{},onSummary=()=>{},onRoad=()=>{},onPower=()=>{}}={}){
 let facilities=null,zones=null,power=null,roads=null,sourceErrors={},map=null,vicinity=null,rows=[],previous=new Map(),generation=0,signature='',vicinityError=null,busy=false,listSignature='';
 const now=()=>exercise?exerciseNow:Date.now(),time=careTime;
 const stamp=t=>t?.time?time(t.time):t?.text?`${t.text} · publisher time zone unverified`:'Not supplied';
 function render(){
  const review=rows.filter(r=>r.review),gaps=rows.filter(r=>r.gaps.length),visible=$('care-review-filter').value==='all'?rows:review;
  $('care-review-status').textContent=facilities?`${exercise?'EXERCISE · ':''}${review.length} reviews / ${rows.length} CDPH records · ${gaps.length} with evidence gaps${busy?' · roads checking':''}.`:'Resident-care review unassessed · checking CDPH and county sources.';
  const next=JSON.stringify([visible.map(r=>[r.key,r.reasons,r.gaps.length]),busy]);if(next===listSignature)return;listSignature=next;
  const host=$('care-review-list');host.replaceChildren();
  for(const row of visible.slice(0,6)){const section=el('article');section.className='care-review-row';section.append(button(row.name,()=>onSelect(row.key)),el('p',row.reasons.join(' · ')||'No current spatial review cue; verify source coverage'),el('small',`${row.zones.filter(z=>['Order','Warn'].includes(z.status)).length} Order / Warning record(s) · ${row.powerReviews.length} utility review(s) · ${row.roads.length} nearby road record(s)${row.gaps.length?' · incomplete evidence':''}`));host.append(section);}
  if(visible.length>6)host.append(el('p',`Showing six of ${visible.length} records. Open the full resident-care list to search by name or address.`));
  if(facilities&&!visible.length)host.append(el('p','No resident-care review cue returned in this display. Missing coverage does not establish site power, safe access or absence of an order.'));
 }
 function assess(){
  rows=assessCareReviews({facilities,zones,power,roads,vicinity,previous,sourceErrors},now());previous=new Map(rows.map(r=>[r.key,r]));
  onSummary(facilities?rows.filter(r=>r.review).length:null);render();onChange(rows);
 }
 async function schedule(){
  const next=JSON.stringify([facilities?.rows.map(f=>[f.key,f.geometry]),roads?.snapshot?.checked,roads?.error,!!map]);if(next===signature){assess();return;}signature=next;
  const version=++generation,current=()=>generation===version;vicinity=null;vicinityError=null;busy=!!(facilities&&roads?.snapshot&&map);assess();
  if(!busy)return;
  try{const result=await careRoadVicinity(facilities.rows,roads,(...args)=>map.findNearbySearch(...args),{current});if(!current()||!result)return;vicinity=result;}
  catch{if(!current())return;vicinityError='Resident-care nearby-road comparison failed; distances and access context are unassessed.';}
  finally{if(current()){busy=false;if(!exercise)reportHealth('care:road-distance','Resident-care nearby-road comparison',{checked:vicinity?Date.now():null,error:vicinityError,state:[...vicinity?.values()||[]].some(r=>r.unknown)?'coverage':null,maxAgeMs:420000,detail:'One-mile shortest horizontal distance; not routing or safe access. Some road geometries may be unassessable; inspect the selected facility.'});assess();}}
 }
 function renderInto(host,key){const row=rows.find(r=>r.key===key);host.append(el('h3','Planning review'));
  if(!row){host.append(el('p','Resident-care review not ready. Check the source status.'));return;}
  for(const reason of row.reasons)host.append(el('p',reason));
  if(!row.review)host.append(el('p','No current spatial review cue returned; site conditions remain unverified.'));
  host.append(el('p',row.nextReview),el('p','Backup power, fuel/runtime, responsible facility contact and current occupancy are not supplied by these layers. Confirm them with the facility liaison.'));
  const gaps=disclosure(`Source coverage checks · ${row.gaps.length} unresolved`);for(const gap of row.gaps)gaps.append(el('p',gap));if(vicinityError)gaps.append(el('p',vicinityError));host.append(gaps);
  host.append(el('h4','County evacuation context'),el('p',`County source checked ${time(row.zonesChecked)}${row.zoneCurrent?'':' · failed / overdue'}. Individual issue times are not supplied; confirm current direction with the county.`));
  for(const zone of row.zones)host.append(el('p',`${zone.name} · ${ZONE_STATUS[zone.status]||`Status unverified: ${zone.rawStatus??'not supplied'}`}`));
  if(!row.zones.length)host.append(el('p','No polygon returned at this CDPH point. This does not establish safety or absence of an order.'));
  for(const zone of row.zoneFollowups)host.append(el('p',`${zone.name}: previous concern changed / disappeared. ${ZONE_STATUS[zone.status]||'Prior source status retained'}; verify disposition.`));
  host.append(link('County-maintained evacuation source',CARE_SOURCES.zoneItem),el('h4','Utility areas and backup-power review'));
  if(!row.powerReviews.length)host.append(el('p','No current utility-polygon review returned at this point. Electrical service and site power remain unconfirmed.'));
  for(const match of row.powerReviews){const r=match.row;host.append(el('p',`${r.utility} · ${POWER_STATES[r.status]} · ${r.name}${match.followup?' · prior concern requires follow-up':''}${match.returned?'':' · no longer returned at this point'}`),el('p',`Utility updated ${stamp(r.updated)} · source retrieved ${time(Date.parse(match.sourceRetrieved))}. Start ${stamp(r.start)} · end ${stamp(r.end)} · estimated restoration ${stamp(r.restoration)}.`));if(match.problem)host.append(el('p',`${match.returned?'Verification':'Prior evidence requiring verification'}: ${match.problem}`));const b=button('Inspect utility record',()=>onPower(r.key));b.disabled=exercise||!match.returned;host.append(b,link('Official '+r.utility+' source',r.official));}
  if(row.power.pointOnly)host.append(el('p',`${row.power.pointOnly} active point-only record(s) in the county utility feed cannot establish facility coverage. No buffer or circuit relationship is inferred.`));
  const future=row.power.matches.filter(m=>m.outside);if(future.length)host.append(el('p',`${future.length} utility-area match(es) start beyond the next 72 hours; separate future context, excluded from current review counts.`));
  host.append(el('h4',`Nearby road records · ${row.roads.length}`),el('p',`Within ${CARE_ROAD_MILES} mile of the CDPH point using shortest horizontal distance to the whole road geometry. Not travel distance or a verified facility access route. County source checked ${time(row.roadChecked)}${row.roadCurrent?'':' · failed / overdue'}.`));
  if(!row.nearbyCurrent)host.append(el('p','Nearby-road comparison incomplete / pending; no-road conclusions are unavailable.'));else if(!row.roads.length)host.append(el('p','No current road record returned within one mile. This does not confirm roads are open.'));
  for(const r of row.roads.slice(0,10)){const b=button(`${r.record.kind} · ${r.record.name}`,()=>onRoad(r.key));b.disabled=exercise;host.append(b,el('p',`${r.record.status} · ${(r.distanceMeters/1609.344).toFixed(2)} mi${r.verification?' · verification required':''}`),el('p',`Start ${time(r.record.start)} · end ${time(r.record.end)} · updated ${time(r.record.sourceTime)} · edited ${time(r.record.edited)}.`));}
  if(row.roads.length>10)host.append(el('p',`${row.roads.length-10} more nearby road records; open Roads to inspect.`));
  for(const r of row.roadFollowups)host.append(el('p',`${r.record.name}: prior nearby road record changed / disappeared; verify current disposition and access. Last retained status: ${r.record.status}, end ${time(r.record.end)}.`));
  if(row.backlog.length){const old=disclosure(`${row.backlog.length} historical road date contradictions · excluded from current review counts`);for(const r of row.backlog.slice(0,10))old.append(el('p',`${r.record.name} · end ${time(r.record.end)} · still flagged active in source; verify disposition.`));host.append(old);}
  host.append(link('Official county road map',ROAD_MAP));
 }
 $('care-review-filter').addEventListener('calciteSelectChange',render);
 setInterval(()=>{if(!document.hidden&&facilities)assess();},30000);
 window.addEventListener('pagehide',()=>{generation++;facilities=null;zones=null;power=null;roads=null;vicinity=null;rows=[];previous.clear();});
 render();
 return {setSources(f,z,errors={}){facilities=f;zones=z;sourceErrors={...errors};void schedule();},setPower(value){power=value;assess();},setRoads(value){roads=value;void schedule();},setMap(value){map=value;void schedule();},get:key=>rows.find(r=>r.key===key),freeze:key=>freezeCareReview(rows.find(r=>r.key===key),now()),renderInto};
}
