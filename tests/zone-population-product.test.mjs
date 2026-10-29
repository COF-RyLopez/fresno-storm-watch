import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {prepareGeometry,preparePopulation,calculatePreparedZone,polygonArea,selectFresnoZones} from '../scripts/lib/zone-population-calc.mjs';
import {estimatedResidents,zoneLabel,validateZoneProduct,readZoneProduct,zoneRows,boundaryFingerprint} from '../site/lib/zone-population-product.js';

const box=(left=-120,bottom=36,right=-119.98,top=36.02)=>({rings:[[[left,bottom],[left,top],[right,top],[right,bottom],[left,bottom]]],spatialReference:{wkid:4326}});
const tract=(id='06019000100',geometry=box(),population=1000,moe=100)=>({id,name:'EXERCISE tract',geometry,measures:[{estimate:population,moe}]}),block=(id,population,geometry)=>({id,population,geometry}),zone=geometry=>({key:'county-zone:1',geometry});
const blocks=()=>[block('060190001001000',100,box(-120,36,-119.99,36.02)),block('060190001001001',900,box(-119.99,36,-119.98,36.02))];

test('neighboring county context is accounted for separately; unclassified names stop the build',()=>{
  const result=selectFresnoZones([{key:'county-zone:1',name:'L39'},{key:'county-zone:2',name:'San Benito County'}]);
  assert.equal(result.included.length,1);assert.equal(result.excluded.length,1);assert.match(result.excluded[0].reason,/context/);
  assert.equal(selectFresnoZones(['P18B2','K75 south of Elwood','K73 North'].map(name=>({name}))).included.length,3);
  assert.throws(()=>selectFresnoZones([{name:'Unknown new area'}]),/scope review/);
});

test('batch ACS allocates by populated blocks, not equal tract area',()=>{
  const prepared=preparePopulation([tract()],blocks()),left=calculatePreparedZone(zone(box(-120,36,-119.99,36.02)),prepared),right=calculatePreparedZone(zone(box(-119.99,36,-119.98,36.02)),prepared);
  assert(Math.abs(left.estimate-100)<.001);assert(Math.abs(right.estimate-900)<.001);assert(Math.abs(left.estimate+right.estimate-1000)<.001);assert(Math.abs(left.samplingMoe-10)<.001);
});

test('whole tracts use published ACS even with an unpopulated old pattern; partial zero stays unknown',()=>{
  const prepared=preparePopulation([tract()],[block('060190001001000',0,box())]),whole=calculatePreparedZone(zone(box()),prepared),partial=calculatePreparedZone(zone(box(-120,36,-119.99,36.02)),prepared);
  assert.equal(whole.estimate,1000);assert.equal(whole.rows[0].method,'Whole tract');assert.equal(partial.estimate,null);assert.match(partial.rows[0].reason,/newer development is unknown/);
});

test('missing block values, ACS totals and MOEs do not become zero or fabricated confidence',()=>{
  const missing=blocks();missing[0].population=null;assert.equal(calculatePreparedZone(zone(box(-120,36,-119.99,36.02)),preparePopulation([tract()],missing)).estimate,null);
  assert.equal(calculatePreparedZone(zone(box()),preparePopulation([tract(undefined,box(),null)],blocks())).estimate,null);
  const noMoe=calculatePreparedZone(zone(box()),preparePopulation([tract(undefined,box(),1000,null)],blocks()));assert.equal(noMoe.estimate,1000);assert.equal(noMoe.samplingMoe,null);
});

test('holes and multipart geometry survive clipping and ellipsoidal area accounting',()=>{
  const outer=box(),hole=box(-119.995,36.005,-119.985,36.015).rings[0].slice().reverse(),withHole={...outer,rings:[outer.rings[0],hole]},shape=prepareGeometry(withHole,'hole');
  assert.equal(shape.shape[0].length,2);assert(shape.area<prepareGeometry(outer,'outer').area);assert.equal(calculatePreparedZone(zone(box(-119.994,36.006,-119.986,36.014)),preparePopulation([tract(undefined,withHole)],[block('060190001001000',100,withHole)])).estimate,null);
  const multi={rings:[box().rings[0],box(-119.96,36,-119.94,36.02).rings[0]],spatialReference:{wkid:4326}};assert.equal(prepareGeometry(multi,'multi').shape.length,2);
});

test('invalid CRS, geometry, duplicate IDs and overlapping tracts block production',()=>{
  assert.throws(()=>prepareGeometry({...box(),spatialReference:{wkid:3857}},'bad'),/CRS/);
  assert.throws(()=>prepareGeometry({rings:[[[0,0],[1,1],[0,1],[0,0]]],spatialReference:{wkid:4326}},'bad'),/coordinates/);
  assert.throws(()=>prepareGeometry({rings:[[[-120,36],[-119.98,36.02],[-120,36.02],[-119.98,36],[-120,36]]],spatialReference:{wkid:4326}},'crossing'),/topology/);
  const b=blocks();assert.throws(()=>preparePopulation([tract()],[b[0],b[0]]),/Duplicate/);
  assert.throws(()=>preparePopulation([tract(),tract('06019000200')],b),/overlaps/);
  assert.equal(polygonArea([]),0);
});

test('overlapping zones are independent estimates; no sum or false empty-area zero is returned',()=>{
  const p=preparePopulation([tract()],blocks());assert.equal(calculatePreparedZone(zone(box()),p).estimate,1000);assert.equal(calculatePreparedZone(zone(box()),p).estimate,1000);
  const outside=calculatePreparedZone(zone(box(-119.9,36,-119.8,36.02)),p);assert.equal(outside.estimate,null);assert.equal(outside.tracts,0);
});

const load=async()=>({meta:JSON.parse(await readFile(new URL('../site/data/zone-population/manifest.json',import.meta.url),'utf8')),data:JSON.parse(await readFile(new URL('../site/data/zone-population/zones.geojson',import.meta.url),'utf8'))});

test('prepared county product reconciles every zone, unknown reason, geometry and CSV hash',async()=>{
  const {meta,data}=await load();validateZoneProduct(meta,data);assert.equal(data.features.length,397);assert.equal(meta.counts.tracts,225);assert.equal(meta.counts.blocks,16854);assert.equal(meta.inventory.sourceZones,398);assert.equal(meta.inventory.excluded.length,1);assert.equal(meta.counts.zones+meta.inventory.excluded.length,meta.inventory.sourceZones);
  for(const [key,file]of [['geojson','zones.geojson'],['csv','zone-population.csv']]){const bytes=await readFile(new URL('../site/data/zone-population/'+file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),meta[key].sha256);assert.equal(bytes.length,meta[key].bytes);}
  const rows=JSON.parse(await readFile(new URL('../site/data/zone-population/evidence.json',import.meta.url),'utf8'));
  for(const f of data.features){const c=rows[f.properties.key];assert(c);if(f.properties.population!==null){assert(c.every(r=>r.weight!==null&&r.population!==null));assert(Math.abs(c.reduce((n,r)=>n+r.weight*r.population,0)-f.properties.population)<1e-8);}}
});

test('product rejects missing zones, contradictory estimates and mismatched periods',async()=>{
  for(const mutate of [x=>x.data.features.pop(),x=>x.meta.period='2021–2025',x=>x.data.features[0].properties.population=-1,x=>x.data.features[0].properties.samplingMoe=-1,x=>x.data.features.find(f=>f.properties.population!==null).properties.population=null,x=>x.data.features.push(x.data.features[0])]){const p=await load();mutate(p);assert.throws(()=>validateZoneProduct(p.meta,p.data));}
});

test('unknown labels are distinct from zero; small estimates never round to a confirmed zero',()=>{
  assert.equal(estimatedResidents(null),'Unavailable');assert.equal(estimatedResidents(2),'<10');assert.equal(estimatedResidents(1580.16),'≈ 1,580');assert.equal(estimatedResidents(0),'≈ 0');assert.match(zoneLabel({name:'L39',population:null}),/Estimate unavailable/);
});

test('search is literal, case insensitive and does not change the underlying estimate inventory',async()=>{
  const {data}=await load(),before=data.features.length;assert.equal(zoneRows(data.features,' l39 ')[0].properties.name,'L39');assert(zoneRows(data.features,'',true).every(f=>f.properties.population===null));assert.equal(zoneRows(data.features,'<script>').length,0);assert.equal(data.features.length,before);
});

test('mixed or incomplete file delivery is rejected before displaying figures',async()=>{
  const {meta,data}=await load(),text=JSON.stringify(data),buffer=new TextEncoder().encode(text),goodMeta={...meta,geojson:{...meta.geojson,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')}};
  const fetcher=async url=>String(url).endsWith('manifest.json')?new Response(JSON.stringify(goodMeta)):new Response(buffer);
  assert.equal((await readZoneProduct({fetcher})).data.features.length,397);
  await assert.rejects(readZoneProduct({fetcher:async url=>String(url).endsWith('manifest.json')?new Response(JSON.stringify(goodMeta)):new Response('{}')}),/incomplete/);
});

test('boundary fingerprint ignores row ordering and status but catches changed geometry/name',async()=>{
  const a={key:'county-zone:1',name:'EXERCISE A',geometry:box(),status:'Lifted'},b={key:'county-zone:2',name:'EXERCISE B',geometry:box(),status:'Order'},before=await boundaryFingerprint([a,b]);assert.equal(await boundaryFingerprint([b,{...a,status:'Order'}]),before);assert.notEqual(await boundaryFingerprint([a,{...b,name:'Corrected'}]),before);
});

test('standalone public product has no private stores, sign-in dependency or hidden persistence',async()=>{
  const js=await readFile(new URL('../site/zone-population.js',import.meta.url),'utf8');assert(!/localStorage|sessionStorage|createPrivateStore|setupAuth|applyEdits|eoc-config/.test(js));assert(js.includes('popupEnabled:false'));assert(js.includes('deconflictionStrategy'));assert(js.includes('history.pushState'));
});
