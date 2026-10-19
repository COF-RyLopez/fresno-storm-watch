import test from 'node:test';
import assert from 'node:assert/strict';
import {POWER_SYMBOLS,powerMapStyle,powerMarkerUrl} from '../site/lib/power-symbols.js';
import {powerExercise} from '../site/lib/power-exercise.js';
import {validatePowerSnapshot} from '../site/lib/power-model.js';

test('utility states remain visually distinguishable without relying on hue',()=>{
  assert.equal(new Set(Object.values(POWER_SYMBOLS).map(s=>s.shape)).size,7);
  assert.notEqual(powerMapStyle({status:'warning'}).area.style,powerMapStyle({status:'consideration'}).area.style);
  assert.notEqual(powerMapStyle({status:'psps'}).area.style,powerMapStyle({status:'outage'}).area.style);
});
test('stale retrieval preserves last utility status instead of converting an outage to unknown/restored',()=>{
  for(const status of Object.keys(POWER_SYMBOLS)){
    const style=powerMapStyle({status,health:'Source check failed'});
    assert.equal(style.status,status);assert.equal(style.retained,true);
    assert.notEqual(style.point.url,powerMarkerUrl(status));
    assert.equal(style.area.style,powerMapStyle({status}).area.style);
    assert.equal(style.area.outline.style,'dash-dot');
  }
});
test('unknown future publisher state gets a question symbol, never a restored check',()=>{
  assert.equal(powerMapStyle({status:'unexpected'}).status,'unknown');
  assert.equal(powerMapStyle({status:'unexpected'}).point.url,powerMarkerUrl('unknown'));
});
test('symbol exercise represents all seven statuses while counting point/area pairs once',()=>{
  const result=validatePowerSnapshot(powerExercise('symbols'));
  const rows=result.feeds.flatMap(f=>f.rows);
  assert.equal(rows.length,7);assert(rows.every(r=>r.geometries.length===2));
  assert.deepEqual(rows.map(r=>r.status).sort(),Object.keys(POWER_SYMBOLS).sort());
  assert.equal(rows.find(r=>r.status==='outage').kind,'sce-outage');
});
