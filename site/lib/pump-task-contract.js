import {validBinding} from './pump-readiness-contract.js';
export const PUMP_TASK_TYPES=['Backup power','Refueling','Verification'];
export const PUMP_TASK_STATUSES=['Open','In progress','Complete','Canceled'];
/** Optional typed payload on the existing append-only coordination collection. */
export function validatePumpTask(p){
  const t=p.pumpTask,b=t?.binding;
  if(p.kind!=='Follow-up'||t?.schema!==1||!PUMP_TASK_TYPES.includes(t.type))throw Error('Pump follow-up type is invalid.');
  if(!validBinding(b))throw Error('Pump follow-up source association is invalid.');
  if(!['Person','Team'].includes(t.assigneeType))throw Error('Choose a person or team.');
  if(t.readinessEvent!==null&&(typeof t.readinessEvent!=='string'||!t.readinessEvent))throw Error('Pump readiness reference is invalid.');
  if(t.identityConfirmed!==true)throw Error('Confirm the selected pump identity.');
  for(const key of ['owner','title','location','nextReview','evidence'])if(typeof p[key]!=='string'||!p[key].trim()||p[key].length>1500)throw Error(`${key} is required (up to 1,500 characters).`);
  return p;
}
