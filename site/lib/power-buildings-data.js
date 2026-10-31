import {sha256Hex} from './zone-population-product.js';
import {validateBuildingIndex,planBuildingTiles,selectPowerBuildings} from './power-buildings-model.js';

/** Only a capacity limit narrows the scope; failed or incomplete feeds never silently become viewport results. */
export async function loadPowerBuildingsAutomatic(polygons,{viewport,current=()=>true,read=loadPowerBuildings,onVisible=()=>{}}={}){
  try{return await read(polygons,{current});}
  catch(error){
    if(error.code!=='building-query-limit'||!current())throw error;
    onVisible();const shape=viewport();if(!shape)throw Error('Map extent is not ready. Retry when the map is available.');
    return read(polygons,{viewport:shape,current});
  }
}

/** Public-only, bounded reference acquisition. No tokens, private assets, browser storage or partial-success fallback. */
export async function loadPowerBuildings(polygons,{viewport=null,current=()=>true,fetcher=fetch}={}){
  const root=new URL('../data/power-buildings/',import.meta.url);
  const read=async url=>{const r=await fetcher(url,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Building reference HTTP ${r.status}. Retry the source check.`);return r;};
  const index=validateBuildingIndex(await (await read(new URL('index.json',root))).json());
  if(!current())return null;
  const tiles=planBuildingTiles(index,polygons,viewport),rows=[];
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,tiles.length)},async()=>{
    while(current()&&next<tiles.length){
      const t=tiles[next++],r=await read(new URL(`${index.release}/${t.key}.json.gz`,root)),buffer=await r.arrayBuffer();
      if(!current())return;
      if(buffer.byteLength!==t.bytes)throw Error('Building chunk size changed; reload the reference index.');
      const hash=await sha256Hex(buffer);
      if(hash!==t.sha256)throw Error('Building chunk version differs from its index; reload the reference.');
      const decoded=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      if(decoded.byteLength!==t.decodedBytes)throw Error('Building chunk expanded size differs from its index.');
      const d=JSON.parse(new TextDecoder().decode(decoded));
      if(d.schemaVersion!==1||d.release!==index.release||!Array.isArray(d.rows)||d.rows.length!==t.count)throw Error('Building chunk is incomplete. No partial building count is shown.');
      rows.push(...d.rows);
    }
  }));
  if(!current())return null;
  return {index,rows:selectPowerBuildings(rows,polygons,viewport),scope:viewport?'Visible map portion when loaded':'Whole selected utility area',checked:Date.now()};
}
