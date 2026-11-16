import test from 'node:test';
import assert from 'node:assert/strict';
import { careRoadTriggers, riverTrigger } from '../site/lib/watch-triggers.js';

test('a forecast comparison points to the model sample and names its competing values', () => {
  const point = {id:'trimmer', name:'Trimmer', longitude:-119.3, latitude:37.03};
  const rain = {point, rainSpread:1, values:[{source:'NWS',rain:1},{source:'HRRR',rain:2}]};
  const trigger = riverTrigger({status:'Forecast differences need planning review',forecastDifference:{rain}});
  assert.deepEqual(trigger.points,[point]);
  assert.match(trigger.lines[0],/Trimmer.*NWS 1 in.*HRRR 2 in/);
});

test('rain and pool rise leads with pool elevation rather than unrelated release', () => {
  const dam = {id:'PNF', name:'Pine Flat', longitude:-119.3, latitude:36.8};
  const pool = {station:'PNF',name:'Pine Flat',delta:0.3,units:'ft',label:'Pool elevation'};
  const row = {status:'Rain + rising pool — review',poolRising:[pool],rainfall:{samples:[]}};
  const trigger = riverTrigger(row,[dam]);
  assert.deepEqual(trigger.points,[dam]);
  assert.equal(trigger.firstCharts[0],'Pool elevation');
  assert.match(trigger.lines[0],/pool rose 0.3 ft/);
});

test('only an actually nearby active-source road segment can trigger a care location', () => {
  const facility = {x:-119.7,y:36.7};
  const candidate = (key, x, active='yes') => ({
    row:{key,active}, bounds:[x,36.67,x,36.73],
    feature:{geometry:{type:'MultiLineString',coordinates:[[[x,36.67],[x,36.73]]]}},
  });
  const matches = careRoadTriggers(facility,[candidate('road',-119.701),candidate('far',-119.72),candidate('inactive',-119.701,'no')]);
  assert.deepEqual(matches.map(m=>m.row.key),['road']);
  assert.ok(matches[0].miles < 0.1);
});
