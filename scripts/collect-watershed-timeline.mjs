/** Publish six-hour WPC contours intersecting each full USGS reservoir basin. */
import {siteJson,writeAtomic,bounded} from './lib/snapshot-io.mjs';
import {countyGeometry} from '../site/lib/model.js';
import {HOUR} from '../site/lib/river-model.js';
import {QPF_URL,qpfCycle,realNumber} from '../site/lib/environment-model.js';
import {WPC_INTERVALS,riseOutletReports} from '../site/lib/watershed-timeline-model.js';

const now=Date.now(),basins=await siteJson('reservoir-watersheds.geojson');
const scopes=Object.fromEntries(basins.features.map(f=>[f.properties.reservoir,JSON.stringify(countyGeometry(f.geometry))]));
if(!scopes.MIL||!scopes.PNF||Object.keys(scopes).length!==2)throw Error('Expected both reservoir watersheds');

async function getJson(url,init={}){
 const options={...init,signal:AbortSignal.timeout(14_000)};
 const response=await fetch(url,options);
 const body=await bounded(response,2_000_000,'Publisher','Publisher response too large');
 const doc=JSON.parse(body);
 if(doc.error||doc.exceededTransferLimit)throw Error('Incomplete publisher response');
 return doc;
}

const fields='product,issue_time,start_time,end_time,units';
const common={f:'json',where:"qpf >= 0.01",outFields:fields,returnGeometry:'false',resultRecordCount:'200'};
const sameCycle=(a,b)=>['issue','start','end','product'].every(key=>a[key]===b[key]);
async function windowAt(layer){
 const url=`${QPF_URL}/${layer}/query`;
 const national=async()=>{
  const cycle=qpfCycle(await getJson(`${url}?${new URLSearchParams(common)}`),6,now);
  if(cycle.product!=='6-hour QPF')throw Error('Expected WPC 6-hour QPF');
  return cycle;
 };
 const cycle=await national();
 if(cycle.end<=now||now-cycle.issue>24*HOUR||cycle.start>=now+78*HOUR)return null;
 const results=await Promise.all(Object.entries(scopes).map(async([id,geometry])=>{
  const body=new URLSearchParams({...common,outFields:fields+',qpf',geometryType:'esriGeometryPolygon',inSR:'4326',spatialRel:'esriSpatialRelIntersects',geometry});
  const doc=await getJson(url,{method:'POST',body});
  if(!Array.isArray(doc.features))throw Error('WPC did not return features');
  if(!doc.features.length)return [id,null];
  if(!sameCycle(qpfCycle(doc,6,now),cycle))throw Error('WPC revised during basin query');
  const values=doc.features.map(f=>realNumber(f.attributes?.qpf));
  if(values.some(v=>v===null||v<0.01))throw Error('WPC amount is invalid');
  return [id,Math.max(...values)];
 }));
 if(results.some(([,amount])=>amount===null)&&!sameCycle(await national(),cycle))throw Error('WPC revised during empty basin query');
 return {layer,issue:cycle.issue,start:cycle.start,end:cycle.end,max:Object.fromEntries(results)};
}

async function rise(){
 try{
  const after=new Date(now-5*24*HOUR).toISOString().slice(0,10);
  const query=new URLSearchParams({itemId:'10810','dateTime[after]':after,'order[dateTime]':'desc',itemsPerPage:'10'});
  return riseOutletReports(await getJson(`https://data.usbr.gov/rise/api/result?${query}`),now);
 }catch(error){console.warn('RISE outlet:',error.message);return null;}
}

const riseTask=rise(),windows=[],failed=[];
for(let i=0;i<WPC_INTERVALS.length;i+=3){
 const layers=WPC_INTERVALS.slice(i,i+3);
 const results=await Promise.allSettled(layers.map(windowAt));
 results.forEach((result,index)=>{
  if(result.status==='fulfilled'){if(result.value)windows.push(result.value);}
  else{failed.push(layers[index]);console.warn(`WPC layer ${layers[index]}:`,result.reason.message);}
 });
}
const data={schemaVersion:1,generatedAt:new Date(now).toISOString(),windows,failed,riseOutlet:await riseTask};
await writeAtomic(new URL('../site/data/watershed-timeline.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(`Collected ${windows.length} WPC intervals, ${failed.length} unavailable, ${data.riseOutlet?.length??0} RISE reports`);
