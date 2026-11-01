import {pointInRings,validPoint as valid,bounds} from './power-geometry.js';
// IUGG mean Earth radius. Spherical straight-line lookup, not ellipsoidal surveying or road travel.
const R=6371008.8,rad=Math.PI/180;
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>Math.hypot(...a),unit=a=>a.map(v=>v/norm(a));
const angle=(a,b)=>Math.atan2(norm([a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]),dot(a,b));
const vector=([x,y])=>[Math.cos(y*rad)*Math.cos(x*rad),Math.cos(y*rad)*Math.sin(x*rad),Math.sin(y*rad)];
/** @param {number[]} p @param {number[]} a @param {number[]} b @returns {number} Minimum distance to the minor great-circle segment, in meters. */
function segment(p,a,b){
  const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],length=angle(a,b);
  let best=Math.min(angle(p,a),angle(p,b));
  if(norm(cross)>1e-12&&length<Math.PI-1e-8){const n=unit(cross),projection=p.map((v,i)=>v-dot(p,n)*n[i]);if(norm(projection)>1e-12){const q=unit(projection);if(angle(a,q)+angle(q,b)<=length+1e-8)best=Math.min(best,angle(p,q));}}
  return best*R;
}
/** @param {object} geometry @returns {object} Validate once per refresh; never reinterpret projected coordinates as degrees. */
export function prepareWatchGeometry(geometry){
  const sr=geometry?.spatialReference,wkid=sr?.latestWkid||sr?.wkid;if(wkid&&wkid!==4326||sr?.wkt&&!wkid)throw new Error('Watch lookup requires WGS84 geometry.');
  if(Number.isFinite(geometry?.x)&&valid([geometry.x,geometry.y]))return {point:vector([geometry.x,geometry.y]),box:[geometry.x,geometry.y,geometry.x,geometry.y]};
  const paths=geometry?.paths||geometry?.rings;
  if(!Array.isArray(paths)||!paths.length||paths.some(p=>!Array.isArray(p)||p.length<(geometry.rings?4:2)||p.some(v=>!valid(v))||geometry.rings&&(p[0][0]!==p.at(-1)[0]||p[0][1]!==p.at(-1)[1])))throw new Error('Watch lookup geometry missing or invalid.');
  return {paths:paths.map(p=>p.map(vector)),rings:geometry.rings||null,box:bounds(paths.flat())};
}
/** @param {object} prepared @param {object[]} points @returns {object|null} Minimum geometry distance to configured gauge/dam points; O(vertices × watchpoints). */
export function nearbyWatchpoints(prepared,points,maxMeters=Infinity){
  let nearest=null;
  for(const point of points){const xy=[point.longitude,point.latitude];if(!valid(xy))throw new Error('Invalid watchpoint coordinates.');
    // Conservative coarse rejection for Fresno's short, local geometries; margins include 1% extra for spherical/edge curvature approximation.
    if(Number.isFinite(maxMeters)){const dy=maxMeters/R/rad*1.01+0.01,dx=dy/Math.max(1e-6,Math.cos(Math.min(90,Math.max(Math.abs(xy[1]),Math.abs(prepared.box[1]),Math.abs(prepared.box[3]))+dy)*rad));if(xy[1]<prepared.box[1]-dy||xy[1]>prepared.box[3]+dy||![-360,0,360].some(shift=>xy[0]+shift>=prepared.box[0]-dx&&xy[0]+shift<=prepared.box[2]+dx))continue;}
    const p=vector(xy);
    let meters=prepared.point?angle(p,prepared.point)*R:prepared.rings&&pointInRings(xy,prepared.rings)?0:Infinity;
    if(!prepared.point&&meters!==0)for(const path of prepared.paths)for(let i=1;i<path.length;i++)meters=Math.min(meters,segment(p,path[i-1],path[i]));
    if(!nearest||meters<nearest.meters)nearest={meters,pointId:point.id,pointName:point.name||point.id};
  }
  return nearest;
}
