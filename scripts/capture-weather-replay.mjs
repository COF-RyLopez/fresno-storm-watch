/** Public, bounded WPC acquisition. Writes only an ignored replay; never deploys it. */
import {mkdir,writeFile,readFile,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {loadWatershedRain,regionalForecastBounds} from '../site/lib/watch-watershed-data.js';
import {fetchQpfCycle} from '../site/lib/environment-data.js';
import {QPF_URL} from '../site/lib/environment-model.js';
import {validateWeatherReplay,weatherReferenceFeatures} from '../site/lib/weather-frame-package.js';
import {riverConcerns} from '../site/lib/command-data.js';

const root=new URL('../',import.meta.url),base=new URL('work/weather-delivery/',root);
const capturedAt=new Date().toISOString(),clock=Date.parse(capturedAt),id=`capture-${clock}-${randomUUID().slice(0,8)}`;
const output=new URL(id+'/',base),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(new URL('images/',output),{recursive:true});await mkdir(new URL('responses/',output),{recursive:true});
const routes={},requests=[];
async function readPublic(url,options={}){
  const input=new URL(url);
  if(input.origin!=='https://mapservices.weather.noaa.gov'||!input.pathname.startsWith('/vector/rest/services/precip/wpc_qpf/MapServer'))throw Error('Only public WPC requests may be recorded');
  const started=performance.now();
  const r=await fetch(input,{...options,credentials:'omit',signal:AbortSignal.any([AbortSignal.timeout(25000),...(options.signal?[options.signal]:[])])});
  if(!r.ok)throw Error('WPC returned '+r.status);
  const reader=r.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12*1024*1024)throw Error('WPC response exceeds capture bound');parts.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const bytes=Buffer.concat(parts),digest=hash(bytes),file=`responses/${digest}.bin`,type=r.headers.get('content-type')||'application/octet-stream';
  await writeFile(new URL(file,output),bytes);
  routes[input.href]={file,type,bytes:size,sha256:digest};
  requests.push({url:input.href,bytes:size,milliseconds:performance.now()-started});
  return new Response(bytes,{status:200,headers:{'content-type':type,'content-length':String(size)}});
}
const frames=[];
for(const layer of [9,...Array.from({length:13},(_,i)=>i+13)]){
  if(frames.length===3)break;
  let window=null;
  if(layer!==9){
    const cycle=await fetchQpfCycle({id:layer,hours:6},readPublic,clock);
    if(cycle.end<=clock||clock-cycle.issue>24*3600000){process.stdout.write(JSON.stringify({frame:`qpf-${layer}`,skipped:'expired source window'})+'\n');continue;}
    window={layer,...cycle};
  }
  const before=requests.length,start=performance.now();
  const rain=await loadWatershedRain(regionalForecastBounds,{window,fetchImpl:readPublic,clock:()=>clock});
  let image=null;
  if(rain.blob){
    const bytes=Buffer.from(await rain.blob.arrayBuffer()),sha256=hash(bytes),file=`images/${sha256}.png`;
    image={file,sha256,bytes:bytes.length,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
    await writeFile(new URL(file,output),bytes);
  }
  frames.push({id:`qpf-${layer}`,window,cycle:rain.cycle,coordinates:rain.coordinates,legend:rain.legend,image,
    capture:{milliseconds:performance.now()-start,requests:requests.length-before}});
  process.stdout.write(JSON.stringify({frame:`qpf-${layer}`,requests:requests.length-before,imageBytes:image?.bytes||0})+'\n');
}
const manifest=validateWeatherReplay({schemaVersion:1,kind:'recorded-wpc-display-replay',capturedAt,clock,publisher:'NOAA WPC',source:QPF_URL,
  rasterCrs:'EPSG:3857',coordinateCrs:'EPSG:4326',bounds:[...regionalForecastBounds],frames});
await writeFile(new URL('manifest.json',output),JSON.stringify(manifest));
await writeFile(new URL('routes.json',output),JSON.stringify(routes));
await writeFile(new URL('acquisition.json',output),JSON.stringify({capturedAt,source:QPF_URL,requests},null,2));
const watersheds=JSON.parse(await readFile(new URL('site/data/reservoir-watersheds.geojson',root),'utf8'));
// Public observation context is frozen and individually dated; it is not a future condition.
let features=[],contextNote='Gauge/reservoir context unavailable';
try{
  const bundle=JSON.parse(await readFile(new URL('site/data/map-pilot-latest.json',root),'utf8'));
  const assessment=riverConcerns(bundle,clock);
  features=weatherReferenceFeatures(assessment.features);
  contextNote='Recorded public gauges/reservoirs; each reading retains its observation time. Missing/old readings are unassessed.';
}catch(error){contextNote+=': '+error.message;}
await writeFile(new URL('context.json',output),JSON.stringify({watersheds,features,contextNote}));
const next=new URL('current.next.json',base);
await writeFile(next,JSON.stringify({id,capturedAt}));await rename(next,new URL('current.json',base));
process.stdout.write(JSON.stringify({status:'public_replay_ready',id,frames:frames.length,imageBytes:frames.reduce((n,f)=>n+(f.image?.bytes||0),0),directory:output.pathname})+'\n');
