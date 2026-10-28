import {canonical,heads} from './eoc-model.js';
/** @param {object[]} items @param {object} item @returns {boolean} Keep genuinely changed versions, ignore repeat capture of identical evidence. */
export function captureBriefingEvidence(items,item){
  const withoutCaptureTime=value=>Array.isArray(value)?value.map(withoutCaptureTime):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='capturedAt').map(([key,v])=>[key,withoutCaptureTime(v)])):value;
  const identity=value=>canonical(withoutCaptureTime(value));
  const key=identity(item);if(items.some(prior=>identity(prior)===key))return false;
  items.push(structuredClone(item));return true;
}
/** @param {number} count @param {number} revision @param {number} saved @returns {boolean} A copy/export does not claim a durable private save. */
export const briefingNeedsSave=(count,revision,saved)=>count>0&&revision!==saved;
/** @param {EventTarget} target @param {Function} needsSave @returns {Function} Native browser wording/availability varies by device. */
export function protectBriefingDraft(target,needsSave){const warn=event=>{if(needsSave()){event.preventDefault();event.returnValue='';}};target.addEventListener('beforeunload',warn);return ()=>target.removeEventListener('beforeunload',warn);}
/** @param {object[]} records @param {number} now @returns {object[]} Conflicting or superseded periods cannot be silently selected. */
export const briefingPeriods=(records,now=Date.now())=>heads(records).filter(h=>!h.conflict).map(h=>({...h.record,active:h.record.payload.start<=now&&now<h.record.payload.end})).sort((a,b)=>b.payload.start-a.payload.start||a.id.localeCompare(b.id));
