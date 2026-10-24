import {heads} from './eoc-model.js?v=0.45.0';
import {pumpBinding,bindingKey} from './pump-readiness-contract.js';
export const tasksCurrent=(s,now=Date.now())=>!!s?.connected&&!s.error&&Number.isFinite(s.checked)&&s.checked<=now+60000&&now-s.checked<=120000;
/** One explicit task per pump and type; concurrent heads never become confirmed completion. */
export function pumpTasks(record,state,readinessEvent=null,now=Date.now()){
  if(!tasksCurrent(state,now))return {current:false,history:[],rows:[]};
  const key=bindingKey(pumpBinding(record)),history=(state.tasks||[]).filter(e=>bindingKey(e.payload.pumpTask?.binding)===key);
  const versions=heads(history),byType=new Map();for(const h of versions){const type=h.record.payload.pumpTask.type,arr=byType.get(type)||[];arr.push(h);byType.set(type,arr);}
  const rows=[...byType].map(([type,list])=>{
    const events=list.flatMap(h=>h.heads),e=list[0].record,p=e.payload,conflict=list.length>1||list.some(h=>h.conflict);
    const active=events.some(e=>!['Complete','Canceled'].includes(e.payload.status)),overdue=events.some(e=>!['Complete','Canceled'].includes(e.payload.status)&&e.payload.due<=now),changed=events.some(e=>e.payload.pumpTask.readinessEvent!==(readinessEvent?.id||null));
    return {event:e,type,owner:conflict?[...new Set(events.map(e=>e.payload.owner))].join(' / '):p.owner,assigneeType:conflict?'Review owners':p.pumpTask.assigneeType,due:Math.min(...events.map(e=>e.payload.due)),status:conflict?'Conflicting updates':p.status,active,conflict,overdue,changed,needsReview:conflict||changed||overdue};
  });
  return {current:true,history,rows:rows.sort((a,b)=>Number(b.needsReview)-Number(a.needsReview)||a.due-b.due||a.type.localeCompare(b.type))};
}
export function pumpTaskCounts(groups,state,now=Date.now()){
  if(state&&!tasksCurrent(state,now))return null;
  const pumps=new Map(groups.flatMap(g=>g.pumpPower.map(p=>[p.key,p]))),rows=[...pumps.values()].flatMap(p=>p.tasks?.rows||[]);
  const matched=new Set([...pumps.values()].flatMap(p=>(p.tasks?.history||[]).map(e=>bindingKey(e.payload.pumpTask.binding))));
  const unmatched=new Set((state?.tasks||[]).filter(e=>!matched.has(bindingKey(e.payload.pumpTask.binding))).map(e=>bindingKey(e.payload.pumpTask.binding))).size;
  return {unmatched,active:rows.filter(t=>t.active||t.conflict).length,overdue:rows.filter(t=>t.overdue).length,review:rows.filter(t=>t.needsReview).length};
}
export function freezePumpTasks(taskState){
  return structuredClone({current:!!taskState?.current,records:(taskState?.history||[]).map(e=>({id:e.id,entity:e.entity,supersedes:e.supersedes,created:e.created,author:e.author,payload:e.payload})),summary:(taskState?.rows||[]).map(t=>({event:t.event.id,type:t.type,owner:t.owner,assigneeType:t.assigneeType,due:t.due,status:t.status,overdue:t.overdue,changed:t.changed,conflict:t.conflict})),note:'Assignment status is separate from pump readiness and utility status. Snapshot retains exact task versions; no dispatch or message was sent.'});
}
