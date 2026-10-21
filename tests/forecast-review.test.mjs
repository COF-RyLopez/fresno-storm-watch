import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {comparisonWindow,comparisonAreas} from '../site/lib/forecast-comparison-model.js';
import {pointDifferences,areaDifferences,rankDifferences,mergeForecastReviews,uniqueComparisonPoints,validateComparisonSnapshot,REVIEW_MAX_AGE} from '../site/lib/forecast-review-model.js';
import {collectComparisonSnapshot,currentComparisonSnapshot} from '../site/lib/forecast-review-data.js';
const now=Date.parse('2026-10-20T01:00:00Z'),H=3600000,w=comparisonWindow(now);
const point={id:'A',name:'Public sample A',longitude:-119.7,latitude:36.9};
const modelId='noaa-hrrr-forecast-48-hour',gfsId='noaa-gfs-forecast';
function row(id,rain=[1,0,0,0],wind=[1,2,3,4]){
  const intervals=values=>values.map((value,i)=>({value,start:w.start+i*6*H,end:w.start+(i+1)*6*H}));
  return {id,label:id,issued:now-H,source:id==='nws'?'https://api.weather.gov/gridpoints/HNX/1,2':'https://api.dynamical.org/v1/data/test/snapshot/points/1,2',gustProvided:id!==gfsId,rain:intervals(rain),wind:intervals(wind),gust:[]};
}
const sample=(rows=[row('nws'),row(modelId),row(gfsId)])=>({point,checked:now,rows});
test('rain spread and timing compare identical windows and preserve source attribution',()=>{
  const s=pointDifferences(sample([row('nws',[0.2,0,0,0]),row(modelId,[0,0.7,0,0]),row(gfsId,[0.4,0,0,0])]),now);
  assert(Math.abs(s.rainSpread-0.5)<1e-10);assert.equal(s.rainTiming.hours,6);assert.equal(s.rainTiming.sourceId,modelId);assert.equal(s.complete,true);assert.equal(s.review,true);
});
test('ties cannot create a false wind timing signal by selecting only their first period',()=>{
  const s=pointDifferences(sample([row('nws',[0,0,0,0],[9,9,9,9]),row(modelId,[0,0,0,0],[1,2,9,2]),row(gfsId,[0,0,0,0],[1,2,9,1])]),now);
  assert.equal(s.windTiming.hours,0);assert.equal(s.windTiming.nwsPeriods.length,4);assert.equal(s.review,false);assert.equal(s.rainTiming,null);
});
test('disjoint tied peaks use the nearest pair of period starts; no unique arrival is inferred',()=>{
  const s=pointDifferences(sample([row('nws',[0,0,0,0],[10,1,1,10]),row(modelId,[0,0,0,0],[1,10,1,1]),row(gfsId,[0,0,0,0],[1,1,10,1])]),now);
  assert.equal(s.windTiming.hours,6);assert.equal(s.review,true);
});
test('partial sources retain an explicitly partial NWS-anchored difference',()=>{
  const s=pointDifferences(sample([row('nws'),row(modelId,[1.5,0,0,0]),{id:gfsId,error:'Source down'}]),now);
  assert.equal(s.rainSpread,0.5);assert.equal(s.rainSources,2);assert.equal(s.complete,false);assert.equal(s.review,true);
});
test('missing NWS cannot turn model-only agreement into a comparison review or zero',()=>{
  const s=pointDifferences(sample([{id:'nws',error:'Source down'},row(modelId),row(gfsId,[9,0,0,0])]),now);
  assert.equal(s.rainSpread,null);assert.equal(s.windTiming,null);assert.equal(s.review,false);assert.equal(s.complete,false);
});
test('missing values and expired collections are excluded independently from ranking metrics',()=>{
  const s=sample();s.checked=now-REVIEW_MAX_AGE-1;const old=pointDifferences(s,now);assert.equal(old.review,false);assert.equal(old.rainSpread,null);assert.equal(old.complete,false);
  const fresh=sample();fresh.rows[1].rain[1].value=null;const p=pointDifferences(fresh,now);assert.equal(p.rainSources,2);assert.equal(p.windSources,3);assert.equal(p.complete,false);
});
test('old/future runs and future check stamps cannot produce current cues',()=>{
  const s=sample();s.rows[1].issued=now-19*H;s.rows[2].issued=now+6*60000;assert.equal(pointDifferences(s,now).rainSpread,null);
  s.checked=now+3*60000;assert.equal(pointDifferences(s,now).complete,false);
});
test('differences below displayed precision do not add tiny numeric-noise review cues',()=>{
  const s=pointDifferences(sample([row('nws'),row(modelId,[1.00001,0,0,0]),row(gfsId)]),now);assert.equal(s.review,false);
});
test('zero precipitation and calm wind are known values, not missing or timing signals',()=>{
  const s=pointDifferences(sample([row('nws',[0,0,0,0],[0,0,0,0]),row(modelId,[0,0,0,0],[0,0,0,0]),row(gfsId,[0,0,0,0],[0,0,0,0])]),now);
  assert.equal(s.rainSpread,0);assert.equal(s.complete,true);assert.equal(s.review,false);assert.equal(s.windTiming,null);
});
test('area maxima retain different sample identities and an area counts once',()=>{
  const second={...point,id:'B',name:'Public sample B'},a=sample([row('nws'),row(modelId,[2,0,0,0]),row(gfsId)]),b={...sample([row('nws',[1,0,0,0],[4,1,1,1]),row(modelId,[1,0,0,0],[1,1,1,4]),row(gfsId,[1,0,0,0],[4,1,1,1])]),point:second};
  const area=areaDifferences([{id:'reach',name:'Reach',points:[point,second]}],{points:[a,b]},now)[0];assert.equal(area.rain.point.id,'A');assert.equal(area.wind.point.id,'B');assert.equal(area.wind.windTiming.hours,18);
  const rows=mergeForecastReviews([{area:{id:'reach'},review:true,status:'Official cue',gaps:[]}],[area]);assert.equal(rows.filter(r=>r.review).length,1);assert.equal(rows[0].status,'Official cue');assert(!rows[0].forecastDifference.samples);
});
test('rankings sort missing metrics after measured zero and never blend unlike units',()=>{
  const list=[{name:'Unknown',rain:null,wind:null},{name:'Rain',rain:{rainSpread:0.8},wind:{windTiming:{hours:0}}},{name:'Wind',rain:{rainSpread:0},wind:{windTiming:{hours:18}}}];
  assert.equal(rankDifferences(list,'rain')[0].name,'Rain');assert.equal(rankDifferences(list,'wind')[0].name,'Wind');assert.equal(rankDifferences(list)[2].name,'Unknown');
});
test('current window rollover invalidates missing next-window coverage, not old data as new',()=>{
  const s=sample();s.checked=w.start+H;const p=pointDifferences(s,w.start+H);assert.equal(p.complete,false);assert.equal(p.review,false);
});
test('snapshot schema rejects duplicate/unexpected locations, overlaps and untrusted source URLs',()=>{
  const valid={schemaVersion:1,generatedAt:new Date(now).toISOString(),points:[sample()]};assert.equal(validateComparisonSnapshot(valid,[point]),valid);
  for(const mutate of [s=>s.points[0].point={...point,id:'private'},s=>s.points.push(sample()),s=>s.points[0].rows[0].source='https://evil.invalid',s=>s.points[0].rows[0].rain[1].start=w.start]){const s=structuredClone(valid);mutate(s);assert.throws(()=>validateComparisonSnapshot(s,[point]));}
});
test('shared Friant point is fetched once with at most two simultaneous workers',async()=>{
  const areas=[{points:[point,{...point,id:'B'}]},{points:[point,{...point,id:'C'}]}];let active=0,max=0;const seen=[];
  const result=await collectComparisonSnapshot(areas,{now,fetchPoint:async p=>{active++;max=Math.max(max,active);seen.push(p.id);await new Promise(resolve=>setTimeout(resolve,1));active--;return {...sample(),point:p};}});
  assert.equal(result.points.length,3);assert.equal(new Set(seen).size,3);assert(max<=2);
});
test('fresh public copy avoids live queries and preserves its original check',async()=>{
  const valid={schemaVersion:1,generatedAt:new Date(now).toISOString(),points:[sample()]},areas=[{points:[point]}];let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true,json:async()=>valid};};const result=await currentComparisonSnapshot(areas,{now,fetchImpl});assert.equal(calls,1);assert.equal(result.points[0].checked,now);
});
test('stale public copy falls back to current failures without relabeling old values',async()=>{
  const old={schemaVersion:1,generatedAt:new Date(now-REVIEW_MAX_AGE-1).toISOString(),points:[sample()]};old.points[0].checked=now-REVIEW_MAX_AGE-1;
  let calls=0;const fetchImpl=async url=>{calls++;return String(url).includes('comparison-latest.json')?{ok:true,json:async()=>old}:{ok:false,status:503};};
  const result=await currentComparisonSnapshot([{points:[point]}],{now,fetchImpl});assert(calls>1);assert.equal(result.points[0].checked,now);assert(result.points[0].rows.every(r=>r.error));assert(result.points[0].rows.every(r=>!r.rain));
});
test('configured review groups resolve seven unique samples rather than eight area associations',async()=>{
  const read=async name=>JSON.parse(await readFile(new URL(`../site/data/${name}.json`,import.meta.url),'utf8'));const [a,c,w,g]=await Promise.all(['river-areas','area-concerns','wind-watchlist','river-watchlist'].map(read));const points=uniqueComparisonPoints(comparisonAreas(a.areas,c.areas,w.sites,g.stations));assert.equal(points.length,7);
});
