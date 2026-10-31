import {areaPowerEvidence} from './area-concern-model.js';
import {pointInRings} from './power-geometry.js';
import {searchGeometry,METERS_PER_MILE} from './nearby-search.js';
import {roadInCurrentView} from './roads.js';
import {current as fresh} from './dwr-supply-planning-model.js';

const dateFormat=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
export const careTime=value=>Number.isFinite(value)?dateFormat.format(value):'Not supplied';
export const CARE_ROAD_MILES=1;
export const careIdentity=f=>JSON.stringify([f.key,f.sourceId,f.name,f.address,f.city,f.geometry]);
const activeZone=z=>['Order','Warn','unknown'].includes(z.status);

/** One-mile horizontal distance to whole county road geometries; never a routing test. */
export async function careRoadVicinity(facilities,roads,lookup,{current=()=>true,yieldTask=()=>new Promise(r=>setTimeout(r,0))}={}){
 if(!roads?.snapshot||typeof lookup!=='function')return null;
 const entries=roads.snapshot.rows.map(record=>({key:record.key,kind:'road-record',record,history:record.active==='no',geometry:record.geometry?{...record.geometry,spatialReference:record.geometry.spatialReference||{wkid:4326}}:null}));
 const result=new Map();
 for(const f of new Map(facilities.map(f=>[f.key,f])).values()){
  if(!current())return null;
  const found=await lookup(f.geometry,entries,{miles:CARE_ROAD_MILES,history:false,current,limit:Number.MAX_SAFE_INTEGER});
  if(!found||!current())return null;
  result.set(f.key,{rows:found['road-record'].rows,unknown:found['road-record'].unknown,checked:roads.snapshot.checked,identity:careIdentity(f)});
  await yieldTask();
 }
 return current()?result:null;
}

/** County point-in-zone and utility polygon matches. Overture guesses never drive review flags. */
export function assessCareReviews({facilities,zones,power,roads,vicinity,previous=new Map(),sourceErrors={}},now=Date.now()){
 if(!facilities)return [];
 const zoneIndex=(zones?.rows||[]).map(z=>({zone:z,bounds:searchGeometry(z.geometry)?.bounds}));
 const facilitiesCurrent=fresh(facilities.checked,sourceErrors.facilities,now);
 const zoneCurrent=!!zones&&fresh(zones.checked,sourceErrors.zones,now);
 const roadCurrent=!!roads?.snapshot&&fresh(roads.snapshot.checked,roads.error,now);
 const result=[];
 for(const f of new Map(facilities.rows.map(f=>[f.key,f])).values()){
  if(!searchGeometry(f.geometry)||f.geometry.rings||f.geometry.paths)throw Error('Resident-care location requires a WGS84 point.');
  const identity=careIdentity(f),prior=previous.get(f.key)?.identity===identity?previous.get(f.key):null;
  const matchedZones=zoneIndex.filter(({bounds:b,zone:z})=>b&&f.geometry.x>=b[0]&&f.geometry.x<=b[2]&&f.geometry.y>=b[1]&&f.geometry.y<=b[3]&&pointInRings([f.geometry.x,f.geometry.y],z.geometry.rings)).map(i=>i.zone);
  const zoneFollowups=[...new Map([...(prior?.zones||[]).filter(activeZone),...(prior?.zoneFollowups||[])].filter(z=>!matchedZones.some(n=>n.key===z.key&&activeZone(n))).map(z=>[z.key,matchedZones.find(n=>n.key===z.key)||z])).values()];
  const powerEvidence=areaPowerEvidence(power,[{id:f.key,name:f.name,longitude:f.geometry.x,latitude:f.geometry.y}],now,prior?.power);
  const powerReviews=[...new Map([...powerEvidence.active,...powerEvidence.pending,...powerEvidence.followups].map(m=>[m.row.key,m])).values()].map(m=>{
   const current=powerEvidence.matches.find(n=>n.row.key===m.row.key),match=current||m;
   return {...match,returned:!!current,followup:powerEvidence.followups.some(n=>n.row.key===m.row.key),sourceRetrieved:current?power?.feeds?.find(feed=>feed.id===match.row.feedId)?.lastSuccess||null:prior?.powerReviews.find(n=>n.row.key===match.row.key)?.sourceRetrieved||null};
  });
  const near=vicinity?.get(f.key),located=near?.identity===identity?near:null;
  const nearRoads=(located?.rows||[]).filter(r=>r.record.active!=='no').map(r=>({...r,verification:!roadCurrent||r.record.active!=='yes'||r.record.issues?.length>0}));
  const currentRoads=nearRoads.filter(r=>roadInCurrentView(r.record,now));
  const backlog=nearRoads.filter(r=>!roadInCurrentView(r.record,now)&&r.record.active==='yes');
  const roadFollowups=located?[...new Map([...(prior?.retainedRoads||prior?.roads||[]),...(prior?.roadFollowups||[])].filter(r=>!currentRoads.some(n=>n.key===r.key)).map(r=>[r.key,nearRoads.find(n=>n.key===r.key)||r])).values()]:prior?.roadFollowups||[];
  const retainedRoads=located?currentRoads:prior?.retainedRoads||prior?.roads||[];
  const order=matchedZones.some(z=>z.status==='Order'),warning=matchedZones.some(z=>z.status==='Warn'),unknownZone=matchedZones.some(z=>z.status==='unknown');
  const evacuationReview=order||warning||unknownZone||zoneFollowups.length>0,powerReview=powerReviews.length>0,roadReview=currentRoads.length>0||roadFollowups.length>0;
  const reasons=[...(order?['Evacuation planning: published Order at facility point']:warning?['Evacuation planning: published Warning at facility point']:[]),...(unknownZone?['County zone status needs verification']:[]),...(zoneFollowups.length?['Previous county zone concern changed / disappeared; verify disposition']:[]),...(powerReview?['Backup power: utility-area match / follow-up needs verification']:[]),...(currentRoads.length?['Nearby road records: review access and transport planning']:[]),...(roadFollowups.length?['Previous nearby road record changed / disappeared; verify access']:[])];
  const gaps=[...(!facilitiesCurrent?['CDPH query failed / overdue; facility location and operation require verification']:[]),...(!zoneCurrent?['County zone check failed / overdue; current direction unassessed']:[]),...powerEvidence.gaps,...(!roadCurrent?['County road check failed / overdue; access unassessed']:[]),...(!located?['Nearby-road distance comparison not ready']:located.unknown?['Some road geometries could not be assessed; nearby counts incomplete']:[]),...(facilities.accounting?.rejected?['CDPH inventory contains excluded invalid records']:[]),...(zones?.accounting?.rejected?['County zone inventory contains excluded invalid records']:[])];
  result.push({key:f.key,name:f.name,facility:f,identity,zones:matchedZones,zoneFollowups,power:powerEvidence,powerReviews,roads:currentRoads,backlog,roadFollowups,retainedRoads,evacuationReview,powerReview,roadReview,order,warning,review:reasons.length>0,reasons,gaps:[...new Set(gaps)],assessedAt:now,facilitiesChecked:facilities.checked,zonesChecked:zones?.checked,roadChecked:roads?.snapshot?.checked,facilitiesCurrent,zoneCurrent,roadCurrent,nearbyCurrent:!!located&&located.checked===roads?.snapshot?.checked,
   nextReview:'Planning / Operations: confirm current county direction and facility operation with the facility liaison; verify site power, backup connection, fuel/runtime, transport needs and approved access before recommending resources. Licensed beds are not current occupancy.'});
 }
 return result.sort((a,b)=>Number(b.order)-Number(a.order)||Number(b.warning)-Number(a.warning)||Number(b.powerReview)-Number(a.powerReview)||Number(b.roadReview)-Number(a.roadReview)||a.name.localeCompare(b.name));
}

/** Freeze attributes and exact source revisions; no private county inventory or inferred impacts. */
export function freezeCareReview(row,now=Date.now()){
 if(!row)return null;
 return structuredClone({schemaVersion:1,kind:'resident-care-review',name:row.name,key:row.key,capturedAt:now,reasons:row.reasons,gaps:row.gaps,nextReview:row.nextReview,facility:row.facility,facilitiesChecked:row.facilitiesChecked,zonesChecked:row.zonesChecked,zoneIssueTime:null,
  zones:row.zones.map(({key,name,status,rawStatus})=>({key,name,status,rawStatus})),zoneFollowups:row.zoneFollowups.map(({key,name,status,rawStatus})=>({key,name,status,rawStatus})),
  power:row.powerReviews.map(m=>({key:m.row.key,revision:m.row.revision,utility:m.row.utility,name:m.row.name,status:m.row.status,updated:m.row.updated,start:m.row.start,end:m.row.end,restoration:m.row.restoration,official:m.row.official,eligible:m.eligible,problem:m.problem,returned:m.returned,followup:m.followup,sourceRetrieved:m.sourceRetrieved})),
  roads:row.roads.map(r=>({key:r.key,revision:r.record.revision,name:r.record.name,kind:r.record.kind,status:r.record.status,start:r.record.start,end:r.record.end,sourceTime:r.record.sourceTime,edited:r.record.edited,distanceMeters:r.distanceMeters,verification:r.verification})),roadChecked:row.roadChecked,roadRadiusMeters:CARE_ROAD_MILES*METERS_PER_MILE,roadFollowups:row.roadFollowups.map(r=>({key:r.key,revision:r.record.revision,name:r.record.name,status:r.record.status,end:r.record.end,distanceMeters:r.distanceMeters})),historicalRoadContradictions:row.backlog.length,
  note:'Published CDPH point only. No confirmed outage at the site, circuit/service relationship, occupied campus boundary, safe route, transport requirement or evacuation decision. Backup power, contacts and occupancy require facility verification.'});
}
