import {prepareWatchGeometry,nearbyWatchpoints} from './watch-proximity.js';
import {FACILITY_MAX_AGE} from './facility-model.js';
const AREA_IDS=['san-joaquin-lower','san-joaquin-upper','little-dry','james-bypass','kings-upper','kings-lower'];
export const LOOKUP_KM=Object.freeze([1,5,10]);
const calendar=t=>Number.isFinite(t)&&t>0?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(t):null;
/** @param {object} value @returns {object} No implicit association survives a change to the reviewed briefing revision. */
export function validateBriefingContext(value){
  if(value?.schemaVersion!==1||!Array.isArray(value.associations)||value.associations.length>40)throw new Error('Invalid briefing / river association register.');
  const keys=new Set();for(const a of value.associations){if(typeof a.impact!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||!['regional-context','headwater-context'].includes(a.relation)||typeof a.note!=='string'||!a.note||!Array.isArray(a.areas)||!a.areas.length||a.areas.some(id=>!AREA_IDS.includes(id)))throw new Error('Invalid briefing / river association.');for(const id of a.areas){const key=[a.impact,a.sha256,id].join(':');if(keys.has(key))throw new Error('Duplicate briefing / river association.');keys.add(key);}}
  return value;
}
/** @param {number|null} start @param {number|null} end @param {object[]} briefings @returns {string} Calendar-date comparison only; missing dates never imply simultaneous conditions. */
export function briefingDateRelation(start,end,briefings){
  if(!briefings.length)return 'No current reviewed public briefing window to compare';
  const a=calendar(start),b=calendar(end);if(!a||!b||end<start)return 'Published timing incomplete / contradictory; simultaneous timing unknown';
  return briefings.some(i=>a<=i.lastDate&&b>=i.firstDate)?'Published dates intersect briefing dates; exact timing and impacts unconfirmed':'Published dates do not intersect reviewed briefing dates; verify status separately';
}
/** @param {object[]} rows @param {Function} geometry @returns {object} Missing or invalid geometries are accounted for once, not counted as absent concerns. */
function prepare(rows,geometry){
  const result=[],seen=new Set();let rejected=0;
  for(const row of rows){const key=row.site?.key||row.key;if(!key||seen.has(key))continue;seen.add(key);try{result.push({row,prepared:prepareWatchGeometry(geometry(row))});}catch{rejected++;}}
  return {result,rejected};
}
/** @param {object} input @param {number} now @returns {object} A bounded, memory-only lookup; regional context and proximity do not establish asset exposure or access. */
export function correlateBriefingContext({associations,briefing={rows:[]},planning=null,roads=null,facilities=null,radiusKm=5,history=false},now=Date.now()){
  if(!LOOKUP_KM.includes(radiusKm))throw new Error('Unsupported nearby-record lookup distance.');
  const roadPrepared=prepare(roads?.snapshot?.rows||[],r=>r.geometry),facilityPrepared=prepare(facilities?.connected?facilities.sites:[],r=>r.site.geometry);
  const checked=roads?.snapshot?.checked,roadCurrent=!!checked&&!roads?.error&&now-checked<=420000&&checked<=now+120000;
  const groups=(planning?.rows||[]).map(r=>{
    const points=planning.points.filter(p=>r.area.rainPoints.includes(p.id));
    const impacts=(briefing.rows||[]).flatMap(i=>{const a=associations?.associations.find(a=>a.impact===i.id&&a.sha256===i.document.sha256&&a.areas.includes(r.area.id));return a?[{...i,association:a}]:[];});
    const current=impacts.filter(i=>i.document.kind==='latest'&&i.period!=='past'&&!i.qualification);
    const nearRoads=roadPrepared.result.flatMap(({row,prepared})=>{const at=nearbyWatchpoints(prepared,points,radiusKm*1000);if(!at||at.meters>radiusKm*1000||row.active==='no'&&!history)return [];return [{row,...at,timing:briefingDateRelation(row.start,row.end,current),verification:!roadCurrent||row.active!=='yes'||row.issues.length>0,history:row.active==='no'}];}).sort((a,b)=>a.meters-b.meters||a.row.key.localeCompare(b.row.key));
    const nearFacilities=facilityPrepared.result.flatMap(({row,prepared})=>{const at=nearbyWatchpoints(prepared,points,radiusKm*1000);if(!at||at.meters>radiusKm*1000)return [];const siteCurrent=!row.site.sourceError&&Number.isFinite(row.site.fetched)&&now-row.site.fetched<=FACILITY_MAX_AGE&&row.site.fetched<=now+60000;return [{row,...at,siteCurrent,power:row.active.map(m=>({row:m,timing:briefingDateRelation(m.start?.time,m.end?.time,current)}))}];}).sort((a,b)=>Number(b.power.length>0)-Number(a.power.length>0)||a.meters-b.meters||a.row.site.key.localeCompare(b.row.site.key));
    const riverReview=!!r.riverReview,contextReview=current.length>0&&(riverReview||nearRoads.some(i=>!i.history)||nearFacilities.some(i=>i.power.length||i.row.followup));
    return {id:r.area.id,name:r.area.name,river:{status:r.status,gaps:r.gaps||[],threshold:!!r.threshold},points,impacts,current,roads:nearRoads,facilities:nearFacilities,riverReview,contextReview,roadCurrent};
  });
  return {groups,briefingUnreviewed:!!briefing.unreviewed,roadCurrent,roadChecked:checked||null,roadRejected:roadPrepared.rejected,facilityRejected:facilityPrepared.rejected,facilityConnected:!!facilities?.connected,facilityGaps:facilities?.sourceGaps||0,unassociated:(briefing.rows||[]).filter(i=>!associations?.associations.some(a=>a.impact===i.id&&a.sha256===i.document.sha256)).length};
}
