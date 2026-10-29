import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizePopulationFeature,summarizePopulation,approximatePopulation,populationZoneRows,POPULATION_LIMIT} from '../site/lib/population-model.js';
import {readPopulationBlocks,calculateZonePopulation} from '../site/lib/population-data.js';
const geometry={rings:[[[-120,36],[-120,37],[-119,37],[-119,36],[-120,36]]],spatialReference:{wkid:4326}};
const feature=(population=20,oid=1)=>({attributes:{OBJECTID:oid,GEOID:'060190001001'+String(oid).padStart(3,'0'),P0010001:population},geometry});
const metadata={objectIdField:'OBJECTID',geometryType:'esriGeometryPolygon',fields:['GEOID','P0010001','COUNTY'].map(name=>({name}))};

test('population preserves explicit zero, missing values and county geography',()=>{
  assert.equal(normalizePopulationFeature(feature(0)).population,0);
  for(const v of [null,undefined,-999,'20',NaN])assert.equal(normalizePopulationFeature({...feature(),attributes:{...feature().attributes,P0010001:v}}).population,null);
  assert.throws(()=>normalizePopulationFeature({...feature(),attributes:{...feature().attributes,GEOID:'060390001001001'}}),/Fresno/);
  assert.throws(()=>normalizePopulationFeature({...feature(),geometry:{x:-120,y:36}}),/polygon/i);
});
test('whole and boundary blocks produce a qualified estimate without double counting',()=>{
  const full={id:'a',population:100,fraction:1},partial={id:'b',population:80,fraction:.25};
  const r=summarizePopulation([full,partial,full,{id:'touch',population:50,fraction:0}]);
  assert.equal(r.estimate,120);assert.equal(r.wholePopulation,100);assert.equal(r.boundaryPopulation,80);assert.equal(r.blocks,2);
  assert.equal(r.wholeBlocks,1);assert.equal(r.boundaryBlocks,1);
  assert.throws(()=>summarizePopulation([full,{...full,population:10}]),/Conflicting/);
});
test('missing population and empty overlaps are unknown, never zero',()=>{
  assert.equal(summarizePopulation([]).estimate,null);
  const r=summarizePopulation([{id:'a',population:null,fraction:.5},{id:'b',population:10,fraction:1}]);
  assert.equal(r.estimate,null);assert.equal(r.missing,1);assert.equal(r.knownWeightedSubtotal,10);
  assert.equal(summarizePopulation([{id:'z',population:0,fraction:1}]).estimate,0);
});
test('population fractions reject invalid values and retain rounding as display only',()=>{
  for(const fraction of [NaN,-.1,1.01])assert.throws(()=>summarizePopulation([{id:'a',population:10,fraction}]));
  assert.equal(approximatePopulation(null),'Unavailable');assert.equal(approximatePopulation(.1),'Less than 1');assert.equal(approximatePopulation(1243),'≈ 1,240');
  assert.equal(approximatePopulation(20565),'≈ 20,600');assert.equal(approximatePopulation(0),'≈ 0');
});
test('zone display filter does not promote lifted records to active orders',()=>{
  const rows=[{oid:1,name:'L2',status:'Lifted'},{oid:2,name:'L11',status:'Warn'},{oid:3,name:'L3',status:'Order'}];
  assert.deepEqual(populationZoneRows(rows,{status:'active'}).map(r=>r.name),['L3','L11']);
  assert.deepEqual(populationZoneRows(rows,{query:'l2'}).map(r=>r.name),['L2']);assert.equal(rows.length,3);
});
function fakeSource({ids=[1],features=[feature()],changeIds=false,batchChange={},badSR=false}={}){
  let inventories=0;const requests=[];
  return {requests,fetcher:async(url,options)=>{requests.push({url,options});let data;if(!options.body)data=metadata;else if(options.body.has('returnIdsOnly'))data={objectIds:changeIds&&++inventories>1?[2]:ids};else data={features,...batchChange,spatialReference:{wkid:badSR?3857:4326}};return {ok:true,json:async()=>data};}};
}
test('public block collector reconciles all records with no credentials and POST queries',async()=>{
  const s=fakeSource(),r=await readPopulationBlocks(geometry,{fetcher:s.fetcher});assert.equal(r.rows[0].population,20);assert.equal(r.accounting.queried,1);
  assert(s.requests.every(r=>r.options.credentials==='omit'));assert(s.requests.filter(r=>r.options.body).every(r=>r.options.method==='POST'));
  assert.equal(s.requests[1].options.body.get('where'),"COUNTY = '019'");
});
test('block collector rejects truncated, changed, duplicate and wrong-CRS inventories',async()=>{
  for(const options of [{ids:[1,1]},{features:[]},{changeIds:true},{badSR:true},{batchChange:{exceededTransferLimit:true}}]){
    const s=fakeSource(options);await assert.rejects(readPopulationBlocks(geometry,{fetcher:s.fetcher}));
  }
});
test('block collector retains valid empty result without fabricating population',async()=>{
  const s=fakeSource({ids:null}),r=await readPopulationBlocks(geometry,{fetcher:s.fetcher});assert.equal(r.rows.length,0);
});
test('block collector stops on HTTP or schema failures',async()=>{
  await assert.rejects(readPopulationBlocks(geometry,{fetcher:async()=>({ok:false,status:503})}),/503/);
  await assert.rejects(readPopulationBlocks(geometry,{fetcher:async()=>({ok:true,json:async()=>({})})}),/schema/);
});
test('geometry calculation measures fractional areas, discards touches and cancels superseded work',async()=>{
  const Polygon=class{constructor(g){Object.assign(this,g);}};
  const rows=[{id:'a',population:100,geometry:{area:100}},{id:'b',population:50,geometry:{area:100}},{id:'touch',population:200,geometry:{area:10}}];
  const operators={Polygon,intersection:{execute:g=>g.area===10?null:{rings:[[]],area:g===null?0:g.area/2}},area:{execute:g=>g.area}};
  const r=await calculateZonePopulation({geometry:{}},{rows,checked:1,accounting:{}},operators);assert.equal(r.estimate,75);assert.equal(r.blocks,2);
  await assert.rejects(calculateZonePopulation({geometry:{}},{rows,checked:1},{...operators,current:()=>false}),{name:'AbortError'});
  await assert.rejects(calculateZonePopulation({geometry:{}},{rows:[{...rows[0],geometry:{area:0}}]},operators),/usable area/);
});
test('population addition keeps an anonymous read-only surface and source distinctions',async()=>{
  const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8'),ui=await readFile(new URL('../site/lib/population-ui.js',import.meta.url),'utf8');
  for(const id of ['population-watch','population-evidence','population-density-key','population-share'])assert(html.includes(`id="${id}"`));
  assert(!/localStorage|sessionStorage|applyEdits|addFeatures|updateFeatures|clientSecret|accessToken/.test(ui));
  assert(html.includes('2020 block-based zone estimates and newer ACS tract estimates are separate datasets'));
  assert(ui.includes('generation!==epoch'));assert(POPULATION_LIMIT.includes('not people currently present'));
});
