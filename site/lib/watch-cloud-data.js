import {fetchSatelliteCatalog} from './weather-data.js';
import {GOES_URL,GOES_PRODUCTS,observationAt} from './weather-model.js';
import {mercator} from './watch-watershed-data.js';

const product=GOES_PRODUCTS.find(entry=>entry.id==='goes_longwave_imagery');
export const CLOUD_PAIR_GAP=15*60_000;
export function matchCloudObservation(frames,target,now){
 return observationAt(frames,target,now,{maxGapMs:CLOUD_PAIR_GAP,maxAgeMs:120*60_000});
}

/** Regional WMS image north-up in Web Mercator, with the exact requested image corners. */
export function cloudMapRequest(time){
 const [west,south,east,north]=[-125,32,-113,42.5];
 const [xmin,ymin]=mercator(west,south),[xmax,ymax]=mercator(east,north);
 const width=1000,height=Math.round(width*(ymax-ymin)/(xmax-xmin));
 const url=new URL(GOES_URL);
 url.search=new URLSearchParams({service:'WMS',version:'1.3.0',request:'GetMap',layers:product.id,styles:'',
  crs:'EPSG:3857',bbox:[xmin,ymin,xmax,ymax].join(','),width:String(width),height:String(height),
  transparent:'true',format:'image/png',time:new Date(time).toISOString()});
 return {url,width,height,coordinates:[[west,north],[east,north],[east,south],[west,south]]};
}
export async function loadCloudTimes({signal,now=Date.now()}={}){
 const timeout=AbortSignal.timeout(12_000);
 const fetcher=(url,options)=>fetch(url,{...options,signal:AbortSignal.any(signal?[signal,timeout,options.signal]:[timeout,options.signal])});
 return (await fetchSatelliteCatalog(fetcher,now,[product]))[product.id];
}
export async function loadCloudImage(time,{signal,fetchImpl=fetch}={}){
 const {url,width,height,coordinates}=cloudMapRequest(time);
 const timeout=AbortSignal.timeout(10_000);
 const response=await fetchImpl(url,{credentials:'omit',signal:signal?AbortSignal.any([signal,timeout]):timeout});
 if(!response.ok||!response.headers.get('content-type')?.startsWith('image/png'))throw Error('GOES cloud image unavailable');
 const blob=await response.blob();
 if(blob.size>5_000_000)throw Error('GOES cloud image exceeds size limit');
 const bitmap=await createImageBitmap(blob),valid=bitmap.width===width&&bitmap.height===height;bitmap.close();
 if(!valid)throw Error('GOES cloud image dimensions changed');
 return {blob,coordinates};
}
