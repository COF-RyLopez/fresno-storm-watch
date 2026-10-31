import {heads} from './eoc-model.js?v=0.74.0-eoc';
import {pumpBinding,bindingKey,validatePumpReadiness} from './pump-readiness-contract.js';
export {pumpBinding,bindingKey};

/** Never choose silently between concurrent updates, duplicate associations or changed source records. */
export function pumpReadiness(record,state,now=Date.now()){
  const key=bindingKey(pumpBinding(record));
  const history=(state?.records||[]).filter(r=>r.payload.kind==='pump-readiness'&&bindingKey(r.payload.binding)===key);
  const versions=heads(history),event=versions.length===1&&!versions[0].conflict?versions[0].record:null;
  const base={history,event:null,needsReview:true,current:false,label:'Readiness not confirmed',reasons:[]};
  if(!state?.connected||state.error||!Number.isFinite(state.checked)||now-state.checked>120000||state.checked>now+60000)return {...base,label:'Readiness source unavailable / overdue',reasons:['Reconnect / refresh private readiness records. Cached confirmations are not treated as current.']};
  if(!versions.length)return base;
  if(!event)return {...base,label:'Conflicting readiness updates',reasons:['Review all saved versions with FMFCD before reconfirming.']};
  let p;try{p=validatePumpReadiness(event.payload,now);}catch{return {...base,label:'Readiness record needs verification',reasons:['Saved record failed validation; ask GIS / FMFCD to inspect it.']};}
  const current=p.validUntil>now&&p.observed<=now&&Number.isFinite(event.created)&&event.created<=now+60000;
  const reasons=[];
  if(!current)reasons.push('The owner’s next readiness review is due / confirmation time is unverified.');
  if(p.backup!=='Available')reasons.push(p.backup==='Unavailable'?'Backup power reported unavailable.':'Backup availability unknown.');
  if(p.connection!=='Confirmed compatible / tested')reasons.push('Backup connection / compatibility needs verification.');
  if(!['Confirmed available','Not fuel powered'].includes(p.fuel))reasons.push(p.fuel==='Refuel needed'?'Refueling requested.':'Fuel availability unknown.');
  if(p.runtimeHours===null)reasons.push('Runtime unknown.');else if(p.runtimeHours===0)reasons.push('No remaining runtime reported.');
  return {...base,event,current,needsReview:reasons.length>0,reasons,label:!current?'Readiness confirmation overdue':reasons.length?'Backup readiness needs follow-up':'Owner-confirmed backup details · verify duration for this event'};
}

export function unmatchedPumpReadiness(rows,state){
  if(!state?.connected)return 0;
  const keys=new Set(rows.filter(r=>r.kind==='pump'&&r.category==='existing').map(r=>bindingKey(pumpBinding(r))));
  return new Set((state.records||[]).filter(r=>r.payload.kind==='pump-readiness'&&!keys.has(bindingKey(r.payload.binding))).map(r=>bindingKey(r.payload.binding))).size;
}

/** Briefings retain exact confirmation versions without copying private contact methods or source coordinates. */
export function freezePumpReadiness(value){
  if(!value)return null;const e=value.event,p=e?.payload;
  return {label:value.label,current:value.current,needsReview:value.needsReview,reasons:[...value.reasons],eventId:e?.id||null,author:e?.author||null,submitted:e?.created||null,
    confirmation:p?{pumpLabel:p.pumpLabel,backup:p.backup,connection:p.connection,fuel:p.fuel,runtimeHours:p.runtimeHours,runtimeBasis:p.runtimeBasis,owner:p.owner,observed:p.observed,validUntil:p.validUntil}:null};
}
