import {isPio,validatePioPayload,validatePioApproval,validatePioEvent,pioNotifications,pioBriefingLines} from './pio-model.js?v=0.73.0-r1';
import {validatePumpReadiness} from './pump-readiness-contract.js';
import {validatePumpTask} from './pump-task-contract.js';
/** Append-only EOC records. No source cue changes activation or official status. */
export const LEVELS=['Duty Officer monitoring','Level 3 minimum','Level 2 partial','Level 1 full'];
export const AUTHORITIES=['CAO / Director of Emergency Services','Public Health Director / Assistant Director','County Emergency Manager'];
export const COLLECTIONS=['incidents','periods','reports','verifications','coordination','checklists','staging','briefings','approvals','references','reviews'];
export const CHECKS=['Staffing','Communications','Source coverage','Partner coordination','Briefing preparation'];
export const PLAN_URL='https://fresnocounty.legistar.com/View.ashx?M=F&ID=13374832&GUID=3C309AAE-B5AC-4764-8293-946B62BAB68F';
export const ROLE_VIEWS=['Management','Planning / Intelligence','Operations','Public Information'];
export const emptyRecords=()=>Object.fromEntries(COLLECTIONS.map(k=>[k,[]]));
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');}
const required=(data,fields)=>{for(const f of fields)if(data[f]===null||data[f]===undefined||String(data[f]).trim()==='')throw new Error(`${f} is required.`);};
const oneOf=(value,values,label)=>{if(!values.includes(value))throw new Error(`${label} is not recognized.`);};
const time=(v,label)=>{if(!Number.isFinite(v)||v<=0)throw new Error(`${label} must include a valid date and time.`);};
export function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function validatePayload(collection,p){
  oneOf(collection,COLLECTIONS,'Record collection');
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Record data is required.');
  if(canonical(p).length>60000)throw new Error('Record exceeds the 60,000-character limit. Reduce the selected briefing content.');
  if(collection==='incidents'){required(p,['name','level','authority','decisionBy','evidence']);oneOf(p.level,LEVELS,'Activation level');oneOf(p.authority,AUTHORITIES,'Decision authority');time(p.effective,'Effective time');if(p.effective>Date.now()+60000)throw new Error('Record an effective decision; future activation is not scheduled by this app.');}
  else if(collection==='periods'){required(p,['label','objectives']);time(p.start,'Period start');time(p.end,'Period end');time(p.nextBriefing,'Next briefing');if(p.end<=p.start)throw new Error('Operational period end must follow its start.');}
  else if(collection==='reports'){required(p,['location','condition','evidence','requestedFollowup']);time(p.observed,'Observation time');if(p.observed>Date.now()+300000)throw new Error('An observation cannot be in the future.');if(p.latitude!==null||p.longitude!==null){if(!Number.isFinite(p.latitude)||!Number.isFinite(p.longitude)||p.latitude<35||p.latitude>38.5||p.longitude< -122||p.longitude> -117)throw new Error('Use WGS84 coordinates near Fresno County, or leave both coordinates blank.');}}
  else if(collection==='verifications'){required(p,['reportEvent','finding','evidence']);oneOf(p.outcome,['Confirmed','Corrected','Unable to verify'],'Verification outcome');time(p.verifiedAt,'Verification time');}
  else if(collection==='coordination'){required(p,['title','location','owner','nextReview']);oneOf(p.kind,['Follow-up','Decision','Information gap'],'Coordination kind');oneOf(p.status,['Open','In progress','Complete','Canceled'],'Coordination status');time(p.due,'Due time');if(['Complete','Canceled'].includes(p.status))required(p,['evidence']);if(p.pumpTask)validatePumpTask(p);if(isPio(p))validatePioPayload(p);}
  else if(collection==='checklists'){if(p.kind==='pump-readiness')validatePumpReadiness(p);else {oneOf(p.check,CHECKS,'Readiness check');oneOf(p.status,['Not started','In progress','Complete','Blocked'],'Readiness status');required(p,['owner','evidence']);}}
  else if(collection==='staging'){required(p,['location','owner','evidence']);oneOf(p.status,['Unconfirmed','Owner confirmed','Unavailable'],'Staging status');if(p.status==='Owner confirmed'){time(p.confirmedAt,'Access confirmed time');time(p.validUntil,'Access review due');if(p.validUntil<=p.confirmedAt)throw new Error('Access review must follow confirmation.');}}
  else if(collection==='briefings'){required(p,['title','periodEvent','snapshot','digest']);if(!/^[a-f0-9]{64}$/.test(p.digest))throw new Error('Invalid snapshot digest.');}
  else if(collection==='approvals'){if(p.kind==='pio-outreach')validatePioApproval(p);else{required(p,['briefingEvent','digest','evidence']);oneOf(p.status,['Approved','Withdrawn'],'Approval status');}}
  else if(collection==='references'){required(p,['system','externalId','evidence']);oneOf(p.system,['Cal EOC360','RRS','County system'],'External system');if(!safeLink(p.link))throw new Error('An HTTPS reference link without embedded credentials is required.');time(p.reconciledAt,'Reconciliation time');}
  else if(collection==='reviews'){required(p,['sourceKey','sourceRevision','team']);oneOf(p.action,['Acknowledged','Reopened'],'Review action');}
  return p;
}
/** Unresolved parallel corrections are shown, never silently resolved by client clocks. */
export function heads(records){
  const unique=new Map();
  for(const r of records){if(unique.has(r.id)&&canonical(unique.get(r.id))!==canonical(r))throw new Error('Conflicting duplicate event ID');unique.set(r.id,r);}
  const replaced=new Set([...unique.values()].flatMap(r=>r.supersedes||[]));
  const entities=new Map();for(const r of unique.values())if(!replaced.has(r.id)){const list=entities.get(r.entity)||[];list.push(r);entities.set(r.entity,list);}
  return [...entities.values()].map(list=>({record:[...list].sort((a,b)=>b.created-a.created||b.id.localeCompare(a.id))[0],conflict:list.length>1,heads:list}));
}
export function current(records,entity){const h=heads(records).filter(h=>!entity||h.record.entity===entity);return h.length===1&&!h[0].conflict?h[0].record:null;}
export function verificationFor(report,records){const h=heads(records.filter(v=>v.payload.reportEvent===report.id));if(h.length!==1||h[0].conflict)return null;return h[0].record;}
export function reportStatus(report,records){const v=verificationFor(report,records);return v?v.payload.outcome:'Unverified';}
export function validateEvent(event,records){
  required(event,['id','entity','incident','collection']);validatePayload(event.collection,event.payload);
  if(!Array.isArray(event.supersedes))throw new Error('Correction references are required.');
  const existing=records[event.collection]||[];
  for(const id of event.supersedes){const old=existing.find(r=>r.id===id);if(!old||old.entity!==event.entity||old.incident!==event.incident)throw new Error('Correction must reference the same incident and record.');}
  const prior=heads(existing.filter(r=>r.entity===event.entity)).flatMap(h=>h.heads.map(r=>r.id)).sort();
  if(canonical(prior)!==canonical([...event.supersedes].sort()))throw new Error('This record changed. Refresh and review every current version before saving.');
  if(event.collection==='coordination')for(const old of existing.filter(r=>r.entity===event.entity&&r.payload.pumpTask)){
    if(canonical(old.payload.pumpTask.binding)!==canonical(event.payload.pumpTask?.binding)||old.payload.pumpTask.type!==event.payload.pumpTask?.type)throw Error('A pump assignment cannot be moved to another pump or work type. Create the appropriate separate task.');
  }
  if(event.collection==='verifications'&&!records.reports.some(r=>r.id===event.payload.reportEvent))throw new Error('The report revision is missing.');
  validatePioEvent(event,records,heads);
  if(event.collection==='approvals'&&event.payload.kind!=='pio-outreach'){
    const b=records.briefings.find(r=>r.id===event.payload.briefingEvent);
    if(!b||b.payload.digest!==event.payload.digest)throw new Error('Approval must reference an existing exact briefing snapshot.');
  }
  if(event.collection==='briefings'&&!records.periods.some(r=>r.id===event.payload.periodEvent))throw new Error('An operational period must be recorded before a briefing.');
  return event;
}
export function makeEvent(collection,payload,{incident,entity=crypto.randomUUID(),supersedes=[],id=crypto.randomUUID()}={}){return {id,entity,incident,collection,supersedes,payload:validatePayload(collection,structuredClone(payload))};}
export function buildNotifications(records,sources,now=Date.now()){
  const notices=sources.map(s=>({...s,verification:s.verification||'Publisher information',owner:s.owner||'Unassigned',nextReview:s.nextReview||'Review source and local implications'}));
  for(const h of heads(records.reports)){
    const r=h.record,v=verificationFor(r,records.verifications),status=h.conflict?'Conflicting corrections':v?.payload.outcome||'Unverified';
    notices.push({key:`report:${r.entity}`,revision:r.id+(v?`:${v.id}`:''),category:status==='Confirmed'?'Verified field issues':'Verification queue',location:r.payload.location,change:v?.payload.finding||r.payload.condition,sourceTime:r.payload.observed,verification:status,owner:'Unassigned',nextReview:r.payload.requestedFollowup,evidence:{reportEvent:r.id,report:r.payload,reporter:r.author,submitted:r.created,verification:v?.payload||null,reviewer:v?.author||null}});
  }
  for(const h of heads(records.coordination)){const r=h.record,p=r.payload;if(isPio(p))continue;if(h.conflict||!['Complete','Canceled'].includes(p.status)&&(p.due<now||p.kind!=='Follow-up'))notices.push({key:`followup:${r.entity}`,revision:r.id,category:h.conflict?'Verification queue':p.due<now?'Overdue follow-ups':p.kind==='Decision'?'Decisions awaiting attention':'Information gaps',location:p.location,change:p.title,sourceTime:r.created,verification:h.conflict?'Conflicting versions':p.status,owner:p.owner,nextReview:p.nextReview});}
  notices.push(...pioNotifications(records,heads,now));
  return notices.map(n=>{
    const assignments=heads(records.coordination).filter(h=>h.record.payload.sourceKey===n.key&&!['Complete','Canceled'].includes(h.record.payload.status));
    return {...n,owner:assignments.length?assignments.map(h=>h.record.payload.owner).join(' / '):n.owner,nextReview:assignments.length?assignments.map(h=>h.record.payload.nextReview).join(' / '):n.nextReview};
  });
}
export function reviewState(notice,records,team){const r=current(records.filter(r=>r.payload.sourceKey===notice.key&&r.payload.team===team));return r&&r.payload.sourceRevision===notice.revision?r.payload.action:'Awaiting review';}
export function changeSummary(previous,currentEvidence){const before=new Map((previous||[]).map(n=>[n.key,n]));const after=new Map(currentEvidence.map(n=>[n.key,n]));return [...currentEvidence.filter(n=>!before.has(n.key)||before.get(n.key).revision!==n.revision).map(n=>`${before.has(n.key)?'Changed':'New'} · ${n.location} · ${n.change}`),...[...before.values()].filter(n=>!after.has(n.key)).map(n=>`Absent from this snapshot · ${n.location} · verify disposition/selection; not a clearance`)];}
export async function briefingSnapshot({records,notifications,sourceHealth,period,previous,now=Date.now(),exercise=false,scope='all',pioZoneKey=null}){
  if(!period)throw new Error('Record an operational period first.');
  if(!['all','pio'].includes(scope))throw new Error('Unknown briefing scope.');
  if(pioZoneKey!==null&&(scope!=='pio'||!/^county-zone:\d+$/.test(pioZoneKey)))throw new Error('Choose a county zone for a PIO briefing.');
  if(scope==='pio')notifications=notifications.filter(n=>n.key.startsWith('pio'));
  const scoped=scope==='pio'?{...emptyRecords(),incidents:heads(records.incidents).flatMap(h=>h.heads),periods:[period],coordination:records.coordination.filter(r=>isPio(r.payload)),approvals:records.approvals.filter(r=>r.payload.kind==='pio-outreach'),reviews:records.reviews.filter(r=>r.payload.sourceKey.startsWith('pio'))}:records;
  if(pioZoneKey){
    const plans=scoped.coordination.filter(r=>r.payload.pioOutreach?.zone.key===pioZoneKey),ids=new Set(plans.map(r=>r.id)),entities=new Set(plans.map(r=>r.entity));if(!plans.length)throw new Error('No saved outreach exists for that county zone.');
    const inZone=key=>key==='pio:zone-source'||key.startsWith('pio:afn-source:')||[...entities].some(entity=>key==='pio:'+entity||key==='pio-zone:'+entity||key==='pio-afn:'+entity);
    scoped.coordination=scoped.coordination.filter(r=>ids.has(r.id)||r.payload.pioDistribution&&entities.has(r.payload.pioDistribution.outreachEntity));scoped.approvals=scoped.approvals.filter(r=>ids.has(r.payload.outreachEvent));scoped.reviews=scoped.reviews.filter(r=>inZone(r.payload.sourceKey));notifications=notifications.filter(n=>inZone(n.key));sourceHealth=[];
  }
  const snapshot=structuredClone({schema:1,scope,pioZoneKey,exercise,captured:now,period,incident:current(records.incidents),activationConflict:heads(records.incidents).some(h=>h.conflict),notifications,sourceHealth,changes:changeSummary(previous?.notifications,notifications),records:{...Object.fromEntries(COLLECTIONS.filter(k=>!['briefings','approvals'].includes(k)).map(k=>[k,scoped[k]])),approvals:scoped.approvals.filter(r=>r.payload.kind==='pio-outreach')},handoff:'Manual handoff only — not submitted to Cal OES'});
  return {snapshot,digest:await digest(snapshot)};
}
export function approvalFor(briefing,records){const r=current(records.filter(r=>r.payload.briefingEvent===briefing.id));return r?.payload.digest===briefing.payload.digest?r:null;}
export function briefingText(briefing,approval){
  const p=briefing.payload,s=p.snapshot,t=v=>v?new Date(v).toLocaleString('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'short'}):'Unknown';
  return [s.exercise?'EXERCISE ONLY — FICTIONAL':'PRIVATE COUNTY EOC WORKSPACE',`${approval?.payload.status==='Approved'?'APPROVED SNAPSHOT':'DRAFT / NOT APPROVED'} · ${p.title}`,`Version ${briefing.id} · SHA-256 ${p.digest}`,`Scope: ${s.scope==='pio'?'PIO outreach and manual distribution'+(s.pioZoneKey?' · '+s.pioZoneKey:''):'Selected county EOC evidence'}`,`Evidence selection: ${s.selection?.included??s.notifications.length} included · ${s.selection?.excluded??0} excluded by preparer`,`Captured ${t(s.captured)} · prepared by ${briefing.author}`,`Approval: ${approval?`${approval.payload.status} by ${approval.author} at ${t(approval.created)} · ${approval.payload.evidence}`:'Pending'}`,`Incident: ${s.incident?.payload.name||'Unconfirmed'} · ${s.incident?.payload.level||'Activation status unconfirmed'}`,`Decision: ${s.incident?`${s.incident.payload.authority} · ${s.incident.payload.decisionBy} · effective ${t(s.incident.payload.effective)} · ${s.incident.payload.evidence}`:'No authorized record'}`,`Period: ${s.period.payload.label} · ${t(s.period.payload.start)} → ${t(s.period.payload.end)} · next briefing ${t(s.period.payload.nextBriefing)}`,`Objectives: ${s.period.payload.objectives}`,'\nCHANGES SINCE PREVIOUS SNAPSHOT',...s.changes,'\nEVIDENCE / INFORMATION GAPS',...s.notifications.map(n=>`${n.category} · ${n.location}\n${n.change}\nSource ${t(n.sourceTime)} · ${n.verification} · owner ${n.owner} · next review ${n.nextReview}${n.link?'\n'+n.link:''}${n.evidence?'\nSaved evidence: '+JSON.stringify(n.evidence,null,2):''}`),...s.notifications.flatMap(n=>(n.evidence?.pumpFollowups||[]).flatMap(p=>[`${p.pump} · ${p.current?'task snapshot':'assignments unassessed'}`,...p.summary.map(r=>`${r.type}: ${r.status}${r.overdue?' · OVERDUE':''} · ${r.assigneeType}: ${r.owner} · due ${t(r.due)}${r.changed?' · readiness changed; review assignment':''} · version ${r.event}`)])),'\nSOURCE HEALTH',...s.sourceHealth.map(h=>`${h.name}: ${h.status} · checked ${t(h.checked)}`),'\nPIO OUTREACH / MANUAL DISTRIBUTION',...pioBriefingLines(s.records,heads,t,s.captured),'\nCOORDINATION / READINESS / STAGING',...['coordination','checklists','staging','references'].flatMap(k=>heads(s.records[k]).filter(h=>!isPio(h.record.payload)).map(h=>`${k}${h.conflict?' — CONFLICT':''}: ${JSON.stringify(h.record.payload)} · recorded by ${h.record.author} at ${t(h.record.created)}`)),'\n'+s.handoff,'Acknowledgement is not task completion or hazard clearance. Source forecasts, FEMA and imagery do not prove safe access.'].join('\n');
}
