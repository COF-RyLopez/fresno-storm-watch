/** Presentation of source checks, separate from hazard severity and source coverage. */
export const HEALTH_GROUPS=Object.freeze([
  ['failed','Failed checks'],['stale','Stale / overdue'],['coverage','Coverage gaps'],
  ['unknown','Time unverified'],['checking','Awaiting first check'],
  ['unassessed','Not assessed'],['current','Checks current']
]);
/** @param {object} check @param {number} now @returns {object} Errors never become healthy through a recent check time. */
export function sourceHealth(check,now=Date.now()){
  const checked=Number.isFinite(check.checked)?check.checked:null;
  let status=check.error?'failed':check.state==='unassessed'?'unassessed':checked!==null&&checked>now+120000?'unknown':checked!==null&&now-checked>(check.maxAgeMs??420000)?'stale':check.state||'current';
  if(!check.error&&checked===null&&!['unassessed','coverage','stale','failed'].includes(status))status='checking';
  if(!HEALTH_GROUPS.some(([key])=>key===status))status='unknown';
  return {...check,checked,status};
}
/** @param {Map} checks @param {number} now @returns {object} One entry per underlying key, independent of map filters. */
export function sourceHealthSummary(checks,now=Date.now()){
  const rows=[...checks.values()].map(s=>sourceHealth(s,now)),groups=HEALTH_GROUPS.map(([id,label])=>({id,label,rows:rows.filter(s=>s.status===id).sort((a,b)=>a.label.localeCompare(b.label))}));
  return {groups,review:rows.filter(s=>['failed','stale','coverage','unknown'].includes(s.status)).length,total:rows.length};
}
