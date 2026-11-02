/** NWS snow level, county snow-removal routes and forecast-discussion snow lines. Planning context, not road condition reports. */
import {forecastInterval} from './weather-model.js';
export const FT_PER_M=3.28084;
/** NWS forecast points along the county's snow-removal routes (all in the Sierra foothills and mountains). */
export const SNOW_POINTS=Object.freeze([
  {id:'shaver',name:'Shaver Lake',latitude:37.105,longitude:-119.318},
  {id:'huntington',name:'Huntington Lake',latitude:37.233,longitude:-119.22},
  {id:'dunlap',name:'Dunlap',latitude:36.735,longitude:-119.12}
]);
export const SNOW_ROUTES_URL='https://gisprod10.co.fresno.ca.us/server/rest/services/Hosted/Snow_Removal/FeatureServer/0';
/** County priority codes (Hosted/Snow_Removal). Colours run hot for "at all times" to grey for other agencies / permits. */
export const ROUTE_PRIORITIES=Object.freeze({
  1:{label:'1 · At all times',color:'#ff5d5d',width:3.5},
  2:{label:'2 · As time permits',color:'#f5a524',width:3},
  3:{label:'3 · Emergencies only',color:'#ffd27a',width:2,style:'dash'},
  4:{label:'4 · All roads by May 1',color:'#b9a6ff',width:2,style:'dash'},
  10:{label:'10 · CSA contract',color:'#6fd3e0',width:2},
  9:{label:'9 · Permit (private)',color:'#a5a9ad',width:1.5,style:'dot'},
  11:{label:'11 · Caltrans',color:'#7f8890',width:1.5,style:'dot'}
});
/** @param {object} payload NWS gridpoint JSON @returns {{start:number,end:number,meters:number}[]} Snow-level steps; unparseable steps are dropped. */
export function snowLevels(payload){
  const p=payload?.properties?.snowLevel;
  if(p?.uom!=='wmoUnit:m'||!Array.isArray(p.values))throw new Error('NWS snow level units changed.');
  return p.values.flatMap(v=>{try{return Number.isFinite(v.value)?[{...forecastInterval(v.validTime),meters:v.value}]:[];}catch{return [];}});
}
/** @returns {number|null} Snow level (m) for the step containing time t; null outside the forecast. */
export const snowLevelAt=(steps,t)=>steps.find(s=>s.start<=t&&t<s.end)?.meters??null;
/** @returns {{low:number,high:number}|null} Range (m) over [from, to). */
export function snowRange(steps,from,to){
  const m=steps.filter(s=>s.end>from&&s.start<to).map(s=>s.meters);
  return m.length?{low:Math.min(...m),high:Math.max(...m)}:null;
}
export const feet=m=>Math.round(m*FT_PER_M/100)*100;
/** @param {string} text Forecast discussion @returns {string[]} Sentences that talk about snow (at most 5), whitespace collapsed. */
export function snowLines(text){
  const flat=String(text||'').replace(/\s+/g,' ');
  return flat.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(s=>/\bsnow(fall| levels?| accumulations?)?\b|\bfreezing level/i.test(s)).map(s=>s.trim()).slice(0,5);
}

const R_KM=6371.0088;
/** @param {number[]} a [lon,lat] @param {number[]} b @returns {number} Great-circle km. */
export function km(a,b){const r=Math.PI/180,dp=(b[1]-a[1])*r,dl=(b[0]-a[0])*r,h=Math.sin(dp/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dl/2)**2;return 2*R_KM*Math.asin(Math.sqrt(h));}
/** Join a road's segments into lines: start at the end farthest from the road's centre, then repeatedly take the nearest
 * unused segment (reversed if its far end is closer). A gap over GAP_KM starts a new part instead of a straight jump,
 * so neither the map nor the profile crosses open country.
 * ponytail: greedy, fine for the county's few-dozen-segment roads; a graph walk if branches ever matter.
 * @param {number[][][]} paths @returns {number[][][]} parts in travel order */
export const GAP_KM=0.3;
export function chainPaths(paths){
  const segs=paths.filter(p=>p.length>1).map(p=>p.slice());if(!segs.length)return [];
  const all=segs.flat(),c=[all.reduce((a,p)=>a+p[0],0)/all.length,all.reduce((a,p)=>a+p[1],0)/all.length];
  let start=null;segs.forEach((p,i)=>{for(const [pt,rev] of [[p[0],false],[p.at(-1),true]]){const d=km(c,pt);if(!start||d>start.d)start={i,rev,d};}});
  let line=start.rev?segs[start.i].slice().reverse():segs[start.i];const parts=[line],used=new Set([start.i]);
  while(used.size<segs.length){
    let best=null;for(let i=0;i<segs.length;i++)if(!used.has(i))for(const rev of [false,true]){const d=km(line.at(-1),rev?segs[i].at(-1):segs[i][0]);if(!best||d<best.d)best={i,rev,d};}
    used.add(best.i);const next=best.rev?segs[best.i].slice().reverse():segs[best.i];
    if(best.d>GAP_KM){line=next.slice();parts.push(line);}else line.push(...next.slice(best.d<0.01?1:0));
  }
  return parts;
}
/** 3DEP getSamples -> ordered, de-duplicated [{km, m}] along the line (the service returns samples out of order and repeats some). */
export function profileSamples(samples){
  const byId=new Map();for(const s of samples||[]){const v=Number(s.value);if(Number.isFinite(v)&&!byId.has(s.locationId))byId.set(s.locationId,{x:s.location.x,y:s.location.y,m:v});}
  const pts=[...byId.entries()].sort((a,b)=>a[0]-b[0]).map(([,p])=>p);let d=0;
  return pts.map((p,i)=>{if(i)d+=km([pts[i-1].x,pts[i-1].y],[p.x,p.y]);return {km:d,m:p.m,x:p.x,y:p.y};});
}
/** @returns {{lengthMi:number,lowFt:number,highFt:number,aboveMi:number|null}} aboveMi: length at or above the snow level (null without one). */
export function profileStats(points,snowM){
  const ms=points.map(p=>p.m);let above=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],seg=b.km-a.km;if(snowM===null)continue;
    if(a.m>=snowM&&b.m>=snowM)above+=seg;else if(a.m>=snowM||b.m>=snowM){const f=(snowM-a.m)/(b.m-a.m);above+=a.m>=snowM?seg*f:seg*(1-f);}}
  const mi=k=>k/1.609344;
  return {lengthMi:mi(points.at(-1)?.km||0),lowFt:Math.min(...ms)*FT_PER_M,highFt:Math.max(...ms)*FT_PER_M,aboveMi:snowM===null?null:mi(above)};
}

/** USGS GNIS names near the road. Places get text labels; summits and gaps (passes) get ticks with the name on hover. */
export const GNIS_URL='https://carto.nationalmap.gov/arcgis/rest/services/geonames/MapServer';
export const LANDMARK_LAYERS=Object.freeze([{id:3,kind:'place',metres:600},{id:5,kind:'peak',metres:1500,where:"gaz_featureclass IN ('Summit','Gap')"}]);
/** @param {{name:string,kind:string,x:number,y:number}[]} items @param {{km:number,m:number,x:number,y:number}[]} points profile
 * @returns {{name:string,kind:string,km:number,m:number,offKm:number}[]} each at its nearest profile point, nearest copy of a name kept, in road order. */
export function placeOnProfile(items,points){
  const best=new Map();
  for(const it of items){let near=null;for(const p of points){const d=km([it.x,it.y],[p.x,p.y]);if(!near||d<near.d)near={p,d};}
    if(near&&(!best.has(it.name)||near.d<best.get(it.name).offKm))best.set(it.name,{name:it.name,kind:it.kind,km:near.p.km,m:near.p.m,offKm:near.d});}
  return [...best.values()].sort((a,b)=>a.km-b.km);
}
/** Which places get a text label: greedy by closeness to the road, at most maxLabels, never overlapping on either of
 * `rows` label rows (width estimated from name length). Everything else becomes a tick with its name on hover.
 * @returns {{...item,row:number|null}[]} row index for labelled items, null for ticks. */
export function labelRows(marks,{width,maxKm,charPx=6,rows=2,maxLabels=5}){
  const taken=Array.from({length:rows},()=>[]),out=marks.map(m=>({...m,row:null}));
  const order=out.map((m,i)=>i).filter(i=>out[i].kind==='place').sort((a,b)=>out[a].offKm-out[b].offKm);
  let n=0;for(const i of order){if(n>=maxLabels)break;const c=out[i].km/(maxKm||1)*width,w=out[i].name.length*charPx+6,span=[Math.max(0,c-w/2),Math.min(width,c+w/2)];
    const r=taken.findIndex(t=>t.every(([a,b])=>span[1]<a||span[0]>b));if(r<0)continue;taken[r].push(span);out[i].row=r;n++;}
  return out;
}
