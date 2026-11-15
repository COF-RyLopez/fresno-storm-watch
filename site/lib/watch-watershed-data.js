import {countyGeometry} from './model.js';
import {terrainBounds} from './watch-terrain-model.js';
import {fetchQpfCycle} from './environment-data.js';
import {QPF_URL,qpfPlanningTime,realNumber} from './environment-model.js';

const areaReservoirs=new Map([
 ['san-joaquin-lower','MIL'],['san-joaquin-upper','MIL'],
 ['kings-lower','PNF'],['kings-upper','PNF']
]);
export const upstreamReservoir=key=>key?.startsWith('river:')?areaReservoirs.get(key.slice(6)):undefined;

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

const mercator=(lon,lat)=>[lon*Math.PI/180*6378137,Math.asinh(Math.tan(lat*Math.PI/180))*6378137];

/** Fetch a compact map image tied to one verified WPC forecast cycle. */
export async function loadWatershedRain(bounds,{signal,fetchImpl=fetch,clock=Date.now}={}){
 const request=(url,options={})=>fetchImpl(url,{...options,signal:signal&&options.signal?AbortSignal.any([signal,options.signal]):signal??options.signal});
 const cycle=await fetchQpfCycle({id:9,hours:72},request,clock());
 const now=clock();
 if(qpfPlanningTime(cycle,now,now,24*3_600_000)===null)throw Error('Published forecast is stale or expired');
 const [west,south,east,north]=bounds;
 const [xmin,ymin]=mercator(west,south),[xmax,ymax]=mercator(east,north);
 // Match the image aspect ratio to the Web Mercator extent to avoid edge shifts.
 const size=[800,Math.round(800*(ymax-ymin)/(xmax-xmin))];
 const definitionExpression=`issue_time = '${cycle.issueText}' AND start_time = '${cycle.startText}' AND end_time = '${cycle.endText}' AND units = 'Inches' AND qpf >= 0.01`;
 const query=new URL(`${QPF_URL}/9/query`);
 query.search=new URLSearchParams({f:'json',where:definitionExpression,geometry:bounds.join(','),geometryType:'esriGeometryEnvelope',inSR:'4326',outFields:'qpf',returnGeometry:'false'});
 const url=new URL(`${QPF_URL}/export`);
 url.search=new URLSearchParams({f:'image',format:'png32',transparent:'true',bbox:[xmin,ymin,xmax,ymax].join(','),bboxSR:'3857',imageSR:'3857',size:size.join(','),layers:'show:9',layerDefs:JSON.stringify({9:definitionExpression})});
 const options=()=>({credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(25_000)});
 const [response,local,metadata]=await Promise.all([
  request(url,options()),request(query,options()).then(r=>r.json()),request(`${QPF_URL}/9?f=json`,options()).then(r=>r.json())
 ]);
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('WPC forecast map unavailable');
 if(local.error||local.exceededTransferLimit||!Array.isArray(local.features))throw Error('WPC forecast coverage unavailable');
 const levels=[...new Set(local.features.map(f=>realNumber(f.attributes?.qpf)))].sort((a,b)=>a-b);
 const symbols=metadata.drawingInfo?.renderer?.uniqueValueInfos;
 const legend=levels.map(value=>{
  const color=symbols?.find(entry=>Number(entry.value)===value)?.symbol?.color;
  if(value===null||value<0.01||!Array.isArray(color)||color.length!==4||color.some(n=>!Number.isInteger(n)||n<0||n>255))throw Error('WPC legend unavailable');
  return {value,color:`rgb(${color.slice(0,3).join(',')})`};
 });
 // Confirm the source did not roll over while the image was requested.
 const confirmed=await fetchQpfCycle({id:9,hours:72},request,clock());
 if(['issue','start','end'].some(field=>cycle[field]!==confirmed[field]))throw Error('WPC forecast is updating');
 // Export expands one axis to match the integer output pixel ratio.
 const ratio=size[0]/size[1],dx=Math.max((xmax-xmin),(ymax-ymin)*ratio)/2,dy=dx/ratio;
 const cx=(xmin+xmax)/2,cy=(ymin+ymax)/2;
 const unproject=(x,y)=>[x/6378137*180/Math.PI,Math.atan(Math.sinh(y/6378137))*180/Math.PI];
 return {cycle,legend,blob:legend.length?await response.blob():null,coordinates:[unproject(cx-dx,cy+dy),unproject(cx+dx,cy+dy),unproject(cx+dx,cy-dy),unproject(cx-dx,cy-dy)]};
}
