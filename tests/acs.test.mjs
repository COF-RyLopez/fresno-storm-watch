import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ACS_SOURCES,acsFields,acsPeriod,acsMeasure,formatAcsMeasure,normalizeAcs,ACS_LIMIT} from '../site/lib/acs-model.js';
import {readAcsMetadata,readAcsTracts,readPioContext} from '../site/lib/acs-data.js';
const id='06019000200',period='2020–2024';
const geometry={rings:[[[-120,36],[-120,37],[-119,37],[-119,36],[-120,36]]],spatialReference:{wkid:4326}};
function source({periods={},missingField=false,owner='esri_demographics',count=1,features=null,extra={},sr=4326,fail=null}={}){
  const requests=[];return {requests,fetcher:async(url,options)=>{
    requests.push({url,options});const key=Object.keys(ACS_SOURCES).find(k=>url.includes(ACS_SOURCES[k].id)||url.startsWith(ACS_SOURCES[k].url));
    if(key===fail)return {ok:false,status:503};let data;
    if(url.includes('/sharing/rest/'))data={id:ACS_SOURCES[key].id,owner,description:`<strong>Current Vintage</strong>: ${periods[key]||'2020-2024'}`};
    else if(!options.body)data={geometryType:'esriGeometryPolygon',fields:acsFields(key).filter((_,i)=>!missingField||i).map(name=>({name}))};
    else if(options.body.get('returnCountOnly'))data={count};
    else{const attributes=Object.fromEntries(acsFields(key).map(f=>[f,10]));Object.assign(attributes,{GEOID:id,NAME:'Census Tract 2',ALAND:1988144,B01001_001E:3029,B01001_001M:546,B01001_calc_numLT18E:1151,B01001_calc_numLT18M:279,B01001_calc_numGE65E:209,B01001_calc_numGE65M:90});data={features:features||[{attributes,geometry}],spatialReference:{wkid:sr},...extra};}
    return {ok:true,json:async()=>data};
  }};
}
test('ACS uses replacement hosted views and verifies an unambiguous five-year period',()=>{
  assert(ACS_SOURCES.population.url.includes('ACS_Population_View_Boundaries/FeatureServer/2'));
  assert.equal(acsPeriod('<b>Current Vintage</b>: 2020-2024'),period);
  assert.equal(acsPeriod('Current Vintage: 2021–2025'),'2021–2025');
  for(const text of ['', 'Latest 2024', 'Current Vintage: 2020-2025','Current Vintage: 2020-2024 Current Vintage: 2020-2024'])assert.throws(()=>acsPeriod(text),/verified/);
});
test('ACS estimate and MOE preserve missing/suppressed values independently from zero',()=>{
  for(const v of [null,undefined,-666666666,-999,'10',NaN,Infinity])assert.equal(acsMeasure({e:v,m:v},'e','m').estimate,null);
  assert.equal(formatAcsMeasure(acsMeasure({e:0,m:14},'e','m')),'0 ± 14');
  assert.equal(formatAcsMeasure({estimate:50,moe:null}),'50 · MOE unavailable');
  assert.equal(formatAcsMeasure({estimate:null,moe:10}),'Unavailable');
  assert.equal(formatAcsMeasure({estimate:300,moe:25.7}),'300 ± 25.7');
});
test('verified tract fixture retains total, children and older adults with their own MOEs',async()=>{
  const s=source(),data=await readAcsTracts({id,fetcher:s.fetcher}),r=data.rows[0];
  assert.equal(data.metadata.period,period);assert.deepEqual(r.measures.map(m=>[m.estimate,m.moe]),[[3029,546],[1151,279],[209,90]]);
  assert.equal(r.id,id);assert.equal(r.geometry.spatialReference.wkid,4326);
  assert(s.requests.every(r=>r.options.credentials==='omit'));
  assert(s.requests.filter(r=>r.options.body).every(r=>r.options.method==='POST'));
});
test('ACS rejects changed publisher, schema and incomplete county query',async()=>{
  for(const options of [{owner:'someone_else'},{missingField:true},{count:2},{extra:{exceededTransferLimit:true}},{sr:3857},{count:501}]){
    const s=source(options);await assert.rejects(readAcsTracts({id,fetcher:s.fetcher}));
  }
});
test('ACS rejects duplicate, outside-county and absent single-tract records',async()=>{
  const f={attributes:{GEOID:id},geometry};
  for(const options of [{count:2,features:[f,f]},{features:[{attributes:{GEOID:'06039000200'},geometry}]},{count:0,features:[]}]){
    const s=source(options);await assert.rejects(readAcsTracts({id,fetcher:s.fetcher}));
  }
  assert.throws(()=>normalizeAcs({attributes:{GEOID:'06039'}},'population'),/Fresno/);
  await assert.rejects(readAcsTracts({id:"06019000200' OR 1=1"}),/Choose/);
});
test('ACS zone context uses intersecting tracts without allocating their counts',async()=>{
  const s=source();await readAcsTracts({geometry,fetcher:s.fetcher});
  const queries=s.requests.filter(r=>r.options.body);assert(queries.every(q=>q.options.body.get('where')==="GEOID LIKE '06019%'"));
  assert(queries.every(q=>q.options.body.get('inSR')==='4326'));
  assert.equal(queries[1].options.body.get('returnGeometry'),'false');
  assert(ACS_LIMIT.includes('not evacuation-zone totals'));
});
test('PIO topics retain separate universes, sources and partial failures',async()=>{
  const s=source({fail:'internet'}),r=await readPioContext(id,period,{fetcher:s.fetcher});
  assert.equal(r.length,4);assert(r.find(t=>t.key==='internet').error.includes('503'));
  assert(r.filter(t=>t.key!=='internet').every(t=>t.rows.length===1));
  assert.equal(ACS_SOURCES.vehicles.universe,'Households, not people');assert(ACS_SOURCES.disability.universe.includes('noninstitutionalized'));
});
test('annual topic update cannot silently mix periods with selected population',async()=>{
  const s=source({periods:{language:'2021-2025'}}),r=await readPioContext(id,period,{fetcher:s.fetcher});
  assert(r.find(t=>t.key==='language').error.includes('period differs'));assert(r.find(t=>t.key==='vehicles').rows);
});
test('ACS HTTP and cancellation errors do not fabricate a zero result',async()=>{
  await assert.rejects(readAcsMetadata('population',{fetcher:async()=>({ok:false,status:500})}),/500/);
  const abort=new AbortController();abort.abort();await assert.rejects(readAcsTracts({signal:abort.signal}),{name:'AbortError'});
});
test('ACS and PIO evidence remains read-only, progressive and distinct from block allocation',async()=>{
  const ui=await readFile(new URL('../site/lib/acs-ui.js',import.meta.url),'utf8'),zone=await readFile(new URL('../site/lib/population-ui.js',import.meta.url),'utf8');
  assert(!/localStorage|sessionStorage|applyEdits|addFeatures|updateFeatures|accessToken|clientSecret/.test(ui));
  assert(ui.includes('generation!==epoch'));assert(ui.includes('onExpand(pio,open=>{if(open)void loadPio('));assert(ui.includes('Cal OES accessible emergency communications'));
  assert(zone.includes('Explore intersecting ACS tracts'));assert(zone.includes('calculateZonePopulation'));
});
