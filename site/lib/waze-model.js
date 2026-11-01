/** Waze for Cities partner-feed snapshot: storm-relevant allowlist, strict minimised schema, and client rows. Shared by scripts/collect-waze.mjs. */
import {fresh} from './source-health-model.js';

export const WAZE_SOURCE='Waze for Cities partner feed';
export const WAZE_NOTE='Unverified crowd reports from Waze users. Not county verification; a disappearing report does not mean a road reopened.';
export const WAZE_MAX_AGE=20*60000;
export const WAZE_CATEGORIES=['Flooding','Road closed','Hazard on road'];
/** Explicit storm allowlist (Waze data feed / CIFS subtype names): subtype -> [category, short label]. Anything absent is dropped. */
export const WAZE_SUBTYPES=Object.freeze({
  HAZARD_WEATHER_FLOOD:['Flooding','Flooding'],
  HAZARD_WEATHER:['Hazard on road','Weather hazard'],
  HAZARD_WEATHER_HEAVY_RAIN:['Hazard on road','Heavy rain'],
  HAZARD_WEATHER_FOG:['Hazard on road','Fog'],
  HAZARD_WEATHER_HAIL:['Hazard on road','Hail'],
  HAZARD_WEATHER_FREEZING_RAIN:['Hazard on road','Freezing rain'],
  HAZARD_ON_ROAD_OBJECT:['Hazard on road','Object on road'],
  ROAD_CLOSED_HAZARD:['Road closed','Road closed (hazard)'],
  ROAD_CLOSED_EVENT:['Road closed','Road closed (event)']
});
const HAZARD_TYPES=['HAZARD','WEATHERHAZARD'];
/** @returns {[string,string]|null} ROAD_CLOSED with no subtype counts as a closure; planned construction closures are excluded. */
export function wazeCategory(type,subtype){
  if(type==='ROAD_CLOSED'&&(!subtype||subtype==='NO_SUBTYPE'))return ['Road closed','Road closed'];
  const hit=WAZE_SUBTYPES[subtype];
  return hit&&(subtype.startsWith('ROAD_CLOSED')?type==='ROAD_CLOSED':HAZARD_TYPES.includes(type))?hit:null;
}
const ALERT_KEYS='id,type,subtype,lon,lat,street,city,reportedAt,reliability,confidence,thumbsUp';
const iso=(v,now)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now+120000;
const score=v=>v===null||Number.isInteger(v)&&v>=0&&v<=10;
const rounded=v=>Number.isFinite(v)&&Math.round(v*1e4)/1e4===v;
/** Category counts derived from rows, so the published totals cannot drift from the alerts. */
export const wazeCounts=alerts=>Object.fromEntries(WAZE_CATEGORIES.map(c=>[c,alerts.filter(a=>wazeCategory(a.type,a.subtype)[0]===c).length]));

/** Strict published-snapshot check: exact alert keys (minimisation), allowlisted subtypes, rounded points, consistent counts. */
export function validateWazeSnapshot(d,now=Date.now()){
  if(d?.schemaVersion!==1||d.source!==WAZE_SOURCE||d.note!==WAZE_NOTE||!Array.isArray(d.alerts)||d.alerts.length>5000)throw new Error('Invalid Waze snapshot');
  if(!iso(d.generatedAt,now)||!(d.checkedAt===null||iso(d.checkedAt,now)&&Date.parse(d.checkedAt)<=Date.parse(d.generatedAt)))throw new Error('Waze snapshot timestamp invalid');
  if(!(d.error===null||typeof d.error==='string')||!d.checkedAt&&!d.error)throw new Error('Waze collection state invalid');
  for(const key of ['startTime','endTime'])if(!(d.feed?.[key]===null||iso(d.feed?.[key],now)))throw new Error('Waze feed window invalid');
  if(typeof d.possiblyTruncated!=='boolean')throw new Error('Waze truncation flag missing');
  const seen=new Set();
  for(const a of d.alerts){
    if(Object.keys(a).join()!==ALERT_KEYS||!/^[0-9a-f]{16}$/.test(a.id)||seen.has(a.id)||!wazeCategory(a.type,a.subtype))throw new Error('Waze alert identity or type invalid');
    if(!rounded(a.lon)||!rounded(a.lat)||Math.abs(a.lon)>180||Math.abs(a.lat)>90||!iso(a.reportedAt,now))throw new Error('Waze alert location or time invalid');
    if(![a.street,a.city].every(v=>v===null||typeof v==='string')||!score(a.reliability)||!score(a.confidence)||!(a.thumbsUp===null||Number.isInteger(a.thumbsUp)&&a.thumbsUp>=0))throw new Error('Waze alert fields invalid');
    seen.add(a.id);
  }
  const counts=wazeCounts(d.alerts);
  for(const c of WAZE_CATEGORIES)if(d.counts?.byCategory?.[c]!==counts[c])throw new Error('Waze category counts mismatch');
  return d;
}

/** @param {object|null} snapshot @param {number} now @returns {object[]} Newest-first rows; every row is stale once the last successful check is older than WAZE_MAX_AGE. */
export function wazeReports(snapshot,now=Date.now()){
  if(!snapshot)return [];
  const d=validateWazeSnapshot(snapshot,now),stale=!fresh(Date.parse(d.checkedAt),WAZE_MAX_AGE,now);
  return d.alerts.map(a=>{
    const [category,name]=wazeCategory(a.type,a.subtype);
    return {...a,category,label:a.street?`${name} · ${a.street}`:name,ageMinutes:Math.max(0,Math.round((now-Date.parse(a.reportedAt))/60000)),stale};
  }).sort((a,b)=>Date.parse(b.reportedAt)-Date.parse(a.reportedAt));
}
