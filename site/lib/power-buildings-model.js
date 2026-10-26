import {powerGeometry,powerScope} from './power-geometry.js';

export const BUILDING_LIMITS=Object.freeze({tiles:80,bytes:28_000_000,rows:15000,labelsScale:6000,drawScale:50000});
export const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export const buildingBounds=g=>g.rings.flat().reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
export const buildingHeight=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=850?v:null;

/** Polygon overlap only. A point, circuit match or expired status never supplies an affected-area boundary. */
export function buildingPowerTarget(row){
  if(!row||['restored','cancelled','unknown'].includes(row.status))return {polygons:[],reason:'Select an active outage or PSPS area. Restored, cancelled and unknown records do not define a current affected area.'};
  const polygons=(row.geometries||[]).filter(g=>g.rings).map(powerGeometry);
  return {polygons,reason:polygons.length?'Footprint overlap with the utility’s published area; individual service and power state are unverified.':'This utility record provides a point only. It cannot identify affected buildings; select a published PSPS / outage area.'};
}

/** Validate the pinned public reference manifest before accepting paths or counts. */
export function validateBuildingIndex(d){
  if(d?.schemaVersion!==1||!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(d.release)||d.crs!=='EPSG:4326'||d.heightUnit!=='metres'||d.compression!=='gzip'||!Array.isArray(d.tiles))throw Error('Building reference index is invalid.');
  const seen=new Set();
  for(const t of d.tiles){if(!/^-?\d+_-?\d+$/.test(t.key)||seen.has(t.key)||!Array.isArray(t.bbox)||t.bbox.length!==4||t.bbox.some(v=>!Number.isFinite(v))||t.bbox[0]>t.bbox[2]||t.bbox[1]>t.bbox[3]||!Number.isInteger(t.count)||t.count<1||!Number.isInteger(t.bytes)||t.bytes<1||!Number.isInteger(t.decodedBytes)||t.decodedBytes<t.bytes||!/^[a-f0-9]{64}$/.test(t.sha256))throw Error('Building reference chunk index is invalid.');seen.add(t.key);}
  return d;
}

/** Bounded chunk plan; whole building bounds prevent cell-edge omissions. Viewport is an explicit frozen display scope. */
export function planBuildingTiles(index,polygons,viewport=null){
  const bounds=polygons.map(buildingBounds),view=viewport?buildingBounds(powerGeometry(viewport)):null;
  const tiles=index.tiles.filter(t=>bounds.some(b=>overlaps(b,t.bbox))&&(!view||overlaps(view,t.bbox)));
  if(tiles.length>BUILDING_LIMITS.tiles||tiles.reduce((n,t)=>n+t.decodedBytes,0)>BUILDING_LIMITS.bytes)throw Error('This area is too large for a responsive building view. Zoom to a smaller part, then choose Load visible buildings.');
  return tiles;
}

/** Exact full-footprint overlap, including holes. Address labels are spatial associations, never ownership or service verification. */
export function selectPowerBuildings(rows,polygons,viewport=null){
  const scopes=polygons.map(powerScope),view=viewport?powerScope(viewport):null,seen=new Set(),selected=[];
  for(const row of rows){
    if(typeof row.id!=='string'||!row.id||seen.has(row.id))throw Error('Building identity is missing or duplicated.');seen.add(row.id);
    const geometry=powerGeometry(row.geometry);if(!geometry.rings)throw Error('Building footprint is not a polygon.');
    if(!scopes.some(s=>s.intersects(geometry))||view&&!view.intersects(geometry))continue;
    if(!Array.isArray(row.addresses)||row.addresses.some(a=>typeof a!=='string'||!a.trim()||a.length>500))throw Error('Building address association is invalid.');
    const addresses=[...new Set(row.addresses)].sort();
    selected.push({...row,geometry,height:buildingHeight(row.height),addresses,label:addresses.length===1?addresses[0]:addresses.length>1?`${addresses.length} associated addresses`:'Address not matched'});
  }
  if(selected.length>BUILDING_LIMITS.rows)throw Error('More than 15,000 footprints overlap this selection. Zoom closer and load visible buildings.');
  return selected.sort((a,b)=>Number(!a.addresses.length)-Number(!b.addresses.length)||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
}
