import {areaPowerEvidence} from './area-concern-model.js';
import {powerGeometry} from './power-geometry.js';
import {pumpReadiness,freezePumpReadiness} from './pump-readiness-model.js';

/** Compare published intervals, never an estimated restoration time or an inferred rain onset. */
export function drainagePowerTiming(match,cycle,rainCurrent){
  if(['restored','cancelled'].includes(match.row.status))return {relation:'ended',label:'Utility reports restored / cancelled; verify power at the pump.'};
  if(!rainCurrent||!cycle)return {relation:'unknown',label:'Rainfall window unavailable / stale; relative timing unknown.'};
  const start=match.row.start?.time,end=match.row.end?.time;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return {relation:'unknown',label:'Utility start/end timing incomplete; restoration before rainfall is unconfirmed.'};
  if(end<=cycle.start)return {relation:'before',label:'Published utility window ends before rainfall window; verify restoration and backup readiness.'};
  if(start>=cycle.end)return {relation:'after',label:'Published utility window starts after rainfall window; keep as separate planning context.'};
  return {relation:'overlap',label:'Published utility dates overlap the rainfall accumulation window; this is not storm-onset timing.'};
}

/** Exact existing-pump / utility-polygon matches only. No buffers, circuit inference or generator association.
 * Runtime is bounded by the existing 1,000-record drainage and utility source limits.
 */
export function assessDrainagePumpPower({records,state,contours=[],cycle,rainCurrent=false,inventoryCurrent=false,previous=new Map(),readinessState},now=Date.now()){
  const result=new Map();
  for(const record of records){
    if(record.kind!=='pump'||record.category!=='existing'||result.has(record.key))continue;
    if((record.geometry?.spatialReference?.latestWkid||record.geometry?.spatialReference?.wkid)!==4326)throw Error('FMFCD pump location CRS is unverified; power matching stopped.');
    const geometry=powerGeometry(record.geometry);
    if(!Number.isFinite(geometry.x))throw Error('An existing FMFCD pump lacks a valid point location.');
    const location=JSON.stringify(geometry),prior=previous.get(record.key);
    const evidence=areaPowerEvidence(state,[{id:record.key,name:record.name,longitude:geometry.x,latitude:geometry.y}],now,prior?.location===location?prior.evidence:null);
    const amounts=rainCurrent?contours.filter(f=>f.scope.intersects(geometry)).map(f=>f.value):[];
    const maximum=amounts.length?Math.max(...amounts):null;
    const candidates=[...evidence.active,...evidence.pending,...evidence.followups];
    const reviews=[...new Map([...candidates,...evidence.matches.filter(m=>m.outside)].map(m=>[m.row.key,m])).values()].map(previousMatch=>{
      // A restored/cancelled revision must replace the old status in the retained follow-up.
      const current=evidence.matches.find(i=>i.row.key===previousMatch.row.key),m=current||previousMatch;
      return {...m,problem:m.problem||(m.row.status==='unknown'?'Utility status is unknown; verify the official source.':null),timing:drainagePowerTiming(m,cycle,rainCurrent),
        sourceRetrieved:current?state?.feeds?.find(f=>f.id===m.row.feedId)?.lastSuccess||null:prior?.reviews.find(i=>i.row.key===m.row.key)?.sourceRetrieved||null,
        returned:!!current,followup:evidence.followups.some(i=>i.row.key===m.row.key),previousRevision:previousMatch.row.revision!==m.row.revision?previousMatch.row.revision:null};
    });
    const review=candidates.length>0;
    const readiness=pumpReadiness(record,readinessState,now),readinessReview=readiness.needsReview&&(review||rainCurrent&&maximum>0||readiness.history.length>0);
    const powerRain=inventoryCurrent&&rainCurrent&&maximum!==null&&maximum>0&&reviews.some(m=>m.eligible&&!m.followup&&!['after','ended'].includes(m.timing.relation));
    result.set(record.key,{key:record.key,name:record.name,code:record.code,location,evidence,reviews,review,powerRain,maximum,rainCurrent,inventoryCurrent,readiness,readinessReview,backup:readiness.current?readiness.event?.payload.backup||null:null,
      label:powerRain?'Pump power concern + rainfall: verify timing and backup':review?'Pump power needs verification':reviews.length?'Future utility-area match outside the next 72 hours':evidence.gaps.length?'Utility coverage incomplete at pump':'No published utility-area match at pump',
      nextReview:'FMFCD / Operations: confirm this pump’s electrical service and operating state, backup connection and generator compatibility, critical load, fuel/runtime, staffing and approved access. Coordinate resource lead time with NWS rainfall timing before recommending prepositioning.'});
  }
  return result;
}

/** Freeze only evidence attributes; private pump coordinates and utility polygons stay out of handoff payloads. */
export function freezeDrainagePumpPower(pumps=[]){
  return structuredClone(pumps.map(p=>({pumpKey:p.key,name:p.name,code:p.code,backup:p.backup,review:p.review,label:p.label,nextReview:p.nextReview,readiness:freezePumpReadiness(p.readiness),readinessReview:p.readinessReview,
    rainfall:{maximumIntersectingLabel:p.maximum,units:'inches liquid equivalent',current:p.rainCurrent},checked:p.evidence.checked,gaps:p.evidence.gaps,pointOnly:p.evidence.pointOnly,
    utility:p.reviews.map(m=>({key:m.row.key,revision:m.row.revision,previousRevision:m.previousRevision,utility:m.row.utility,name:m.row.name,status:m.row.status,official:m.row.official,start:m.row.start,end:m.row.end,restoration:m.row.restoration,updated:m.row.updated,sourceRetrieved:m.sourceRetrieved,issues:m.row.issues,problem:m.problem,eligible:m.eligible,outside:m.outside,returned:m.returned,followup:m.followup,timing:m.timing})),
    note:'A utility polygon contains the mapped pump point; electrical service, loss of power, backup operation and hydraulic consequences remain unconfirmed.'})));
}
