import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {summarizeZoneAcs,ZONE_ACS_LIMIT,ZONE_ACS_ERROR,formatAllocationWeight} from '../site/lib/zone-acs-model.js';
import {calculateAcsZonePopulation,readCensusAnalysisTracts,readZoneAcsTracts} from '../site/lib/zone-acs-data.js';

const id='06019000100',id2='06019000200';
const shape=(x1,y1,x2,y2)=>({rings:[[[x1,y1],[x1,y2],[x2,y2],[x2,y1],[x1,y1]]],spatialReference:{wkid:4326}});
const bounds=g=>{const r=g.rings[0];return [r[0][0],r[0][1],r[2][0],r[2][1]];};
// Rectangles isolate accounting and weighting logic; real SDK geometry is exercised in the browser.
const operators={Polygon:class{constructor(g){Object.assign(this,g);}},area:{execute:g=>{const [x1,y1,x2,y2]=bounds(g);return (x2-x1)*(y2-y1);}},intersection:{execute:(a,b)=>{const [a1,a2,a3,a4]=bounds(a),[b1,b2,b3,b4]=bounds(b),x1=Math.max(a1,b1),y1=Math.max(a2,b2),x2=Math.min(a3,b3),y2=Math.min(a4,b4);return x2>x1&&y2>y1?shape(x1,y1,x2,y2):null;}}};
const metadata={period:'2020–2024',modified:1,edited:2};
const tract=(tractId=id,g=shape(0,0,10,10),population=1000,moe=100)=>({id:tractId,name:tractId,geometry:g,measures:[{estimate:population,moe}]});
const blocks=[{id:'a',population:90,geometry:shape(0,0,5,10)},{id:'b',population:10,geometry:shape(5,0,10,10)}];
function options({tracts=[tract()],records=blocks,after=metadata}={}){
  let reads=0;return {options:{...operators,readTracts:async()=>({rows:tracts,metadata,checked:1}),readBlocks:async()=>{reads++;return {rows:records,checked:Date.now()};},verifyMetadata:async()=>after,yieldFrame:async()=>{}},reads:()=>reads};
}

test('weighted ACS total and sampling-only component retain distinct uncertainties',()=>{
  const r=summarizeZoneAcs([{id,weight:.25,population:1000,moe:100},{id:id2,weight:.5,population:2000,moe:200}]);
  assert.equal(r.estimate,1250);assert.equal(r.samplingMoe,Math.hypot(25,100));
  assert(ZONE_ACS_ERROR.includes('not a complete 90% confidence interval'));assert(ZONE_ACS_LIMIT.includes('not a 2026 headcount'));
});
test('missing allocation or source population prevents a complete zone estimate',()=>{
  for(const row of [{weight:null,population:100},{weight:.2,population:null}]){
    const r=summarizeZoneAcs([{id,moe:10,...row}]);assert.equal(r.estimate,null);assert.equal(r.samplingMoe,null);assert.equal(r.missing,1);
  }
  assert.equal(summarizeZoneAcs([]).estimate,null);
  assert.equal(summarizeZoneAcs([{id,weight:1,population:0,moe:12}]).estimate,0);
});
test('missing source MOE is not zero sampling error; invalid and duplicate contributions fail',()=>{
  const row={id,weight:.5,population:20,moe:null};assert.equal(summarizeZoneAcs([row]).samplingMoe,null);
  for(const change of [{id:'06039000100'},{weight:1.1},{population:NaN},{moe:-1}])assert.throws(()=>summarizeZoneAcs([{...row,...change}]));
  assert.throws(()=>summarizeZoneAcs([row,row]),/duplicate/);
});
test('rounded weights cannot turn tiny contributions into zero or partial shares into full coverage',()=>{
  assert.equal(formatAllocationWeight(.00001),'<0.1%');assert.equal(formatAllocationWeight(.99999),'>99.9%');
  assert.equal(formatAllocationWeight(0),'0%');assert.equal(formatAllocationWeight(1),'100%');assert.equal(formatAllocationWeight(null),'Unavailable');
});
test('partial tract uses populated-block pattern instead of uniform tract area',async()=>{
  const s=options(),r=await calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options);
  assert.equal(r.rows[0].areaFraction,.5);assert.equal(r.rows[0].weight,.9);assert.equal(r.estimate,900);assert.equal(r.samplingMoe,90);assert.equal(r.rows[0].baselineTotal,100);
});
test('blocks clipped by a tract are not counted wholly in its denominator',async()=>{
  const s=options({tracts:[tract(id,shape(0,0,5,10))]}),r=await calculateAcsZonePopulation({geometry:shape(0,0,2.5,10)},s.options);
  assert.equal(r.rows[0].baselineTotal,90);assert.equal(r.rows[0].baselineWithin,45);assert.equal(r.estimate,500);
});
test('whole tracts use exact published totals without requesting baseline blocks',async()=>{
  const s=options(),r=await calculateAcsZonePopulation({geometry:shape(-1,-1,11,11)},s.options);
  assert.equal(r.estimate,1000);assert.equal(r.rows[0].method,'Whole tract');assert.equal(s.reads(),0);
});
test('complementary zone allocations conserve a tract total before display rounding',async()=>{
  const s=options(),a=await calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options),b=await calculateAcsZonePopulation({geometry:shape(5,0,10,10)},s.options);
  assert.equal(a.estimate+b.estimate,1000);
});
test('touch-only tracts are excluded and overlapping ACS outlines cannot inflate counts',async()=>{
  let s=options({tracts:[tract(),tract(id2,shape(10,0,20,10))]}),r=await calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options);
  assert.equal(r.tracts,1);assert.equal(r.accounting.returnedTracts,2);
  s=options({tracts:[tract(),tract(id2)]});await assert.rejects(calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options),/overlap/);
});
test('missing or empty 2020 patterns in partial tracts remain unknown, including potential new growth',async()=>{
  for(const records of [[],blocks.map(r=>({...r,population:0})),[{...blocks[0],population:null},blocks[1]]]){
    const s=options({records}),r=await calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options);
    assert.equal(r.estimate,null);assert.equal(r.missing,1);assert(r.rows[0].reason);
  }
  const s=options(),r=await calculateAcsZonePopulation({geometry:shape(10.1,0,11,10)},s.options);assert.equal(r.estimate,null);assert.equal(r.tracts,0);
});
test('unpopulated subset is not silently assigned zero current population',async()=>{
  const s=options({records:[{...blocks[0],population:0},blocks[1]]}),r=await calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options);
  assert.equal(r.estimate,null);assert(r.rows[0].reason.includes('later development'));
});
test('source changes, failures, cancellation and invalid areas do not return a newer total',async()=>{
  for(const after of [{...metadata,period:'2021–2025'},{...metadata,modified:3}]){
    const s=options({after});await assert.rejects(calculateAcsZonePopulation({geometry:shape(0,0,5,10)},s.options),/changed/);
  }
  const s=options();await assert.rejects(calculateAcsZonePopulation({geometry:shape(0,0,5,10)},{...s.options,current:()=>false}),{name:'AbortError'});
  await assert.rejects(calculateAcsZonePopulation({geometry:shape(0,0,5,10)},{...s.options,readBlocks:async()=>{throw Error('503');}}),/503/);
  await assert.rejects(calculateAcsZonePopulation({geometry:shape(0,0,5,10)},{...s.options,area:{execute:()=>NaN}}),/area/);
});
test('block cache is memory-only and bound to the exact tract geometry',async()=>{
  const s=options(),blockCache=new Map(),zone={geometry:shape(0,0,5,10)};
  await calculateAcsZonePopulation(zone,{...s.options,blockCache});await calculateAcsZonePopulation(zone,{...s.options,blockCache});assert.equal(s.reads(),1);
  const changed=options({tracts:[tract(id,shape(0,0,10,11))]});await calculateAcsZonePopulation(zone,{...changed.options,blockCache});assert.equal(changed.reads(),1);
});
test('newer evidence remains read-only and does not allocate age or outreach attributes',async()=>{
  const ui=await readFile(new URL('../site/lib/population-ui.js',import.meta.url),'utf8'),data=await readFile(new URL('../site/lib/zone-acs-data.js',import.meta.url),'utf8');
  assert(!/localStorage|sessionStorage|applyEdits|addFeatures|updateFeatures|accessToken/.test(ui+data));
  assert(ui.includes('not a measured population change'));assert(ui.includes('Under-18, 65+, language, disability and household values remain whole-tract'));
  assert(ui.includes('acsCache.delete(old.key)'));assert(ui.includes('generation!==epoch'));
});

function boundaries({ids=[1],changed=false,sr=4326,geoId=id,period='January 1, 2024',truncated=false}={}){
  const requests=[];let reads=0;return {requests,fetcher:async(url,options)=>{
    requests.push({url,options});let data;
    if(!options.body)data={name:'Census Tracts',description:'Census Tracts; '+period+' vintage',geometryType:'esriGeometryPolygon',fields:[{name:'OBJECTID',type:'esriFieldTypeOID'},...['GEOID','STATE','COUNTY'].map(name=>({name}))]};
    else if(options.body.has('returnIdsOnly'))data={objectIds:changed&&++reads>1?[2]:ids};
    else data={features:[{attributes:{GEOID:geoId,OBJECTID:1},geometry:shape(-120,36,-119,37)}],spatialReference:{wkid:sr},exceededTransferLimit:truncated};
    return {ok:true,json:async()=>data};
  }};
}
test('full Census analysis geometry reconciles IDs with county scope and no simplification',async()=>{
  const s=boundaries(),r=await readCensusAnalysisTracts(shape(-120,36,-119,37),{fetcher:s.fetcher});
  assert.equal(r.rows[0].id,id);assert.equal(r.vintage,'January 1, 2024');assert.equal(r.rows[0].geometry.spatialReference.wkid,4326);
  assert(s.requests.every(r=>r.options.credentials==='omit'));
  assert(s.requests.filter(r=>r.options.body).every(r=>r.options.method==='POST'&&!r.options.body.has('maxAllowableOffset')));
  assert.equal(s.requests[1].options.body.get('where'),"STATE = '06' AND COUNTY = '019'");
});
test('Census outlines reject changed inventory, CRS, vintage, truncation and wrong county',async()=>{
  for(const value of [{changed:true},{sr:3857},{period:'January 1, 2025'},{ids:[1,1]},{geoId:'06039000100'},{truncated:true}]){
    const s=boundaries(value);await assert.rejects(readCensusAnalysisTracts(shape(-120,36,-119,37),{fetcher:s.fetcher}));
  }
});
test('ACS totals join by GEOID to full Census geometry and require matching vintage',async()=>{
  const full=shape(-120,36,-119,37),trimmed=shape(-120,36,-119.5,37);
  const args={geometry:full,readValues:async()=>({rows:[tract(id,trimmed)],metadata,checked:1}),readOutlines:async()=>({rows:[{id,geometry:full}],vintage:'January 1, 2024'})};
  const r=await readZoneAcsTracts(args);assert.deepEqual(r.rows[0].geometry,full);assert.equal(r.rows[0].measures[0].estimate,1000);
  await assert.rejects(readZoneAcsTracts({...args,readValues:async()=>({rows:[],metadata:{...metadata,period:'2021–2025'}})}),/matching/);
  await assert.rejects(readZoneAcsTracts({...args,readValues:async()=>({rows:[],metadata})}),/no matching/);
});
