import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCities, normalizeBurnScars, collectCommandContext, validateCommandContext, SOURCES } from '../scripts/collect-command-context.mjs';

const now=Date.parse('2026-11-19T20:00:00Z');
const ring=[[-120,36],[-120,37],[-119,37],[-119,36],[-120,36]];
const county={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}}]};
const response=attributes=>({spatialReference:{wkid:4326},features:attributes.map(a=>({attributes:a,geometry:{rings:[ring]}}))});
const city={GEOID:'0627000',BASENAME:'Fresno',NAME:'Fresno city'};
const fire={FIRE_NAME:'BASIN',YEAR_:2024,GlobalID:'{AAA}',IRWINID:'{BBB}',ALARM_DATE:1719360000000,CONT_DATE:1721347200000};
const garnet={...fire,FIRE_NAME:'GARNET',YEAR_:2025,GlobalID:'{DDD}',IRWINID:'{EEE}',ALARM_DATE:1755993600000};
const nifc={poly_IncidentName:'North',poly_IRWINID:'{CCC}',attr_FireDiscoveryDateTime:1777409881000,poly_DateCurrent:1788214389000};
function fixtureFetch(fail) { return async (url,opts)=>{
  const u=String(url); if(fail&&u.includes(fail)) throw Error('offline source failure');
  let data;
  if(u.endsWith('/4?f=json')) data={name:'Incorporated Places',description:'Incorporated Places; January 1, 2026 vintage'};
  else if(u.includes('/ls/pwfdf/')) {const p=new URLSearchParams(opts.body); const garnet=p.get('where').includes('Garnet'); data={features:[{attributes:{Fire_ID:garnet?'Garnet_2025-08-24_v1.0':'bas2024',assessment_date:garnet?1758672000000:1722211200000,Rainfall:garnet?'34mm':'30mm'}}]};}
  else if(u.startsWith(SOURCES.cities.url)) data=response([city]);
  else if(u.startsWith(SOURCES.calfire.url)) data=response([fire,garnet]);
  else if(u.startsWith(SOURCES.nifc.url)) data=response([nifc]);
  else throw Error('Unexpected URL '+u);
  return {ok:true,json:async()=>structuredClone(data)};
}; }

test('normalizes authoritative names, stable IDs and missing fire dates without inventing times',()=>{
  assert.equal(normalizeCities(response([city]))[0].properties.id,'city:0627000');
  const f=normalizeBurnScars(response([{...fire,ALARM_DATE:undefined,CONT_DATE:undefined}]),'calfire')[0];
  assert.equal(f.properties.id,'burn-scar:bbb');
  assert.equal(f.properties.discovered,null); assert.equal(f.properties.updated,null);
});
test('rejects wrong CRS, invalid polygons, partial query pages and zero coverage',()=>{
  for(const bad of [ {...response([city]),spatialReference:{wkid:3857}}, {...response([city]),exceededTransferLimit:true}, response([]), {...response([city]),features:[{attributes:city,geometry:{rings:[[[0,0],[1,1],[0,0]]]}}]} ]) assert.throws(()=>normalizeCities(bad));
});
test('rejects duplicate city identifiers and repeated same-source fire IDs',()=>{
  assert.throws(()=>normalizeCities(response([city,city])),/duplicate/i);
  assert.throws(()=>normalizeBurnScars(response([fire,fire]),'calfire'),/duplicate/i);
});
test('collects whole display polygons and explicitly records source vintage and historical model',async()=>{
  const requests=[]; const base=fixtureFetch();
  const fetchImpl=async(u,o)=>{requests.push([String(u),o]);return base(u,o);};
  const result=await collectCommandContext({county,fetchImpl,now});
  assert.equal(result.cities.features.length,1); assert.equal(result.burnScars.features.length,3);
  assert.equal(result.burnScars.features[0].properties.assessment.storm,'30 mm/h peak 15-minute intensity');
  assert.equal(result.burnScars.features[0].properties.assessment.source,'https://www.sciencebase.gov/catalog/item/68c492d1d4be021a00d8cc38');
  assert.match(result.sources.find(s=>s.id==='census-places').coverage,/January 1, 2026/);
  const query=new URLSearchParams(requests.find(([u])=>u===SOURCES.calfire.url+'/query')[1].body);
  assert.equal(query.get('spatialRel'),'esriSpatialRelIntersects'); assert.equal(query.get('outSR'),'4326');
  assert.equal(query.get('maxAllowableOffset'),'0.0003'); assert.equal(query.get('geometryPrecision'),'5');
  assert.deepEqual(result.cities.features[0].geometry.coordinates,[ring.toReversed()]);
  assert.equal(validateCommandContext(result),result);
});
test('deduplicates the same incident across providers using IRWIN identity, not names',async()=>{
  const base=fixtureFetch(); const fetchImpl=async(u,o)=>String(u)===SOURCES.nifc.url+'/query'?{ok:true,json:async()=>response([{...nifc,poly_IRWINID:'{BBB}'}])}:base(u,o);
  const result=await collectCommandContext({county,fetchImpl,now});
  assert.equal(result.burnScars.features.length,2); assert.match(result.warnings.join(' '),/duplicate/i);
});
test('a partial source failure rejects a new bundle; a valid previous bundle retains its timestamp',async()=>{
  await assert.rejects(collectCommandContext({county,fetchImpl:fixtureFetch('YearToDate'),now}),/source failure/);
  const previous=await collectCommandContext({county,fetchImpl:fixtureFetch(),now:now-3600000});
  const result=await collectCommandContext({county,fetchImpl:fixtureFetch('YearToDate'),now,previous});
  assert.equal(result.generatedAt,previous.generatedAt); assert.deepEqual(result.sources,previous.sources);
  assert.match(result.warnings.join(' '),/retained|previous/i);
});
test('rejects invalid stored bundle dates, duplicate features, and invalid geometry',async()=>{
  const result=await collectCommandContext({county,fetchImpl:fixtureFetch(),now});
  for(const mutate of [r=>r.generatedAt='today',r=>r.cities.features.push(r.cities.features[0]),r=>r.burnScars.features[0].geometry.coordinates[0][0]=[200,95],r=>r.burnScars.features[0].properties.discovered='yesterday']){
    const bad=structuredClone(result); mutate(bad); assert.throws(()=>validateCommandContext(bad));
  }
});
test('rejects collapsed generalized geometry and reacquires full source precision with an explicit warning',async()=>{
  const base=fixtureFetch();let retries=0;
  const fetchImpl=async(u,o)=>{
    if(String(u)===SOURCES.calfire.url+'/query'){
      const p=new URLSearchParams(o.body);
      if(p.has('maxAllowableOffset'))return {ok:true,json:async()=>({...response([fire,garnet]),features:[{attributes:fire,geometry:{rings:[[[0,0],[1,1],[2,2],[0,0]]]}}]})};
      retries++;
    }
    return base(u,o);
  };
  const result=await collectCommandContext({county,fetchImpl,now});
  assert.equal(retries,1);assert.match(result.warnings.join(' '),/precision|generalization/i);
});
