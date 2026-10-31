import {PRODUCT_METHOD,readZoneProduct,boundaryFingerprint,estimatedResidents,SHA256,validTime,sha256Hex,fetchPublic} from './zone-population-product.js';
import {summarizeZoneAcs,ZONE_ACS_BOUNDARIES} from './zone-acs-model.js';
import {CARE_SOURCES} from './care-model.js';
import {POPULATION_SOURCES} from './population-model.js';

const same=(a,b)=>a===null||b===null?a===b:Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-9;
const sourceLinks={zones:CARE_SOURCES.zoneItem,acs:POPULATION_SOURCES.acsItem,blocks:POPULATION_SOURCES.blocksItem,boundaries:ZONE_ACS_BOUNDARIES.url};

/** Links contain public identifiers only. Counts and private form fields never enter the URL. */
export function pioZoneLink(oid,snapshot=null,built=null){
  if(!Number.isSafeInteger(oid)||oid<1||snapshot!==null&&(!SHA256.test(snapshot)||!validTime(built))||snapshot===null&&built!==null)throw Error('Invalid public zone link.');
  return './eoc.html?'+new URLSearchParams({v:'0.73.0-r2',pioZone:String(oid),...(snapshot?{populationMap:snapshot,populationBuilt:String(built)}:{})})+'#outreach';
}
export function readPioZoneRequest(search){
  const q=new URLSearchParams(search);if(!q.has('pioZone')&&!q.has('populationMap')&&!q.has('populationBuilt'))return null;
  const id=q.get('pioZone'),snapshot=q.get('populationMap'),built=q.has('populationBuilt')?Number(q.get('populationBuilt')):null;
  if(q.getAll('pioZone').length!==1||q.getAll('populationMap').length>1||q.getAll('populationBuilt').length>1||!/^\d{1,12}$/.test(id||'')||Number(id)<1||snapshot!==null&&(!SHA256.test(snapshot)||!validTime(built))||snapshot===null&&built!==null)throw Error('The zone outreach link is invalid. Open the population map and select the zone again.');
  return {oid:Number(id),key:'county-zone:'+Number(id),snapshot,built};
}

/** Require the same public boundary snapshot before importing its population assumptions. */
export async function assertPopulationMapBoundary(s,rows){
  if(await boundaryFingerprint(rows)!==s.geometryFingerprint)throw Error('County boundaries differ from the population map snapshot. Calculate latest population evidence or refresh the map before attaching its estimate.');
  const row=rows.find(r=>r.key===s.zone.key);
  if(!row||row.name!==s.zone.name||row.oid!==s.zone.oid)throw Error('The selected county zone differs from the map snapshot.');
}

/** Frozen public aggregates only; no geometry, contacts, messages or full source collections. */
export function freezePopulationMapEvidence(meta,feature,rows,{checked,captured=Date.now()}={}){
  const p=feature.properties;
  const snapshot={schema:1,method:PRODUCT_METHOD,zone:{key:p.key,oid:p.oid,name:p.name},population:p.population,samplingMoe:p.samplingMoe,tracts:p.tracts,missing:p.missing,missingMoe:p.missingMoe,reason:p.reason,countyShare:p.countyShare,period:meta.period,
    built:meta.built,zonesChecked:meta.zonesChecked,boundaryVerifiedAt:checked,captured,geometryFingerprint:meta.geometryFingerprint,snapshot:meta.geojson.sha256,evidenceDigest:meta.evidence?.sha256,
    sources:{...sourceLinks},sourceDates:{acsChecked:meta.acsChecked,acsModified:meta.acsMetadata.modified,acsEdited:meta.acsMetadata.edited,blocksChecked:meta.blockChecked,blocksEdited:meta.blockEdited,boundariesChecked:meta.boundarySource.checked},
    limits:Object.fromEntries(['method','interpretation','uncertainty','geometry','boundary'].map(k=>[k,meta.limits[k]])),
    rows:rows.map(r=>Object.fromEntries(['id','population','moe','weight','baselineWithin','baselineTotal','reason'].map(k=>[k,r[k]??null])))};
  return validatePopulationMapEvidence(snapshot,snapshot.zone);
}
export function validatePopulationMapEvidence(s,zone){
  if(s?.schema!==1||s.method!==PRODUCT_METHOD||s.period!==ZONE_ACS_BOUNDARIES.period||!s.zone||s.zone.key!==zone.key||s.zone.oid!==zone.oid||s.zone.name!==zone.name||s.zone.key!==`county-zone:${s.zone.oid}`||typeof s.zone.name!=='string'||!s.zone.name.trim()||s.zone.name.length>160)throw Error('Population map evidence must retain the same county zone.');
  if(![s.built,s.zonesChecked,s.boundaryVerifiedAt,s.captured].every(validTime)||s.zonesChecked>s.built||s.built>s.captured||![s.snapshot,s.evidenceDigest,s.geometryFingerprint].every(x=>SHA256.test(x||'')))throw Error('Population map snapshot dates or identifiers are invalid.');
  if(Object.entries(sourceLinks).some(([k,v])=>s.sources?.[k]!==v)||!s.sourceDates||!['acsChecked','blocksChecked','boundariesChecked'].every(k=>validTime(s.sourceDates[k]))||['acsModified','acsEdited','blocksEdited'].some(k=>s.sourceDates[k]!==null&&!validTime(s.sourceDates[k])))throw Error('Population map source references or dates are invalid.');
  if(!s.limits||['method','interpretation','uncertainty','geometry','boundary'].some(k=>typeof s.limits[k]!=='string'||!s.limits[k].trim()||s.limits[k].length>2000)||!Number.isFinite(s.countyShare)||s.countyShare<0||s.countyShare>1.000001||!Array.isArray(s.rows)||s.rows.length>500)throw Error('Population map methods, scope or contributions are invalid.');
  const result=summarizeZoneAcs(s.rows);
  if(!same(s.population,result.estimate)||!same(s.samplingMoe,result.samplingMoe)||['tracts','missing','missingMoe'].some(k=>s[k]!==result[k])||s.population===null&&(typeof s.reason!=='string'||!s.reason.trim()))throw Error('Population map estimate does not reconcile to its source contributions.');
  for(const r of s.rows)if(['baselineWithin','baselineTotal'].some(k=>r[k]!==null&&(!Number.isFinite(r[k])||r[k]<0))||r.reason!==null&&(typeof r.reason!=='string'||r.reason.length>500))throw Error('Population map block-pattern evidence is invalid.');
  if(JSON.stringify(s).length>45000)throw Error('Population map evidence exceeds the private record size budget.');return s;
}

/** Read only fixed public files; an old or tampered link never silently selects another snapshot. */
export async function loadPioZoneContext(request,collection,{fetcher=fetch,signal,readProduct=readZoneProduct}={}){
  const zone=collection.rows.find(r=>r.oid===request.oid);if(!zone)throw Error('This county zone is no longer returned. Verify the source before creating outreach.');
  if(!request.snapshot)return {zone,populationMap:null};
  const {meta,data}=await readProduct({fetcher,signal});
  if(meta.geojson.sha256!==request.snapshot||meta.built!==request.built)throw Error('The population map has changed since this link was created. Open the current map and select the zone again.');
  const feature=data.features.find(f=>f.properties.oid===request.oid);if(!feature)throw Error('This zone is not in the population map snapshot.');
  const manifest=meta.evidence;
  if(manifest?.file!=='evidence.json'||!SHA256.test(manifest.sha256)||!Number.isSafeInteger(manifest.bytes)||manifest.bytes<1||manifest.bytes>10000000)throw Error('Population map calculation evidence is unavailable. Rebuild the map snapshot.');
  const bytes=await(await fetchPublic(new URL('../data/zone-population/evidence.json',import.meta.url),{fetcher,signal})).arrayBuffer();
  if(bytes.byteLength!==manifest.bytes||await sha256Hex(bytes)!==manifest.sha256)throw Error('Population map calculation evidence belongs to a different snapshot. Reload to retry.');
  const evidence=JSON.parse(new TextDecoder().decode(bytes))[zone.key];if(!Array.isArray(evidence))throw Error('Selected-zone calculation evidence is missing.');
  const populationMap=freezePopulationMapEvidence(meta,feature,evidence,{checked:collection.checked});await assertPopulationMapBoundary(populationMap,collection.rows);return {zone,populationMap};
}
export const populationMapSummary=s=>`${estimatedResidents(s.population)} planning residents · ACS ${s.period} · saved population map estimate`;
export function populationMapLines(s,time){
  if(!s)return [];return [populationMapSummary(s),`Population map ${s.zone.name} / ${s.zone.key} · method ${s.method} · snapshot ${s.snapshot}`,
    `Calculated ${time(s.built)} · county boundaries queried ${time(s.zonesChecked)} · applicability checked ${time(s.boundaryVerifiedAt)} · attached ${time(s.captured)}. Query and attachment times are not population observations.`,
    `ACS checked ${time(s.sourceDates.acsChecked)} · publisher modified ${time(s.sourceDates.acsModified)} / edited ${time(s.sourceDates.acsEdited)} · 2020 block pattern checked ${time(s.sourceDates.blocksChecked)} / edited ${time(s.sourceDates.blocksEdited)} · Census boundaries checked ${time(s.sourceDates.boundariesChecked)}.`,
    `Sampling-only MOE component: ${s.samplingMoe===null?'Unavailable':'± '+Math.ceil(s.samplingMoe)+' residents'}. Total zone uncertainty is not quantified.`,
    ...(s.reason?[s.reason]:[]),...Object.values(s.limits),...Object.values(s.sources),
    'Language and AFN context remain separate whole-area evidence. This map does not confirm language preference, current occupants, evacuation orders or message delivery.'];
}
