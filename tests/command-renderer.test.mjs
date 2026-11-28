import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseRenderer,switchHref,switchLabel,fallbackNote,MODULE} from '../command/src/renderer.ts';

const desk={phone:false,webgl:true};
test('desktops with WebGL2 get the 3D county scene by default',()=>{
  assert.deepEqual(chooseRenderer('',desk),{id:'three',reason:'default'});
  assert.equal(MODULE.three,'county-scene-map');
});
test('phones and browsers without WebGL2 get the standard map',()=>{
  assert.deepEqual(chooseRenderer('',{phone:true,webgl:true}),{id:'maplibre',reason:'phone'});
  assert.deepEqual(chooseRenderer('',{phone:false,webgl:false}),{id:'maplibre',reason:'no-webgl'});
  assert.equal(MODULE.maplibre,'watch-terrain-map');
});
test('?renderer= forces either map, whatever the device',()=>{
  assert.deepEqual(chooseRenderer('?renderer=maplibre',desk),{id:'maplibre',reason:'requested'});
  assert.deepEqual(chooseRenderer('?renderer=three',{phone:true,webgl:false}),{id:'three',reason:'requested'});
  assert.deepEqual(chooseRenderer('?renderer=nonsense',desk),{id:'three',reason:'default'});
});
test('the switch link names the other map explicitly and keeps other parameters and the place',()=>{
  assert.equal(switchHref('/command/','','#gauge-1','three'),'/command/?renderer=maplibre#gauge-1');
  assert.equal(switchHref('/command/','?exercise=1&renderer=maplibre','','maplibre'),'/command/?exercise=1&renderer=three');
  assert.equal(switchLabel('three'),'Use the standard map');
  assert.equal(switchLabel('maplibre'),'Use the 3D map');
});
test('a fallback says why; a chosen or phone map says nothing',()=>{
  assert.match(fallbackNote('failed'),/could not start/);
  assert.match(fallbackNote('no-webgl'),/WebGL2/);
  for(const r of ['default','requested','phone'])assert.equal(fallbackNote(r),'');
});
