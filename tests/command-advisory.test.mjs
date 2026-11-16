import test from 'node:test';
import assert from 'node:assert/strict';
import {advisoryProfile, advisoryContext, advisoryMatches, advisoryForecastMode, advisoryForecastWindow, advisoryGauges} from '../site/lib/command-model.js';
const feature = (x,y) => ({type:'Feature',geometry:{type:'Point',coordinates:[x,y]},properties:{}});
const alert = {id:'alert',kind:'alert',name:'Flood Advisory',features:[{geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}}]};
const row = (kind,x=1) => ({id:kind,kind,review:true,features:[feature(x,1)]});
test('advisories select hazard-specific context, de-duplicate and keep screening separate from impacts',()=>{
 const rows=[row('river'),row('power'),row('road'),row('care'),row('facility'),row('river'),{...row('road',15),id:'far-road'}];
 const flood=advisoryContext(alert,rows);
 assert.deepEqual(flood.map(r=>r.id),['river','road','care']);
 const wind=advisoryContext({...alert,name:'Wind Advisory'},rows);
 assert.deepEqual(wind.map(r=>r.id),['power','road','care']);
 assert.match(advisoryProfile(alert.name).qualification,/not confirmed impacts/);
 assert.match(advisoryProfile('Dense Fog Advisory').nextAction,/Road Maintenance/);
 assert.equal(advisoryContext({...alert,features:[]},rows).length,0);
 assert.ok(advisoryContext(alert,[...rows,{...row('facility'),private:true}]).some(r=>r.id==='facility'));
});

test('auto-opens rain and surface gust modes only for the corresponding alert products', () => {
  for (const name of ['Flood Advisory', 'Flash Flood Warning', 'Flood Watch']) {
    assert.equal(advisoryForecastMode({...alert,name}), 'rain');
  }
  for (const name of ['Wind Advisory', 'High Wind Warning', 'High Wind Watch', 'Lake Wind Advisory']) {
    assert.equal(advisoryForecastMode({...alert,name}), 'gust');
  }
  for (const name of ['Wind Chill Advisory', 'Red Flag Warning', 'Winter Weather Advisory', 'Dense Fog Advisory']) {
    assert.equal(advisoryForecastMode({...alert,name}), null);
  }
});

test('chooses earliest overlapping accumulation but requires the gust valid instant to fall within the alert', () => {
  const timing = {start:100, end:220};
  const rain = [{start:200,end:260}, {start:80,end:140}, {start:40,end:100}];
  assert.deepEqual(advisoryForecastWindow(rain, timing, 90), rain[1]);
  assert.deepEqual(advisoryForecastWindow(rain, timing, 150), rain[0]);
  const gust = [240, 220, 90, 180, 120].map(start => ({start,end:start}));
  assert.deepEqual(advisoryForecastWindow(gust, timing, 90), {start:120,end:120});
  assert.equal(advisoryForecastWindow(gust, timing, 220), null);
});

test('flood map includes gauges in or near the footprint and excludes distant points and other feature types', () => {
  const flood = {...alert, features:[{geometry:{type:'Polygon',coordinates:[[[-120,36],[-119.9,36],[-119.9,36.1],[-120,36.1],[-120,36]]]}}]};
  const gauge = (name, x, y) => ({...feature(x,y), properties:{kind:'gauge',name}});
  const points = [gauge('inside',-119.95,36.05), gauge('near',-119.85,36.05), gauge('far',-119.6,36.05), feature(-119.95,36.05)];
  assert.deepEqual(advisoryGauges(flood, points).map(p => p.properties.name), ['inside','near']);
  assert.deepEqual(advisoryGauges({...flood,features:[]}, points), []);
});
test('advisory context uses polygon edges and holes, not the bounding rectangle',()=>{
 const shaped={...alert,features:[{geometry:{type:'Polygon',coordinates:[[[0,0],[4,0],[0,4],[0,0]],[[.5,.5],[1,.5],[1,1],[.5,1],[.5,.5]]]}}]};
 assert.equal(advisoryMatches(shaped,feature(3,3)),false);
 assert.equal(advisoryMatches(shaped,feature(.75,.75)),false);
 assert.equal(advisoryMatches(shaped,feature(1.5,1)),true);
 assert.equal(advisoryMatches(shaped,{geometry:{type:'LineString',coordinates:[[-1,2],[3,2]]}}),true);
 assert.equal(advisoryMatches(shaped,{geometry:{type:'LineString',coordinates:[[3,3],[4,4]]}}),false);
 assert.equal(advisoryMatches(shaped,{geometry:{type:'Polygon',coordinates:[[[3,3],[4,3],[4,4],[3,3]]]}}),false);
});
