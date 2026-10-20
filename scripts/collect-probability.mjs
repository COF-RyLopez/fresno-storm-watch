/** Public WPC map images only; scheduled Pages collection bridges publisher CORS restrictions. */
import {writeFile,mkdir,rename,readdir,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROBABILITY_BASE,PROBABILITY_SOURCE,PROBABILITY_BOUNDS,PROBABILITY_LEGEND,parseProbabilityCycle,probabilityPeriods,probabilityImageUrl,validateProbabilitySnapshot} from '../site/lib/precip-probability-model.js';
const DATA=new URL('../site/data/',import.meta.url);
/** Bound streamed files even when the server omits Content-Length. */
async function bounded(response,max){if(!response.ok)throw new Error(`WPC HTTP ${response.status}`);let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>max)throw new Error('WPC response exceeds size limit.');chunks.push(chunk);}return Buffer.concat(chunks);}
/** Reject HTML, truncated PNGs and unexpected pixel dimensions. */
export function probabilityPng(bytes){
  if(bytes.length<100||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR'||bytes.subarray(-8).toString('hex')!=='49454e44ae426082')throw new Error('WPC image is not a complete PNG.');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<2||height<2||width>4096||height>4096)throw new Error('Unexpected WPC image dimensions.');
  return {width,height};
}
/** Verify publisher georeferencing and color definitions before reusing them. */
export function probabilitySourceContract(script){
  for(const marker of ['xmin: -124.786952, ymin: 24.530802, xmax: -95.856708, ymax: 38.002106',"'0p25': 'ige0p25'","'0p50': 'ige0p50'",'ppp_ndfd_'])if(!script.includes(marker))throw new Error('WPC image source contract changed; verification required.');
  for(const [label,color]of PROBABILITY_LEGEND)if(!script.includes(`'${label}': '${color}'`))throw new Error('WPC probability legend changed; verification required.');
}
/** Collect a coherent complete cycle; on failure publish a conspicuous error, not partial shading. */
export async function collectProbability({fetchImpl=fetch,now=Date.now()}={}){
  const checkedAt=new Date(now).toISOString(),get=url=>fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(25_000),headers:{'User-Agent':'FresnoCountyStormWatch/0.25 (https://cof-rylopez.github.io/fresno-storm-watch/)'}});
  const base={schemaVersion:1,source:PROBABILITY_SOURCE,checkedAt,error:null,records:[]};
  try{
    const text=async url=>(await bounded(await get(url),500_000)).toString('utf8');
    const [declaration,script]=await Promise.all([text(PROBABILITY_BASE+'current_cycle_co.js'),text(PROBABILITY_BASE+'script.js?v=5')]);
    probabilitySourceContract(script);const {cycle,issue}=parseProbabilityCycle(declaration,now),images=new Map();
    const records=[];
    // Sequential downloads keep the request burst bounded to one image at a time.
    for(const period of probabilityPeriods(cycle,now))for(const threshold of ['0p25','0p50']){
      const source=probabilityImageUrl(cycle,threshold,period.forecastHour),bytes=await bounded(await get(source),8_000_000),dimensions=probabilityPng(bytes),sha256=createHash('sha256').update(bytes).digest('hex'),file=`probability-images/${sha256}.png`;
      images.set(file,bytes);records.push({period:period.index,threshold,start:period.start,end:period.end,source,file,sha256,bytes:bytes.length,...dimensions});
    }
    const final=parseProbabilityCycle(await text(PROBABILITY_BASE+'current_cycle_co.js'),now);
    if(final.cycle!==cycle)throw new Error('WPC cycle changed during collection; retry next collection.');
    const snapshot=validateProbabilitySnapshot({...base,cycle,issue:new Date(issue).toISOString(),bounds:PROBABILITY_BOUNDS,legend:PROBABILITY_LEGEND,records},now);
    return {snapshot,images};
  }catch(error){return {snapshot:{...base,error:String(error.message||error).slice(0,300)},images:new Map()};}
}
async function main(){
  const start=Date.now(),{snapshot,images}=await collectProbability(),folder=new URL('probability-images/',DATA);
  await mkdir(folder,{recursive:true});
  for(const [file,bytes]of images)await writeFile(new URL(file,DATA),bytes);
  await writeFile(new URL('precip-probability.tmp',DATA),JSON.stringify(snapshot,null,2)+'\n','utf8');
  await rename(new URL('precip-probability.tmp',DATA),new URL('precip-probability.json',DATA));
  // Only delete orphaned public PNGs inside this collector's resolved output directory.
  const keep=new Set([...images.keys()].map(f=>f.split('/').at(-1)));
  for(const name of await readdir(folder))if(/^[a-f0-9]{64}\.png$/.test(name)&&!keep.has(name))await unlink(new URL(name,folder));
  console.log(JSON.stringify({event:'wpc-probability-collection',checkedAt:snapshot.checkedAt,cycle:snapshot.cycle,images:images.size,bytes:[...images.values()].reduce((n,b)=>n+b.length,0),durationMs:Date.now()-start,error:snapshot.error}));
  if(snapshot.error)console.warn('Probability overlay withheld; official portal remains available.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
