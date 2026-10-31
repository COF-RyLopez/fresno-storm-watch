/** Public polygon-only MVT extension. Existing 0.29 flowline tiles remain byte-for-byte intact. */
import {readFile,writeFile} from 'node:fs/promises';
import geojsonvt from 'geojson-vt';
import {addWaterbodyStyle,writeTiles,thumbnailPoint,PUBLIC_URL as publicUrl} from './waterbody-cartography.mjs';
import {normalizedName as normalize} from './waterway-cartography.mjs';
const root=new URL('../',import.meta.url),input=new URL('work/waterbodies-county/',root),output=new URL('site/basemaps/frog-waterways-dark/',root);
const source=JSON.parse(await readFile(new URL('county.geojson',input),'utf8')),provenance=JSON.parse(await readFile(new URL('manifest.json',input),'utf8'));
if(source.features.length!==provenance.accepted||provenance.rejected!==0||provenance.countyGeoid!=='06019')throw new Error('Unreconciled waterbody source');
const version='0.33.0',maxzoom=12,tileDirectory='waterbodies-v'+version,bounds=provenance.bounds;
const flowIndex=JSON.parse(await readFile(new URL('site/data/search/v0.31.0/index.json',root),'utf8'));
const channelNames=new Set(flowIndex.entries.filter(row=>row.kind==='waterway').map(row=>normalize(row.name))),named=new Map();
const data={type:'FeatureCollection',features:source.features.map(row=>{
  const p=row.properties;if(!Number.isFinite(p.display_area_sqkm)||!Array.isArray(p.label_point))throw new Error('Missing projected area / interior label point');
  if(p.name&&!channelNames.has(normalize(p.name))&&(!named.has(normalize(p.name))||named.get(normalize(p.name)).properties.display_area_sqkm<p.display_area_sqkm))named.set(normalize(p.name),row);
  return {...row,properties:{source_id:p.source_id,name:p.name,kind:p.kind,kind_label:p.kind_label,area_sqkm:p.display_area_sqkm}};
})};
const names={type:'FeatureCollection',features:[...named.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,row])=>({type:'Feature',id:row.id,geometry:{type:'Point',coordinates:row.properties.label_point},properties:{source_id:row.properties.source_id,name:row.properties.name,area_sqkm:row.properties.display_area_sqkm}}))};
const options={maxZoom:maxzoom,indexMaxZoom:8,indexMaxPoints:50000,extent:4096,buffer:128,tolerance:1};
const {tiles,bytes,represented,tilesSha256}=await writeTiles(output,tileDirectory,bounds,maxzoom,{waterbodies:geojsonvt(data,options),waterbodyNames:geojsonvt(names,options)});
const manifest={...provenance,version,tileDirectory,maxzoom,tileCount:tiles,tileBytes:bytes,tilesSha256,
  labelAnchors:names.features.length,labelNames:names.features.map(row=>row.properties.name),
  cartography:{projection:'EPSG:3857 web tiles; polygon areas measured in EPSG:26944 meters',extent:4096,tileSize:512,tolerance:1,labelRule:'One interior anchor in the largest clipped polygon per normalized name; channel-name duplicates omitted. Collision avoidance enabled. Major named bodies >=1 sqkm appear from zoom 7, smaller named bodies from zoom 11.',symbolRule:'Muted blue reference footprint with blue-gray boundary; no hazard, current level or inundation meaning.'},
  displayAccounting:{inputFeatures:data.features.length,representedAtMaxZoom:represented.size,notRepresentedAtMaxZoom:data.features.filter(row=>!represented.has(row.properties.source_id)).map(row=>({source_id:row.properties.source_id,name:row.properties.name,reason:'Subpixel reference polygon omitted during display tiling; source retained in acquisition batches / publisher service.'}))}};
await writeFile(new URL('waterbodies-manifest.json',output),JSON.stringify(manifest,null,2)+'\n');
await writeFile(new URL('waterbodies-tilejson.json',output),JSON.stringify({tilejson:'3.0.0',name:'Fresno waterbody reference footprints',scheme:'xyz',tiles:[publicUrl+tileDirectory+'/{z}/{x}/{y}.pbf'],minzoom:0,maxzoom,bounds,tileSize:512,attribution:'USGS 3DHP; reference outlines, not current water levels',vector_layers:[{id:'waterbodies',geometry_type:'polygon',fields:{source_id:'String',name:'String',kind:'Number',kind_label:'String',area_sqkm:'Number'}},{id:'waterbodyNames',geometry_type:'point',fields:{source_id:'String',name:'String',area_sqkm:'Number'}}]},null,2)+'\n');
const style=addWaterbodyStyle(JSON.parse(await readFile(new URL('root.json',output),'utf8')),manifest,publicUrl);
await writeFile(new URL('root.json',output),JSON.stringify(style,null,2)+'\n');
console.log(JSON.stringify({polygons:data.features.length,names:names.features.length,tiles,bytes,notRepresented:manifest.displayAccounting.notRepresentedAtMaxZoom.length}));

// Extend the existing gallery thumbnail using the same public footprints.
const paths=data.features.filter(row=>row.properties.area_sqkm>=1).flatMap(row=>(row.geometry.type==='Polygon'?[row.geometry.coordinates]:row.geometry.coordinates)).map(polygon=>polygon.map(ring=>{
  const points=ring.map(thumbnailPoint(bounds));
  const reduced=points.filter((p,i)=>i===0||i===points.length-1||Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1])>.15);
  return 'M'+reduced.map(p=>p.map(n=>n.toFixed(1)).join(',')).join(' L')+' Z';
}).join(' '));
let thumb=await readFile(new URL('thumbnail.svg',output),'utf8');
thumb=thumb.replace(/<g id="frog-waterbody-preview"[^>]*>[\s\S]*?<\/g>/,'');
thumb=thumb.replace('<g fill="none"',`<g id="frog-waterbody-preview" fill="#294d60" stroke="#6997aa" stroke-width=".4" fill-rule="evenodd">${paths.map(path=>`<path d="${path}"/>`).join('')}</g><g fill="none"`);
await writeFile(new URL('thumbnail.svg',output),thumb);
