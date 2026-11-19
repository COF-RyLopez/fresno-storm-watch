import {mercator,regionalForecastBounds} from './watch-watershed-data.js';
import {boundedVolumeBytes} from './radar-volume-data.js';
export const MOSAIC_URL='https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows';
const LAYER='conus_base_reflectivity_mosaic',MAX_AGE=120*60000;
export function mosaicTimes(dimension,now=Date.now()){
 if(typeof dimension!=='string'||dimension.length>200000||dimension.includes('/'))throw Error('Radar requires explicit observation times');
 const times=[...new Set(dimension.split(',').map(s=>s.trim()).filter(s=>/Z$/.test(s)).map(Date.parse))]
  .filter(t=>Number.isFinite(t)&&t<=now+120000&&now-t<=MAX_AGE).sort((a,b)=>a-b).slice(-12);
 if(!times.length)throw Error('No recent NWS radar observations available');
 return {frames:times.map(time=>({time})),gaps:times.some((t,i)=>i&&t-times[i-1]>10*60000)};
}
export function mosaicLegend(json){
 const entries=json?.Legend?.find(l=>l.layerName===LAYER)?.rules?.[0]?.symbolizers?.[0]?.Raster?.colormap?.entries;
 const bands=[10,20,30,40,50,60,70].map(t=>entries?.find(e=>Number(e.quantity)===t));
 if(bands.some(e=>!e||!/^#[a-f0-9]{6}$/i.test(e.color)))throw Error('NWS radar legend unavailable');
 return bands.map(e=>({value:String(e.quantity),color:e.color}));
}
export function mosaicRequest(time,bounds=regionalForecastBounds){
 if(!Number.isFinite(time)||!Array.isArray(bounds)||bounds.length!==4||!bounds.every(Number.isFinite)||
  bounds[0]<-180||bounds[2]>180||bounds[1]<-80||bounds[3]>80||bounds[0]>=bounds[2]||bounds[1]>=bounds[3])throw Error('Invalid radar bounds/time');
 const [west,south,east,north]=bounds,[xmin,ymin]=mercator(west,south),[xmax,ymax]=mercator(east,north);
 const ratio=(ymax-ymin)/(xmax-xmin),width=Math.round(1200/Math.max(1,ratio)),height=Math.round(width*ratio);
 const url=new URL(MOSAIC_URL);url.search=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetMap',
  layers:LAYER,styles:'weather_radar_base_reflectivity',crs:'EPSG:3857',bbox:[xmin,ymin,xmax,ymax].join(','),
  width:String(width),height:String(height),transparent:'true',format:'image/png',time:new Date(time).toISOString()});
 return {url,width,height,coordinates:[[west,north],[east,north],[east,south],[west,south]]};
}
async function read(url,signal,fetchImpl){
 const r=await fetchImpl(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),credentials:'omit',cache:'no-store'});
 if(!r.ok)throw Error('NWS radar HTTP '+r.status);return r;
}
export async function loadMosaicCatalog(signal,{fetchImpl=fetch,now=Date.now()}={}){
 const caps=new URL(MOSAIC_URL);caps.search=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetCapabilities'});
 const legend=new URL(MOSAIC_URL);legend.search=new URLSearchParams({service:'WMS',request:'GetLegendGraphic',layer:LAYER,format:'application/json'});
 const [xml,colors]=await Promise.all([read(caps,signal,fetchImpl).then(r=>r.text()),read(legend,signal,fetchImpl).then(r=>r.json())]);
 const doc=new DOMParser().parseFromString(xml,'application/xml');
 if(doc.querySelector('parsererror'))throw Error('NWS radar catalog invalid');
 const node=[...doc.getElementsByTagNameNS('*','Layer')].find(n=>[...n.children].some(c=>c.localName==='Name'&&c.textContent.trim()===LAYER));
 const dimension=node&&[...node.children].find(c=>c.localName==='Dimension'&&c.getAttribute('name')==='time');
 return {...mosaicTimes(dimension?.textContent,now),legend:mosaicLegend(colors)};
}
export async function loadMosaicImage(frame,signal,{bounds=regionalForecastBounds,fetchImpl=fetch,now=Date.now()}={}){
 if(!Number.isFinite(frame?.time)||frame.time>now+120000||now-frame.time>MAX_AGE)throw Error('Radar observation expired');
 const request=mosaicRequest(frame.time,bounds),r=await read(request.url,signal,fetchImpl);
 if(!r.headers.get('content-type')?.startsWith('image/png'))throw Error('NWS radar image unavailable');
 const bytes=await boundedVolumeBytes(r.body,8*1024*1024);
 if(bytes.length<24||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw Error('NWS radar PNG invalid');
 const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(header.getUint32(16)!==request.width||header.getUint32(20)!==request.height)throw Error('NWS radar image size changed');
 return {blob:new Blob([bytes],{type:'image/png'}),coordinates:request.coordinates};
}
