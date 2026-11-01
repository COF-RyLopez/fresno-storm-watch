import {mkdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {preparePopulation,calculatePreparedZone,prepareGeometry,polygonArea,overlap,selectFresnoZones} from './lib/zone-population-calc.mjs';
import {ZONE_ACS_METHOD,ZONE_ACS_LIMIT,ZONE_ACS_ERROR} from '../site/lib/zone-acs-model.js';
import {fingerprint,acsChanged} from './acquire-zone-population.mjs';
import {PRODUCT_METHOD,boundaryFingerprint} from '../site/lib/zone-population-product.js';
import {countyGeometry} from '../site/lib/model.js';
import {readAcsMetadata} from '../site/lib/acs-data.js';
import {readCareCollection} from '../site/lib/care-data.js';
import {writeAtomic} from './lib/snapshot-io.mjs';

const root=new URL('../',import.meta.url),folder=new URL('site/data/zone-population/',root),work=new URL('work/zone-population/',root);
const sha=text=>createHash('sha256').update(text).digest('hex');
const csv=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';

// Rebuild a dated, public aggregate product. Never reads private county records.
const inputs=JSON.parse(await readFile(new URL('inputs.json',work),'utf8')),started=Date.now();
if(inputs.schema!==1||inputs.tracts.metadata.period!=='2020–2024'||inputs.zones.rows.length!==new Set(inputs.zones.rows.map(z=>z.key)).size)throw Error('Invalid or unsupported source snapshot.');
if(Object.entries(inputs.fingerprints).some(([k,v])=>fingerprint(inputs[k].rows)!==v))throw Error('Prepared input integrity check failed.');
const inventory=selectFresnoZones(inputs.zones.rows);
const prepared=preparePopulation(inputs.tracts.rows,inputs.blocks.rows,p=>{if(p.tracts%25===0)console.log(`Prepared ${p.tracts} / ${inputs.tracts.rows.length} tracts`);});
const county=prepareGeometry({...countyGeometry(inputs.county.geometry),spatialReference:{wkid:4326}},'Fresno County');
const features=[],evidence={};
for(const zone of [...inventory.included].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))){
  try{
    const result=calculatePreparedZone(zone,prepared),shape=prepareGeometry(zone.geometry,zone.key),countyShare=polygonArea(overlap(shape,county))/shape.area;
    const reason=result.estimate===null?[...new Set(result.rows.map(r=>r.reason).filter(Boolean))].join(' ')||'No positive-area Fresno tract overlap.':null;
    features.push({type:'Feature',id:zone.oid,geometry:result.geojson,properties:{oid:zone.oid,key:zone.key,name:zone.name,population:result.estimate,samplingMoe:result.samplingMoe,tracts:result.tracts,missing:result.missing,missingMoe:result.missingMoe,reason,countyShare,method:PRODUCT_METHOD}});
    evidence[zone.key]=result.rows;
  }catch(error){throw new Error(`Zone ${zone.name} failed geometry/area validation: ${error.message}`,{cause:error});}
  if(features.length%50===0)console.log(`Calculated ${features.length} / ${inputs.zones.rows.length} zones`);
}
// Do not publish changed boundaries or a silently upgraded ACS vintage.
const [latest,metadata]=await Promise.all([readCareCollection('zones',{county:inputs.county}),readAcsMetadata('population')]);
if(fingerprint(latest.rows)!==inputs.fingerprints.zones||acsChanged(metadata,inputs.tracts.metadata))throw Error('Publisher changed after acquisition; reacquire before publishing.');
await mkdir(folder,{recursive:true});
const geo={type:'FeatureCollection',features},data=JSON.stringify(geo),evidenceText=JSON.stringify(evidence),headers=['Zone','Approximate ACS residents (nearest 10)','Sampling-only MOE component','Estimate status','ACS period','Population scope','Boundary query (UTC)','Calculated (UTC)','Method','Reason / limits','Sampling uncertainty limits','Zone source','ACS source','2020 weight source'];
const built=Date.now(),csvText='\uFEFF'+[headers.map(csv).join(','),...features.map(({properties:p})=>[p.name,p.population===null?'Unknown':p.population>0&&p.population<5?'<10':Math.round(p.population/10)*10,p.samplingMoe===null?'Unknown':Math.ceil(p.samplingMoe),p.population===null?'Needs review':'Estimated','2020–2024','Fresno County portion only',new Date(inputs.zones.checked).toISOString(),new Date(built).toISOString(),PRODUCT_METHOD,p.reason||ZONE_ACS_LIMIT,ZONE_ACS_ERROR,inputs.sources.zones,inputs.sources.acs,inputs.sources.blocks].map(csv).join(','))].join('\r\n');
const manifest={schema:1,method:PRODUCT_METHOD,built,acquired:inputs.acquired,zonesChecked:inputs.zones.checked,acsChecked:inputs.tracts.checked,acsMetadata:inputs.tracts.metadata,blockChecked:inputs.blocks.checked,blockEdited:inputs.blocks.edited,scope:'Fresno County portions of county-published Sheriff evacuation zones',period:'2020–2024',baselineYear:2020,source:inputs.sources,boundarySource:{url:inputs.tracts.boundaries.source,vintage:inputs.tracts.boundaries.vintage,checked:inputs.tracts.boundaries.checked,tracts:inputs.tracts.boundaries.rows.length},inventory:{sourceZones:inputs.zones.rows.length,excluded:inventory.excluded},counts:{zones:features.length,estimated:features.filter(f=>f.properties.population!==null).length,unknown:features.filter(f=>f.properties.population===null).length,tracts:prepared.length,blocks:inputs.blocks.rows.length},limits:{method:ZONE_ACS_METHOD,interpretation:ZONE_ACS_LIMIT,uncertainty:ZONE_ACS_ERROR,geometry:'Intersections in EPSG:4326; WGS84 ellipsoidal areas using GeographicLib. Straight geographic segments densified to at most 0.0005 degrees. No Web Mercator area measurement.',boundary:'Dated boundary snapshot, not current evacuation orders. Only Fresno County population is included. Do not sum overlapping zones.'},geometryFingerprint:await boundaryFingerprint(inputs.zones.rows),inputFingerprints:inputs.fingerprints,geojson:{file:'zones.geojson',sha256:sha(data),bytes:Buffer.byteLength(data)},csv:{file:'zone-population.csv',sha256:sha(csvText),bytes:Buffer.byteLength(csvText)},evidence:{file:'evidence.json',sha256:sha(evidenceText),bytes:Buffer.byteLength(evidenceText)},engine:{node:process.version,polygonClipping:'0.15.7',geographiclib:'2.2.0'}};
for(const [name,content]of [['zones.geojson',data],['evidence.json',evidenceText],['zone-population.csv',csvText],['manifest.json',JSON.stringify(manifest,null,2)]])await writeAtomic(new URL(name,folder),content);
console.log(JSON.stringify({status:'built',...manifest.counts,seconds:(Date.now()-started)/1000}));
