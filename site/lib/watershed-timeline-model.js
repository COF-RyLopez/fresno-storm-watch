import {HOUR} from './river-model.js';

export const RESERVOIR_NAMES={MIL:'Millerton',PNF:'Pine Flat'};
export const WPC_INTERVALS=Array.from({length:13},(_,i)=>i+13);
export const RISE_OUTLET='https://data.usbr.gov/catalog/2382/item/10810';
export const TIMELINE_QPF_URL='https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer/12';

export function timelineSnapshotCurrent(snapshot,now){
 const generated=Date.parse(snapshot?.generatedAt);
 return snapshot?.schemaVersion===1&&Number.isFinite(generated)&&generated<=now+120000&&now-generated<=HOUR;
}

/** Preserve the actual valid windows even if the publisher is rolling over. */
export function precipitationTimeline(snapshot,now){
 const candidates=timelineSnapshotCurrent(snapshot,now)&&Array.isArray(snapshot.windows)?snapshot.windows:[];
 const valid=candidates.filter(row=>WPC_INTERVALS.includes(row.layer)&&[row.issue,row.start,row.end].every(Number.isFinite)&&
  row.end-row.start===6*HOUR&&row.end>now&&row.end<=now+78*HOUR&&row.issue<row.end&&row.issue<=now+300000&&now-row.issue<=24*HOUR&&
  ['MIL','PNF'].every(id=>row.max?.[id]===null||(Number.isFinite(row.max?.[id])&&row.max[id]>=0.01)));
 // A conflicting overlap occurs during a publication transition. Withhold both intervals.
 const windows=valid.filter(row=>!valid.some(other=>other!==row&&(other.layer===row.layer||other.start<row.end&&other.end>row.start)))
  .sort((a,b)=>a.start-b.start);
 const continuous=windows.length>0&&windows[0].start<=now&&windows.at(-1).end>=now+66*HOUR&&
  windows.every((row,index)=>!index||row.start===windows[index-1].end);
 return {windows,continuous,peaks:Object.fromEntries(Object.keys(RESERVOIR_NAMES).map(id=>{
  const peak=Math.max(0,...windows.map(row=>row.max[id]??0));
  return [id,windows.filter(row=>row.max[id]===peak)];
 }))};
}

/** RISE outlet values are provisional daily averages and remain separate from CDEC. */
export function riseOutletReports(payload,now){
 if(!Array.isArray(payload?.data)||payload.meta?.totalItems!==payload.data.length||payload.data.length>10)throw Error('Incomplete RISE outlet series');
 const reports=new Map();
 for(const {attributes:a} of payload.data){
  const time=Date.parse(a?.dateTime);
  if(a?.itemId!==10810||a.locationId!==413||a.parameterId!==15||a.modelRunId!==null||
    a.sourceCode!=='har'||!/^\d{4}-\d{2}-\d{2}T0[78]:00:00\+00:00$/.test(a.dateTime)||
    !Number.isFinite(time)||new Date(time).toISOString().slice(0,19)!==a.dateTime.slice(0,19)||time>now||!Number.isFinite(a.result)||a.result<0||a.status!==null)throw Error('RISE outlet identity, time or value changed');
  const date=a.dateTime.slice(0,10);
  if(reports.has(date))throw Error('Duplicate RISE outlet report date');
  reports.set(date,{date,time,value:a.result});
 }
 return [...reports.values()].sort((a,b)=>a.time-b.time);
}
