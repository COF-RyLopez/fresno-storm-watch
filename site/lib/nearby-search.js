/** In-memory vicinity query. Distances are horizontal meters from the geodetic / local-projected SDK backend, never route distances. */
export const METERS_PER_MILE=1609.344;
const KINDS=['gauge','road-record','asset'];

/** Reject missing/ambiguous CRS and malformed coordinates instead of assigning a location. */
export function searchGeometry(shape){
  if(shape?.spatialReference?.wkid!==4326)return null;
  const type=shape.paths?'polyline':shape.rings?'polygon':'point';
  const parts=type==='point'?[[[shape.x,shape.y]]]:shape.paths??shape.rings;
  if(!Array.isArray(parts)||!parts.length)return null;
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const part of parts){
    if(!Array.isArray(part)||part.length<(type==='point'?1:type==='polygon'?4:2))return null;
    for(const xy of part){
      if(!Array.isArray(xy)||!Number.isFinite(xy[0])||!Number.isFinite(xy[1])||Math.abs(xy[0])>180||Math.abs(xy[1])>90)return null;
      bounds[0]=Math.min(bounds[0],xy[0]);bounds[1]=Math.min(bounds[1],xy[1]);bounds[2]=Math.max(bounds[2],xy[0]);bounds[3]=Math.max(bounds[3],xy[1]);
    }
  }
  return {shape:{...shape,type},bounds};
}

/** Conservative geographic envelope prefilter for this Fresno-only index (35–38°N).
 * Final inclusion always uses the SDK's metric distance between complete geometries.
 */
export function envelopesNear(a,b,meters){
  if([...a,...b].some((n,i)=>!Number.isFinite(n)||(i%4===1||i%4===3)&&Math.abs(n)>60))return true;
  const pad=meters/50_000; // larger than either axis' degrees/meter at Fresno latitudes
  return a[0]-pad<=b[2]&&a[2]+pad>=b[0]&&a[1]-pad<=b[3]&&a[3]+pad>=b[1];
}

/** Async, cancellable query with bounded paint batches. No features or queries are persisted. */
export async function nearbyEntries(shape,entries,{miles=2,history=false,distance,current=()=>true,yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0)),limit=20}={}){
  const target=searchGeometry(shape);if(!target)throw new Error('Selected geometry has no usable WGS84 location');
  if(![.5,1,2,5].includes(miles))throw new Error('Unsupported vicinity distance');
  const meters=miles*METERS_PER_MILE,groups=Object.fromEntries(KINDS.map(kind=>[kind,{rows:[],total:0,available:0,unknown:0,historyExcluded:0}])),seen=new Set();
  let checks=0;
  for(const row of entries){
    if(!current())return null;
    const group=groups[row.kind];if(!group||seen.has(row.key))continue;seen.add(row.key);group.available++;
    if(row.history&&!history){group.historyExcluded++;continue;}
    const candidate=searchGeometry(row.geometry);if(!candidate){group.unknown++;continue;}
    if(!envelopesNear(target.bounds,candidate.bounds,meters))continue;
    let value;try{value=await distance(target.shape,candidate.shape);}catch{value=NaN;}
    if(!current())return null;
    if(!Number.isFinite(value)||value<0)group.unknown++;
    else if(value<=meters)group.rows.push({...row,distanceMeters:value});
    if(++checks%16===0)await yieldTask();
  }
  for(const group of Object.values(groups)){group.rows.sort((a,b)=>a.distanceMeters-b.distanceMeters||a.key.localeCompare(b.key));group.total=group.rows.length;group.rows=group.rows.slice(0,limit);}
  return current()?groups:null;
}
