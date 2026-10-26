import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gunzipSync,gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildingPowerTarget,buildingHeight,validateBuildingIndex,planBuildingTiles,selectPowerBuildings} from '../site/lib/power-buildings-model.js';
import {loadPowerBuildings} from '../site/lib/power-buildings-data.js';
import {createPowerBuildingsMap} from '../site/lib/power-buildings-map.js';
const box=(x=0,y=0,w=1)=>({rings:[[[x,y],[x,y+w],[x+w,y+w],[x+w,y],[x,y]]],spatialReference:{wkid:4326}});
const building=(id,g=box(.2,.2,.1),height=8,addresses=['100 Example Rd'])=>({id,version:1,geometry:g,height,addresses,sources:['EXERCISE']});
const index=()=>({schemaVersion:1,release:'2026-10-21.0',compression:'gzip',crs:'EPSG:4326',heightUnit:'metres',tiles:[{key:'-2_1',bbox:[0,0,1,1],count:1,bytes:10,decodedBytes:100,sha256:'a'.repeat(64)}]});

test('only current published polygons define a potential building overlap; points and circuit identity do not',()=>{
  assert.equal(buildingPowerTarget({status:'warning',geometries:[box()]}).polygons.length,1);
  for(const status of ['restored','cancelled','unknown'])assert.equal(buildingPowerTarget({status,geometries:[box()]}).polygons.length,0);
  assert.equal(buildingPowerTarget({status:'outage',geometries:[{x:0,y:0,spatialReference:{wkid:4326}}],networkCircuit:{value:'123'}}).polygons.length,0);
});
test('height is positive published metres; missing, zero, strings and impossible values remain unknown',()=>{
  for(const v of [null,0,-1,true,'12',NaN,Infinity,851])assert.equal(buildingHeight(v),null);
  assert.equal(buildingHeight(12.5),12.5);
});
test('full polygon boundaries and holes determine overlap, rather than building centres or bounding boxes',()=>{
  const area=box();area.rings.push(box(.3,.3,.4).rings[0]);
  const rows=[building('edge',box(-.05,.1,.1)),building('hole',box(.4,.4,.1)),building('outside',box(2,2,.1))];
  assert.deepEqual(selectPowerBuildings(rows,[area]).map(r=>r.id),['edge']);
  assert.equal(selectPowerBuildings([building('a')],[box()],box(.8,.8,.1)).length,0);
});
test('duplicate identities and ambiguous CRS fail closed; multiple address associations are retained without picking one',()=>{
  assert.throws(()=>selectPowerBuildings([building('x'),building('x')],[box()]),/duplicated/);
  assert.throws(()=>selectPowerBuildings([building('x',{...box(),spatialReference:{wkid:3857}})],[box()]),/WGS84/);
  const row=selectPowerBuildings([building('x',box(.1,.1,.1),null,['100 A St','102 A St','100 A St'])],[box()])[0];
  assert.deepEqual(row.addresses,['100 A St','102 A St']);assert.equal(row.label,'2 associated addresses');assert.equal(row.height,null);
  assert.equal(selectPowerBuildings([building('x',box(.1,.1,.1),8,[])],[box()])[0].label,'Address not matched');
});
test('chunk bounds preserve footprints crossing cells; oversized queries and unsafe paths cannot silently truncate',()=>{
  assert.equal(planBuildingTiles(validateBuildingIndex(index()),[box(.99,0,.1)]).length,1);
  const big=index();big.tiles[0].decodedBytes=30_000_000;assert.throws(()=>planBuildingTiles(big,[box()]),/too large/);
  for(const change of [d=>d.tiles[0].key='../secret',d=>d.crs='EPSG:3857',d=>d.tiles.push({...d.tiles[0]}),d=>d.tiles[0].sha256='x']){const d=index();change(d);assert.throws(()=>validateBuildingIndex(d));}
});
test('all compressed chunks reconcile with the exact pinned county index and preserve height/address unknowns',async()=>{
  const root=new URL('../site/data/power-buildings/',import.meta.url),d=validateBuildingIndex(JSON.parse(await readFile(new URL('index.json',root))));
  let count=0,heights=0,addresses=0;const ids=new Set();
  for(const tile of d.tiles){const data=await readFile(new URL(`${d.release}/${tile.key}.json.gz`,root));assert.equal(data.length,tile.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),tile.sha256);const text=gunzipSync(data);assert.equal(text.length,tile.decodedBytes);const chunk=JSON.parse(text);assert.equal(chunk.rows.length,tile.count);assert.equal(chunk.release,d.release);for(const r of chunk.rows){assert(!ids.has(r.id));ids.add(r.id);count++;heights+=buildingHeight(r.height)!==null;addresses+=r.addresses.length>0;}}
  assert.equal(count,d.buildings);assert.equal(heights,d.withHeight);assert.equal(addresses,d.withAddress);assert.equal((await readdir(new URL(d.release+'/',root))).length,d.tiles.length);
});
test('partial, changed or cancelled downloads never yield an apparently complete result',async()=>{
  const d=index(),chunk=gzipSync(JSON.stringify({schemaVersion:1,release:d.release,rows:[building('a')]}));d.tiles[0].bytes=chunk.length;d.tiles[0].decodedBytes=gunzipSync(chunk).length;d.tiles[0].sha256=createHash('sha256').update(chunk).digest('hex');
  let cancelled=false;const fetcher=async url=>String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response(chunk);
  const value=await loadPowerBuildings([box()],{fetcher});assert.equal(value.rows.length,1);
  assert.equal(await loadPowerBuildings([box()],{fetcher:async url=>{const r=await fetcher(url);cancelled=true;return r;},current:()=>!cancelled}),null);
  await assert.rejects(loadPowerBuildings([box()],{fetcher:async url=>String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response('Failed',{status:503})}),/503/);
  await assert.rejects(loadPowerBuildings([box()],{fetcher:async url=>String(url).endsWith('index.json')?new Response(JSON.stringify(d)):new Response(new Uint8Array(chunk.length))}),/differs/);
});
test('3D uses the same positive height field; unknown footprints stay flat and closing releases registered layers',async()=>{
  class Layer{constructor(p){Object.assign(this,p);}load(){return Promise.resolve(this);}destroy(){this.destroyed=true;}}
  class Graphic{constructor(p){Object.assign(this,p);}}
  const registered=[],removed=[],view={type:'2d'};
  const c=createPowerBuildingsMap({FeatureLayer:Layer,Graphic,registerLayer:(k,l)=>registered.push(l),removeLayer:l=>removed.push(l),getView:()=>view,focusGeometry:()=>{}});
  await c.set([building('a'),building('b',box(.3,.3,.1),null,[])]);view.type='3d';c.sync();
  assert.equal(registered[0].renderer.visualVariables[0].field,'height_m');assert.equal(registered[0].renderer.visualVariables[0].valueUnit,'meters');assert.equal(registered[1].renderer.symbol.type,'simple-fill');assert.equal(registered[1].source[0].attributes.height_m,null);assert.equal(registered[1].source[0].attributes.address_label,'');
  c.clear();assert.equal(removed.length,2);assert(removed.every(l=>l.destroyed));
});
