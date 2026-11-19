import test from 'node:test';
import assert from 'node:assert/strict';
import * as symbols from '../site/lib/command-gauge.js';
import {assessGauge} from '../site/lib/river-model.js';
import {CONFIG} from '../site/config.js';
const now=Date.parse('2026-11-19T16:00:00Z'),H=3600000;
const station={id:'TEST1',name:'Test river gauge',latitude:36.8,longitude:-119.7};
function fixture(overrides={}) {
 return {id:'TEST1',name:'Test river gauge',fetched:now,inService:true,observedStatus:'',forecastStatus:'',stageUnits:'ft',flowUnits:'cfs',
  categories:{action:{stage:10},minor:{stage:12},moderate:{stage:15},major:{stage:18}},
  observed:{name:'Stage',units:'ft',points:[{time:now-3*H,value:9,secondary:300},{time:now,value:11,secondary:600}]},
  forecast:{name:'Stage',units:'ft',issued:now-H,points:[{time:now+H,value:11},{time:now+4*H,value:13}]},
  sourceUrl:'https://water.noaa.gov/gauges/test1',...overrides};
}
function display(g,clock=now,error=null){return symbols.gaugeDisplay(g,assessGauge(g,CONFIG.rivers,72,clock,error),station);}
test('current reading, observed trend and separate forecast marker use published levels',()=>{
 assert.equal(typeof symbols.gaugeDisplay,'function');const d=display(fixture());
 assert.equal(d.value,11);assert.equal(d.status,'action');assert.equal(d.trend.direction,'rising');
 assert.equal(d.trend.delta,2);assert.equal(d.trend.hours,3);assert.equal(d.forecast.value,13);
 assert.deepEqual(d.thresholds.map(x=>x.value),[10,12,15,18]);assert.ok(d.fraction>0&&d.fraction<1);
 assert.match(d.readout,/Action.*10 ft/);assert.match(d.readout,/Forecast high.*13 ft/);assert.doesNotMatch(d.readout,/%/);
});
test('zero and negative stage remain real readings; small changes do not invent a rising alarm',()=>{
 const g=fixture();g.observed.points=[{time:now-3*H,value:-.001},{time:now,value:0}];
 const d=display(g);assert.equal(d.value,0);assert.equal(d.trend.direction,'little change');
 g.observed.points.at(-1).value=-2;assert.equal(display(g).value,-2);assert.equal(display(g).trend.direction,'falling');
});
test('stale or failed readings remain labeled last reported and never use a current threshold color',()=>{
 const stale=display(fixture(),now+3*H);assert.equal(stale.status,'stale');assert.equal(stale.trend,null);
 assert.match(stale.readout,/Last reported/);assert.match(stale.readout,/stale|not current/i);
 const failed=display(fixture(),now,'query failed');assert.equal(failed.status,'stale');
 const missing=display(null);assert.equal(missing.value,null);assert.equal(missing.fraction,null);assert.equal(missing.status,'unavailable');
});
test('unknown and contradictory thresholds stay neutral and do not fabricate a capacity scale',()=>{
 for(const categories of [{},{action:{stage:12},minor:{stage:10}}]){
  const d=display(fixture({categories}));assert.equal(d.status,'unknown');assert.equal(d.fraction,null);assert.equal(d.scale,null);
  assert.match(d.readout,/thresholds unknown/i);assert.equal(d.trend.direction,'rising');
 }
});
test('thresholds and forecast must match the displayed variable and convert compatible units only',()=>{
 const g=fixture({stageUnits:'m',categories:{action:{stage:3.048},minor:{stage:3.6576}}});
 assert.equal(display(g).thresholds[0].value,10);
 g.observed={name:'Flow',units:'cfs',points:[{time:now-3*H,value:300},{time:now,value:600}]};
 const d=display(g);assert.equal(d.metric,'Flow');assert.equal(d.thresholds.length,0);assert.equal(d.forecast,null);
});
test('secondary stage may be displayed, but primary flow is not compared with stage thresholds',()=>{
 const g=fixture();g.observed={name:'Flow',units:'cfs',secondaryName:'Stage',secondaryUnits:'ft',points:[{time:now-3*H,value:300,secondary:9},{time:now,value:600,secondary:11}]};
 const d=display(g);assert.equal(d.metric,'Stage');assert.equal(d.units,'ft');assert.equal(d.value,11);assert.equal(d.status,'action');
});

test('retained gauge features age without a successful new fetch and failed checks become neutral immediately',()=>{
 assert.equal(typeof symbols.refreshGaugeFeatures,'function');
 const g=fixture(),bundle={generatedAt:new Date(now).toISOString(),input:{gauges:{stations:[station]},entries:[{id:'TEST1',gauge:g,error:null}]}};
 const features=[{type:'Feature',id:'gauge:TEST1',properties:{id:'river:a',kind:'gauge',gaugeId:'TEST1'},geometry:{type:'Point',coordinates:[-119.7,36.8]}}];
 const fresh=symbols.refreshGaugeFeatures(features,bundle,CONFIG.rivers,now);assert.equal(fresh[0].properties.gaugeDisplay.status,'action');
 const old=symbols.refreshGaugeFeatures(fresh,bundle,CONFIG.rivers,now+8*60000);assert.equal(old[0].properties.gaugeDisplay.status,'stale');
 const failed=symbols.refreshGaugeFeatures(fresh,bundle,CONFIG.rivers,now,'source check failed');assert.equal(failed[0].properties.gaugeDisplay.status,'stale');
 assert.equal(failed[0].properties.id,'river:a');assert.equal(failed[0].id,'gauge:TEST1');
});
