import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleForecastWind} from '../site/lib/watch-wind-trails.js';

test('trails interpolate signed east and north vectors with northward grid rows',()=>{
 const field={width:2,height:2,bounds:[0,0,200,200],
  vectors:new Float32Array([-12,1,4,1,-12,9,4,9])};
 assert.deepEqual(sampleForecastWind(field,50,50),[-12,1]);
 assert.deepEqual(sampleForecastWind(field,150,150),[4,9]);
 assert.deepEqual(sampleForecastWind(field,100,100),[-4,5]);
 assert.deepEqual(sampleForecastWind(field,200,0),[4,1]);
 assert.equal(sampleForecastWind(field,201,50),null);
 assert.equal(sampleForecastWind(field,NaN,50),null);
});
