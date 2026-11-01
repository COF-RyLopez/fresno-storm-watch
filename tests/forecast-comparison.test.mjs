import test from 'node:test';
import assert from 'node:assert/strict';
import {MODELS,comparisonWindow,comparisonAreas,modelSeries,nwsSeries,summarizeWindow,compareForecasts} from '../site/lib/forecast-comparison-model.js';
import {fetchComparison} from '../site/lib/forecast-comparison-data.js';
import {siteJson} from '../scripts/lib/snapshot-io.mjs';
const H=3600000,now=Date.parse('2026-10-20T01:00:00Z'),point={id:'PNF',latitude:36.833,longitude:-119.325};
function fixture(model=MODELS[0]){
  const init=now-H,times=Array.from({length:49},(_,i)=>new Date(init+i*H).toISOString());
  const data={precipitation_surface:times.map(()=>1/3600),wind_u_10m:times.map(()=>3),wind_v_10m:times.map(()=>4),...(model.gust?{wind_gust_surface:times.map(()=>8)}:{})};
  return {dataProduct:{id:model.id},point:{requested:{latitude:point.latitude,longitude:point.longitude},selected:{latitude:36.8367,longitude:-119.3422}},variables:Object.fromEntries(Object.keys(data).map(k=>[k,{unit:k==='precipitation_surface'?'kg m-2 s-1':'m s-1'}])),snapshotId:'fixture',forecasts:[{initTime:new Date(init).toISOString(),validTimes:times,leadTimeHours:times.map((_,i)=>i),data}]};
}
test('model precipitation integrates preceding intervals once; lead zero excluded and wind uses vector magnitude',()=>{
  const f=modelSeries(fixture(),MODELS[0],point,now),w=comparisonWindow(now),s=summarizeWindow(f,w.start,w.end);
  assert.equal(f.rain.length,48);assert(Math.abs(s.rain.value-24/25.4)<1e-10);assert(Math.abs(s.wind.value-5*2.2369362920544)<1e-10);assert.equal(s.gust.hours,24);
});
test('null rain and vector components remain unknown; later valid coverage is still accounted',()=>{
  const raw=fixture();raw.forecasts[0].data.precipitation_surface[7]=null;raw.forecasts[0].data.wind_u_10m[6]=null;
  const f=modelSeries(raw,MODELS[0],point,now),w=comparisonWindow(now),s=summarizeWindow(f,w.start,w.end);
  assert.equal(s.rain.value,null);assert.equal(s.rain.hours,23);assert.equal(s.wind.value,null);assert.equal(s.wind.hours,23);
});
test('model identity, units, axis mismatch, duplicate times, future and old runs are rejected',()=>{
  for(const mutate of [r=>r.dataProduct.id='other',r=>r.variables.precipitation_surface.unit='mm',r=>r.forecasts[0].leadTimeHours[2]=7,r=>r.forecasts[0].validTimes[2]=r.forecasts[0].validTimes[1],r=>r.point.requested.latitude=1,r=>r.point.selected.latitude=0]){const r=fixture();mutate(r);assert.throws(()=>modelSeries(r,MODELS[0],point,now));}
  assert.throws(()=>modelSeries(fixture(),MODELS[0],point,now-2*H));assert.throws(()=>modelSeries(fixture(),MODELS[0],point,now+19*H));
});
test('GFS has no gust series and does not borrow HRRR gusts',()=>{
  const f=modelSeries(fixture(MODELS[1]),MODELS[1],point,now);assert.equal(f.gustProvided,false);assert.deepEqual(f.gust,[]);
});
test('amounts crossing the window are not apportioned and gaps never become zero',()=>{
  const f={rain:[{start:0,end:6*H,value:0.5}],wind:[],gust:[]};assert.equal(summarizeWindow(f,H,6*H).rain.value,null);
  assert.equal(summarizeWindow(f,6*H,12*H).rain.value,null);assert.equal(summarizeWindow({...f,rain:[{start:0,end:6*H,value:0}]},0,6*H).rain.value,0);
});
test('common window and first tied wettest six-hour period retain exact source timing',()=>{
  const w=comparisonWindow(now);assert.equal(w.start,Date.parse('2026-10-20T06:00:00Z'));assert.equal(w.end-w.start,24*H);
  const row=compareForecasts([modelSeries(fixture(),MODELS[0],point,now)],w)[0];assert.equal(row.periods.length,4);assert.equal(row.wettest.start,w.start);
});
test('NWS precipitation uses interval amounts, not rain probability, and preserves wind intervals',()=>{
  const values=[{validTime:'2026-10-20T06:00:00Z/PT6H',value:25.4}],p={gridId:'HNX',gridX:1,gridY:2,updateTime:new Date(now).toISOString(),quantitativePrecipitation:{uom:'wmoUnit:mm',values},windSpeed:{uom:'wmoUnit:km_h-1',values},windGust:{uom:'wmoUnit:km_h-1',values},windDirection:{uom:'wmoUnit:degree_(angle)',values}};
  const f=nwsSeries({properties:p},{office:'HNX',x:1,y:2},point,now);assert.equal(f.rain[0].value,1);assert.equal(f.wind[0].end-f.wind[0].start,6*H);
  p.quantitativePrecipitation.uom='wmoUnit:percent';assert.throws(()=>nwsSeries({properties:p},{office:'HNX',x:1,y:2},point,now));
});
test('seven river groups retain explicit samples; Redinger uses its existing gauge, not Shaver',async()=>{
  const [a,c,w,g]=await Promise.all(['river-areas.json','area-concerns.json','wind-watchlist.json','river-watchlist.json'].map(siteJson));
  const areas=comparisonAreas(a.areas,c.areas,w.sites,g.stations);assert.equal(areas.length,7);assert.equal(areas.find(a=>a.id==='san-joaquin-upper').points[0].id,'RJQC1');assert.equal(areas[0].points.length,3);
});
test('publisher failures are independent, credentials omitted and queries stay bounded',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url:String(url),options});if(String(url).includes('/points/'))return {ok:false,status:503};
    if(String(url).includes('stac.')){const m=MODELS.find(m=>String(url).includes(m.id));return {ok:true,json:async()=>({id:m.id,license:'CC-BY-4.0',attribution:'NOAA fixture', 'cube:variables':fixture(m).variables})};}
    const q=JSON.parse(options.body).queries[0],m=MODELS.find(m=>m.id===q.dataProductId);assert(q.maxLeadTimeHours<=72);assert.equal(q.location.latitude,point.latitude);
    return {ok:true,json:async()=>({results:[fixture(m)]})};};
  const r=await fetchComparison(point,{fetchImpl,now});assert.match(r.rows[0].error,/503/);assert(!r.rows[1].error);assert(!r.rows[2].error);assert(calls.every(c=>c.options.credentials==='omit'));
});
