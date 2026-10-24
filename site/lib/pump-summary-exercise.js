import {drainageReviewExercise} from './drainage-review-exercise.js?v=0.42.0';
import {pumpBinding,PUMP_READINESS_SCOPE} from './pump-readiness-contract.js';
import {emptyRecords} from './eoc-model.js?v=0.45.0';
/** Synthetic rehearsal only; no actual assets, contacts or operating facts. */
export function pumpSummaryExercise(now=Date.now()){
  const data=drainageReviewExercise(now),first=data.snapshot.rows.find(r=>r.kind==='pump'&&r.category==='existing');
  const second={...structuredClone(first),key:'fictional-pump-b',code:'EXERCISE-B',name:'Fictional pump B',geometry:{...first.geometry,x:first.geometry.x+.0001}},third={...structuredClone(first),key:'fictional-pump-c',code:'EXERCISE-C',name:'Fictional pump C',geometry:{...first.geometry,x:first.geometry.x+.0002}};
  data.snapshot.rows.push(second,third);
  const make=(pump,id,values)=>({id,entity:id,collection:'checklists',incident:PUMP_READINESS_SCOPE,supersedes:[],created:now-540000,author:'EXERCISE operator',payload:{kind:'pump-readiness',schema:1,binding:pumpBinding(pump),identityConfirmed:true,pumpLabel:pump.name,backup:'Available',connection:'Confirmed compatible / tested',fuel:'Confirmed available',runtimeHours:12,runtimeBasis:'FICTIONAL fuel and load assumption; not an actual pump.',owner:'Fictional FMFCD operator',contact:'EXERCISE radio A',observed:now-600000,validUntil:now+21600000,evidence:'FICTIONAL exercise confirmation only.',...values}});
  data.readinessRecords=emptyRecords();
  data.readinessRecords.checklists=[make(first,'exercise-backup',{backup:'Unavailable',connection:'Unknown'}),make(second,'exercise-refuel',{fuel:'Refuel needed',runtimeHours:2,validUntil:now+7200000,contact:'EXERCISE radio B'})];
  const binding=pumpBinding(first);
  data.readinessRecords.coordination=[{id:'exercise-backup-task',entity:'exercise-backup-task',collection:'coordination',incident:PUMP_READINESS_SCOPE,supersedes:[],created:now-300000,author:'EXERCISE operator',payload:{kind:'Follow-up',title:'Backup power · Fictional pump A',location:first.name,owner:'Fictional logistics team',due:now-60000,status:'Open',nextReview:'Verify portable backup availability and compatible connection with the pump owner.',evidence:'FICTIONAL task for rehearsal only.',sourceKey:'pump:'+first.key,pumpTask:{schema:1,binding,type:'Backup power',assigneeType:'Team',readinessEvent:'exercise-backup',identityConfirmed:true}}}];
  return data;
}
