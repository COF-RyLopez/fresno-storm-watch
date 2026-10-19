import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {forecastInterval,windForecast,intervalAt,observationAt,satelliteFrames,weatherStops,validateWindSnapshot,windAt,windCompass,HOUR} from '../site/lib/weather-model.js';
import {collectWind} from '../scripts/collect-wind.mjs';

const now=Date.parse('2026-10-19T14:00:00Z'),grid={office:'HNX',x:53,y:106};
const rows=value=>[{validTime:'2026-10-19T13:00:00+00:00/PT2H',value},{validTime:'2026-10-19T15:00:00+00:00/PT3H',value:10}];
const payload=()=>({properties:{gridId:'HNX',gridX:53,gridY:106,updateTime:'2026-10-19T12:56:18Z',windSpeed:{uom:'wmoUnit:km_h-1',values:rows(16.09344)},windGust:{uom:'wmoUnit:km_h-1',values:rows(32.18688)},windDirection:{uom:'wmoUnit:degree_(angle)',values:rows(0)}}});
const site=(changes={})=>({id:'SJ41',lastSuccess:new Date(now).toISOString(),error:null,forecast:windForecast(payload(),grid,now),...changes});

test('ISO NWS durations preserve day/hour/minute/second lengths and explicit timezone',()=>{
  const i=forecastInterval('2026-10-19T06:00:00-07:00/P1DT2H30M');
  assert.equal(i.start,now-HOUR);assert.equal(i.end-i.start,26.5*HOUR);
  for(const s of ['2026-10-19T00:00:00/PT1H','2026-10-19T00:00Z/P1M','2026-10-19T00:00Z/PT0H','bad/PT1H','2026-10-19T00:00Z/P99D'])assert.throws(()=>forecastInterval(s));
});
test('wind/gust km/h are converted to mph and a north wind retains zero degrees',()=>{
  const f=windForecast(payload(),grid,now);
  assert(Math.abs(f.series.windSpeed[0].value-10)<1e-9);assert(Math.abs(f.series.windGust[0].value-20)<1e-9);
  assert.equal(f.series.windDirection[0].value,0);assert.equal(f.units,'mph');assert.equal(f.heightMeters,10);
  assert.equal(f.sourceUnits.windSpeed,'wmoUnit:km_h-1');
});
test('wind identity, units and future update times fail closed',()=>{
  for(const change of [p=>p.gridId='MTR',p=>p.gridX=52,p=>p.windSpeed.uom='unknown',p=>p.updateTime='2026-10-20T00:00Z']){
    const data=payload();change(data.properties);assert.throws(()=>windForecast(data,grid,now));
  }
});
test('missing gusts are unknown, zero wind is preserved, negatives cannot be calm wind',()=>{
  const p=payload();p.properties.windSpeed.values=rows(0);p.properties.windGust.values=rows(null);
  const s=site({forecast:windForecast(p,grid,now)}),state=windAt(s,now,now);
  assert.equal(state.speed,0);assert.equal(state.gust,null);assert.equal(state.direction,0);
  p.properties.windSpeed.values=rows(-1);assert.equal(windForecast(p,grid,now).series.windSpeed[0].value,null);
});
test('conflicting source duplicates stay unknown in either ordering; north 360 equals zero',()=>{
  const p=payload();p.properties.windGust.values.push({...p.properties.windGust.values[0],value:99});
  assert.equal(windForecast(p,grid,now).series.windGust[0].value,null);
  p.properties.windGust.values.reverse();assert.equal(windForecast(p,grid,now).series.windGust[0].value,null);
  const d=payload();d.properties.windDirection.values.push({...d.properties.windDirection.values[0],value:360});
  assert.equal(windForecast(d,grid,now).series.windDirection[0].value,0);
});
test('overlapping source intervals are rejected rather than arbitrarily picking a value',()=>{
  const p=payload();p.properties.windSpeed.values.push({validTime:'2026-10-19T14:00:00Z/PT3H',value:100});assert.throws(()=>windForecast(p,grid,now),/Overlapping/);
});
test('forecast interval ends are exclusive and missing time spans are not bridged',()=>{
  const s=windForecast(payload(),grid,now).series.windSpeed;
  assert.equal(intervalAt(s,now-HOUR).value,s[0].value);assert.equal(intervalAt(s,Date.parse('2026-10-19T15:00Z')),s[1]);
  assert.equal(intervalAt(s,Date.parse('2026-10-19T18:00Z')),null);assert.equal(intervalAt(s,now-2*HOUR),null);
});
test('a browser check cannot renew a stale or failed source; latest forecasts are not historical archives',()=>{
  assert.match(windAt(site({error:'offline'}),now,now).reason,/failed/);
  assert.match(windAt(site(),now,now,true).reason,/Collection overdue/);
  assert.match(windAt(site({lastSuccess:new Date(now-HOUR).toISOString()}),now,now).reason,/collection overdue/);
  assert.match(windAt(site({forecast:{...site().forecast,issued:now-25*HOUR}}),now,now).reason,/old/);
  assert.match(windAt(site(),now-2*HOUR,now).reason,/predates/);
});
test('satellite uses explicit frames only; sort/dedup and ignore bad/future/expired times',()=>{
  const frames=satelliteFrames('2026-10-19T13:55Z,bad,2026-10-19T13:50Z,2026-10-19T13:55Z,2026-10-20T00:00Z',now);
  assert.deepEqual(frames,[now-5*60000,now-10*60000]);
  assert.throws(()=>satelliteFrames('2025-01-01T00:00Z',now),/no recent/);
});
test('shared timeline selects earlier observations and never carries an observation into future time',()=>{
  const frames=[now-3*60000,now-8*60000,now-13*60000];
  assert.equal(observationAt(frames,now-6*60000,now),now-8*60000);
  assert.equal(observationAt(frames,now+1,now),null);
  assert.equal(observationAt([now-HOUR],now-HOUR,now),null);
  assert.equal(observationAt(frames,now-HOUR,now),null);
});
test('shared timeline has three hours of history, a live stop, and 72 forecast hours',()=>{
  const stops=weatherStops(now);assert.equal(stops.length,85);assert.equal(stops[0],now-3*HOUR);assert.equal(stops[12],now);assert.equal(stops.at(-1),now+72*HOUR);
  assert(stops.every((t,i)=>!i||t>stops[i-1]));assert.equal(windCompass(0),'N');assert.equal(windCompass(270),'W');assert.equal(windCompass(null),'Unknown');
});
test('NWS collector re-resolves grids, bounds concurrency, and preserves failed-site prior evidence',async()=>{
  const selection={sites:[{id:'SJ41',latitude:36.8761,longitude:-119.7933},{id:'FAIL',latitude:37,longitude:-120}]};
  const previous={sites:[{id:'FAIL',forecast:{issued:123},lastSuccess:'2026-10-18T00:00Z'}]};
  let active=0,peak=0;const urls=[];
  const result=await collectWind({selection,previous,now,fetchImpl:async url=>{
    urls.push(String(url));active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;
    if(String(url).includes('/points/37.0000'))throw new Error('source down');
    return {ok:true,json:async()=>String(url).includes('/points/')?{properties:{gridId:'HNX',gridX:53,gridY:106}}:payload()};
  }});
  assert(peak<=2);assert(urls.some(u=>u.endsWith('/gridpoints/HNX/53,106')));
  assert.equal(result.sites[0].forecast.units,'mph');assert.match(result.sites[1].error,/source down/);assert.equal(result.sites[1].forecast.issued,123);assert.equal(result.sites[1].lastSuccess,previous.sites[0].lastSuccess);
});
test('published wind snapshot has nine source-identified planning points and rejects corrupt samples',async()=>{
  const s=validateWindSnapshot(JSON.parse(await readFile(new URL('../site/data/wind-latest.json',import.meta.url),'utf8')));
  assert.equal(s.sites.length,9);assert(s.sites.every(s=>s.source?.startsWith('https://api.weather.gov/gridpoints/')||s.error));
  const bad=structuredClone(s);bad.sites[0].forecast.series.windGust[0].value=-1;assert.throws(()=>validateWindSnapshot(bad));
  const missing=structuredClone(s);missing.sites.pop();assert.throws(()=>validateWindSnapshot(missing));
});
