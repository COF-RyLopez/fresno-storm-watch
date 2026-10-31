import {powerGeometry,powerScope} from './power-geometry.js';
import {DRAINAGE_MAX_AGE} from './drainage-model.js';
import {FACILITY_MAX_AGE} from './facility-model.js';
import {assessDrainagePumpPower,freezeDrainagePumpPower} from './drainage-power-model.js?v=0.43.0';
import {pumpTasks,freezePumpTasks} from './pump-task-model.js?v=0.73.1';
export const DRAINAGE_REVIEW_MILES=1;
export const DRAINAGE_REVIEW_LIMIT=1000;
export const DRAINAGE_RAIN_BOUNDS=Object.freeze([-120.95,35.88,-118.3,37.65]);
const fresh=(checked,age,now)=>Number.isFinite(checked)&&checked<=now+120000&&now-checked<=age;

/** Group existing inventory by exact normalized source code, never by inferred hydraulic connectivity. */
export function drainageReviewGroups(rows){
  const groups=new Map(),seen=new Map();
  for(const row of rows){
    if(row.category!=='existing'||!['basin','pump'].includes(row.kind))continue;
    if(seen.has(row.key)){if(JSON.stringify(seen.get(row.key))!==JSON.stringify(row))throw Error('Conflicting FMFCD selection IDs; refresh the source.');continue;}seen.set(row.key,row);
    if(seen.size>DRAINAGE_REVIEW_LIMIT)throw Error('FMFCD review inventory exceeds the bounded limit; request a smaller source view.');
    const code=row.code?.trim().toUpperCase(),id=code?'code:'+code:row.key;
    if(!groups.has(id))groups.set(id,{id,name:code?`FMFCD ${code}`:row.name,records:[]});groups.get(id).records.push(row);
  }
  return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

/** Complete, cancellable full-geometry vicinity joins; source/map display filters never enter this lookup. */
export async function drainageVicinity(groups,roads,facilities,lookup,current=()=>true,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))){
  // The road adapter validates the query response's WGS84 CRS; individual ArcGIS feature geometries omit the inherited reference.
  const entries=[...(roads?.snapshot?.rows||[]).map(row=>({kind:'road-record',key:row.key,geometry:row.geometry?{...row.geometry,spatialReference:row.geometry.spatialReference||{wkid:4326}}:null,history:row.active==='no',record:row})),...(facilities?.connected?facilities.sites:[]).map(row=>({kind:'asset',key:row.site.key,geometry:row.site.geometry,record:row}))];
  const result=new Map();
  for(const group of groups){
    const near={roads:new Map(),facilities:new Map(),unknown:0};
    for(const record of group.records){
      if(!current())return null;
      const found=await lookup(record.geometry,entries,{miles:DRAINAGE_REVIEW_MILES,history:false,current,limit:Number.MAX_SAFE_INTEGER});if(!found||!current())return null;
      for(const [kind,key]of [['road-record','roads'],['asset','facilities']]){near.unknown+=found[kind].unknown;for(const row of found[kind].rows){const prior=near[key].get(row.key);if(!prior||row.distanceMeters<prior.distanceMeters)near[key].set(row.key,row);}}
    }
    result.set(group.id,{roads:[...near.roads.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.key.localeCompare(b.key)),facilities:[...near.facilities.values()].sort((a,b)=>a.distanceMeters-b.distanceMeters||a.key.localeCompare(b.key)),geometryIncomplete:near.unknown>0});
    await yieldTask();
  }
  return current()?result:null;
}

/** Published road dates are evidence, not confirmation of closure duration or reopening. */
export function drainageRoadTiming(row,cycle){
  if(!cycle||!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.end<=row.start)return 'Timing unknown / contradictory';
  return row.start<cycle.end&&row.end>cycle.start?'Published dates overlap rainfall window':'Published dates do not overlap rainfall window';
}

/** Explainable coordination cues, with separate inventory, rain, road and facility freshness. No risk score. */
export function assessDrainageReviews({groups,vicinity,snapshot,rain,roads,facilities,power,previousPower,readinessState,config},now=Date.now()){
  const inventoryCurrent=!!snapshot?.connected&&!snapshot.error&&fresh(snapshot.checked,DRAINAGE_MAX_AGE,now);
  const cycle=rain?.cycle,rainCurrent=!!cycle&&!rain.error&&fresh(rain.checked,config.weatherCheckMaxAgeMs,now)&&fresh(cycle.issue,config.qpfMaxAgeMs,now)&&cycle.end>now&&cycle.hours===72;
  const roadCurrent=!!roads?.snapshot&&!roads.error&&fresh(roads.snapshot.checked,420000,now);
  const prepared=rainCurrent?(rain.features||[]).map(f=>({value:f.value,scope:powerScope(f.geometry)})):[];
  const pumpAssessments=assessDrainagePumpPower({records:groups.flatMap(g=>g.records),state:power,contours:prepared,cycle,rainCurrent,inventoryCurrent,previous:previousPower,readinessState},now);
  for(const record of groups.flatMap(g=>g.records)){const p=pumpAssessments.get(record.key);if(p)p.tasks=pumpTasks(record,readinessState,p.readiness.event,now);}
  return groups.map(group=>{
    const nearby=vicinity?.get(group.id),gaps=[];let maximum=null;
    const pumpPower=group.records.map(r=>pumpAssessments.get(r.key)).filter(Boolean),powerReview=pumpPower.some(p=>p.review),powerRain=pumpPower.some(p=>p.powerRain),readinessReview=pumpPower.some(p=>p.readinessReview);
    if(pumpPower.some(p=>p.evidence.gaps.length))gaps.push('Utility source coverage incomplete at pump locations; no overlap is not proof of power.');
    if(!inventoryCurrent)gaps.push('FMFCD retrieval overdue / unavailable; source maintenance age remains unknown.');
    if(!rainCurrent)gaps.push(rain?.error||'Rainfall source missing, expired or overdue.');
    else {const values=prepared.filter(f=>group.records.some(r=>f.scope.intersects(powerGeometry(r.geometry)))).map(f=>f.value);if(values.length)maximum=Math.max(...values);else gaps.push('No WPC polygon intersects this inventory group; amount unknown.');}
    if(!nearby)gaps.push('Nearby-record lookup is not ready.');else if(nearby.geometryIncomplete)gaps.push('Some road / facility geometries could not be assessed; nearby counts are incomplete.');
    if(!roadCurrent)gaps.push('Road source failed, missing or overdue; current access needs verification.');
    if(!facilities?.connected)gaps.push('County facilities are not connected; facility overlap is unassessed.');
    if(facilities?.sourceGaps)gaps.push('Connected facility inventory is incomplete or overdue.');
    const nearRoads=(nearby?.roads||[]).map(i=>({...i,timing:drainageRoadTiming(i.record,cycle),verification:!!(!roadCurrent||i.record.active!=='yes'||i.record.issues?.length>0||i.record.end&&i.record.end<=now)}));
    const nearFacilities=(nearby?.facilities||[]).map(i=>({...i,current:!i.record.site.sourceError&&fresh(i.record.site.fetched,FACILITY_MAX_AGE,now)}));
    if(nearFacilities.some(i=>!i.current))gaps.push('Nearby facility records have unverified / old retrievals.');
    const rainfall=inventoryCurrent&&rainCurrent&&maximum!==null&&maximum>0;
    const combined=rainfall&&(nearFacilities.length>0||nearRoads.some(i=>i.timing!=='Published dates do not overlap rainfall window'));
    const taskReview=pumpPower.some(p=>p.tasks.rows.some(t=>t.active||t.needsReview));
    const roadVerification=nearRoads.some(i=>i.verification),review=taskReview||rainfall||powerReview||readinessReview||roadVerification||gaps.length>0;
    return {...group,roads:nearRoads,facilities:nearFacilities,pumpPower,powerReview,powerRain,readinessReview,gaps,maximum,cycle,checked:rain?.checked,inventoryChecked:snapshot?.checked,inventoryCurrent,rainCurrent,roadCurrent,roadChecked:roads?.snapshot?.checked,review,combined,rainfall,
      change:powerRain?'Pump power concern + forecast precipitation: review backup readiness':powerReview?'Pump power needs verification':readinessReview?'Pump backup readiness needs follow-up':combined?'Forecast precipitation + nearby county records: review readiness':rainfall?'Forecast precipitation: verify basin / pump readiness':roadVerification?'Nearby road status needs verification':gaps.length?'Evidence incomplete: verification needed':'No current drainage review cue; check source coverage',
      nextReview:powerReview?pumpPower.find(p=>p.review).nextReview:'Planning / Operations: confirm FMFCD capacity and pump operation, rainfall timing with NWS, site backup power, resource lead time and approved staging access before recommending prepositioning.'};
  }).sort((a,b)=>Number(b.powerRain)-Number(a.powerRain)||Number(b.powerReview)-Number(a.powerReview)||Number(b.combined)-Number(a.combined)||Number(b.rainfall)-Number(a.rainfall)||Number(b.review)-Number(a.review)||a.name.localeCompare(b.name));
}

/** Immutable, tab-only handoff evidence. Source ObjectIDs remain qualified as retrieval-session references. */
export function freezeDrainageReview(row,now=Date.now()){
  return structuredClone({schemaVersion:1,kind:'drainage-planning-evidence',classification:'Private planning review cue',id:row.id,name:row.name,capturedAt:now,change:row.change,nextReview:row.nextReview,gaps:row.gaps,
    inventory:{retrieved:row.inventoryChecked,records:row.records.map(r=>({selectionKey:r.key,kind:r.kind,code:r.code,sourceUpdated:r.updated,status:r.status})),note:'ObjectIDs identify this retrieval only. A shared source code is not a validated hydraulic connection.'},
    rainfall:{maximumIntersectingLabel:row.maximum,units:'inches liquid equivalent',cycle:row.cycle,checked:row.checked,current:row.rainCurrent,note:'Highest WPC polygon label touching inventory geometry, not basin average, onset, runoff or flood depth.'},
    pumpPower:freezeDrainagePumpPower(row.pumpPower),
    pumpFollowups:row.pumpPower.map(p=>({pump:p.name,selectionKey:p.key,...freezePumpTasks(p.tasks)})),
    roads:row.roads.map(i=>({key:i.key,name:i.record.name,status:i.record.status,start:i.record.start,end:i.record.end,sourceTime:i.record.sourceTime,edited:i.record.edited,distanceMeters:i.distanceMeters,timing:i.timing,verification:i.verification})),
    facilities:row.facilities.map(i=>({key:i.key,name:i.record.site.name,owner:i.record.site.owner||null,backup:i.record.site.backup||null,retrieved:i.record.site.fetched,current:i.current,distanceMeters:i.distanceMeters})),
    note:'Within one mile by shortest horizontal geometry distance; proximity is not flood exposure, hydraulic connectivity, a safe route or a deployment order.'});
}
