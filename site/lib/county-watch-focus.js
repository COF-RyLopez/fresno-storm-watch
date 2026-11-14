/** Presentation only: no new risk score, source assessment, permissions or stored state. */
const layers={river:['areas','power','roads','facilities'],care:['care','evacuations'],pump:['drainage','power'],drainage:['drainage','power'],power:['power'],road:['roads'],asset:['facilities','power']};
export function focusLayerAllowed(workspace,explore,selected,key){
 return workspace!=='watch'||explore||!!layers[selected?.type]?.includes(key);
}
export function focusedLayerVisible({workspace,explore,selected,key,eligible,preferred,focusTypes}){
 if(!eligible)return false;
 if(workspace!=='watch'||explore)return !!preferred;
 return focusLayerAllowed(workspace,explore,selected,key)&&(!focusTypes||focusTypes.includes(selected?.type));
}
const fields={areaId:['river','areas'],powerKey:['power','power'],roadKey:['road','roads'],facilityKey:['asset','facilities'],drainageKey:['pump','drainage'],careKey:['care','care'],zoneKey:['zone','zones']};
export function focusGraphicAllowed(selected,attributes={}){
 for(const [field,[type,group]] of Object.entries(fields))if(attributes[field]!=null){
  return !!selected&&((selected.type===type&&selected.id===attributes[field])||!!selected.related?.[group]?.includes(attributes[field]));
 }
 // Unkeyed graphics belong to a permitted layer's selected-evidence overlay.
 return !!selected;
}
export function nextReview(item){
 if(item.owner&&item.status==='Overdue follow-up')return `Contact ${item.owner} for a follow-up update.`;
 if(item.id==='kings-lower')return 'Confirm release timing with USACE.';
 if(item.id==='san-joaquin')return 'Confirm release timing with Reclamation.';
 if(item.nextReview)return item.nextReview;
 return ({river:'Verify timing and downstream conditions with the operator.',care:'Confirm site power, access and resident-care needs.',pump:'Confirm backup power, fuel/runtime and the responsible contact.',drainage:'Verify field conditions and drainage readiness.',power:'Verify site power and backup needs with the responsible owner.',road:'Confirm current access and detours with the road owner.',asset:'Confirm facility power and readiness with its owner.'})[item.type]||'Review the source and assign verification if needed.';
}
export function watchExploreRoute(input){const u=new URL(input);return ['population','zone','dwr','dwrSupplies','briefingLayer','sandbags'].some(k=>u.searchParams.has(k));}
