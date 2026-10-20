import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {createHash} from 'node:crypto';
import {addWaterbodyStyle} from '../scripts/waterbody-cartography.mjs';
import {waterwayStyle} from '../site/lib/waterway-basemap.js';
const base=new URL('../site/basemaps/frog-waterways-dark/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('waterbodies-manifest.json',base),'utf8')),style=JSON.parse(await readFile(new URL('root.json',base),'utf8'));

test('waterbody reference snapshot is reconciled and qualified independently from original flowlines',()=>{
  assert.equal(manifest.accepted,7118);assert.equal(manifest.downloaded,manifest.accepted+manifest.rejected);assert.equal(manifest.rejected,0);
  assert.equal(Object.values(manifest.featureTypes).reduce((a,b)=>a+b,0),manifest.accepted);
  assert.equal(manifest.displayAccounting.inputFeatures,manifest.accepted);
  assert.equal(manifest.displayAccounting.representedAtMaxZoom+manifest.displayAccounting.notRepresentedAtMaxZoom.length,manifest.accepted);
  assert.match(manifest.limitations,/not current shorelines/);assert.match(manifest.scope,/boundary-crossing/);
  for(const name of ['Millerton Lake','Pine Flat Lake','Shaver Lake','Huntington Lake'])assert(manifest.labelNames.includes(name));
  assert(!manifest.labelNames.includes('San Joaquin River'));assert(!manifest.labelNames.includes('Kings River'));
});

test('fills stay below roads and stream lines; names collide rather than overlap; style application is idempotent',()=>{
  const fill=style.layers.findIndex(l=>l.id==='frog-waterbody-fill'),road=style.layers.findIndex(l=>l.source==='esri'&&l['source-layer']==='Road');
  assert(fill>=0&&fill<road);assert(fill<style.layers.findIndex(l=>l.id==='frog-overview-rivers'));
  for(const l of style.layers.filter(l=>l.source==='frogWaterbodies'&&l.type==='symbol')){assert.equal(l.layout['text-allow-overlap'],false);assert.equal(l.layout['text-ignore-placement'],false);}
  assert.equal(new Set(style.layers.map(l=>l.id)).size,style.layers.length);
  const reapplied=addWaterbodyStyle(style,manifest,'https://cof-rylopez.github.io/fresno-storm-watch/basemaps/frog-waterways-dark/');assert.deepEqual(reapplied,style);
  for(const url of ['http://127.0.0.1:8782/basemaps/frog-waterways-dark/','https://cof-rylopez.github.io/fresno-storm-watch/basemaps/frog-waterways-dark/'])assert.equal(waterwayStyle(style,url).sources.frogWaterbodies.url,url+'waterbodies-tilejson.json?v=0.33.0');
});

test('all polygon tiles decode with intact IDs, labels and geometry; source accounting and aggregate checksum match',async()=>{
  let count=0,bytes=0;const represented=new Set(),names=new Map(),hashes=[];
  for(let z=0;z<=manifest.maxzoom;z++)for(const x of (await readdir(new URL(`${manifest.tileDirectory}/${z}/`,base))).sort((a,b)=>Number(a)-Number(b)))for(const file of (await readdir(new URL(`${manifest.tileDirectory}/${z}/${x}/`,base))).sort((a,b)=>parseInt(a)-parseInt(b))){
    const path=`${manifest.tileDirectory}/${z}/${x}/${file}`,data=await readFile(new URL(path,base)),tile=new VectorTile(new Pbf(data));count++;bytes+=data.length;hashes.push([path,createHash('sha256').update(data).digest('hex')]);
    for(const [id,layer]of Object.entries(tile.layers)){
      assert(['waterbodies','waterbodyNames'].includes(id));assert.equal(layer.extent,4096);
      for(let i=0;i<layer.length;i++){
        const f=layer.feature(i);assert.equal(f.type,id==='waterbodies'?3:1);assert(f.properties.source_id);assert(f.loadGeometry().length);
        if(z===manifest.maxzoom&&id==='waterbodies')represented.add(f.properties.source_id);
        if(z===manifest.maxzoom&&id==='waterbodyNames'){const keys=names.get(f.properties.name)??new Set();keys.add(f.id);names.set(f.properties.name,keys);}
      }
    }
  }
  assert.equal(count,manifest.tileCount);assert.equal(bytes,manifest.tileBytes);assert.equal(represented.size,manifest.displayAccounting.representedAtMaxZoom);assert.equal(represented.size,manifest.accepted);
  assert.equal(names.size,manifest.labelAnchors);for(const keys of names.values())assert.equal(keys.size,1);
  assert.equal(createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),manifest.tilesSha256);
});
