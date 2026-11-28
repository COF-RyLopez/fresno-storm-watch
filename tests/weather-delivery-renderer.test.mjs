import test from 'node:test';
import assert from 'node:assert/strict';
import {labRenderer} from '../site/lib/weather-delivery-renderer.js';

test('the lab keeps the standard map by default and links to the 3D preview',()=>{
  const r=labRenderer('');
  assert.equal(r.three,false);assert.equal(r.id,'maplibre');
  assert.equal(r.switchHref('/weather-delivery.html'),'/weather-delivery.html?renderer=three');
});
test('?renderer=three selects the county scene and links back without dropping other parameters',()=>{
  const r=labRenderer('?renderer=three&x=1');
  assert.equal(r.three,true);assert.equal(r.id,'three');
  assert.equal(r.switchHref('/weather-delivery.html','#a'),'/weather-delivery.html?x=1#a');
  assert.equal(labRenderer('?renderer=maplibre').three,false);
});
