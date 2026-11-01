import {countyGeometry} from './model.js';
import {pointInRings} from './power-geometry.js';
import {prepareWatchGeometry} from './watch-proximity.js';
import {correlateDwrSupplies} from './dwr-supply-planning-model.js';
import {fresh} from './source-health-model.js';

export const SANDBAG_SOURCE='https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Sandbag_Locations/FeatureServer/0';
export const SANDBAG_APP='https://gisportal.co.fresno.ca.us/portal/apps/webappviewer/index.html?id=ab6bf09e95cb4a23b4aa2e97ed61a843';
export const SANDBAG_CONFIG='https://gisportal.co.fresno.ca.us/portal/sharing/rest/content/items/ab6bf09e95cb4a23b4aa2e97ed61a843/data?f=json';
export const SANDBAG_GUIDANCE='https://www.fresnocountyca.gov/Departments/Public-Works-and-Planning/divisions-of-public-works-and-planning/road-maintenance-and-operations-division/sandbags-for-flood-prevention';
export const SANDBAG_MAX_AGE=45*60000;
export const SANDBAG_STATES={active:'Source marks active · stock / access unconfirmed',unknown:'Source status unknown · verify before use',inactive:'Source marks inactive · not a confirmed pickup site'};
const text=v=>String(v??'').trim().slice(0,300),date=v=>Number.isFinite(v)&&v>0?v:null;
const state=value=>({yes:'active',no:'inactive'})[text(value).toLowerCase()]||'unknown';
const counts=rows=>({read:rows.length,active:rows.filter(r=>r.state==='active').length,unknown:rows.filter(r=>r.state==='unknown').length,inactive:rows.filter(r=>r.state==='inactive').length,mapped:rows.filter(r=>r.geometry).length,unmapped:rows.filter(r=>!r.geometry).length});

/** Reconcile every public record; missing/outside points remain address-only, never geocoded or assigned a reach. */
export function normalizeSandbags(features,spatialReference,county){
  if((spatialReference?.latestWkid||spatialReference?.wkid)!==4326)throw new Error('Sandbag query requires WGS84');
  const rings=countyGeometry(county.geometry).rings,seen=new Set();
  const rows=features.map(f=>{
    const a=f.attributes||{},id=a.fid;if(!Number.isSafeInteger(id)||id<0||seen.has(id))throw new Error('Sandbag identity missing or duplicated');seen.add(id);
    let geometry=null,locationIssue=null;
    if(f.geometry){const shape={...f.geometry,spatialReference:f.geometry.spatialReference||spatialReference};prepareWatchGeometry(shape);if(!Number.isFinite(shape.x)||!Number.isFinite(shape.y))throw new Error('Sandbag point geometry invalid');if(pointInRings([shape.x,shape.y],rings))geometry={x:shape.x,y:shape.y,spatialReference:{wkid:4326}};else locationIssue='Source point outside Fresno County · verify location';}
    else locationIssue='Source has no coordinates · address only';
    return {key:'county-sandbag:'+id,id,name:text(a.rdyard_nm)||'Unnamed county site',yard:text(a.rdyard_num),address:text(a.rdyard_add),city:text(a.rdyard_a_1),state:state(a.active),rawActive:text(a.active)||null,jointLocation:text(a.jointlocation)||null,edited:date(a.modifiedda),maintained:date(a.dt_maint),geometry,locationIssue};
  }).sort((a,b)=>a.id-b.id);
  return {rows,accounting:counts(rows)};
}

/** Validate the public snapshot's schema, identity, CRS and exact accounting before showing it. */
export function validateSandbagSnapshot(d,now=Date.now()){
  if(d?.schemaVersion!==1||d.countyGeoid!=='06019'||d.source!==SANDBAG_SOURCE||d.app!==SANDBAG_APP||!Array.isArray(d.rows)||d.rows.length>1000)throw new Error('Invalid county sandbag snapshot');
  for(const key of ['generatedAt','lastAttempt','lastSuccess'])if(!(key==='lastSuccess'&&d[key]===null)&&(typeof d[key]!=='string'||!Number.isFinite(Date.parse(d[key]))||Date.parse(d[key])>now+120000))throw new Error('Sandbag snapshot timestamp invalid');
  if(d.error!==null&&typeof d.error!=='string')throw new Error('Sandbag collection error state invalid');
  if(!d.lastSuccess&&!d.error||d.lastSuccess&&Date.parse(d.lastSuccess)>Date.parse(d.generatedAt))throw new Error('Sandbag collection state invalid');
  const seen=new Set();for(const r of d.rows){if(!Number.isSafeInteger(r.id)||r.id<0||r.key!=='county-sandbag:'+r.id||seen.has(r.key)||!Object.hasOwn(SANDBAG_STATES,r.state)||typeof r.name!=='string'||typeof r.address!=='string'||typeof r.city!=='string')throw new Error('Sandbag record identity / status invalid');seen.add(r.key);if(r.geometry){if((r.geometry.spatialReference?.latestWkid||r.geometry.spatialReference?.wkid)!==4326)throw new Error('Sandbag snapshot CRS missing');prepareWatchGeometry(r.geometry);if(!Number.isFinite(r.geometry.x)||!Number.isFinite(r.geometry.y))throw new Error('Sandbag point required');}}
  const expected=counts(d.rows);for(const key of Object.keys(expected))if(d.accounting?.[key]!==expected[key])throw new Error('Sandbag accounting mismatch');
  return d;
}

export function sandbagHealth(snapshot,now=Date.now()){
  const checked=Date.parse(snapshot?.lastSuccess);return {checked:Number.isFinite(checked)?checked:null,current:!!snapshot&&!snapshot.error&&fresh(checked,SANDBAG_MAX_AGE,now),error:snapshot?.error||null};
}

/** Reuse the bounded watchpoint/road proximity rules, keeping address-only sites out of spatial matches. */
export function sandbagContext(snapshot,planning,roads,{filter='active',query='',areaId='all',radiusKm=25}={},now=Date.now()){
  const rows=(snapshot?.rows||[]).filter(r=>(filter==='all'||r.state===filter)&&[r.name,r.address,r.city].join(' ').toLowerCase().includes(query.trim().toLowerCase())),mapped=rows.filter(r=>r.geometry);
  const health=sandbagHealth(snapshot,now);
  const matched=correlateDwrSupplies({supplies:{loaded:!!snapshot,checked:health.checked,rows:mapped.map(r=>({...r,longitude:r.geometry.x,latitude:r.geometry.y})),error:null},planning,roads,areaId,radiusKm},now);
  return {...matched,health,rows:[...matched.rows,...(areaId==='all'?rows.filter(r=>!r.geometry).map(site=>({site,areas:[],roads:[],unmapped:true})):[])].sort((a,b)=>a.site.name.localeCompare(b.site.name)),unmappedInFilter:rows.filter(r=>!r.geometry).length};
}

/** Exact name/address associations to the separately published county guidance; never apply road-yard hours to city/fire sites. */
export function sandbagHours(row){
  const entries={'AUBERRY YARD|33148 AUBERRY RD':'7:00 AM–3:00 PM','BIOLA YARD|12855 G AVE':'24 hours','FRESNO YARD - ROAD YARD 7|9400 N MATUS AVE':'24 hours','SANGER YARD|9525 E OLIVE AVE':'24 hours','CARUTHERS YARD|2544 W MOUNTAIN VIEW AVE':'7:00 AM–3:00 PM'};
  return entries[(row.name+'|'+row.address).toUpperCase()]||null;
}

export function sandbagSearchEntries(snapshot){return (snapshot?.rows||[]).map(r=>({key:r.key,name:r.name,kind:'sandbag',aliases:[r.address,r.city,r.yard,'sandbags'],detail:[r.address,r.city,SANDBAG_STATES[r.state],r.locationIssue].filter(Boolean).join(' · '),geometry:r.geometry,sourceUrl:SANDBAG_APP,sourceTime:r.edited,reference:`County sandbag location: ${r.address} ${r.city}. ${SANDBAG_STATES[r.state]}. Hours, eligibility, sand and bag availability require confirmation. Collection ${snapshot.lastSuccess||'unknown'}${snapshot.error?' · collection failed; retained reference':''}.`,history:r.state==='inactive'}));}
