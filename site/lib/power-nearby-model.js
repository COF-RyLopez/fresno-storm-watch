import {searchGeometry} from './nearby-search.js';
import {DRAINAGE_MAX_AGE} from './drainage-model.js';

/** Preserve every published circuit part; never substitute a centroid or its bounding box. */
export function networkVicinityGeometry(features){
  if(!features?.length)throw Error('No selected network reference.');
  if(features.length===1){const shape=searchGeometry(features[0].geometry);if(!shape)throw Error('Selected reference location is invalid.');return shape.shape;}
  if(features.some(f=>!searchGeometry(f.geometry)||!f.geometry.paths))throw Error('Selected circuit geometry is incomplete.');
  return {paths:features.flatMap(f=>f.geometry.paths),spatialReference:{wkid:4326}};
}

/** Private records remain session-only. Proposed pumps and ambiguous duplicate identities are excluded. */
export function powerNearbyCandidates(facilities,pumps){
  const candidates=[];
  for(const row of facilities?.sites||[]){
    const site=row.site;if(!site?.key)continue;
    candidates.push({key:'power-site:'+site.key,kind:'asset',category:'facility',name:site.name||site.key,geometry:site.geometry,site,assessment:row});
  }
  for(const pump of pumps?.rows||[])if(pump.kind==='pump'&&pump.category==='existing'&&pump.key)candidates.push({key:'power-pump:'+pump.key,kind:'asset',category:'pump',name:pump.name||pump.key,geometry:pump.geometry,pump});
  const byId=new Map(),conflicts=new Set();
  for(const row of candidates){const previous=byId.get(row.key);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))conflicts.add(row.key);else byId.set(row.key,row);}
  return {entries:[...byId.values()].filter(r=>!conflicts.has(r.key)),conflicts:conflicts.size};
}

/** Retrieval and source verification are separate; a fresh read of an old copy is still qualified. */
export function pumpInventoryProblem(inventory,now=Date.now()){
  if(!inventory?.connected)return inventory?.error||'Private AGOL pump inventory is not loaded.';
  if(inventory.error)return inventory.error;
  if(!Number.isFinite(inventory.checked)||inventory.checked>now+60000||now-inventory.checked>DRAINAGE_MAX_AGE)return 'Pump inventory retrieval is overdue; retained locations need verification.';
  if(inventory.refreshState==='failed')return 'The source refresh reported a failure; retained pump locations need verification.';
  if(!Number.isFinite(inventory.sourceChecked)||inventory.sourceChecked>now+60000||!Number.isFinite(inventory.maxSourceAgeMs)||now-inventory.sourceChecked>inventory.maxSourceAgeMs)return 'Source inventory verification is overdue; retained locations need verification.';
  return null;
}
