import {countyGeometry} from './model.js';
import {terrainBounds} from './watch-terrain-model.js';
import {environmentalJson,fetchQpfCycle} from './environment-data.js';
import {QPF_URL,qpfPlanningTime,realNumber} from './environment-model.js';
import {WPC_INTERVALS} from './watershed-timeline-model.js';

const areaReservoirs=new Map([
 ['san-joaquin-lower','MIL'],['san-joaquin-upper','MIL'],
 ['kings-lower','PNF'],['kings-upper','PNF']
]);
export const upstreamReservoir=key=>key?.startsWith('river:')?areaReservoirs.get(key.slice(6)):undefined;
export const regionalForecastBounds=Object.freeze([-131,28,-107.5,47]);

export async function loadWatershed(reservoir,{signal,fetchImpl=fetch}={}){
 const response=await fetchImpl(new URL('../data/reservoir-watersheds.geojson',import.meta.url),{signal,credentials:'omit'});
 if(!response.ok)throw Error('Watershed boundary unavailable');
 const data=await response.json();
 const feature=data.features?.find(item=>item.properties?.reservoir===reservoir);
 if(!feature)throw Error('Watershed boundary unavailable');
 const bounds=terrainBounds(countyGeometry(feature.geometry));
 if(!bounds)throw Error('Watershed bounds unavailable');
 return {feature,bounds};
}

export const mercator=(lon,lat)=>[lon*Math.PI/180*6378137,Math.asinh(Math.tan(lat*Math.PI/180))*6378137];

/** Fetch a compact map image tied to one verified WPC forecast cycle. */
export async function loadWatershedRain(bounds,{window,signal,fetchImpl=fetch,clock=Date.now}={}){
 if(window&&!WPC_INTERVALS.includes(window.layer))throw Error('Unsupported six-hour forecast layer');
 const period=window?{id:window.layer,hours:6}:{id:9,hours:72};
 const request=(url,options={})=>fetchImpl(url,{...options,signal:signal&&options.signal?AbortSignal.any([signal,options.signal]):signal??options.signal});
 const cycle=await fetchQpfCycle(period,request,clock());
 const sameRevision=(a,b)=>['issue','start','end'].every(field=>a[field]===b[field]);
 if(window&&(cycle.product!=='6-hour QPF'||!sameRevision(cycle,window)))throw Error('WPC has revised the selected window');
 const now=clock();
 if(qpfPlanningTime(cycle,now,now,24*3_600_000)===null)throw Error('Published forecast is stale or expired');
 const [west,south,east,north]=bounds;
 const [xmin,ymin]=mercator(west,south),[xmax,ymax]=mercator(east,north);
 // Match the image aspect ratio to the Web Mercator extent to avoid edge shifts.
 const width=1400;
 const size=[width,Math.round(width*(ymax-ymin)/(xmax-xmin))];
 const definitionExpression=`issue_time = '${cycle.issueText}' AND start_time = '${cycle.startText}' AND end_time = '${cycle.endText}' AND units = 'Inches' AND qpf >= 0.01`;
 const query=new URL(`${QPF_URL}/${period.id}/query`);
 query.search=new URLSearchParams({f:'json',where:definitionExpression,geometry:bounds.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',outFields:'qpf',returnGeometry:'false'});
 const url=new URL(`${QPF_URL}/export`);
 url.search=new URLSearchParams({f:'image',format:'png32',transparent:'true',bbox:[xmin,ymin,xmax,ymax].join(','),bboxSR:'3857',imageSR:'3857',size:size.join(','),layers:`show:${period.id}`,layerDefs:JSON.stringify({[period.id]:definitionExpression})});
 const options=()=>({credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25_000)});
 const local=await environmentalJson(query,request);
 if(local.exceededTransferLimit||!Array.isArray(local.features))throw Error('WPC forecast coverage unavailable');
 const levels=[...new Set(local.features.map(f=>realNumber(f.attributes?.qpf)))].sort((a,b)=>a-b);
 // A verified empty extent has nothing to export. Preserve this distinction during playback.
 const [response,metadata]=levels.length?await Promise.all([
  request(url,options()),environmentalJson(`${QPF_URL}/${period.id}?f=json`,request)
 ]):[null,null];
 if(response&&(!response.ok||!response.headers.get('content-type')?.startsWith('image/png')))throw Error('WPC forecast map unavailable');
 const symbols=metadata?.drawingInfo?.renderer?.uniqueValueInfos;
 const legend=levels.map(value=>{
  const color=symbols?.find(entry=>Number(entry.value)===value)?.symbol?.color;
  if(value===null||value<0.01||!Array.isArray(color)||color.length!==4||color.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('WPC legend unavailable');
  return {value,color:`rgb(${color.slice(0,3).join(',')})`};
 });
 // Confirm the source did not roll over while the image was requested.
 const confirmed=await fetchQpfCycle(period,request,clock());
 if(!sameRevision(cycle,confirmed)||cycle.product!==confirmed.product)throw Error('WPC forecast is updating');
 if(cycle.end<=clock())throw Error('Forecast window ended while loading');
 // Export expands one axis to match the integer output pixel ratio.
 const ratio=size[0]/size[1],dx=Math.max((xmax-xmin),(ymax-ymin)*ratio)/2,dy=dx/ratio;
 const cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
 const unproject=(x,y)=>[x/6378137*180/Math.PI,Math.atan(Math.sinh(y/6378137))*180/Math.PI];
 return {cycle,legend,blob:response?await response.blob():null,coordinates:[unproject(cx-dx,cy+dy),unproject(cx+dx,cy+dy),unproject(cx+dx,cy-dy),unproject(cx-dx,cy-dy)]};
}
