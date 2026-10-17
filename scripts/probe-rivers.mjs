/** Read-only publisher spot checks. Run with Node --use-system-ca on managed Windows. */
import { readFile } from 'node:fs/promises';
import { CONFIG } from '../site/config.js';
import { fetchRiverWatch } from '../site/lib/nwps.js';
import { assessGauge } from '../site/lib/river-model.js';
import { fetchJson } from '../site/lib/nws.js';

const watch=JSON.parse(await readFile(new URL('../site/data/river-watchlist.json',import.meta.url),'utf8'));
const outcomes=await fetchRiverWatch(watch.stations.filter(s=>['GVAC1','KREC1','LTDC1'].includes(s.id)),CONFIG.rivers);
const iso=value=>value===null||value===undefined?null:new Date(value).toISOString();
const samples=outcomes.map(({id,gauge:g,error})=>{
  const a=assessGauge(g,CONFIG.rivers,72,Date.now(),error);
  return {id,error,longitude:g?.longitude,latitude:g?.latitude,observed:a.observed?.value??null,observationTime:iso(a.observed?.time),observedUnits:g?.observed.units,forecastHigh:a.peak?.value??null,highFirstSample:iso(a.peak?.time),forecastUnits:g?.forecast.units,forecastIssued:iso(g?.forecast.issued),thresholds:a.thresholds,source:g?.sourceUrl};
});
const params=new URLSearchParams({f:'json',where:"SFHA_TF = 'T' OR ZONE_SUBTY LIKE '%0.2%' OR FLD_ZONE = 'D'",geometry:JSON.stringify({xmin:-120.18,ymin:36.78,xmax:-120.14,ymax:36.82,spatialReference:{wkid:4326}}),geometryType:'esriGeometryEnvelope',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'FLD_ZONE,ZONE_SUBTY,SFHA_TF,DFIRM_ID,FLD_AR_ID,SOURCE_CIT',returnGeometry:'false',resultRecordCount:'3'});
let fema,femaError=null;
try {
  fema=await fetchJson(`https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query?${params}`,{},25000);
  if(fema.error)throw new Error(fema.error.message);
} catch(error){femaError=`${error.message}${error.cause?.code?` (${error.cause.code})`:''}`;}
console.log(JSON.stringify({checked:new Date().toISOString(),nwps:samples,femaError,femaNearGravellyFord:(fema?.features||[]).map(f=>f.attributes),femaSampleLimit:3},null,2));
if(femaError||outcomes.some(r=>r.error))process.exitCode=1;
