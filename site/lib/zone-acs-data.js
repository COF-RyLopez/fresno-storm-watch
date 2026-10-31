import {readAcsMetadata,readAcsTracts} from './acs-data.js?v=0.67.0';
import {readPopulationBlocks} from './population-data.js?v=0.73.1';
import {summarizeZoneAcs,ZONE_ACS_BOUNDARIES} from './zone-acs-model.js?v=0.67.0';
import {powerGeometry} from './power-geometry.js';

const AREA_TOLERANCE=1e-6,MAX_BLOCK_WORK=75000,CACHE_LIFETIME=600000;

/** Full Census boundaries, not the Living Atlas water-erased display polygons. */
export async function readCensusAnalysisTracts(geometry,{fetcher=fetch,signal}={}){
  const read=async(path,query)=>{
    const timeout=AbortSignal.timeout(30000),response=await fetcher(ZONE_ACS_BOUNDARIES.url+path+(query?'':'?f=json'),{credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,...(query?{method:'POST',body:new URLSearchParams({f:'json',...query})}:{})});
    if(!response.ok)throw Error('Census tract boundary HTTP '+response.status);const data=await response.json();if(data.error)throw Error('Census tract boundary query failed.');return data;
  };
  const metadata=await read(''),oid=metadata.fields?.find(field=>field.type==='esriFieldTypeOID')?.name;
  if(metadata.name!=='Census Tracts'||!metadata.description?.includes(ZONE_ACS_BOUNDARIES.vintage)||metadata.geometryType!=='esriGeometryPolygon'||!oid||!['GEOID','STATE','COUNTY'].every(name=>metadata.fields?.some(field=>field.name===name)))throw Error('Census analysis-boundary schema or vintage changed.');
  const filter={where:"STATE = '06' AND COUNTY = '019'",geometry:JSON.stringify(geometry),geometryType:'esriGeometryPolygon',inSR:4326,spatialRel:'esriSpatialRelIntersects',returnIdsOnly:true};
  const inventory=await read('/query',filter),ids=inventory.objectIds===null?[]:inventory.objectIds;
  if(!Array.isArray(ids)||ids.length>500||inventory.exceededTransferLimit||new Set(ids).size!==ids.length||ids.some(id=>!Number.isSafeInteger(id)))throw Error('Census analysis-boundary inventory is incomplete.');
  const rows=[],seen=new Set();
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100),data=await read('/query',{objectIds:batch.join(','),outFields:`${oid},GEOID`,returnGeometry:true,outSR:4326});
    if((data.spatialReference?.latestWkid||data.spatialReference?.wkid)!==4326||data.exceededTransferLimit||data.features?.length!==batch.length||new Set(data.features.map(f=>f.attributes?.[oid])).size!==batch.length||data.features.some(f=>!batch.includes(f.attributes?.[oid])))throw Error('Census analysis boundaries are incomplete or in an unexpected CRS.');
    for(const feature of data.features){const id=String(feature.attributes?.GEOID||'');if(!/^06019\d{6}$/.test(id)||seen.has(id))throw Error('Duplicate or outside-county analysis tract.');seen.add(id);const polygon=powerGeometry({...feature.geometry,spatialReference:{wkid:4326}});if(!polygon.rings)throw Error('Census analysis polygon missing.');rows.push({id,geometry:polygon});}
  }
  const after=await read('/query',filter),afterIds=after.objectIds===null?[]:after.objectIds;
  if(!Array.isArray(afterIds)||after.exceededTransferLimit||JSON.stringify([...afterIds].sort((a,b)=>a-b))!==JSON.stringify([...ids].sort((a,b)=>a-b)))throw Error('Census analysis-boundary inventory changed; retry.');
  return {rows,checked:Date.now(),source:ZONE_ACS_BOUNDARIES.url,vintage:ZONE_ACS_BOUNDARIES.vintage};
}

/** Join publisher totals to matching full Census tracts; no cartographic cutout is analyzed. */
export async function readZoneAcsTracts({geometry,readValues=readAcsTracts,readOutlines=readCensusAnalysisTracts,...options}={}){
  const [values,outlines]=await Promise.all([readValues(options),readOutlines(geometry,options)]);
  if(values.metadata.period!==ZONE_ACS_BOUNDARIES.period)throw Error('The ACS period needs matching Census analysis boundaries; use whole-tract context until the new vintage is configured.');
  const byId=new Map(values.rows.map(row=>[row.id,row]));
  const rows=outlines.rows.map(outline=>{const source=byId.get(outline.id);if(!source)throw Error('A Census analysis tract has no matching ACS population record.');return {...source,geometry:outline.geometry};}).sort((a,b)=>a.id.localeCompare(b.id));
  return {...values,rows,boundaries:outlines,checked:Date.now()};
}

/** O(queried blocks) geometry work, bounded and yielded; all geometry remains in WGS84. */
export async function calculateAcsZonePopulation(zone,{
  Polygon,intersection,area,signal,fetcher=fetch,current=()=>true,
  readTracts=readZoneAcsTracts,readBlocks=readPopulationBlocks,verifyMetadata=readAcsMetadata,
  blockCache=new Map(),onProgress=()=>{},yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0))
}){
  const check=()=>{if(signal?.aborted||!current())throw new DOMException('Selection changed','AbortError');};
  const squareMetres=polygon=>{
    const value=polygon?.rings?.length?Math.abs(area.execute(polygon,{unit:'square-meters'})):0;
    if(!Number.isFinite(value))throw Error('ACS allocation area failed validation.');return value;
  };
  check();
  const collection=await readTracts({geometry:zone.geometry,signal,fetcher});
  check();
  const target=new Polygon(zone.geometry),rows=[],accepted=[];let blockWork=0,sourceBlocks=0;
  intersection.accelerateGeometry?.(target);
  for(const tract of collection.rows){
    check();const polygon=new Polygon(tract.geometry),tractArea=squareMetres(polygon);
    if(tractArea<=0)throw Error('ACS tract has no usable area.');
    const clipped=intersection.execute(polygon,target),clippedArea=squareMetres(clipped);
    if(!clippedArea)continue;
    if(clippedArea>tractArea*(1+AREA_TOLERANCE))throw Error('ACS tract intersection exceeds its source area.');
    // Reject duplicate coverage rather than count overlapping source tracts twice.
    for(const other of accepted)if(squareMetres(intersection.execute(clipped,other.geometry))>Math.min(clippedArea,other.area)*AREA_TOLERANCE)throw Error('ACS tract outlines overlap; allocation needs review.');
    accepted.push({geometry:clipped,area:clippedArea});
    const measure=tract.measures[0];
    const row={id:tract.id,name:tract.name,population:measure.estimate,moe:measure.moe,areaFraction:Math.min(1,clippedArea/tractArea),weight:null,baselineWithin:null,baselineTotal:null,blocks:0,reason:null};
    if(row.areaFraction>=1-1e-9){row.weight=1;row.method='Whole tract';}
    else{
      onProgress(`Checking 2020 block population for ${tract.name}…`);
      const signature=JSON.stringify(tract.geometry),saved=blockCache.get(tract.id);
      const blocks=saved?.signature===signature&&Date.now()-saved.collection.checked<CACHE_LIFETIME?saved.collection:await readBlocks(tract.geometry,{signal,fetcher});
      check();blockCache.set(tract.id,{signature,collection:blocks});if(blockCache.size>8)blockCache.delete(blockCache.keys().next().value);
      blockWork+=blocks.rows.length;if(blockWork>MAX_BLOCK_WORK)throw Error('ACS allocation exceeds the 75,000-block work limit; use whole-tract context and request a prepared analysis.');
      sourceBlocks+=blocks.rows.length;row.blockChecked=blocks.checked;row.blockEdited=blocks.edited??null;
      let denominator=0,numerator=0,missing=0;
      for(let i=0;i<blocks.rows.length;i++){
        check();const block=blocks.rows[i],shape=new Polygon(block.geometry),blockArea=squareMetres(shape);
        if(blockArea<=0)throw Error('Census block has no usable area.');
        const inTract=intersection.execute(shape,polygon),partArea=squareMetres(inTract);
        if(partArea>blockArea*(1+AREA_TOLERANCE))throw Error('Block-to-tract overlap exceeds its source area.');
        if(partArea>0){
          row.blocks++;
          const insideArea=squareMetres(intersection.execute(inTract,target));
          if(insideArea>partArea*(1+AREA_TOLERANCE))throw Error('Block-to-zone overlap exceeds its tract share.');
          if(block.population===null)missing++;
          else {denominator+=block.population*Math.min(1,partArea/blockArea);numerator+=block.population*Math.min(1,insideArea/blockArea);}
        }
        if(i%25===24)await yieldFrame();
      }
      row.baselineWithin=numerator;row.baselineTotal=denominator;row.method='2020 block population pattern';
      if(missing)row.reason='Missing 2020 population prevents a complete allocation weight.';
      else if(denominator<=0||numerator<=0)row.reason='No usable 2020 populated-block pattern in this partial overlap; later development cannot be inferred.';
      else if(numerator>denominator*(1+AREA_TOLERANCE))throw Error('Zone block population exceeds its tract denominator.');
      else row.weight=Math.min(1,numerator/denominator);
    }
    rows.push(row);await yieldFrame();
  }
  check();
  const after=await verifyMetadata('population',{signal,fetcher});check();
  if(after.period!==collection.metadata.period||after.modified!==collection.metadata.modified||after.edited!==collection.metadata.edited)throw Error('ACS source changed during calculation; retry the zone.');
  return {...summarizeZoneAcs(rows),period:collection.metadata.period,checked:Date.now(),sourceChecked:collection.checked,metadata:collection.metadata,boundaries:collection.boundaries,accounting:{returnedTracts:collection.rows.length,positiveAreaTracts:rows.length,queriedBlockRecords:sourceBlocks}};
}
