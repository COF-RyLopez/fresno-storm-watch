import test from 'node:test';
import assert from 'node:assert/strict';
import {labRenderer} from '../site/lib/weather-delivery-renderer.js';

test('the lab draws on the 3D county map by default and links to the standard map',()=>{
  const r=labRenderer('');
  assert.equal(r.three,true);assert.equal(r.id,'three');
  assert.equal(r.switchHref('/weather-delivery.html'),'/weather-delivery.html?renderer=maplibre');
  assert.equal(labRenderer('?renderer=three').three,true);
});
test('?renderer=maplibre selects the standard map and links back without dropping other parameters',()=>{
  const r=labRenderer('?renderer=maplibre&x=1');
  assert.equal(r.three,false);assert.equal(r.id,'maplibre');
  assert.equal(r.switchHref('/weather-delivery.html','#a'),'/weather-delivery.html?x=1#a');
});
