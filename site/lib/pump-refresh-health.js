/** Verification metadata is private AGOL item data, writable only by the inventory owner. */
export function pumpCopyVerification(copy,data,maxSourceAgeMs,now=Date.now()){
  const h=data?.frogPumpRefresh;
  if(h===undefined)return {...copy,snapshotCaptured:copy.sourceChecked,maxSourceAgeMs,refreshMode:'manual',refreshState:'manual'};
  if(h?.schema!=='frog-pump-refresh-v1'||typeof h.enabled!=='boolean'||!['healthy','failed'].includes(h.state)||!Number.isInteger(h.intervalMinutes)||h.intervalMinutes<15||h.intervalMinutes>1440||h.maxLagMs!==h.intervalMinutes*180000||h.activeSnapshot!==copy.snapshot||h.activeDigest!==copy.digest||!Number.isFinite(h.lastSuccess)||h.lastSuccess<copy.sourceChecked||h.lastSuccess>now+60000||!Number.isFinite(h.lastAttempt)||h.lastAttempt<h.lastSuccess||h.lastAttempt>now+60000)throw Error('Inventory refresh verification does not match the active copy. County GIS must reconcile the scheduled job.');
  return {...copy,snapshotCaptured:copy.sourceChecked,sourceChecked:h.lastSuccess,maxSourceAgeMs:h.enabled?h.maxLagMs:maxSourceAgeMs,refreshMode:h.enabled?'scheduled':'manual',refreshState:h.state,refreshIntervalMinutes:h.intervalMinutes,lastAttempt:h.lastAttempt};
}
