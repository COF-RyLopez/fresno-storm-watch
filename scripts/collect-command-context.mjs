/** Public reference geometry only. County intersection selects whole polygons; no hazard inference. */
import {readFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {arcgisToGeoJSON} from '@terraformer/arcgis';
import {writeAtomic} from './lib/snapshot-io.mjs';

export const SOURCES={
  cities:{id:'census-places',publisher:'U.S. Census Bureau',url:'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4'},
  calfire:{id:'calfire-frap',publisher:'CAL FIRE FRAP',url:'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0'},
  nifc:{id:'nifc-2026',publisher:'National Interagency Fire Center',url:'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_YearToDate/FeatureServer/0'},
  usgs:{id:'usgs-postfire',publisher:'U.S. Geological Survey',url:'https://earthquake.usgs.gov/arcgis/rest/services/ls/pwfdf/MapServer/0'}
};
const MODELS=[
  {name:'BASIN',year:2024,fireId:'bas2024',storm:'30 mm/h peak 15-minute intensity',archive:'https://www.sciencebase.gov/catalog/item/68c492d1d4be021a00d8cc38'},
  {name:'GARNET',year:2025,fireId:'Garnet_2025-08-24_v1.0',storm:'34 mm/h peak 15-minute intensity',archive:'https://www.sciencebase.gov/catalog/item/68d406ced4be023091a48085'}
];
const NOTE='Historical immediate-postfire model, not current danger';
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&/^\d{4}-\d\d-\d\dT/.test(value);
const identity=value=>typeof value==='string'?value.trim().replace(/[{}]/g,'').toLowerCase():'';
const text=(value,label)=>{if(typeof value!=='string'||!value.trim())throw Error('Missing '+label);return value.trim();};
const timestamp=value=>{if(value==null)return null;if(typeof value!=='number'||!Number.isFinite(value)||value<=0)throw Error('Invalid source date');return value;};
const fc=features=>({type:'FeatureCollection',features});

/** Validate coordinates without altering source geometry or silently dropping features. */
export function validateGeometry(geometry){
  if(!geometry||!['Polygon','MultiPolygon'].includes(geometry.type))throw Error('Expected Polygon/MultiPolygon');
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  if(!Array.isArray(polygons)||!polygons.length)throw Error('Empty polygon');
  for(const polygon of polygons){
    if(!Array.isArray(polygon)||!polygon.length)throw Error('Empty polygon rings');
    for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<4)throw Error('Invalid polygon ring');
      let area=0;
      for(let i=0;i<ring.length;i++){
        const p=ring[i],q=ring[(i+1)%ring.length];
        if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)throw Error('Invalid WGS84 coordinate');
        area+=p[0]*q[1]-q[0]*p[1];
      }
      if(ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1]||Math.abs(area)<1e-12)throw Error('Unclosed or zero-area polygon');
    }
  }
  return geometry;
}
function rows(payload,label){
  if(payload?.error)throw Error(label+' ArcGIS error: '+JSON.stringify(payload.error));
  if(payload?.exceededTransferLimit)throw Error(label+' exceededTransferLimit; refusing partial data');
  if(!Array.isArray(payload?.features)||!payload.features.length)throw Error(label+' returned zero features');
  const sr=payload.spatialReference?.latestWkid??payload.spatialReference?.wkid;
  if(sr!==4326)throw Error(label+' must explicitly return EPSG:4326');
  return payload.features;
}
function geometryOf(row){
  const sr=row.geometry?.spatialReference;
  if(sr&&(sr.latestWkid??sr.wkid)!==4326)throw Error('Invalid feature CRS');
  try{return validateGeometry(arcgisToGeoJSON({...row.geometry,spatialReference:{wkid:4326}}));}
  catch(error){throw Error('Invalid geometry for '+JSON.stringify(row.attributes)+': '+error.message);}
}
function unique(features,label){
  const ids=new Set();
  for(const f of features){if(ids.has(f.properties.id))throw Error('Duplicate '+label+' ID '+f.properties.id);ids.add(f.properties.id);}
  return features.sort((a,b)=>a.properties.id.localeCompare(b.properties.id));
}
export function normalizeCities(payload){
  return unique(rows(payload,'Census').map(row=>{
    const a=row.attributes??{},geoid=text(a.GEOID,'GEOID');
    if(!/^06\d{5}$/.test(geoid))throw Error('Invalid California place GEOID');
    return {type:'Feature',properties:{id:'city:'+geoid,name:text(a.BASENAME||a.NAME,'city name'),geoid,source:SOURCES.cities.id,publisher:SOURCES.cities.publisher},geometry:geometryOf(row)};
  }),'city');
}
export function normalizeBurnScars(payload,provider){
  if(!['calfire','nifc'].includes(provider))throw Error('Unknown fire provider');
  const src=SOURCES[provider],historical=provider==='calfire';
  return unique(rows(payload,src.publisher).map(row=>{
    const a=row.attributes??{},stable=identity(historical?a.IRWINID:a.poly_IRWINID)||identity(a.GlobalID);
    if(!stable)throw Error('Missing stable fire identity');
    const discovered=timestamp(historical?a.ALARM_DATE:a.attr_FireDiscoveryDateTime);
    const year=historical?a.YEAR_:(discovered?new Date(discovered).getUTCFullYear():2026);
    if(!Number.isInteger(year)||(historical&&![2024,2025].includes(year))||(!historical&&year!==2026))throw Error('Unexpected fire coverage year');
    return {type:'Feature',properties:{id:'burn-scar:'+stable,name:text(historical?a.FIRE_NAME:a.poly_IncidentName,'fire name'),year,discovered,updated:timestamp(historical?a.CONT_DATE:a.poly_DateCurrent),source:src.id,publisher:src.publisher,geometryStatus:historical?'Historical perimeter':'Provisional perimeter'},geometry:geometryOf(row)};
  }),'fire');
}

/** Stored snapshots undergo the same geometry, identity and date checks before reuse. */
export function validateCommandContext(bundle){
  if(bundle?.schemaVersion!==1||!iso(bundle.generatedAt)||!Array.isArray(bundle.sources)||!Array.isArray(bundle.warnings)||!bundle.warnings.every(w=>typeof w==='string'))throw Error('Invalid context bundle');
  for(const [key,prefix] of [['cities','city:'],['burnScars','burn-scar:']]){
    const collection=bundle[key];
    if(collection?.type!=='FeatureCollection'||!Array.isArray(collection.features)||!collection.features.length)throw Error('Missing '+key+' coverage');
    unique(collection.features,key);
    for(const feature of collection.features){
      const p=feature.properties;
      if(feature.type!=='Feature'||!p?.id?.startsWith(prefix)||!p.name||!p.source||!p.publisher)throw Error('Invalid context feature');
      validateGeometry(feature.geometry);
      if(key==='burnScars'){
        timestamp(p.discovered);timestamp(p.updated);
        if(!Number.isInteger(p.year)||!['Historical perimeter','Provisional perimeter'].includes(p.geometryStatus))throw Error('Invalid fire properties');
        if(p.assessment&&(!p.assessment.source||!p.assessment.fireId||!p.assessment.storm||p.assessment.note!==NOTE||timestamp(p.assessment.issued)==null))throw Error('Invalid assessment metadata');
      }else if(p.id!=='city:'+p.geoid||!/^06\d{5}$/.test(p.geoid))throw Error('Invalid city identity');
    }
  }
  if(bundle.sources.length<4||bundle.sources.some(s=>!s.id||!s.publisher||!s.url?.startsWith('https://')||!iso(s.checkedAt)||!s.coverage))throw Error('Invalid source provenance');
  return bundle;
}
async function getJson(url,fetchImpl,params){
  const options={signal:AbortSignal.timeout(45000)};
  if(params)Object.assign(options,{method:'POST',body:new URLSearchParams(params)});
  const response=await fetchImpl(url,options);
  if(!response.ok)throw Error('HTTP '+response.status+' from '+url);
  const data=await response.json();if(data?.error)throw Error('Source error '+JSON.stringify(data.error));return data;
}
function countyQuery(county){
  if(county?.type!=='FeatureCollection'||county.features?.length!==1)throw Error('Expected one county polygon');
  const geometry=validateGeometry(county.features[0].geometry);
  const rings=geometry.type==='Polygon'?geometry.coordinates:geometry.coordinates.flat();
  return {geometry:JSON.stringify({rings,spatialReference:{wkid:4326}}),geometryType:'esriGeometryPolygon',inSR:'4326',spatialRel:'esriSpatialRelIntersects',outSR:'4326',returnGeometry:'true',maxAllowableOffset:'0.0003',geometryPrecision:'5',f:'json'};
}

/** Collect atomically: any failed source retains the entire validated previous snapshot. */
export async function collectCommandContext({county,fetchImpl=fetch,now=Date.now(),previous=null}){
  try{
    const query=countyQuery(county),checkedAt=new Date(now).toISOString();
    const jobs=[
      getJson(SOURCES.cities.url+'?f=json',fetchImpl),
      getJson(SOURCES.cities.url+'/query',fetchImpl,{...query,where:"STATE='06'",outFields:'GEOID,BASENAME,NAME'}),
      getJson(SOURCES.calfire.url+'/query',fetchImpl,{...query,where:'YEAR_ >= 2024',outFields:'FIRE_NAME,YEAR_,GlobalID,IRWINID,ALARM_DATE,CONT_DATE'}),
      getJson(SOURCES.nifc.url+'/query',fetchImpl,{...query,where:"attr_IncidentTypeCategory='WF'",outFields:'poly_IncidentName,poly_IRWINID,GlobalID,attr_FireDiscoveryDateTime,poly_DateCurrent'}),
      ...MODELS.map(m=>getJson(SOURCES.usgs.url+'/query',fetchImpl,{where:"Fire_ID='"+m.fireId+"'",outFields:'Fire_ID,assessment_date,Rainfall',returnGeometry:'false',f:'json'}))
    ];
    const settled=await Promise.allSettled(jobs),failed=settled.find(r=>r.status==='rejected');
    if(failed)throw failed.reason;
    const [metadata,cityRaw,fireRaw,nifcRaw,...modelRaw]=settled.map(r=>r.value);
    if(!metadata.description?.includes('vintage'))throw Error('Census vintage missing');
    const warnings=[];
    const normalizeDisplay=async(raw,provider,normalizer,where,outFields)=>{
      try{return normalizer(raw);}
      catch(error){
        if(!error.message.startsWith('Invalid geometry for '))throw error;
        const precise={...query,where,outFields,geometryPrecision:'7'};delete precise.maxAllowableOffset;
        const retry=await getJson(SOURCES[provider].url+'/query',fetchImpl,precise);
        const features=normalizer(retry);
        warnings.push(SOURCES[provider].publisher+' display generalization produced invalid geometry; source precision retained for the complete layer.');
        return features;
      }
    };
    const cities=await normalizeDisplay(cityRaw,'cities',normalizeCities,"STATE='06'",'GEOID,BASENAME,NAME');
    const fires=await normalizeDisplay(fireRaw,'calfire',r=>normalizeBurnScars(r,'calfire'),'YEAR_ >= 2024','FIRE_NAME,YEAR_,GlobalID,IRWINID,ALARM_DATE,CONT_DATE');
    const recent=await normalizeDisplay(nifcRaw,'nifc',r=>normalizeBurnScars(r,'nifc'),"attr_IncidentTypeCategory='WF'",'poly_IncidentName,poly_IRWINID,GlobalID,attr_FireDiscoveryDateTime,poly_DateCurrent');
    for(let i=0;i<MODELS.length;i++){
      const m=MODELS[i],raw=modelRaw[i];
      if(raw.exceededTransferLimit||raw.features?.length!==1)throw Error('Incomplete USGS assessment metadata');
      const a=raw.features[0].attributes;
      if(a.Fire_ID!==m.fireId||timestamp(a.assessment_date)==null||a.Rainfall!==(i===0?'30mm':'34mm'))throw Error('USGS model identity/scenario changed');
      const match=fires.find(f=>f.properties.name.toUpperCase()===m.name&&f.properties.year===m.year);
      if(!match)throw Error('Priority fire perimeter missing: '+m.name);
      match.properties.assessment={source:m.archive,issued:a.assessment_date,fireId:m.fireId,storm:m.storm,note:NOTE};
    }
    const seen=new Set(fires.map(f=>f.properties.id));
    for(const fire of recent){if(seen.has(fire.properties.id)){warnings.push('Duplicate incident across providers retained once: '+fire.properties.id);continue;}seen.add(fire.properties.id);fires.push(fire);}
    const sources=[
      {...SOURCES.cities,checkedAt,coverage:metadata.description+'; whole incorporated-place polygons intersecting Fresno County; neighboring-place intersection may occur.'},
      {...SOURCES.calfire,checkedAt,coverage:'firep25_1 historical wildfires 2024–2025; county polygon intersection; incomplete inventory and minimum mapping criteria apply.'},
      {...SOURCES.nifc,checkedAt,coverage:'2026 discovery-year wildfire perimeters to date; approved/public/visible IRWIN polygons; provisional and incomplete incident coverage.'},
      {...SOURCES.usgs,checkedAt,coverage:'Basin 2024-07-29 v1.0 and Garnet 2025-09-24 v1.0 assessment metadata only; different design storms; immediate-postfire conditions.'}
    ];
    return validateCommandContext({schemaVersion:1,generatedAt:checkedAt,cities:fc(cities),burnScars:fc(unique(fires,'fire')),sources,warnings});
  }catch(error){
    if(!previous)throw error;
    validateCommandContext(previous);
    return {...previous,warnings:[...new Set([...previous.warnings,'Collection failed; retained previous snapshot at '+previous.generatedAt+'. '+error.message])]};
  }
}

export async function main(args=process.argv.slice(2)){
  const output=new URL('../site/data/command-context.json',import.meta.url);
  let previous=null;
  try{previous=validateCommandContext(JSON.parse(await readFile(output,'utf8')));}catch{/* No valid local fallback. */}
  if(args.includes('--published')){
    try{
      const published=validateCommandContext(await getJson('https://cof-rylopez.github.io/fresno-storm-watch/data/command-context.json',fetch));
      const age=Date.now()-Date.parse(published.generatedAt);
      if(age>=0&&(!previous||Date.parse(published.generatedAt)>Date.parse(previous.generatedAt)))previous=published;
      if(age>=0&&age<86400000){await writeAtomic(output,JSON.stringify(published)+'\n');console.log('Reused published command context '+published.generatedAt);return published;}
    }catch(error){console.warn('Published context unavailable: '+error.message);}
  }
  const county=JSON.parse(await readFile(new URL('../site/data/reported-locations/county.geojson',import.meta.url),'utf8'));
  const bundle=await collectCommandContext({county,previous});
  await mkdir(new URL('../site/data/',import.meta.url),{recursive:true});
  await writeAtomic(output,JSON.stringify(bundle)+'\n');
  console.log(JSON.stringify({event:'command-context',generatedAt:bundle.generatedAt,cities:bundle.cities.features.length,burnScars:bundle.burnScars.features.length,bytes:Buffer.byteLength(JSON.stringify(bundle)),warnings:bundle.warnings}));
  return bundle;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){main().catch(error=>{console.error(error.message);process.exitCode=1;});}
