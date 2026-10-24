import {validatePumpReadiness,bindingKey} from '../../site/lib/pump-readiness-contract.js';
/** Pure preview: O(n) exact maintained-ID join. Never writes AGOL or infers nearest assets. */
export function previewFmfcdReadiness({rows,mapping,crosswalk,now=Date.now()}){
  if(mapping?.schema!==1||!mapping.publisher||!mapping.schemaVersion||!mapping.fields?.assetId||!mapping.fields?.sourceRevision||!Array.isArray(rows)||!Array.isArray(crosswalk))throw Error('Provide a versioned field mapping, publisher, source revision and reviewed maintained-ID crosswalk.');
  const ids=new Map(),bindings=new Map(),seen=new Set(),accepted=[],rejected=[];
  for(const x of crosswalk){if(!x.assetId||!x.reviewedBy||!x.reviewedAt||!x.binding)throw Error('Every crosswalk row needs a maintained asset ID, source association, reviewer and review time.');const k=String(x.assetId),b=bindingKey(x.binding);if(ids.has(k)||bindings.has(b))throw Error('Ambiguous crosswalk: asset IDs and pump associations must be one-to-one.');ids.set(k,x);bindings.set(b,k);}
  const fields=['pumpLabel','backup','connection','fuel','runtimeHours','runtimeBasis','owner','contact','observed','validUntil','evidence'];
  for(const [index,row]of rows.entries()){
    try{
      const assetId=String(row[mapping.fields.assetId]??'').trim(),revision=String(row[mapping.fields.sourceRevision]??'').trim();if(!assetId||!revision)throw Error('Maintained ID / source revision missing.');if(seen.has(assetId))throw Error('Duplicate source asset ID; reconcile the whole batch.');seen.add(assetId);
      const match=ids.get(assetId);if(!match)throw Error('No reviewed maintained-ID match.');
      const p={kind:'pump-readiness',schema:1,binding:structuredClone(match.binding),identityConfirmed:true};
      for(const key of fields){const column=mapping.fields[key],raw=column?row[column]:undefined;
        if(['backup','connection','fuel'].includes(key)){const table=mapping.values?.[key];if(!table||!Object.hasOwn(table,String(raw)))throw Error(`Unmapped ${key} value.`);p[key]=table[String(raw)];}
        else if(['observed','validUntil'].includes(key)){if(typeof raw!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(raw))throw Error(`${key} needs ISO 8601 with an explicit time zone.`);p[key]=Date.parse(raw);}
        else if(key==='runtimeHours'){if(raw===null||raw===undefined||raw==='')p[key]=null;else {if(typeof raw!=='number'||mapping.runtimeUnits!=='hours')throw Error('Runtime must be a numeric value with documented hours units.');p[key]=raw;}}
        else p[key]=raw===null||raw===undefined?'':String(raw).trim();
      }
      validatePumpReadiness(p,now);if(p.validUntil<=now)throw Error('Owner review already expired.');
      accepted.push({assetId,sourceRevision:revision,payload:p,provenance:{publisher:mapping.publisher,schemaVersion:mapping.schemaVersion,reviewedBy:match.reviewedBy,reviewedAt:match.reviewedAt}});
    }catch(e){rejected.push({row:index+1,reason:e.message});}
  }
  // A duplicate ID invalidates every row for that ID, never just the later duplicate.
  const counts=new Map();for(const row of rows){const id=String(row[mapping.fields.assetId]??'').trim();counts.set(id,(counts.get(id)||0)+1);}
  const safe=accepted.filter(r=>{if(counts.get(r.assetId)===1)return true;rejected.push({row:rows.findIndex(x=>String(x[mapping.fields.assetId]??'').trim()===r.assetId)+1,reason:'Duplicate source asset ID; reconcile the whole batch.'});return false;});
  return {schema:1,previewOnly:true,generated:now,inputCount:rows.length,accepted:safe,rejected,counts:{accepted:safe.length,rejected:rejected.length},note:'No AGOL write. A county reviewer must verify the current pump associations and source revisions before applying updates. Task status is never imported from readiness attributes.'};
}
