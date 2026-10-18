import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildReleaseTrend,gaugeTrendSeries,trendSegments,TREND_REACHES} from '../site/lib/release-trend-model.js';
import {planningExercise} from '../site/lib/planning-exercise.js';
import {CONFIG} from '../site/config.js';
import {HOUR} from '../site/lib/river-model.js';
const now=Date.parse('2026-10-18T20:00:00Z');
const settings=JSON.parse(await readFile(new URL('../site/data/reservoir-watchlist.json',import.meta.url),'utf8'));
const gauges=JSON.parse(await readFile(new URL('../site/data/river-watchlist.json',import.meta.url),'utf8')).stations;
const fixture=()=>planningExercise(gauges,[],settings,'scheduled',now);
const model=(options={})=>{const f=fixture();return buildReleaseTrend({reservoirs:f.reservoirs,entries:f.entries,config:CONFIG,now,...options});};

test('Millerton plots only river outlet releases; common flow domain covers reservoir, gauge and planned amounts',()=>{
  const f=fixture();f.reservoirs.snapshot.stations[0].metrics.outflow.samples.forEach(p=>p.value=9999);
  const m=model({reservoirs:f.reservoirs});
  assert.equal(m.release.metric.sensor,85);assert(m.release.observed.length>=6);assert(!m.release.observed.some(p=>p.value===9999));
  assert.deepEqual(m.releaseDomain,m.gaugeDomain);assert(m.releaseDomain[1]>=650);assert.equal(m.markers.length,3);
  assert.equal(m.start,now-168*HOUR);assert.equal(m.end,now+72*HOUR);
});
test('daily CDEC reports remain report dates and use the PST day midpoint, not an instantaneous midnight value',()=>{
  const m=model();for(const p of m.release.observed){assert.equal(p.time-p.sourceTime,12*HOUR);assert.equal(new Date(p.time-8*HOUR).toISOString().slice(0,10),p.reportDate);assert(p.time<=now);}
});
test('Pine Flat uses hourly outflow and does not substitute an upstream Kings gauge',()=>{
  const m=model({stationId:'PNF',gaugeId:'KREC1'});assert.equal(m.release.metric.sensor,23);assert.equal(m.release.daily,false);assert.equal(m.gauge.id,null);assert.equal(m.gauge.observed.length,0);assert.deepEqual(TREND_REACHES.PNF.gauges,[]);
});
test('gauge flow is explicitly converted from kcfs; missing secondary points break paths',()=>{
  const g={name:'Stage',units:'ft',secondaryName:'Flow',secondaryUnits:'kcfs',points:[{time:1,value:10,secondary:.2},{time:2,value:11,secondary:null},{time:3,value:12,secondary:0}]};
  const s=gaugeTrendSeries(g,'flow',0,4);assert.deepEqual(s.points.map(p=>p.value),[200,null,0]);assert.equal(trendSegments(s.points,100).length,2);
  assert.deepEqual(gaugeTrendSeries(g,'stage',0,4).points.map(p=>p.value),[10,11,12]);
});
test('wrong units never produce a plotted gauge series',()=>{
  assert.equal(gaugeTrendSeries({name:'Flow',units:'ft',points:[{time:1,value:10}]},'flow',0,2).supported,false);
});
test('a current primary stage does not make a missing secondary flow current',()=>{
  const f=fixture(),g=f.entries.get('SJXC1').gauge;
  g.observed.secondaryName='Flow';g.observed.secondaryUnits='kcfs';g.observed.points.forEach(p=>p.secondary=null);
  const m=model({entries:f.entries});assert.equal(m.gauge.current,false);assert(m.gauge.observed.every(p=>p.value===null));assert.match(m.gauge.health,/missing/);
});
test('long gaps and explicit conflicts break lines; no extrapolated or carried-forward points',()=>{
  const p=[{time:0,value:1},{time:HOUR,value:null},{time:2*HOUR,value:2},{time:8*HOUR,value:4}];assert.equal(trendSegments(p,2*HOUR).length,3);
  const f=fixture();const series=f.reservoirs.snapshot.stations[0].metrics.release;series.samples[2].flag='CONFLICT';series.samples[2].conflict=true;
  const m=model({reservoirs:f.reservoirs});assert(m.release.observed.some(p=>p.value===null));assert.equal(m.release.forecast.length,0);assert(m.gauge.forecast.every(p=>p.time>=now&&p.time<=m.end));
});
test('schedule markers retain effective times and revisions; never shift to downstream arrival',()=>{
  const m=model();assert(m.markers.some(p=>p.time===now+6*HOUR&&p.value===650));assert(m.markers.some(p=>p.time===now+18*HOUR&&p.value===300));assert(m.markers.every(p=>p.issued===null));
});
test('stale and failed sources retain historical context but are visibly unverified',()=>{
  const f=fixture();f.reservoirs.error='offline';f.entries.get('SJXC1').error='offline';
  const m=model({reservoirs:f.reservoirs,entries:f.entries});assert.equal(m.release.current,false);assert.match(m.release.health,/retained/);assert.equal(m.schedule.current,false);assert(m.markers.every(p=>!p.current));assert.equal(m.gauge.forecastCurrent,false);assert.equal(m.gauge.current,false);
});
test('invalid or duplicate schedules cannot leak into chart markers via historical raw records',()=>{
  const f=fixture();const schedule=f.reservoirs.snapshot.stations[0].scheduled;schedule.records.push(schedule.records[0]);assert.equal(model({reservoirs:f.reservoirs}).markers.length,0);
});
test('stage has its own dimensional scale and invalid upstream selection falls back to first downstream gauge',()=>{
  const m=model({measure:'stage',gaugeId:'RJQC1'});assert.equal(m.gauge.id,'SJXC1');assert.equal(m.gauge.units,'ft');assert.notDeepEqual(m.releaseDomain,m.gaugeDomain);
});
test('window changes filter observations and scheduled markers and empty data stays unknown',()=>{
  const m=model({historyHours:72,futureHours:168});assert.equal(m.start,now-72*HOUR);assert.equal(m.end,now+168*HOUR);assert(m.release.observed.every(p=>p.time>=m.start));
  const empty=model({reservoirs:{},entries:new Map()});assert.equal(empty.release.observed.length,0);assert.equal(empty.gauge.forecast.length,0);assert.equal(empty.schedule.current,false);
  assert.throws(()=>model({stationId:'OTHER'}),/Invalid/);
});
