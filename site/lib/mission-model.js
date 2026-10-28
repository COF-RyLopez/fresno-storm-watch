/** Presentation summaries reuse domain assessments; no new hazard score or thresholds. */
export function concernSummary(row){
 const observed=(row.gauges||[]).map(g=>g.assessment?.observed?.time).filter(Number.isFinite);
 const forecast=(row.gauges||[]).map(g=>g.assessment?.peak?.time).filter(Number.isFinite);
 const changes=[row.status,...(row.scheduled||[]).map(n=>n.label||n.title||'Scheduled release notice'),row.forecastDifference?.review?'Forecast models differ; inspect timing':null].filter(Boolean);
 return {id:row.area.id,name:row.area.name,change:changes.join(' · '),review:!!row.review,rank:row.rank||0,quality:row.gaps?.length?`${row.gaps.length} evidence gaps`:'Inspect publisher times and coverage',observed:observed.length?Math.max(...observed):null,forecast:forecast.length?Math.min(...forecast):null,nextReview:'Confirm operator guidance, field conditions, site power and approved access.',points:(row.samplePoints||[]).map(p=>({id:p.id,longitude:p.longitude,latitude:p.latitude})),gaps:[...(row.gaps||[])]};
}
export const concernOrder=(a,b)=>Number(b.review)-Number(a.review)||b.rank-a.rank||a.name.localeCompare(b.name);
/** A draft captures selected evidence at that moment; it never refreshes silently. */
export function freezeConcern(row,context,now=Date.now()){
 const summary=concernSummary(row);
 return structuredClone({schemaVersion:1,kind:'planning-evidence',capturedAt:now,classification:'Planning review cue',...summary,roads:(context?.roads||[]).map(i=>({key:i.row.key,name:i.row.name,status:i.row.status,sourceTime:i.row.sourceTime,edited:i.row.edited})),facilities:(context?.facilities||[]).map(i=>({id:i.row.site.key,name:i.row.site.name,owner:i.row.site.owner||null,backupPower:i.row.site.backup||null})),gaugeEvidence:(row.gauges||[]).map(g=>({id:g.id,observed:g.assessment?.observed||null,forecastPeak:g.assessment?.peak||null,forecastIssued:g.gauge?.forecast?.issued||null,observedUnits:g.gauge?.observed?.units||null,forecastUnits:g.gauge?.forecast?.units||null,current:!!g.assessment?.current})),note:'Nearby records are context around watchpoints, not modeled exposure or confirmed access.'});
}
export function briefText(title,items,time){return [`DRAFT · ${title}`,'Not an approved briefing or state-system submission.',...items.flatMap((i,n)=>[`\n${n+1}. ${i.name||i.title||i.runId}`,`Captured: ${time(i.capturedAt)}`,...pumpHandoffLines(i,time),...incidentHandoffLines(i,time),JSON.stringify(i,null,2)])].join('\n');}

/** Readable handoff plus exact versions in the evidence JSON. */
export function pumpHandoffLines(item,time){return (item.pumpFollowups||[]).flatMap(p=>[`${p.pump}: ${p.current?'saved task snapshot':'assignments unassessed'}`,...p.summary.map(t=>`${t.type} · ${t.status}${t.overdue?' · OVERDUE':''} · ${t.assigneeType}: ${t.owner} · due ${time(t.due)}${t.changed?' · readiness changed; review assignment':''} · version ${t.event}`)]);}
/** Exact captured task versions, not a live completion or approval claim. */
export function incidentHandoffLines(item,time){const s=item.incidentFollowups;if(!s)return [];return [s.assessed?`Incident follow-ups: ${s.incident} · checked ${time(s.checked)}`:'Incident follow-ups unassessed at capture.',...(s.rows||[]).map(r=>`${r.title} · ${r.status}${r.overdue?' · OVERDUE':''} · owner ${r.owner} · due ${time(r.due)} · version ${r.event}`)];}
