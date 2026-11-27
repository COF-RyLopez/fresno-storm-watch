import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherRaster} from '../site/lib/weather-raster.js';
const tick=()=>new Promise(r=>setImmediate(r));
function harness(){
 const sources=new Map(),layers=new Map(),events=new Map(),revoked=[];
 const map={getSource:id=>sources.get(id),getLayer:id=>layers.get(id),
  addSource(id,value){sources.set(id,{...value,ready:false});},removeSource:id=>sources.delete(id),
  addLayer:l=>layers.set(l.id,l),removeLayer:id=>layers.delete(id),
  setPaintProperty(id,key,value){layers.get(id).paint[key]=value;},
  isSourceLoaded:id=>sources.get(id)?.ready,
  on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},
  off(name,fn){events.get(name)?.delete(fn);}};
 let serial=0;
 const raster=createWeatherRaster(map,'rain',{before:'roads',duration:0,createUrl:()=>`blob:${++serial}`,revokeUrl:url=>revoked.push(url)});
 const image={blob:new Blob(['image']),coordinates:[[0,1],[1,1],[1,0],[0,0]]};
 const ready=()=>{const id=[...sources].find(([,s])=>!s.ready)?.[0];if(id){sources.get(id).ready=true;for(const fn of events.get('sourcedata')??[])fn({sourceId:id});}};
 return {map,sources,layers,revoked,raster,image,ready};
}
test('next image loads behind the current frame; superseded requests cannot clear or replace it',async()=>{
 const h=harness();const first=h.raster.set(h.image,{'raster-opacity':.4});h.ready();assert.equal(await first,true);
 const front=[...h.layers.values()].find(l=>l.paint['raster-opacity']===.4).id;
 const old=h.raster.set(h.image,{'raster-opacity':.4});
 assert.equal(h.layers.get(front).paint['raster-opacity'],.4);assert(h.sources.size<=2);
 const latest=h.raster.set(h.image,{'raster-opacity':.4});assert.equal(await old,false);
 h.ready();assert.equal(await latest,true);assert.equal(h.layers.get(front).paint['raster-opacity'],0);
 assert(h.sources.size<=2);h.raster.destroy();assert.equal(h.sources.size,0);assert.equal(h.revoked.length,3);
});
test('clear during loading releases both slots and never promotes the late frame',async()=>{
 const h=harness(),task=h.raster.set(h.image,{});assert.equal(await h.raster.set(null),true);h.ready();
 assert.equal(await task,false);assert.equal(h.layers.size,0);assert.equal(h.sources.size,0);h.raster.destroy();await tick();
});
