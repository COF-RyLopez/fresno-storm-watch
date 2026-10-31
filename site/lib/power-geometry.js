/** WGS84 intersection predicates. Preserve the county boundary; never use its envelope as the final scope. */
export const bounds=points=>points.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
export const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const cross=(a,b,p)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
const onSegment=(p,a,b)=>Math.abs(cross(a,b,p))<1e-12&&overlaps(bounds([p]),bounds([a,b]));
/** @param {number[]} p @param {number[][][]} rings @returns {boolean} Even/odd parity supports holes and multipart rings. Boundary is included. */
export function pointInRings(p,rings){
  let inside=false;
  for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];if(onSegment(p,a,b))return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
/** @param {object} geometry @returns {object} Reject malformed or non-WGS84 data rather than silently losing records. */
export function powerGeometry(geometry){
  const wkid=geometry?.spatialReference?.latestWkid||geometry?.spatialReference?.wkid;
  if(wkid&&wkid!==4326)throw new Error('Power geometry is not WGS84');
  const valid=p=>Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
  if(Number.isFinite(geometry?.x)&&valid([geometry.x,geometry.y]))return {x:geometry.x,y:geometry.y,spatialReference:{wkid:4326}};
  if(!geometry?.rings?.length||geometry.rings.some(r=>r.length<4||r.some(p=>!valid(p))||r[0][0]!==r.at(-1)[0]||r[0][1]!==r.at(-1)[1]))throw new Error('Power source geometry missing or invalid');
  return {rings:geometry.rings.map(r=>r.map(p=>p.slice(0,2))),spatialReference:{wkid:4326}};
}
/** @param {object} county @returns {object} Precompute edge envelopes once; typical small outage features avoid most edge comparisons. */
export function powerScope(county){
  const rings=powerGeometry(county).rings,envelope=bounds(rings.flat());
  const edges=rings.flatMap(r=>r.slice(1).map((b,i)=>({a:r[i],b,box:bounds([r[i],b])})));
  return {envelope,intersects(raw){
    const g=powerGeometry(raw);
    if(!g.rings)return pointInRings([g.x,g.y],rings);
    if(!overlaps(envelope,bounds(g.rings.flat())))return false;
    if(g.rings.some(r=>pointInRings(r[0],rings))||rings.some(r=>pointInRings(r[0],g.rings)))return true;
    for(const r of g.rings)for(let i=1;i<r.length;i++){
      const a=r[i-1],b=r[i],box=bounds([a,b]);
      for(const e of edges){
        if(!overlaps(box,e.box))continue;
        const c1=cross(a,b,e.a),c2=cross(a,b,e.b),c3=cross(e.a,e.b,a),c4=cross(e.a,e.b,b);
        if((c1*c2<0&&c3*c4<0)||onSegment(a,e.a,e.b)||onSegment(b,e.a,e.b)||onSegment(e.a,a,b)||onSegment(e.b,a,b))return true;
      }
    }
    return false;
  }};
}
