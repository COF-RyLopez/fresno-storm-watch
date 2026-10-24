/** Read-only presentation of existing pump / readiness / weather assessments. No new action thresholds. */
export function pumpReadinessSummary(groups=[]){
  const seen=new Map();
  for(const group of groups)for(const p of group.pumpPower||[]){
    if(seen.has(p.key))continue;
    const r=p.readiness,e=r?.event,report=e?.payload;
    const current=!!r?.current&&!!report&&!!p.inventoryCurrent;
    const backup=current&&report.backup==='Unavailable',refuel=current&&report.fuel==='Refuel needed';
    const tasks=p.tasks?.rows||[],taskAttention=tasks.some(t=>t.active||t.needsReview);
    const attention=!!(r?.needsReview||p.review||!p.inventoryCurrent||taskAttention);
    const followup=taskAttention||attention&&(!current||p.review||report.backup==='Unknown'||report.backup==='Available'&&report.connection!=='Confirmed compatible / tested'||report.fuel==='Unknown'||report.runtimeHours===null||report.runtimeHours===0);
    const labels=[...(backup?['Backup power needed']:[]),...(refuel?['Refueling requested']:[]),...(followup?['Follow-up / unknown']:[])];
    if(!labels.length)labels.push(r?.needsReview?'Readiness unconfirmed':'Owner-confirmed details · check event needs');
    const reasons=[...(r?.reasons||[])];
    if(!e&&!r?.history?.length)reasons.push('No usable owner confirmation is available.');
    if(!p.inventoryCurrent)reasons.push('Pump inventory retrieval is overdue / unavailable; reconfirm the source association.');
    if(p.review)reasons.push('A utility-area concern still needs verification; readiness does not clear it.');
    const wet=!!(p.inventoryCurrent&&p.rainCurrent&&p.maximum!==null&&p.maximum>0),resource=backup||refuel;
    seen.set(p.key,{key:p.key,groupId:group.id,name:report?.pumpLabel||p.name,sourceName:p.name,code:p.code,labels,reasons,backup,refuel,followup,attention,current,
      unconfirmed:!current,contact:e?{owner:report.owner,method:report.contact,current,observed:report.observed,submitted:e.created,author:e.author}:null,
      runtimeHours:report?.runtimeHours??null,reviewDue:report?.validUntil??null,readinessLabel:r?.label||'Readiness unconfirmed',
      rain:{value:p.maximum,current:!!p.rainCurrent,cycle:group.cycle||null,checked:group.checked},
      // Explicit review order; not a severity score, runtime adequacy test or dispatch priority.
      order:p.powerRain?0:wet&&resource?1:resource?2:wet&&attention?3:attention?4:5,
      tasks:tasks.map(t=>({type:t.type,owner:t.owner,assigneeType:t.assigneeType,due:t.due,status:t.status,active:t.active,overdue:t.overdue,changed:t.changed,conflict:t.conflict})),utilityConcern:!!p.review,powerRain:!!p.powerRain});
  }
  const rows=[...seen.values()].sort((a,b)=>a.order-b.order||Number(a.reviewDue===null)-Number(b.reviewDue===null)||(a.reviewDue??0)-(b.reviewDue??0)||a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
  return {rows,counts:{total:rows.length,attention:rows.filter(r=>r.attention).length,backup:rows.filter(r=>r.backup).length,refuel:rows.filter(r=>r.refuel).length,followup:rows.filter(r=>r.followup).length,unconfirmed:rows.filter(r=>r.unconfirmed).length}};
}

export function filterPumpSummary(rows,{filter='attention',search=''}={}){
  const query=String(search).trim().toLocaleLowerCase('en-US');
  return rows.filter(r=>(filter==='all'||!!r[filter])&&[r.name,r.sourceName,r.code,r.contact?.owner,...(r.tasks||[]).map(t=>t.owner)].filter(Boolean).join(' ').toLocaleLowerCase('en-US').includes(query));
}
