import test from 'node:test';
import assert from 'node:assert/strict';
import {measureWeatherReady} from '../site/lib/weather-delivery-measure.js';

test('readiness timing includes both loading and evidence identity verification',async()=>{
  let clock=10;const value={source:'public replay'};
  const result=await measureWeatherReady(async()=>{clock=30;return value;},async received=>{
    assert.equal(received,value);await Promise.resolve();clock=45;return true;
  },()=>clock);
  assert.equal(result.milliseconds,35);assert.equal(result.value,value);
});
test('failed validation cannot produce a successful measurement',async()=>{
  await assert.rejects(measureWeatherReady(async()=>({}),async()=>false),/identity mismatch/);
});
