/** Resource Timing reports bytes only when cache/origin timing policies permit it. */
export function resourceTotals(entries,start){
 const rows=entries.filter(r=>r.startTime>=start);
 return {completedRequests:rows.length,reportedTransferBytes:rows.reduce((n,r)=>n+(Number.isFinite(r.transferSize)?r.transferSize:0),0),zeroOrUnreported:rows.filter(r=>!r.transferSize).length};
}
