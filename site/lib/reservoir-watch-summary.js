/** Compact evidence shared by the concern queue, detailed cards and captured briefings. */
export function reservoirWatchSummary(row){
 return [...(row.releases||[]),...(row.pools||[])].filter(s=>s.current&&Number.isFinite(s.delta)&&Number(s.delta.toFixed(s.metric==='elevation'?2:0))!==0).map(s=>`${s.station} ${s.metric==='elevation'?'pool':s.label} ${s.delta>0?'+':''}${s.delta.toFixed(s.metric==='elevation'?2:0)} ${s.metric==='elevation'?'ft':'cfs'} / ${s.hours.toFixed(1)} h`).join(' · ');
}
/** Source associations are not a hydraulic routing model. */
export const RESERVOIR_CONNECTION_NOTE='Named river association only; downstream routing unverified and travel time unknown. Pool elevation is not downstream stage, flood depth or available flood-control capacity. Rainfall samples are not basin runoff. Confirm release plans, timing and resource lead times with the operator before prepositioning.';
