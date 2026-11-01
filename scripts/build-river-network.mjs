/** Build site/data/river-network.json: routable Fresno County streams (USGS 3DHP) as levelpaths with downstream links,
 * plus the app's gauges and dams snapped onto them. Canals and small channels are drawn by the waterway basemap tiles;
 * they are not routed here (canal flow is operated, not hydraulic).
 * Run: NODE_USE_ENV_PROXY=1 node --use-system-ca scripts/build-river-network.mjs   (batches cache in work/river-network/). */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {countyGeometry} from '../site/lib/model.js';
import {pointInRings} from '../site/lib/power-geometry.js';

export const SOURCE='https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/MapServer/50';
// Order 4+ or named, routable (has a hydrosequence), not a canal. GET only: the publisher firewall rejects large POST bodies.
const WHERE="(streamorder>=4 OR gnisidlabel IS NOT NULL) AND hydrosequence IS NOT NULL AND featuretypelabel<>'Canal'";
const FIELDS='OBJECTID,gnisidlabel,featuretypelabel,streamorder,levelpath,hydrosequence,dnhydrosequence,pathlength,lengthkm,terminalflag';
const BBOX='-120.92,35.9,-118.36,37.59',GAP_DEG=0.0005,SNAP_KM=1.5;
const root=new URL('../',import.meta.url),work=new URL('work/river-network/',root);

const R=6371.0088,rad=Math.PI/180;
export const km=(a,b)=>{const dLat=(b[1]-a[1])*rad,dLon=(b[0]-a[0])*rad,h=Math.sin(dLat/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(h));};
const r5=v=>Math.round(v*1e5)/1e5;

/** @param {object[]} segs attributes + coords (upstream→downstream) @param {number[][][]} rings county @returns {object[]} paths */
export function buildPaths(segs,rings){
  const byLp=new Map(),lpOfHs=new Map();
  for(const s of segs){lpOfHs.set(s.hydrosequence,s.levelpath);(byLp.get(s.levelpath)||byLp.set(s.levelpath,[]).get(s.levelpath)).push(s);}
  const paths=[];
  for(const [lp,list] of byLp){
    if(!list.some(s=>s.coords.some(p=>pointInRings(p,rings))))continue;
    list.sort((a,b)=>b.hydrosequence-a.hydrosequence); // hydrosequence falls downstream
    const parts=[];let cur=null;
    for(const s of list){
      if(cur&&Math.hypot(s.coords[0][0]-cur.c.at(-1)[0],s.coords[0][1]-cur.c.at(-1)[1])<=GAP_DEG)cur.c.push(...s.coords.slice(1));
      else{cur={c:[...s.coords]};parts.push(cur);}
      cur.end=s.pathlength; // km to the network terminal at this segment's downstream end
    }
    const names=new Map();for(const s of list)if(s.gnisidlabel)names.set(s.gnisidlabel,(names.get(s.gnisidlabel)||0)+s.lengthkm);
    const last=list.at(-1),dn=last.terminalflag?null:lpOfHs.get(last.dnhydrosequence)??null;
    paths.push({id:String(lp),name:[...names].sort((a,b)=>b[1]-a[1])[0]?.[0]??null,order:Math.max(...list.map(s=>s.streamorder??0)),dn:dn===lp||dn===null?null:String(dn),
      parts:parts.map(p=>({c:p.c.map(([x,y])=>[r5(x),r5(y)]),end:Math.round(p.end*1000)/1000}))});
  }
  // A downstream link must point at a kept path; otherwise the pulse leaves the mapped network there.
  const ids=new Set(paths.map(p=>p.id));for(const p of paths)if(p.dn&&!ids.has(p.dn))p.dn=null;
  return paths.sort((a,b)=>b.order-a.order||a.id.localeCompare(b.id));
}

/** Nearest point on a part to q, with the km still to travel to the part's downstream end. */
function nearestOnPart(q,c){
  let best={d:Infinity};const k=Math.cos(q[1]*rad);
  for(let i=0;i<c.length-1;i++){
    const a=c[i],b=c[i+1],dx=(b[0]-a[0])*k,dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,((q[0]-a[0])*k*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy))):0;
    const p=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],d=km(q,p);
    if(d<best.d)best={d,i,p};
  }
  if(best.i===undefined)return best;
  let rest=km(best.p,c[best.i+1]);for(let j=best.i+1;j<c.length-1;j++)rest+=km(c[j],c[j+1]);
  return {...best,rest};
}
/** Snap gauges and dams. A name match (station names start with their river) beats a slightly closer tributary. */
export function snapPoints(points,paths){
  return points.map(pt=>{
    let best=null;
    for(const path of paths)for(const part of path.parts){
      const n=nearestOnPart([pt.longitude,pt.latitude],part.c);if(!(n.d<=SNAP_KM))continue;
      const score=n.d-(path.name&&pt.name.toLowerCase().includes(path.name.toLowerCase())?0.5:0)-path.order*0.01;
      if(!best||score<best.score)best={score,path:path.id,km:Math.round((part.end+n.rest)*1000)/1000,offsetKm:Math.round(n.d*1000)/1000};
    }
    return {id:pt.id,kind:pt.kind,name:pt.name,longitude:pt.longitude,latitude:pt.latitude,path:best?.path??null,km:best?.km??null,offsetKm:best?.offsetKm??null};
  });
}

async function get(params){
  for(let i=0;;i++){
    try{const r=await fetch(`${SOURCE}/query?${new URLSearchParams({f:'json',...params})}`,{signal:AbortSignal.timeout(240_000)});
      const j=JSON.parse(await r.text());if(j.error)throw new Error(JSON.stringify(j.error));return j;}
    catch(e){if(i>=3)throw e;await new Promise(r=>setTimeout(r,2000*2**i));}
  }
}
async function download(){
  const ids=(await get({where:WHERE,geometry:BBOX,geometryType:'esriGeometryEnvelope',inSR:'4326',returnIdsOnly:'true'})).objectIds?.sort((a,b)=>a-b)||[];
  if(!ids.length||ids.length>200_000)throw new Error(`Unexpected inventory: ${ids.length}`);
  const tag=createHash('sha256').update(WHERE+FIELDS+ids.join()).digest('hex').slice(0,12),dir=new URL(`batches-${tag}/`,work);await mkdir(dir,{recursive:true});
  const batches=[];for(let i=0;i<ids.length;i+=500)batches.push(ids.slice(i,i+500));
  const out=[];
  await Promise.all([0,1,2,3].map(async w=>{for(let b=w;b<batches.length;b+=4){
    const file=new URL(`${batches[b][0]}.json`,dir);let j;
    if(existsSync(file))j=JSON.parse(await readFile(file,'utf8'));
    else{j=await get({objectIds:batches[b].join(','),outFields:FIELDS,outSR:'4326',returnGeometry:'true',maxAllowableOffset:'0.00015',geometryPrecision:'5'});
      if(j.features?.length!==batches[b].length)throw new Error(`Short batch at ${batches[b][0]}; rerun to resume.`);await writeFile(file,JSON.stringify(j));}
    out[b]=j.features;
  }}));
  return {ids,features:out.flat()};
}

if(import.meta.main){
  const started=new Date().toISOString(),{ids,features}=await download();
  const county=JSON.parse(await readFile(new URL('site/data/counties.geojson',root),'utf8')).features.find(f=>f.properties.GEOID==='06019');
  const rings=countyGeometry(county.geometry).rings;
  const segs=features.map(f=>({...f.attributes,coords:f.geometry.paths.flat()}));
  const paths=buildPaths(segs,rings);
  const [rivers,usgs,dams]=await Promise.all(['river-watchlist.json','usgs-watchlist.json','reservoir-watchlist.json'].map(async n=>JSON.parse(await readFile(new URL(`site/data/${n}`,root),'utf8'))));
  const points=snapPoints([...rivers.stations.map(s=>({...s,kind:'nwps'})),...usgs.sites.map(s=>({id:s.site,name:s.name,longitude:s.longitude,latitude:s.latitude,kind:'usgs'})),...dams.stations.map(s=>({id:s.id,name:s.name,longitude:s.longitude,latitude:s.latitude,kind:'dam'}))],paths);
  const doc={version:1,source:SOURCE,publisher:'USGS 3D Hydrography Program',retrievalStartedAt:started,retrievedAt:new Date().toISOString(),where:WHERE,
    inventory:{segments:ids.length,inventorySha256:createHash('sha256').update(ids.join()).digest('hex')},
    note:'Routable streams only (order 4+ or named), simplified ~15 m. "end" is km to the network terminal at a part\'s downstream end; distance-to-terminal is shared along any downstream route. Not hydraulic routing.',
    paths,points};
  await writeFile(new URL('site/data/river-network.json',root),JSON.stringify(doc)+'\n');
  const v=paths.reduce((n,p)=>n+p.parts.reduce((m,q)=>m+q.c.length,0),0);
  console.log(JSON.stringify({segments:ids.length,paths:paths.length,vertices:v,unsnapped:points.filter(p=>!p.path).map(p=>p.id),points:points.map(p=>[p.id,p.path,p.km,p.offsetKm])}));
}
