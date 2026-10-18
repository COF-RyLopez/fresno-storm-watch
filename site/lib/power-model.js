import {fingerprint,sourceTime} from './model.js';
import {powerGeometry} from './power-geometry.js';

export const POWER_LINKS={
  pge:'https://pgealerts.alerts.pge.com/outage-tools/outage-map/',
  pgePsps:'https://pgealerts.alerts.pge.com/psps-updates/',
  sce:'https://www.sce.com/outages-safety/outage-center/check-outage-status',
  scePsps:'https://www.sce.com/outages-safety/outage-preparedness/outage-types/public-safety-power-shutoff-psps'
};
export const POWER_FEEDS=[
  {id:'pge-psps',utility:'PG&E',label:'PG&E · PSPS notices',direct:true},
  {id:'pge-outages',utility:'PG&E',label:'PG&E · current outage map',direct:true},
  {id:'sce-psps',utility:'SCE',label:'SCE · PSPS consideration / active',direct:false},
  {id:'sce-outages',utility:'SCE',label:'SCE · current outage map',direct:false}
];
export const POWER_STATES={consideration:'PSPS under consideration',warning:'PSPS warning',psps:'PSPS power shut off',outage:'Reported outage',restored:'Utility reports restored',cancelled:'Utility reports cancelled',unknown:'Status needs verification'};
export const POWER_COLORS={consideration:'#edbd62',warning:'#edbd62',psps:'#ef89ba',outage:'#ef89ba',restored:'#93bfc5',cancelled:'#93bfc5',unknown:'#b4bdc6'};
export const POWER_MAX_AGE=45*60_000;
const text=v=>v==null?'':String(v).trim().slice(0,1000);
const required=v=>{const s=text(v);if(!s)throw new Error('Power source identity is missing');return s;};
const count=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const date=v=>({time:sourceTime(v),text:typeof v==='string'?text(v):''});

/** @param {object} feature @param {object} layer @returns {object} Only documented labels become statuses. Preserve ambiguous publisher dates as text. */
export function normalizePower(feature,layer){
  const a=feature.attributes||{},geometry=powerGeometry(feature.geometry);
  let row={utility:layer.utility,feedId:layer.feedId,source:layer.url,official:POWER_LINKS[layer.utility==='PG&E'?'pge':'sce'],geometries:[geometry],kind:layer.kind,issues:[]};
  if(layer.kind==='pge-psps'){
    const stage=text(a.Stage).toLowerCase();
    const status=({watch:'consideration',warning:'warning',cancelled:'cancelled',canceled:'cancelled',restored:'restored'})[stage]||'unknown';
    // Event + source period + footprint: object IDs and VersionID can change on every republication.
    row={...row,key:`pge:psps:${required(a.EventID)}:${text(a.TimePeriod)}:${fingerprint(JSON.stringify(geometry))}`,name:text(a.EventName)||`PSPS event ${a.EventID}`,status,rawStatus:text(a.Stage)||'Not supplied',location:'PSPS area intersecting Fresno County',customers:count(a.TotCustAff),start:date(a.DeEngStart),end:date(a.DeEngEnd),restoration:date(a.ETOR),updated:date(a.LstUpdated),details:`Publisher stage: ${text(a.Stage)||'unknown'}. ${text(a.TimePeriod)}`};
    row.issues.push('PG&E PSPS notice and outage records can overlap; do not add them as separate affected customers.');
  }else if(layer.kind==='sce-psps'){
    const status=({'Monitored':'consideration','Downstream':'consideration','De-Energized':'psps','Re-Energized':'restored'})[text(a.PSPS)]||'unknown';
    row={...row,key:`sce:psps:${required(a.GlobalID).toLowerCase()}`,name:text(a.CIRCUIT_NAME)||'Unnamed circuit',status:status==='consideration'&&a.PSPS_Details==='De-Energization Expected'?'warning':status,rawStatus:text(a.PSPS),location:text(a.COUNTY)||'Area intersecting Fresno County',customers:count(a.GrandTotal),start:date(a.StartDate),end:date(a.EndDate),restoration:date(a.ERT),updated:date(a.EditDate),details:text(a.PSPS_Details),event:text(a.EventName)};
    row.issues.push('Circuit customer counts may span counties and overlap. “Downstream” means electrical circuits, not river reaches.');
  }else if(layer.kind==='pge-outage'){
    row={...row,key:`pge:outage:${required(a.OUTAGE_ID||a.F_OUTAGE_ID)}`,name:`Outage ${a.OUTAGE_ID||a.F_OUTAGE_ID}`,status:layer.psps?'psps':'outage',rawStatus:text(a.CREW_CURRENT_STATUS),location:text(a.CITY)||'Mapped location / area in Fresno County',customers:count(a.EST_CUSTOMERS),start:date(a.OUTAGE_START_TEXT||a.OUTAGE_START),end:date(null),restoration:date(a.CURRENT_ETOR_TEXT||a.CURRENT_ETOR),updated:date(a.LAST_UPDATE_TEXT||a.LAST_UPDATE),details:[text(a.OUTAGE_CAUSE),text(a.CREW_CURRENT_STATUS)].filter(Boolean).join(' · ')};
  }else{
    const status=text(a.Status).toUpperCase()==='ACTIVE'?'outage':text(a.Status).toUpperCase()==='RESTORED'?'restored':'unknown';
    row={...row,key:`sce:outage:${required(a.IncidentId)}`,name:`Outage ${a.OanNo||a.IncidentId}`,status,rawStatus:text(a.Status),location:text(a.CityName)||text(a.CountyName)||'Mapped point in Fresno County',customers:count(a.NoOfAffectedCust_Inci),start:date(a.OutageStartDateTime),end:date(null),restoration:date(a.ERT),updated:date(a.LastChngDateTime),details:[text(a.MemoCauseCdDesc),text(a.CrewStatusCdDesc)].filter(Boolean).join(' · ')};
    row.issues.push('SCE outage change times and restoration estimates are publisher text; the feed does not declare a time zone for those strings.');
  }
  if(row.status==='unknown')row.issues.push('Unrecognized or missing utility status. Verify the official map.');
  return row;
}
/** @param {object[]} input @returns {object[]} Combine point/polygon representations, without summing customers. */
export function deduplicatePower(input){
  const rows=new Map();
  for(const row of input){
    const old=rows.get(row.key);
    if(!old){rows.set(row.key,{...row,geometries:[...row.geometries]});continue;}
    const different=old.status!==row.status||old.customers!==row.customers||JSON.stringify(old.updated)!==JSON.stringify(row.updated);
    const rank=r=>JSON.stringify([r.status,r.rawStatus,r.customers,r.start,r.end,r.restoration,r.updated,r.details]);
    const newer=(row.updated.time||0)-(old.updated.time||0);
    const next=newer>0||newer===0&&rank(row)>rank(old)?row:old;
    rows.set(row.key,{...next,geometries:[...new Map([...old.geometries,...row.geometries].map(g=>[JSON.stringify(g),g])).values()],issues:[...new Set([...old.issues,...row.issues,...(different?['Source representations differ; verify this record with the utility.']:[])])]});
  }
  return [...rows.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(row=>({...row,revision:fingerprint(JSON.stringify([row.status,row.rawStatus,row.customers,row.start,row.end,row.restoration,row.updated,row.details,row.issues,row.geometries.map(g=>JSON.stringify(g)).sort()]))}));
}
/** @param {object} data @returns {object} Validate cached public snapshots before use. */
export function validatePowerSnapshot(data){
  if(data?.schemaVersion!==1||!sourceTime(data.generatedAt)||!Array.isArray(data.feeds)||data.feeds.length!==POWER_FEEDS.length)throw new Error('Unexpected power snapshot');
  for(const spec of POWER_FEEDS){
    const feed=data.feeds.find(f=>f.id===spec.id);
    if(!feed||!Array.isArray(feed.rows)||feed.rows.length>10000||feed.lastSuccess!==null&&!sourceTime(feed.lastSuccess))throw new Error('Power feed contract incomplete');
    const keys=new Set();
    for(const r of feed.rows){if(!r.key||!r.revision||keys.has(r.key)||r.feedId!==feed.id||!POWER_STATES[r.status]||!Array.isArray(r.issues)||!r.geometries?.length||!Object.values(POWER_LINKS).includes(r.official)||!r.updated||!r.start||!r.end||!r.restoration)throw new Error('Power record contract invalid');keys.add(r.key);r.geometries.forEach(powerGeometry);}
  }
  return data;
}
/** @param {object} feed @param {number} now @returns {string|null} Retrieval age is separate from record age. */
export function powerHealth(feed,now=Date.now()){
  if(!feed?.lastSuccess)return 'No successful source check';
  if(feed.error)return 'Source check failed · retained data';
  const age=now-sourceTime(feed.lastSuccess);
  if(age< -120000)return 'Source check timestamp is in the future';
  if(age>POWER_MAX_AGE)return 'Source check overdue · retained data';
  return null;
}
/** @param {object} row @param {number} now @returns {string[]} Never infer restoration from an elapsed estimated time. */
export function powerRowIssues(row,now=Date.now()){
  return [...row.issues,...(row.restoration.time&&row.restoration.time<now&&!['restored','cancelled'].includes(row.status)?['Restoration estimate has passed; restoration is not confirmed.']:[]),...(row.end.time&&row.end.time<now&&!['restored','cancelled'].includes(row.status)?['Published window has ended; status needs verification.']:[]),...(row.updated.time&&now-row.updated.time>24*3600000?['Record update is more than 24 hours old.']:[]),...(row.updated.time>now+120000?['Record update is in the future; verify publisher time.']:[])];
}
/** @param {object|null} prior @param {object[]} rows @returns {object} Memory-only change tracking; disappearance is a verification cue, never restoration. */
export function powerChanges(prior,rows){
  const known=new Map(rows.map(r=>[r.key,r.revision])),pending=new Set(prior?.pending||[]),missing=new Set(prior?.missing||[]);
  for(const row of rows){if(prior?.known.get(row.key)!==row.revision)pending.add(`${row.key}|${row.revision}`);missing.delete(row.key);}
  for(const key of prior?.known.keys()||[])if(!known.has(key))missing.add(key);
  const current=new Set(rows.map(r=>`${r.key}|${r.revision}`));for(const k of pending)if(!current.has(k))pending.delete(k);
  return {known,pending,missing};
}
