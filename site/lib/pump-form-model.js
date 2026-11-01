import {pumpBinding,bindingKey} from './pump-readiness-contract.js';
import {DRAINAGE_MAX_AGE} from './drainage-model.js';
import {fresh} from './source-health-model.js';
/** Source identity and geometry stay in memory, never in share links or browser persistence. */
export function pumpFormChoices(rows,query=''){
  const seen=new Map(),text=String(query).trim().toLocaleLowerCase('en-US');
  for(const row of rows){
    if(row.kind!=='pump'||row.category!=='existing')continue;
    const key=bindingKey(pumpBinding(row));
    if(seen.has(row.key)){if(bindingKey(pumpBinding(seen.get(row.key)))!==key)throw Error('Conflicting pump inventory IDs. Refresh the pump list.');continue;}
    seen.set(row.key,row);
  }
  return [...seen.values()].filter(r=>`${r.name} ${r.code}`.toLocaleLowerCase('en-US').includes(text)).sort((a,b)=>a.name.localeCompare(b.name)||a.key.localeCompare(b.key));
}
export function pumpFormCurrent(record,inventory,now=Date.now()){
  if(!record||!inventory?.connected||inventory.error||!fresh(inventory.checked,DRAINAGE_MAX_AGE,now,60000))return false;
  if(inventory.maxSourceAgeMs!==undefined&&(!Number.isFinite(inventory.sourceChecked)||inventory.sourceChecked>now+60000||!Number.isFinite(inventory.maxSourceAgeMs)||inventory.maxSourceAgeMs<=0||now-inventory.sourceChecked>inventory.maxSourceAgeMs))return false;
  const key=bindingKey(pumpBinding(record));
  return inventory.rows.some(r=>r.kind==='pump'&&r.category==='existing'&&bindingKey(pumpBinding(r))===key);
}
/** Preserve an open draft only while the original pump identity and location still match. */
export function pumpFormRetainsSelection(record,rows){
  return Boolean(record&&rows.some(r=>r.kind==='pump'&&r.category==='existing'&&r.key===record.key&&bindingKey(pumpBinding(r))===bindingKey(pumpBinding(record))));
}
export function pumpFormLink(base,{exercise=false,acceptance=false}={}){
  const url=new URL('./pump-readiness.html',base);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Unsupported form address.');
  if(exercise)url.searchParams.set('exercise','1');else if(acceptance)url.searchParams.set('acceptance','1');return url.href;
}
