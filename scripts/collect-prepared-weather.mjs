/** Public WPC display preparation. Images are immutable; manifest switches last. */
import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadWatershedRain,regionalForecastBounds} from '../site/lib/watch-watershed-data.js';
import {fetchQpfCycle} from '../site/lib/environment-data.js';
import {QPF_URL} from '../site/lib/environment-model.js';
import {validateCurrentWeather,createPreparedWeather} from '../site/lib/weather-frame-package.js';
import {WPC_INTERVALS} from '../site/lib/watershed-timeline-model.js';
import {bounded,writeAtomic} from './lib/snapshot-io.mjs';
import {RAIN_PRESENTATION} from '../site/lib/rain-presentation.js';
import {prepareRainImage} from './lib/rain-image.mjs';

/** @param {{output?:URL,fetchImpl?:typeof fetch,clock?:()=>number,getCycle?:typeof fetchQpfCycle,loadRain?:typeof loadWatershedRain}} [options] */
export async function collectPreparedWeather({output=new URL('../site/data/prepared-weather/',import.meta.url),
  fetchImpl=fetch,clock=Date.now,getCycle=fetchQpfCycle,loadRain=loadWatershedRain}={}){
  const started=clock(),frames=[],failed=[],skipped=[],writes=new Map();
  let requests=0,bytes=0;
  const publicRequest=async(input,options={})=>{
    const url=new URL(input);
    if(url.origin!==new URL(QPF_URL).origin||!(url.pathname===new URL(QPF_URL).pathname||url.pathname.startsWith(new URL(QPF_URL).pathname+'/'))||
      url.username||url.password||[...url.searchParams.keys()].some(k=>/token|key|secret|password/i.test(k)))throw Error('Only public WPC data may be prepared');
    const response=await fetchImpl(url,{...options,credentials:'omit',
      signal:AbortSignal.any([AbortSignal.timeout(20000),...(options.signal?[options.signal]:[])])});
    const body=await bounded(response,12*1024*1024,'WPC','WPC response too large');
    requests++;bytes+=body.length;
    return new Response(body,{headers:{'content-type':response.headers.get('content-type')??'application/octet-stream'}});
  };
  await mkdir(new URL('images/',output),{recursive:true});
  async function at(layer){
    try{
      const cycle=layer===9?null:await getCycle({id:layer,hours:6},publicRequest,clock());
      if(cycle&&(cycle.end<=clock()||clock()-cycle.issue>24*3600000)){skipped.push(layer);return;}
      const window=cycle?{layer,...cycle}:null;
      const rain=await prepareRainImage(await loadRain(regionalForecastBounds,{window,fetchImpl:publicRequest,clock}));
      let image=null;
      if(rain.blob){
        const data=Buffer.from(await rain.blob.arrayBuffer()),sha256=createHash('sha256').update(data).digest('hex');
        if(data.length<24||!data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid PNG');
        image={file:`images/${sha256}.png`,sha256,bytes:data.length,width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
        if(!writes.has(sha256))writes.set(sha256,writeAtomic(new URL(image.file,output),data));
        await writes.get(sha256);
      }
      const frame={id:`qpf-${layer}`,window:cycle?{layer,issue:rain.cycle.issue,start:rain.cycle.start,end:rain.cycle.end}:null,
        cycle:rain.cycle,coordinates:rain.coordinates,legend:rain.legend,image};
      const p=validateCurrentWeather({schemaVersion:1,kind:'prepared-wpc-display',capturedAt:new Date(started).toISOString(),clock:started,
        publisher:'NOAA WPC',source:QPF_URL,presentation:RAIN_PRESENTATION,rasterCrs:'EPSG:3857',coordinateCrs:'EPSG:4326',bounds:[...regionalForecastBounds],frames:[frame]});
      const store=createPreparedWeather(p,output,{fetchImpl:async url=>new Response(await readFile(url),{headers:{'content-type':'image/png'}})});
      try{await store.load(frame.id);}finally{store.destroy();}
      frames.push(frame);
    }catch(error){failed.push(layer);console.warn(JSON.stringify({product:'prepared-rain',layer,status:'unavailable',reason:error.message}));}
  }
  const layers=[9,...WPC_INTERVALS];
  for(let i=0;i<layers.length;i+=3)await Promise.all(layers.slice(i,i+3).map(at));
  if(!frames.length)throw Error('No current WPC frames prepared; prior manifest was not changed');
  frames.sort((a,b)=>Number(a.id.slice(4))-Number(b.id.slice(4)));
  const manifest=validateCurrentWeather({schemaVersion:1,kind:'prepared-wpc-display',capturedAt:new Date(started).toISOString(),clock:started,
    publisher:'NOAA WPC',source:QPF_URL,presentation:RAIN_PRESENTATION,rasterCrs:'EPSG:3857',coordinateCrs:'EPSG:4326',bounds:[...regionalForecastBounds],frames});
  await writeAtomic(new URL('manifest.json',output),JSON.stringify(manifest));
  return {status:'prepared-public-weather',prepared:frames.length,failed:failed.sort((a,b)=>a-b),skipped:skipped.sort((a,b)=>a-b),
    requests,bytes,durationMs:clock()-started,preparedAt:manifest.capturedAt};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try{console.log(JSON.stringify(await collectPreparedWeather()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
