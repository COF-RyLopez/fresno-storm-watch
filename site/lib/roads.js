/** County source facts stay separate from operational verification and clearance. */
export const ROAD_SERVICE='https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Fresno_County_Road_Closures_Public/FeatureServer';
export const ROAD_MAP='https://gisportal.co.fresno.ca.us/portal/apps/webappviewer/index.html?id=f972a2f1457f4115b964019f8c914fba';
export const EVAC_SERVICE='https://services3.arcgis.com/ibgDyuD2DLBge82s/arcgis/rest/services/Fresno_County_Evacuations_2_view/FeatureServer/5';
export const EVAC_MAP='https://www.arcgis.com/apps/webappviewer/index.html?id=e7d6006a016a444db8b210ac4d2eb5cf';
export const ROAD_TYPES=['Road block','Road closure','Detour'];
export const roadInCurrentView=(r,now=Date.now())=>r.active!=='no'&&(!r.end||r.end>now);
export const roadConflictBacklog=(rows,now=Date.now())=>rows.filter(r=>!roadInCurrentView(r,now)&&r.active==='yes'&&r.end&&r.end<=now);
export function missingRoadRecords(previous,next,known=new Map(),now=Date.now()){
  const missing=new Map(known),keys=new Set(next.map(r=>r.key));
  for(const row of previous)if(roadInCurrentView(row,now)&&!keys.has(row.key)&&!missing.has(row.key))missing.set(row.key,{row,detected:now});
  for(const key of keys)missing.delete(key);
  return missing;
}
const date=value=>value!==null&&value!==''&&Number.isFinite(Number(value))&&Number(value)>0?Number(value):null;
export function normalizeRoad(feature,layer,now=Date.now()) {
  const a=feature.attributes||{},id=String(a.globalid||'').toLowerCase();
  if(!id)throw new Error('County road record has no GlobalID; completeness cannot be verified.');
  const active=String(a.active||'').trim().toLowerCase(),start=date(a.startdate),end=date(a.enddate);
  const issues=[];
  if(layer!==2&&!['yes','no'].includes(active))issues.push('Active flag missing or unrecognized');
  if(end&&end<=now)issues.push('End date elapsed; reopening not confirmed');
  if(start&&end&&end<start)issues.push('End date precedes start date');
  if(active==='yes'&&start&&start>now)issues.push('Active flag conflicts with future start');
  if(!feature.geometry)issues.push('Source geometry missing');
  let status=layer===2?'Published detour — current status unconfirmed':active==='yes'?'Published active':active==='no'?'Published inactive — access unconfirmed':'Status unconfirmed';
  if(issues.length)status='Verification needed';
  else if(start&&start>now)status='Scheduled in source';
  const row={key:`county-road:${layer}:${id}`,id,layer,kind:ROAD_TYPES[layer],name:String(a.blocknm||'Unnamed county record'),location:String(a.locdesc||a.blocknm||'Location not supplied'),comment:String(a.comment||''),reason:String(a.blocktype||''),alternateRoute:String(a.altroute||''),active:active||null,start,end,sourceTime:date(a.lastupdate),edited:date(a.last_edited_date),status,issues,geometry:feature.geometry||null,source:`${ROAD_SERVICE}/${layer}`,official:ROAD_MAP};
  row.revision=JSON.stringify([row.name,row.location,row.comment,row.reason,row.alternateRoute,row.active,start,end,row.sourceTime,row.edited,row.geometry]);
  return row;
}
export function normalizeRoads(batches,now=Date.now()) {
  const rows=new Map();
  for(const {layer,features} of batches)for(const feature of features){const row=normalizeRoad(feature,layer,now),previous=rows.get(row.key);if(previous&&previous.revision!==row.revision)throw new Error('Conflicting duplicate county GlobalID');rows.set(row.key,row);}
  return [...rows.values()].sort((a,b)=>Number(b.issues.length>0)-Number(a.issues.length>0)||a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name));
}
export async function roadJson(url,fetcher=fetch) {
  const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(`County service HTTP ${response.status}`);
  const data=await response.json();if(data.error)throw new Error('County service returned an error');return data;
}
export async function fetchRoads(fetcher=fetch) {
  const batches=await Promise.all(ROAD_TYPES.map(async(_,layer)=>{
    const base=`${ROAD_SERVICE}/${layer}/query`,ids=await roadJson(`${base}?f=json&where=1%3D1&returnIdsOnly=true`,fetcher);
    if(!Array.isArray(ids.objectIds)||!ids.objectIdFieldName)throw new Error('County record inventory unavailable');
    const features=[];
    // Enumerate IDs before batching: a service transfer limit must not silently omit closures.
    const fields=['objectid','globalid','blocknm','comment','startdate','enddate','lastupdate','last_edited_date',...(layer===2?[]:['locdesc','blocktype','active','altroute'])];
    for(let i=0;i<ids.objectIds.length;i+=200){
      const slice=ids.objectIds.slice(i,i+200),params=new URLSearchParams({f:'json',objectIds:slice.join(','),outFields:fields.join(','),outSR:'4326',returnGeometry:'true'});
      const part=await roadJson(`${base}?${params}`,fetcher);
      if(!Array.isArray(part.features)||part.exceededTransferLimit||part.features.length!==slice.length)throw new Error('County records changed during the query or were truncated; retry required');
      features.push(...part.features);
    }
    return {layer,features};
  }));
  return {rows:normalizeRoads(batches),checked:Date.now(),source:ROAD_SERVICE};
}
export function roadHealth(snapshot,error,now=Date.now()) {
  if(error)return 'County feed failed — retained records are not a current status check';
  if(!snapshot)return 'Waiting for county service';
  if(now-snapshot.checked>420000)return 'County check is stale — verify with the publisher';
  return snapshot.rows.length?'County query succeeded; verify individual source times':'No records returned — this does not confirm roads are open';
}
