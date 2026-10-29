import {CARE_SOURCES} from './care-model.js?v=0.56.0-r1';
import {validatePopulationEvidence,populationEvidenceLines} from './population-snapshot-model.js?v=0.68.0';
export const PIO_RECEIPTS=['Sent / posted · receipt unconfirmed','Partner acknowledged','Delivery issue'];
export const isPio=p=>!!(p?.pioOutreach||p?.pioDistribution);
const text=(v,name,max=1500)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(`${name} is required (up to ${max} characters).`);};
const timestamp=(v,name)=>{if(!Number.isFinite(v)||v<=0)throw Error(`${name} needs a valid date and time.`);};
const past=(v,name)=>{timestamp(v,name);if(v>Date.now()+300000)throw Error(`${name} cannot be in the future.`);};
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
const list=(v,name,{empty=false,max=24}={})=>{if(!Array.isArray(v)||v.length>max||!empty&&!v.length)throw Error(`${name} needs a bounded list.`);const seen=new Set();for(const entry of v){text(entry,name,200);const key=entry.trim().toLowerCase();if(seen.has(key))throw Error(`${name} contains a duplicate.`);seen.add(key);}};
export function validatePioPayload(p){
  if(p.pioOutreach&&p.pioDistribution||p.pumpTask&&isPio(p))throw Error('Use one record type per coordination record.');
  if(p.pioOutreach){const o=p.pioOutreach,z=o.zone;
    if(o.schema!==1||p.kind!=='Follow-up'||z?.source!==CARE_SOURCES.zones||!Number.isSafeInteger(z.oid)||z.key!==`county-zone:${z.oid}`||!['Order','Warn','Lifted','unknown'].includes(z.status)||!/^[a-f0-9]{64}$/.test(z.revision||''))throw Error('PIO county zone association is invalid.');
    text(z.name,'County zone name',160);if(p.location!==z.name)throw Error('Outreach location must match the selected county zone.');past(z.checked,'Zone query time');
    list(o.languages,'Confirmed languages',{empty:true});list(o.channels,'Channels');list(o.partners,'Community partners',{empty:true});
    text(o.message,'Message text',8000);text(o.messageLanguage,'Message language',100);if(typeof o.analysisNotes!=='string'||o.analysisNotes.length>2000)throw Error('Keep planning evidence within 2,000 characters.');
    if(o.languages.length){text(o.confirmedBy,'Language confirmation by',200);text(o.languageEvidence,'Language confirmation evidence');past(o.confirmedAt,'Language confirmation time');}
    if(o.zoneVerifiedBy||o.zoneEvidence||o.zoneVerifiedAt){text(o.zoneVerifiedBy,'County applicability confirmation by',200);text(o.zoneEvidence,'County applicability evidence');past(o.zoneVerifiedAt,'County applicability confirmation time');}
    if(o.populationEvidence!==undefined&&o.populationEvidence!==null)validatePopulationEvidence(o.populationEvidence,z);
  }
  if(p.pioDistribution){const d=p.pioDistribution;if(d.schema!==1||p.kind!=='Follow-up'||p.status!=='Complete'||![d.outreachEvent,d.outreachEntity,d.approvalEvent].every(identifier))throw Error('Distribution must reference an exact outreach version and approval.');
    list(d.channels,'Channels used');list(d.partners,'Partners used',{empty:true});past(d.distributedAt,'Distribution time');timestamp(d.nextUpdate,'Next update');if(d.nextUpdate<=d.distributedAt)throw Error('Next update must follow distribution.');if(!PIO_RECEIPTS.includes(d.receipt))throw Error('Choose a distribution / receipt status.');text(p.evidence,'Distribution evidence');
  }
  return p;
}
export function validatePioApproval(p){if(p.kind!=='pio-outreach'||!identifier(p.outreachEvent)||!['Approved','Withdrawn'].includes(p.status))throw Error('Outreach approval reference is invalid.');text(p.evidence,'Approval evidence');text(p.decisionBy,'Documented approver',200);past(p.decidedAt,'Approval decision time');return p;}
export function pioApprovalFor(outreach,records,heads){const candidates=heads((records.approvals||[]).filter(r=>r.incident===outreach.incident&&r.payload.kind==='pio-outreach'&&r.payload.outreachEvent===outreach.id));return candidates.length===1&&!candidates[0].conflict?candidates[0].record:null;}
export function assertReadyForApproval(p){const o=p.pioOutreach;if(!o?.languages.length||!o.languages.some(l=>l.toLowerCase()===o.messageLanguage.toLowerCase()))throw Error('Confirm the message language with a named source before approval.');text(o.zoneVerifiedBy,'County applicability confirmation by',200);text(o.zoneEvidence,'County applicability evidence');past(o.zoneVerifiedAt,'County applicability confirmation time');if(Date.now()-o.zone.checked>900000)throw Error('Recheck the county zone and save a refreshed outreach version before approval.');}
/** Cross-record checks use the freshly retrieved incident, not a role selector or cached form. */
export function validatePioEvent(event,records,heads){
  const p=event.payload,prior=(records.coordination||[]).filter(r=>r.entity===event.entity);
  const correctingDistribution=event.collection==='coordination'&&!!p.pioDistribution&&prior.some(r=>r.payload.pioDistribution);
  if(event.collection==='approvals')for(const old of records.approvals.filter(r=>r.entity===event.entity)){
    if(old.payload.kind==='pio-outreach'||p.kind==='pio-outreach'){
      if(old.payload.kind!==p.kind||old.payload.outreachEvent!==p.outreachEvent)throw Error('Approval history must retain its exact outreach version.');
      if(p.decidedAt<old.payload.decidedAt)throw Error('An approval correction cannot precede the prior recorded decision.');
    }
  }
  if(event.collection==='coordination')for(const old of prior){
    if(old.payload.pioOutreach){if(!p.pioOutreach||old.payload.pioOutreach.zone.key!==p.pioOutreach.zone.key||old.payload.pioOutreach.zone.source!==p.pioOutreach.zone.source||old.payload.pioOutreach.zone.name!==p.pioOutreach.zone.name)throw Error('An outreach history cannot be moved to another county zone. Create a new outreach record.');}
    if(old.payload.pioDistribution&&(!p.pioDistribution||old.payload.pioDistribution.outreachEvent!==p.pioDistribution.outreachEvent||old.payload.pioDistribution.approvalEvent!==p.pioDistribution.approvalEvent))throw Error('A distribution correction must retain its exact message and approval.');
    if(!isPio(old.payload)&&isPio(p))throw Error('Create a new PIO record rather than converting another follow-up.');
  }
  if(event.collection==='approvals'&&p.kind==='pio-outreach'||p.pioDistribution){
    const id=p.pioDistribution?.outreachEvent||p.outreachEvent,outreach=records.coordination.find(r=>r.id===id&&r.incident===event.incident&&r.payload.pioOutreach);
    if(!outreach)throw Error('The exact outreach version is missing.');
    const h=heads(records.coordination.filter(r=>r.entity===outreach.entity&&r.incident===event.incident));if(!correctingDistribution&&(h.length!==1||h[0].conflict||h[0].record.id!==id))throw Error('Outreach changed or has conflicting versions. Review the current message.');
    if(!correctingDistribution&&['Complete','Canceled'].includes(outreach.payload.status))throw Error('Reopen outreach before recording a new approval or distribution.');
    if(p.kind==='pio-outreach'){if(p.status==='Approved')assertReadyForApproval(outreach.payload);}
    else {const d=p.pioDistribution,a=correctingDistribution?records.approvals.find(a=>a.id===d.approvalEvent&&a.incident===event.incident&&a.payload.kind==='pio-outreach'&&a.payload.outreachEvent===outreach.id):pioApprovalFor(outreach,records,heads);if(!a||a.payload.status!=='Approved'||a.id!==d.approvalEvent||d.outreachEntity!==outreach.entity||p.location!==outreach.payload.location)throw Error('Distribution requires the current exact-version approval.');if(d.distributedAt<a.payload.decidedAt)throw Error('Distribution time precedes the documented approval.');for(const key of ['channels','partners'])if(d[key].some(v=>!outreach.payload.pioOutreach[key].includes(v)))throw Error('Distribution channels and partners must match the approved plan.');}
  }
}
export function pioStates(records,{heads,now=Date.now()}){
  const plans=(records.coordination||[]).filter(r=>r.payload.pioOutreach),distributions=heads((records.coordination||[]).filter(r=>r.payload.pioDistribution));
  return heads(plans).map(h=>{const r=h.record,p=r.payload,a=pioApprovalFor(r,records,heads),history=distributions.filter(d=>d.record.incident===r.incident&&d.record.payload.pioDistribution.outreachEntity===r.entity),valid=history.filter(d=>{
    const v=d.record.payload.pioDistribution,plan=plans.find(p=>p.id===v.outreachEvent&&p.incident===r.incident),approval=(records.approvals||[]).find(a=>a.id===v.approvalEvent&&a.incident===r.incident&&a.payload.kind==='pio-outreach'&&a.payload.outreachEvent===v.outreachEvent&&a.payload.status==='Approved');
    const decisions=heads((records.approvals||[]).filter(a=>a.incident===r.incident&&a.payload.kind==='pio-outreach'&&a.payload.outreachEvent===v.outreachEvent&&a.payload.decidedAt<=v.distributedAt));
    const effective=decisions.length===1&&!decisions[0].conflict?decisions[0].record:null;
    return !d.conflict&&plan&&approval&&effective?.id===approval.id&&effective.payload.status==='Approved'&&v.channels.every(c=>plan.payload.pioOutreach.channels.includes(c))&&v.partners.every(c=>plan.payload.pioOutreach.partners.includes(c));
  }).map(d=>d.record).sort((a,b)=>b.payload.pioDistribution.distributedAt-a.payload.pioDistribution.distributedAt||b.created-a.created);
    const last=valid[0]||null,currentDistribution=valid.find(d=>d.payload.pioDistribution.outreachEvent===r.id),nextUpdate=currentDistribution?.payload.pioDistribution.nextUpdate??p.due,active=!['Complete','Canceled'].includes(p.status),approved=!h.conflict&&a?.payload.status==='Approved';
    const deliveryIssue=last?.payload.pioDistribution.receipt==='Delivery issue';
    return {record:r,conflict:h.conflict,approval:a,approved,active,last,distributions:valid,distributionHeads:history,deliveryIssue,unverifiedDistributions:history.length-valid.length,nextUpdate,overdue:active&&nextUpdate<=now,needsReview:active&&(h.conflict||!approved||!currentDistribution||deliveryIssue||history.length!==valid.length||nextUpdate<=now)};
  }).sort((a,b)=>Number(b.needsReview)-Number(a.needsReview)||a.nextUpdate-b.nextUpdate);
}
export function pioNotifications(records,heads,now){return pioStates(records,{heads,now}).filter(s=>s.needsReview).map(s=>({key:`pio:${s.record.entity}`,revision:s.record.id+':'+(s.approval?.id||'unapproved')+':'+(s.last?.id||'undistributed'),category:s.overdue?'Overdue follow-ups':s.approved?'Planning review cues':'Information gaps',location:'PIO · '+s.record.payload.location,change:s.conflict?'Outreach versions conflict':s.unverifiedDistributions?'Distribution history needs verification':s.deliveryIssue?'Delivery issue recorded; review distribution alternatives':s.overdue?'PIO update is due':!s.approved?'Message approval / confirmation required':'Approved message; distribution not recorded for this version',sourceTime:s.record.created,verification:s.conflict?'Conflicting versions':s.approved?'Exact message approval recorded':'Draft / approval required',owner:s.record.payload.owner,nextReview:'PIO update due '+new Date(s.nextUpdate).toISOString(),evidence:{outreachEvent:s.record.id,approvalEvent:s.approval?.id||null,lastDistribution:s.last?.id||null,zone:s.record.payload.pioOutreach.zone}}));}
/** One feed failure, or one applicability cue per active outreach; missing zones never imply clearance. */
export function pioZoneNotices(states,current,{checked,error=null}){
  const active=states.filter(s=>s.active);if(!active.length)return [];
  if(error)return [{key:'pio:zone-source',revision:'unavailable',category:'Data failures',location:'PIO · county evacuation-zone source',change:'Current zone applicability could not be checked',sourceTime:checked||null,verification:'Unverified',owner:'County PIO / GIS',nextReview:'Recheck the county source and confirm applicability with the authorized county contact',evidence:{error,source:CARE_SOURCES.zones,issueTime:null}}];
  return active.filter(s=>!current[s.record.entity]||current[s.record.entity].revision!==s.record.payload.pioOutreach.zone.revision).map(s=>({key:'pio-zone:'+s.record.entity,revision:s.record.id+':'+(current[s.record.entity]?.revision||'missing'),category:'Planning review cues',location:'PIO · '+s.record.payload.location,change:current[s.record.entity]?'County zone name, published status or mapped geometry differs; verify message applicability':'Recorded county zone is no longer returned; verify applicability',sourceTime:checked,verification:'County query, not an order issue time',owner:s.record.payload.owner,nextReview:'Review the current county zone and save a refreshed outreach version if appropriate',evidence:{outreachEvent:s.record.id,recorded:s.record.payload.pioOutreach.zone,current:current[s.record.entity]||null,source:CARE_SOURCES.zones,issueTime:null}}));
}
export function pioBriefingLines(records,heads,time,now){return pioStates(records,{heads,now}).flatMap(s=>{const p=s.record.payload,o=p.pioOutreach,d=s.last?.payload.pioDistribution;return [
  `${p.location} · ${p.title} · owner ${p.owner} · ${s.conflict?'CONFLICT':s.approved?'EXACT MESSAGE APPROVAL RECORDED':'DRAFT / NOT APPROVED'}`,
  `Outreach version ${s.record.id} · confirmed languages: ${o.languages.join(', ')||'Unconfirmed'} · language confirmation: ${o.confirmedBy||'Unconfirmed'} / ${time(o.confirmedAt)} / ${o.languageEvidence||'No evidence'}`,
  `${o.messageLanguage} message (${s.approved?'approved exact version':'draft'}): ${o.message}`,
  `Channels: ${o.channels.join('; ')} · partners: ${o.partners.join('; ')||'Not recorded'}`,
  `Approval: ${s.approval?`${s.approval.payload.status} · ${s.approval.payload.decisionBy} · ${time(s.approval.payload.decidedAt)} · recorded by ${s.approval.author}`:'Pending'} · next update ${time(s.nextUpdate)}`,
  `Last recorded distribution: ${d?`${time(d.distributedAt)} · ${d.receipt} · ${d.channels.join('; ')} · exact outreach ${d.outreachEvent}`:'None'}${s.unverifiedDistributions?' · some distribution entries need verification':''}`,
  `Zone source ${o.zone.source} · ${o.zone.key} / ${o.zone.name} · published ${o.zone.status} · queried ${time(o.zone.checked)} · source issue time unavailable · revision ${o.zone.revision}`,
  `County applicability confirmation: ${o.zoneVerifiedBy||'Unconfirmed'} · ${time(o.zoneVerifiedAt)} · ${o.zoneEvidence||'No evidence'}`,
  `Planning evidence: ${o.analysisNotes||'None recorded'}. Population estimates do not establish an evacuation order, language preference or delivery.`,
  ...populationEvidenceLines(o.populationEvidence,o.zone,time)
];});}
