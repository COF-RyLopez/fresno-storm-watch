import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AFN_SOURCES,AFN_LIMIT,CCL_LIMIT,validateLanguageAreas,normalizeSvi,normalizeCes,normalizeDac,normalizeCcl,summarizePercentiles,summarizeFacilities,formatPercentile} from '../site/lib/afn-model.js';
import {readIntersecting,readAfnContext} from '../site/lib/afn-data.js';
const geometry={rings:[[[-120,36],[-120,37],[-119,37],[-119,36],[-120,36]]],spatialReference:{wkid:4326}};
const reference=JSON.parse(await readFile(new URL('../site/data/acs-b16001-fresno.json',import.meta.url),'utf8'));
const features={
  puma:[{attributes:{GEOID:'0601905',NAME:'Fresno City (Southeast) PUMA'}}],
  svi:[{attributes:{FIPS:'06019000100',RPL_THEMES:.91,RPL_THEME2:-999,E_LIMENG:120,M_LIMENG:60}},{attributes:{FIPS:'06019000200',RPL_THEMES:.4,RPL_THEME2:.5,E_LIMENG:0,M_LIMENG:14}}],
  ces:[{attributes:{tract:6019000100,CIscoreP:96.2,lingP:80}},{attributes:{tract:6019000200,CIscoreP:40,lingP:null}}],
  sb535:[{attributes:{Tract:6019000100,DAC_category:'CalEnviroScreen 4.0 Top 25%'}}],
  ccl:[{attributes:{ObjectId:1,FAC_NBR:1,NAME:'A',FAC_TYPE_DESC:'RESIDENTIAL-ELDERLY ',STATUS:3,CAPACITY:6,RES_CITY:'FRESNO'}},{attributes:{ObjectId:2,FAC_NBR:2,NAME:'B',FAC_TYPE_DESC:'RESIDENTIAL-ELDERLY',STATUS:3,CAPACITY:4}},{attributes:{ObjectId:3,FAC_NBR:3,NAME:'C',FAC_TYPE_DESC:'RESIDENTIAL-ELDERLY',STATUS:6,CAPACITY:99}}]
};
function source({fail=null,missingField=null,exceeded=null,countDelta={}}={}){
  const requests=[];return {requests,fetcher:async(url,options={})=>{
    url=String(url);requests.push({url,options});
    if(url.startsWith('file:')||url.endsWith('acs-b16001-fresno.json'))return {ok:true,json:async()=>structuredClone(reference)};
    const key=Object.keys(features).find(k=>url.startsWith(AFN_SOURCES[k].url));if(key===fail)return {ok:false,status:503};
    let data;
    if(!options.body)data={fields:AFN_SOURCES[key].fields.filter(n=>n!==missingField).map(name=>({name}))};
    else if(options.body.get('returnCountOnly'))data={count:features[key].length+(countDelta[key]||0)};
    else data={features:structuredClone(features[key]),...(exceeded===key?{exceededTransferLimit:true}:{})};
    return {ok:true,json:async()=>data};
  }};
}
test('B16001 reference holds seven Fresno PUMAs with Hmong and Punjabi estimates and MOEs',()=>{
  validateLanguageAreas(reference);assert.equal(reference.rows.length,7);assert.equal(reference.period,'2020–2024');
  const se=reference.rows.find(r=>r.puma==='0601905');assert.deepEqual(se.hmong,{estimate:8059,moe:969});assert.equal(se.hmongLep.estimate,4008);assert.deepEqual(se.punjabi,{estimate:3284,moe:809});
  for(const bad of [{...reference,rows:[...reference.rows,reference.rows[0]]},{...reference,rows:[{...reference.rows[0],puma:'0603901'}]},{...reference,rows:[{...reference.rows[0],hmong:{estimate:-1,moe:3}}]},{...reference,table:'C16001'}])assert.throws(()=>validateLanguageAreas(bad));
});
test('tract IDs, percentiles and missing values normalize without inventing zeros',()=>{
  assert.deepEqual(normalizeSvi(features.svi[0]),{id:'06019000100',overall:.91,household:null,limitedEnglish:{estimate:120,moe:60}});
  assert.equal(normalizeCes(features.ces[0]).id,'06019000100');assert(Math.abs(normalizeCes(features.ces[0]).overall-.962)<1e-12);assert.equal(normalizeCes(features.ces[1]).linguistic,null);
  assert.equal(normalizeDac(features.sb535[0]).id,'06019000100');
  for(const f of [{attributes:{FIPS:'06039000100'}},{attributes:{}}])assert.throws(()=>normalizeSvi(f),/Fresno/);
  assert.throws(()=>normalizeCes({attributes:{tract:6039000100}}),/Fresno/);
  assert.equal(normalizeCcl(features.ccl[0]).type,'RESIDENTIAL-ELDERLY');
  assert.equal(normalizeCcl({attributes:{ObjectId:9,NAME:'X',CAPACITY:null}}).capacity,null);
  assert.equal(formatPercentile(.91),'91st percentile');assert.equal(formatPercentile(.12),'12th percentile');assert.equal(formatPercentile(.03),'3rd percentile');assert.equal(formatPercentile(null),'Unavailable');
});
test('percentile summary counts tracts and range only',()=>{
  assert.deepEqual(summarizePercentiles([{v:.9},{v:null},{v:.75},{v:.2}],'v'),{tracts:4,known:3,atLeast:2,max:.9});
  assert.deepEqual(summarizePercentiles([],'v'),{tracts:0,known:0,atLeast:0,max:null});
});
test('facility capacity is grouped by type and status code, never added across codes',()=>{
  const groups=summarizeFacilities(features.ccl.map(normalizeCcl));
  assert.deepEqual(groups.map(g=>[g.type,g.status,g.facilities,g.capacity]),[['RESIDENTIAL-ELDERLY',3,2,10],['RESIDENTIAL-ELDERLY',6,1,99]]);
  assert.equal(summarizeFacilities([...features.ccl.slice(0,2).map(normalizeCcl),normalizeCcl({attributes:{ObjectId:4,NAME:'D',FAC_TYPE_DESC:'RESIDENTIAL-ELDERLY',STATUS:3,CAPACITY:null}})])[0].capacity,null);
  assert(CCL_LIMIT.includes('not current residents'));
});
test('zone reads are anonymous POST intersect queries with fixed county filters and no phone field',async()=>{
  const s=source(),topics=await readAfnContext(geometry,{fetcher:s.fetcher});
  assert.deepEqual(topics.map(t=>[t.key,t.error]),[['languages',undefined],['svi',undefined],['ces',undefined],['ccl',undefined]]);
  const queries=s.requests.filter(r=>r.options.body);
  assert(s.requests.every(r=>r.options.credentials==='omit'));assert(queries.every(q=>q.options.method==='POST'&&q.options.body.get('spatialRel')==='esriSpatialRelIntersects'&&q.options.body.get('inSR')==='4326'));
  for(const key of ['svi','ces','sb535','ccl','puma'])assert(queries.filter(q=>q.url.startsWith(AFN_SOURCES[key].url)).every(q=>q.options.body.get('where')===AFN_SOURCES[key].where));
  assert(queries.every(q=>!/PHONE/i.test(q.options.body.get('outFields')||'')));
  const [languages,,ces,ccl]=topics;
  assert.equal(languages.rows[0].hmong.estimate,8059);assert.equal(languages.rows[0].name,'Fresno City (Southeast) PUMA');
  assert.deepEqual(ces.rows.map(r=>r.dac),['CalEnviroScreen 4.0 Top 25%',null]);assert.equal(ccl.rows.length,3);
  assert(AFN_LIMIT.includes('2010 tracts'));
});
test('one failing or incomplete source stays unavailable without hiding the others',async()=>{
  for(const [options,key] of [[{fail:'svi'},'svi'],[{missingField:'CAPACITY'},'ccl'],[{exceeded:'ces'},'ces'],[{countDelta:{sb535:1}},'ces'],[{fail:'puma'},'languages']]){
    const topics=await readAfnContext(geometry,{fetcher:source(options).fetcher});
    for(const t of topics)assert.equal(!!t.error,t.key===key,JSON.stringify([options,t.key,t.error]));
  }
  await assert.rejects(readIntersecting('svi',geometry,{fetcher:source({countDelta:{svi:600}}).fetcher}),/bounded/);
});
test('zones with no records return empty rows, not an error',async()=>{
  const s=source({countDelta:{ccl:-3}}),r=await readIntersecting('ccl',geometry,{fetcher:s.fetcher});
  assert.deepEqual(r.rows,[]);assert(!s.requests.some(q=>q.options.body?.get('outFields')));
});
