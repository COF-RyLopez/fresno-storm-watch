import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {pilotStyle,WATERWAY_PILOT,createWaterwayBasemap} from '../site/lib/waterway-basemap.js';

const base=new URL('../site/basemaps/frog-waterways-dark/',import.meta.url);
const style=JSON.parse(await readFile(new URL('root.json',base),'utf8'));
const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
const tilejson=JSON.parse(await readFile(new URL('tilejson.json',base),'utf8'));

test('pilot style resolves its own TileJSON for localhost and project Pages, retaining official Esri background',()=>{
  for(const url of ['http://127.0.0.1:8778/basemaps/frog-waterways-dark/','https://cof-rylopez.github.io/fresno-storm-watch/basemaps/frog-waterways-dark/']){
    const result=pilotStyle(style,url);assert.equal(result.sources.frog.url,url+'tilejson.json');
    assert.equal(result.sources.esri.url,'https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer');
    assert.equal(result.glyphs,style.glyphs);assert.equal(result.sprite,style.sprite);
  }
  assert.notEqual(style.sources.frog.url,'http://127.0.0.1:8778/basemaps/frog-waterways-dark/tilejson.json');
});

test('shared style replaces repeated river/canal labels and retains background roads and places',()=>{
  assert.equal(new Set(style.layers.map(l=>l.id)).size,style.layers.length);
  assert(!style.layers.some(l=>l.id==='Water line/label/Default'));
  assert(style.layers.some(l=>l.id==='frog-waterway-names'&&l.layout['text-allow-overlap']===false));
  assert(style.layers.some(l=>l.id.includes('Road')&&l.type==='line'));
  assert(style.layers.some(l=>l.id.includes('City')&&l.type==='symbol'));
  assert(style.layers.some(l=>l.id==='frog-canals-ditches'&&l.paint['line-dasharray']));
});

test('snapshot explicitly accounts for outside-only and rejected geometry without claiming complete county coverage',()=>{
  assert.equal(manifest.downloaded,manifest.outsideCounty+manifest.accepted+manifest.rejected);
  assert.equal(manifest.accepted,Object.values(manifest.featureTypes).reduce((a,b)=>a+b,0));
  assert.equal(manifest.rejected,0);assert.equal(manifest.areas.length,2);
  assert.match(manifest.limitations,/not live flow or a complete ditch inventory/);
  assert.match(WATERWAY_PILOT.note,/pilot.*only.*unverified/);
  assert.equal(tilejson.tileSize,512);assert.equal(tilejson.scheme,'xyz');
  assert.equal(tilejson.tiles[0],'https://cof-rylopez.github.io/fresno-storm-watch/basemaps/frog-waterways-dark/tiles/{z}/{x}/{y}.pbf');
  assert.deepEqual(tilejson.vector_layers.map(l=>l.geometry_type),['line','point']);
});

test('gallery entry is constructed with a valid style immediately; unavailable style rejects before constructing a broken layer',async()=>{
  let created=0;
  class Layer{constructor(props){created++;assert.equal(props.style.version,8);this.props=props;}load(){return Promise.resolve(this);}}
  class Basemap{constructor(props){Object.assign(this,props);}}
  const fetchImpl=async(url,options)=>{assert.match(url.href,/root.json$/);assert.equal(options.credentials,'omit');return {ok:true,json:async()=>style};};
  const result=await createWaterwayBasemap({Basemap,VectorTileLayer:Layer,fetchImpl});
  assert.equal(result.basemap.baseLayers[0],result.layer);assert.equal(await result.load(),result.layer);
  await assert.rejects(createWaterwayBasemap({Basemap,VectorTileLayer:Layer,fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
  assert.equal(created,1);
});

test('every committed tile decodes, expected source attributes survive, and names use one stable anchor each',async()=>{
  let count=0,bytes=0;const names=new Map(),kinds=new Set();
  for(let z=0;z<=tilejson.maxzoom;z++)for(const x of await readdir(new URL(`tiles/${z}/`,base)))for(const file of await readdir(new URL(`tiles/${z}/${x}/`,base))){
    const data=await readFile(new URL(`tiles/${z}/${x}/${file}`,base));count++;bytes+=data.length;
    const tile=new VectorTile(new Pbf(data));
    for(const [id,layer]of Object.entries(tile.layers)){
      assert(['names','flowlines'].includes(id));assert.equal(layer.extent,4096);
      for(let i=0;i<layer.length;i++){
        const f=layer.feature(i);assert.equal(f.type,id==='names'?1:2);
        assert.equal(typeof f.properties.source_id,'string');assert(f.properties.source_id.length>0);
        kinds.add(f.properties.kind);
        if(id==='names'&&z===tilejson.maxzoom){const name=f.properties.name.toLowerCase();const ids=names.get(name)??new Set();ids.add(f.id);names.set(name,ids);}
      }
    }
  }
  assert.equal(count,manifest.tileCount);assert.equal(bytes,manifest.tileBytes);
  assert.equal(names.size,manifest.cartography.labelAnchors);
  for(const [name,ids]of names)assert.equal(ids.size,1,`Repeated anchor for ${name}`);
  for(const name of ['san joaquin river','kings river','friant-kern canal','madera canal'])assert(names.has(name),name);
  assert.deepEqual([...kinds].sort(),[1,2,3,4,5,7]);
});
