import {DRAINAGE_URL,DRAINAGE_LAYERS,drainageRecord,drainageCounts} from './drainage-model.js';
import {canonical,digest} from './eoc-model.js?v=0.74.0-helpers';
export const COPY_TAG='frog-fmfcd-pumps-copy-v1';
export const COPY_PARENT='frog_fmfcd_pumps_exercise_2026_27';
export const COPY_VIEW=COPY_PARENT+'_read';
const spec=DRAINAGE_LAYERS.find(s=>s.kind==='pump');
const FIELDS=[['source_oid','esriFieldTypeInteger'],['source_code','esriFieldTypeString',255],['source_subtype','esriFieldTypeInteger'],['source_modified','esriFieldTypeDate'],['source_x','esriFieldTypeDouble'],['source_y','esriFieldTypeDouble'],['snapshot_id','esriFieldTypeString',36],['source_checked','esriFieldTypeDate'],['source_count','esriFieldTypeInteger'],['existing_count','esriFieldTypeInteger'],['source_digest','esriFieldTypeString',64],['row_key','esriFieldTypeString',80]];
export const COPY_FIELDS=FIELDS.map(([n])=>n);
export function pumpCopyLayer(){
  const fields=[{name:'OBJECTID',type:'esriFieldTypeOID',alias:'Object ID',nullable:false,editable:false}];
  for(const [name,type,length]of FIELDS)fields.push({name,alias:name,type,nullable:['source_subtype','source_modified'].includes(name),editable:true,...(length?{length}:{})});
  return {id:0,name:'FMFCD pump source snapshots',type:'Feature Layer',geometryType:'esriGeometryPoint',objectIdField:'OBJECTID',displayField:'source_code',spatialReference:{wkid:4326},extent:{xmin:-125,ymin:32,xmax:-114,ymax:43,spatialReference:{wkid:4326}},fields,capabilities:'Query,Create',allowGeometryUpdates:false,indexes:[{name:'row_key_unique',fields:'row_key',isUnique:true,isAscending:true},{name:'snapshot_idx',fields:'snapshot_id',isUnique:false,isAscending:true}]};
}
export function verifyCopySchema(metadata){
  if(metadata.geometryType!=='esriGeometryPoint'||COPY_FIELDS.some(name=>!metadata.fields?.some(f=>f.name===name)))throw Error('Pump-copy schema is incomplete. Keep the existing items and ask GIS to inspect them.');
}
export function copyRecord(a){
  if(!Number.isSafeInteger(a.source_oid)||a.source_oid<1||typeof a.source_code!=='string'||!Number.isFinite(a.source_x)||!Number.isFinite(a.source_y)||a.source_subtype!==null&&!Number.isInteger(a.source_subtype)||a.source_modified!==null&&!Number.isFinite(a.source_modified))throw Error('Invalid source association in the AGOL pump copy.');
  return drainageRecord(spec,{attributes:{OBJECTID:a.source_oid,DA:a.source_code,SUBTYPE:a.source_subtype,MODIFIEDDATE:a.source_modified},geometry:{x:a.source_x,y:a.source_y}},'OBJECTID');
}
const sourceShape=r=>({id:r.objectId,code:r.code,subtype:r.subtype,modified:r.updated,x:r.geometry.x,y:r.geometry.y});
export async function preparePumpCopy(rows,now=Date.now(),id=crypto.randomUUID()){
  if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isFinite(now)||now<=0)throw Error('Invalid pump-copy snapshot identity/time.');
  if(!rows.length||rows.length>5000||rows.some(r=>r.kind!=='pump'||!Number.isSafeInteger(r.objectId)||r.key!==`fmfcd:0:${r.objectId}`)||new Set(rows.map(r=>r.key)).size!==rows.length)throw Error('Source pump inventory is empty, incomplete or has duplicate IDs.');
  const ordered=[...rows].sort((a,b)=>a.objectId-b.objectId);for(const r of ordered){const decoded=copyRecord({source_oid:r.objectId,source_code:r.code,source_subtype:r.subtype,source_modified:r.updated,source_x:r.geometry.x,source_y:r.geometry.y});if(canonical(sourceShape(decoded))!==canonical(sourceShape(r)))throw Error('Source pump normalization changed; no copy was prepared.');}
  const counts=drainageCounts(ordered);if(!counts.pumps)throw Error('No existing pumps in the source inventory.');
  const hash=await digest(ordered.map(sourceShape));
  return {id,checked:now,hash,counts,total:ordered.length,features:ordered.map(r=>({geometry:r.geometry,attributes:{source_oid:r.objectId,source_code:r.code,source_subtype:r.subtype,source_modified:r.updated,source_x:r.geometry.x,source_y:r.geometry.y,snapshot_id:id,source_checked:now,source_count:ordered.length,existing_count:counts.pumps,source_digest:hash,row_key:`${id}:${r.objectId}`}}))};
}
export async function verifyStagedCopy(features,snapshot){
  if(features.length!==snapshot.total)throw Error('Staged snapshot count does not match the complete source inventory.');
  const records=features.map(f=>{const a=f.attributes;if(a.snapshot_id!==snapshot.id||a.source_checked!==snapshot.checked||a.source_count!==snapshot.total||a.existing_count!==snapshot.counts.pumps||a.source_digest!==snapshot.hash||a.row_key!==`${snapshot.id}:${a.source_oid}`)throw Error('Staged snapshot provenance differs from its source.');return copyRecord(a);});
  if(new Set(records.map(r=>r.key)).size!==records.length||await digest(records.sort((a,b)=>a.objectId-b.objectId).map(sourceShape))!==snapshot.hash)throw Error('Staged snapshot content differs from its source.');
  return records;
}
/** Original source XY attributes preserve exact readiness bindings despite hosted geometry reprojection. */
export function readPumpCopy(features,now=Date.now()){
  if(!features.length)throw Error('No existing pump records returned from the private AGOL copy.');
  const a=features[0].attributes;
  if(!/^[a-f0-9-]{36}$/.test(a.snapshot_id)||!/^[a-f0-9]{64}$/.test(a.source_digest)||!Number.isFinite(a.source_checked)||a.source_checked>now+60000||!Number.isSafeInteger(a.existing_count)||a.existing_count!==features.length||!Number.isSafeInteger(a.source_count)||a.source_count<features.length)throw Error('Pump-copy count or source provenance is invalid.');
  const rows=features.map(f=>{const b=f.attributes;for(const field of ['snapshot_id','source_checked','source_count','existing_count','source_digest'])if(b[field]!==a[field])throw Error('Mixed or partial pump-copy snapshots; refresh required.');const r=copyRecord(b);if(r.category!=='existing'||b.row_key!==`${a.snapshot_id}:${r.objectId}`)throw Error('The form view must contain existing pumps only.');return r;});
  if(new Set(rows.map(r=>r.key)).size!==rows.length)throw Error('Duplicate pump-copy source associations.');
  return {rows,sourceChecked:a.source_checked,snapshot:a.snapshot_id,total:a.source_count,digest:a.source_digest,source:DRAINAGE_URL+'/0'};
}
