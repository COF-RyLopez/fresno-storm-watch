import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {publishWeatherReplay,verifyPublishedWeatherReplay} from '../scripts/publish-weather-replay.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGfoAAAAASUVORK5CYII=','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){
  const root=await mkdtemp(resolve(tmpdir(),'frog-weather-publish-'));
  t.after(async()=>{if(!root.startsWith(resolve(tmpdir())+sep+'frog-weather-publish-'))throw Error('Unsafe cleanup');await rm(root,{recursive:true,force:true});});
  const source=resolve(root,'input'),dest=resolve(root,'output');await mkdir(resolve(source,'images'),{recursive:true});await mkdir(resolve(source,'responses'));
  const image={file:`images/${hash(png)}.png`,sha256:hash(png),bytes:png.length,width:1,height:1};
  const clock=Date.parse('2026-11-24T22:00:00Z');
  const manifest={schemaVersion:1,kind:'recorded-wpc-display-replay',clock,capturedAt:new Date(clock).toISOString(),publisher:'NOAA WPC',source:'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_qpf/MapServer',rasterCrs:'EPSG:3857',coordinateCrs:'EPSG:4326',bounds:[-131,28,-107.5,47],frames:[{id:'qpf-9',window:null,cycle:{issue:clock,start:clock,end:clock+72*3600000,hours:72,units:'in',product:'72-hour QPF'},coordinates:[[-131,47],[-107.5,47],[-107.5,28],[-131,28]],legend:[{value:.25,color:'rgb(1,2,3)'}],image}]};
  const raw=Buffer.from('{"features":[]}'),route={file:`responses/${hash(raw)}.bin`,sha256:hash(raw),bytes:raw.length,type:'application/json'};
  const routes={[manifest.source+'/9/query?f=json']:route};
  const context={watersheds:{type:'FeatureCollection',features:['MIL','PNF'].map(reservoir=>({type:'Feature',properties:{reservoir},geometry:{type:'Polygon',coordinates:[]}}))},features:[],contextNote:'Synthetic public fixture'};
  for(const [file,value]of [['manifest.json',manifest],['routes.json',routes],['context.json',context]])await writeFile(resolve(source,file),JSON.stringify(value));
  await writeFile(resolve(source,image.file),png);await writeFile(resolve(source,route.file),raw);await writeFile(resolve(source,'.env'),'LOCAL_TEST_ONLY');
  return {source,dest,routes,route,manifest};
}
test('publication copies only verified public assets and supplies a Pages-compatible zero-delay profile',async t=>{
  const f=await fixture(t),result=await publishWeatherReplay(f.source,f.dest);
  assert.equal(result.frames,1);assert.equal(result.files,7);
  assert.equal((await verifyPublishedWeatherReplay(f.dest)).frames,1);
  await assert.rejects(access(resolve(f.dest,'.env')));
  assert.equal(JSON.parse(await readFile(resolve(f.dest,result.recording,'profile.json'),'utf8')).latencyMs,0);
});
test('publication rejects response substitution and token-bearing source URLs before exposing a manifest',async t=>{
  const f=await fixture(t);await writeFile(resolve(f.source,f.route.file),'changed');
  await assert.rejects(publishWeatherReplay(f.source,f.dest),/integrity/);
  await assert.rejects(access(resolve(f.dest,'manifest.json')));
  f.routes[f.manifest.source+'/9/query?token=NOT_A_SECRET']=f.route;
  await writeFile(resolve(f.source,'routes.json'),JSON.stringify(f.routes));
  // Place the token-bearing key first to exercise access classification independently.
  const entries=Object.entries(f.routes).reverse();await writeFile(resolve(f.source,'routes.json'),JSON.stringify(Object.fromEntries(entries)));
  await assert.rejects(publishWeatherReplay(f.source,f.dest),/Nonpublic/);
});

test('a failed refresh preserves the complete previously published recording',async t=>{
  const f=await fixture(t);await publishWeatherReplay(f.source,f.dest);
  const before=await readFile(resolve(f.dest,'index.json'),'utf8');
  await writeFile(resolve(f.source,f.route.file),'corrupted response');
  await assert.rejects(publishWeatherReplay(f.source,f.dest),/integrity/);
  assert.equal(await readFile(resolve(f.dest,'index.json'),'utf8'),before);
  assert.equal((await verifyPublishedWeatherReplay(f.dest)).frames,1);
});

test('the bundled public fallback contains valid images, times and twelve independent reference points',async()=>{
  const result=await verifyPublishedWeatherReplay(new URL('../site/data/weather-delivery-experiment/',import.meta.url));
  assert.equal(result.frames,3);assert.equal(result.referencePoints,12);
});
