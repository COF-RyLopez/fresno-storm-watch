import {heads} from './eoc-model.js';
/** @param {object} item @returns {string|null} Stable evidence identity, never a location-name or proximity match. */
export function missionEvidenceKey(item){
  const id=item?.runId||item?.id||item?.planningReview?.key;
  return typeof item?.kind==='string'&&typeof id==='string'&&id?`mission:${item.kind}:${id}`:null;
}
/** @param {object[]} records @param {number} now @returns {object[]} Preserve conflicting corrections and unlinked legacy entries. */
export function missionFollowups(records,now=Date.now()){
  return heads(records).filter(h=>h.record.payload.kind==='Follow-up'&&!h.record.payload.pioOutreach&&!h.record.payload.pioDistribution).map(h=>{
    const r=h.record,p=r.payload;let key=p.sourceKey||null;
    if(!key&&typeof p.evidence==='string'){try{key=missionEvidenceKey(JSON.parse(p.evidence));}catch{/* Legacy free-text evidence has no verified link. */}}
    const closed=!h.conflict&&['Complete','Canceled'].includes(p.status);
    return {event:r.id,entity:r.entity,title:p.title,location:p.location,owner:p.owner,due:p.due,status:h.conflict?'Conflicting versions':p.status,conflict:h.conflict,versions:h.heads.map(v=>v.id).sort(),active:!closed,overdue:!closed&&Number.isFinite(p.due)&&p.due<now,nextReview:p.nextReview,key,recorded:r.created,author:r.author};
  }).sort((a,b)=>Number(b.conflict)-Number(a.conflict)||Number(b.overdue)-Number(a.overdue)||Number(b.active)-Number(a.active)||a.due-b.due||a.entity.localeCompare(b.entity));
}
/** @param {object} item @param {object[]} rows @returns {object[]} Only exact identities can attach a task to captured evidence. */
export const followupsForEvidence=(item,rows)=>{const key=missionEvidenceKey(item);return key?rows.filter(r=>r.key===key):[];};
