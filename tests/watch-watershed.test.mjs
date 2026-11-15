import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadWatershed,loadWatershedRain,upstreamReservoir} from '../site/lib/watch-watershed-data.js';

const data=JSON.parse(await readFile(new URL('../site/data/reservoir-watersheds.geojson',import.meta.url),'utf8'));
const now=Date.parse('2026-11-14T23:30:00Z');
const attributes={product:'72-hour QPF',issue_time:'2026-11-14 22:19:52',start_time:'2026-11-15 00:00:00',end_time:'2026-11-18 00:00:00',units:'Inches'};

test('both tile manifests cover the pinned basins and account for the added upstream features',async()=>{
 const source=await readFile(new URL('../site/data/reservoir-watersheds.geojson',import.meta.url));
 for(const file of ['manifest.json','waterbodies-manifest.json']){
  const manifest=JSON.parse(await readFile(new URL(`../site/basemaps/frog-waterways-dark/${file}`,import.meta.url),'utf8'));
  assert.equal(manifest.watershedsSha256,createHash('sha256').update(source).digest('hex'));
  assert.equal(manifest.accepted,manifest.countyInventoryCount+manifest.addedUpstreamCount);
  assert(manifest.addedUpstreamCount>0);
  for(const feature of data.features){
   const [west,south,east,north]=feature.properties.bounds;
   const [xmin,ymin,xmax,ymax]=manifest.bounds;
   assert(xmin<=west&&ymin<=south&&xmax>=east&&ymax>=north);
  }
 }
});

test('watershed links attach to their own river concerns and use the published full bounds',async()=>{
 assert.equal(upstreamReservoir('river:san-joaquin-lower'),'MIL');
 assert.equal(upstreamReservoir('river:kings-upper'),'PNF');
 for(const key of ['river:little-dry','river:mill-creek','road:kings-lower',null])assert.equal(upstreamReservoir(key),undefined);
 for(const [id,station] of [['MIL','11250100'],['PNF','11221000']]){
  const basin=await loadWatershed(id,{fetchImpl:async()=>Response.json(data)});
  assert.equal(basin.feature.properties.station,station);
  assert.deepEqual(basin.bounds,basin.feature.properties.bounds);
  assert(Math.abs(basin.feature.properties.areaSqMi-basin.feature.properties.publishedAreaSqMi)<2);
 }
});

function forecastFetch({rollover=false,dry=false,brokenImage=false}={}){
 let cycleChecks=0;
 return async(input,options)=>{
  assert.equal(options.credentials,'omit');
  const u=new URL(input);
  if(u.pathname.endsWith('/export')){
   assert.equal(u.searchParams.get('layers'),'show:9');
   assert.match(JSON.parse(u.searchParams.get('layerDefs'))[9],/2026-11-14 22:19:52.*Inches.*qpf >= 0.01/);
   return brokenImage?Response.json({error:{}}):new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});
  }
  if(u.pathname.endsWith('/9'))return Response.json({drawingInfo:{renderer:{uniqueValueInfos:[{value:'0.25',symbol:{color:[8,139,0,255]}}]}}});
  if(u.searchParams.has('geometry'))return Response.json({features:dry?[]:[{attributes:{qpf:0.25}}]});
  const issue=rollover&&cycleChecks++?'2026-11-14 23:00:00':attributes.issue_time;
  return Response.json({features:[{attributes:{...attributes,issue_time:issue}}]});
 };
}

test('WPC map uses one forecast cycle and the publisher legend within the requested extent',async()=>{
 const bounds=data.features[0].properties.bounds;
 const rain=await loadWatershedRain(bounds,{clock:()=>now,fetchImpl:forecastFetch()});
 assert.deepEqual(rain.legend,[{value:0.25,color:'rgb(8,139,0)'}]);
 assert.equal(rain.blob.type,'image/png');
 const [[west,north],,[east,south]]=rain.coordinates;
 assert(west<=bounds[0]+1e-10&&south<=bounds[1]+1e-10&&east>=bounds[2]-1e-10&&north>=bounds[3]-1e-10);
 assert.equal((await loadWatershedRain(bounds,{clock:()=>now,fetchImpl:forecastFetch({dry:true})})).blob,null);
 for(const options of [{rollover:true},{brokenImage:true}])await assert.rejects(loadWatershedRain(bounds,{clock:()=>now,fetchImpl:forecastFetch(options)}));
 await assert.rejects(loadWatershedRain(bounds,{clock:()=>now+48*3600_000,fetchImpl:forecastFetch()}),/stale or expired/);
});
