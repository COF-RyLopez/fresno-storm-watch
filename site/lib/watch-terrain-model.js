import {prepareWatchGeometry,nearbyWatchpoints} from './watch-proximity.js';
import {roadInCurrentView} from './roads.js';
const valid=p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const geographic=g=>(g?.spatialReference?.latestWkid||g?.spatialReference?.wkid)===4326;
/** Strict geographic display contract; no projection or vertical inference. */
export function terrainBounds(g){
 if(!geographic(g))return null;
 if(Number.isFinite(g.xmin)&&valid([g.xmin,g.ymin])&&valid([g.xmax,g.ymax])&&g.xmin<=g.xmax&&g.ymin<=g.ymax)return [g.xmin,g.ymin,g.xmax,g.ymax];
 const paths=g.paths||g.rings||[[[g.x,g.y]]];if(!Array.isArray(paths)||!paths.length)return null;
 const bounds=[Infinity,Infinity,-Infinity,-Infinity];
 for(const path of paths){if(!Array.isArray(path)||!path.length)return null;for(const p of path){if(!valid(p))return null;bounds[0]=Math.min(bounds[0],p[0]);bounds[1]=Math.min(bounds[1],p[1]);bounds[2]=Math.max(bounds[2],p[0]);bounds[3]=Math.max(bounds[3],p[1]);}}return bounds;
}
const kinds=new Set(['concern','gauge','reservoir','facility','road','power','drainage','care','zone']);
/** Basin records supplement the existing five-kilometer watchpoint lookup. */
export function basinRoadEligible(record,scope,now=Date.now()){
 if(record.kind!=='road'||!roadInCurrentView(record,now)||!terrainBounds(record.geometry))return false;
 const {geometry}=record;
 return geometry.paths?scope.intersectsLine(geometry.paths):scope.intersects(geometry);
}
/** Transient display-only copy. Polygons draw as complete boundary rings, never fabricated extrusions. */
export function terrainSnapshot({target,selected=[],candidates=[],anchors=[],roadStatus=null}){
 const bounds=terrainBounds(target);if(!bounds)return null;
 if(!anchors.length)anchors=[{longitude:(bounds[0]+bounds[2])/2,latitude:(bounds[1]+bounds[3])/2}];
 const features=[],seen=new Map(),facilityKeys=new Set(),roadKeys=new Set();let unknown=0;
 for(const [rows,nearby]of [[selected,false],[candidates,true]])for(const row of rows){
  if(!row?.key||!kinds.has(row.kind))continue;
  const g=row.geometry;if(!terrainBounds(g)){unknown++;continue;}
  if(nearby){let match;try{match=nearbyWatchpoints(prepareWatchGeometry(g),anchors,5000);}catch{unknown++;continue;}if(!match||match.meters>5000)continue;}
  const geometry=g.rings?{type:'MultiLineString',coordinates:g.rings}:g.paths?{type:'MultiLineString',coordinates:g.paths}:{type:'Point',coordinates:[g.x,g.y]};
  const signature=JSON.stringify(geometry),parts=seen.get(row.key)||new Set();if(parts.has(signature))continue;parts.add(signature);seen.set(row.key,parts);
  const properties={key:String(row.key),kind:row.kind,name:String(row.name||row.kind),color:/^#[0-9a-f]{6}$/i.test(row.color||'')?row.color:'#a5a9ad',pickField:String(row.pickField||''),pickId:String(row.pickId||''),selected:!nearby};
  if(row.kind==='road'){properties.detour=row.detour===true;roadKeys.add(row.key);if(roadStatus?.state==='old')properties.color='#a5a9ad';}
  features.push({type:'Feature',id:parts.size===1?String(row.key):String(row.key)+'#'+parts.size,geometry,properties});if(row.kind==='facility')facilityKeys.add(row.key);
 }
 return {type:'FeatureCollection',features,bounds,facilities:facilityKeys.size,roads:roadKeys.size,roadStatus,unknown};
}
/** River watchpoints apply only to their owning concern; other selections use the focus center. */
export const terrainAnchors=(concern,selection,points)=>concern?.type==='river'&&selection?.id===concern.id?points:[];
