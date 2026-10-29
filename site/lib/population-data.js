import {POPULATION_SOURCES,normalizePopulationFeature,summarizePopulation} from './population-model.js?v=0.64.0';

/** Public read-only REST queries. Reconcile all IDs; incomplete data never becomes a population total. */
export async function readPopulationBlocks(geometry,{fetcher=fetch,signal}={}){
  const read=async(path,query)=>{
    const url=POPULATION_SOURCES.blocks+path,body=new URLSearchParams({f:'json',...query});
    const timeout=AbortSignal.timeout(30000);const r=await fetcher(query?url:url+'?f=json',{...(query?{method:'POST',body}:{}),credentials:'omit',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout});
    if(!r.ok)throw Error('Census source HTTP '+r.status);const d=await r.json();if(d.error)throw Error('Census publisher query failed.');return d;
  };
  const metadata=await read('');
  if(metadata.geometryType!=='esriGeometryPolygon'||!['GEOID','P0010001','COUNTY'].every(name=>metadata.fields?.some(f=>f.name===name))||!metadata.objectIdField)throw Error('Census source schema changed.');
  const filter={where:"COUNTY = '019'",geometry:JSON.stringify(geometry),geometryType:'esriGeometryPolygon',inSR:4326,spatialRel:'esriSpatialRelIntersects',returnIdsOnly:true};
  const inventory=await read('/query',filter),ids=inventory.objectIds===null?[]:inventory.objectIds;
  if(!Array.isArray(ids)||ids.length>25000||inventory.exceededTransferLimit||new Set(ids).size!==ids.length||ids.some(i=>!Number.isSafeInteger(i)))throw Error('Census inventory is incomplete or exceeds the bounded query limit.');
  const rows=[],seen=new Set(),idField=metadata.objectIdField;
  for(let i=0;i<ids.length;i+=100){
    const batch=ids.slice(i,i+100),d=await read('/query',{objectIds:batch.join(','),outFields:`${idField},GEOID,P0010001`,returnGeometry:true,outSR:4326});
    if((d.spatialReference?.latestWkid||d.spatialReference?.wkid)!==4326||d.exceededTransferLimit||!Array.isArray(d.features)||d.features.length!==batch.length||new Set(d.features.map(f=>f.attributes?.[idField])).size!==batch.length||d.features.some(f=>!batch.includes(f.attributes?.[idField])))throw Error('Census polygon query returned incomplete records.');
    for(const f of d.features){const row=normalizePopulationFeature({...f,geometry:{...f.geometry,spatialReference:{wkid:4326}}});if(seen.has(row.id))throw Error('Duplicate census GEOID in source.');seen.add(row.id);rows.push(row);}
  }
  const after=await read('/query',filter),afterIds=after.objectIds===null?[]:after.objectIds;
  if(!Array.isArray(afterIds)||after.exceededTransferLimit||JSON.stringify([...afterIds].sort((a,b)=>a-b))!==JSON.stringify([...ids].sort((a,b)=>a-b)))throw Error('Census inventory changed; retry the selection.');
  return {rows,checked:Date.now(),edited:metadata.editingInfo?.dataLastEditDate||metadata.editingInfo?.lastEditDate||null,accounting:{queried:ids.length,retained:rows.length}};
}

/** SDK operators retain multipart polygons/holes and measure areas on the ellipsoid, not Web Mercator. */
export async function calculateZonePopulation(zone,collection,{Polygon,intersection,area,current=()=>true,yieldFrame=()=>new Promise(r=>setTimeout(r,0))}){
  const target=new Polygon(zone.geometry),shares=[];
  intersection.accelerateGeometry?.(target);
  for(let i=0;i<collection.rows.length;i++){
    if(!current())throw new DOMException('Selection changed','AbortError');
    const r=collection.rows[i],polygon=new Polygon(r.geometry),denominator=Math.abs(area.execute(polygon,{unit:'square-meters'}));
    if(!Number.isFinite(denominator)||denominator<=0)throw Error('Census polygon has no usable area.');
    const overlap=intersection.execute(polygon,target),numerator=overlap?.rings?.length?Math.abs(area.execute(overlap,{unit:'square-meters'})):0;
    if(!Number.isFinite(numerator)||numerator/denominator>1.000001)throw Error('Census intersection area failed validation.');
    shares.push({id:r.id,population:r.population,fraction:numerator/denominator});
    if(i%25===24)await yieldFrame();
  }
  return {...summarizePopulation(shares),shares,checked:collection.checked,accounting:collection.accounting};
}
