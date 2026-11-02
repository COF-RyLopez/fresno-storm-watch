import test from 'node:test';
import assert from 'node:assert/strict';
import {snowLevels,snowLevelAt,snowRange,feet,snowLines,ROUTE_PRIORITIES} from '../site/lib/snow-model.js';

const grid={properties:{snowLevel:{uom:'wmoUnit:m',values:[
  {validTime:'2026-11-02T06:00:00+00:00/PT1H',value:1896.16},{validTime:'2026-11-02T07:00:00+00:00/PT2H',value:1700},
  {validTime:'2026-11-02T09:00:00+00:00/PT1H',value:null},{validTime:'garbage',value:1500}]}}};
test('NWS snow level: metres per step, gaps stay unknown, units are checked',()=>{
  const s=snowLevels(grid);assert.equal(s.length,2);
  assert.equal(snowLevelAt(s,Date.parse('2026-11-02T06:30:00Z')),1896.16);assert.equal(snowLevelAt(s,Date.parse('2026-11-02T08:59:00Z')),1700);
  assert.equal(snowLevelAt(s,Date.parse('2026-11-02T09:30:00Z')),null);
  assert.deepEqual(snowRange(s,Date.parse('2026-11-02T06:00:00Z'),Date.parse('2026-11-03T06:00:00Z')),{low:1700,high:1896.16});
  assert.equal(snowRange(s,0,1),null);assert.equal(feet(1896.16),6200);
  assert.throws(()=>snowLevels({properties:{snowLevel:{uom:'wmoUnit:ft',values:[]}}}));
});
test('forecast discussion: keeps snow sentences only',()=>{
  const afd='.DISCUSSION... A cold trough arrives Tuesday. Snow levels fall to 5000 feet by Wednesday morning. Valley rain totals near 0.5 inch. Heavy snowfall is possible above 6000 ft. Freezing levels lower to 4500 ft. Dry Friday.';
  assert.deepEqual(snowLines(afd),['Snow levels fall to 5000 feet by Wednesday morning.','Heavy snowfall is possible above 6000 ft.','Freezing levels lower to 4500 ft.']);
  assert.deepEqual(snowLines(''),[]);assert.deepEqual(snowLines('Mostly sunny. Breezy.'),[]);
});
test('every county priority code in the layer has a style',()=>{for(const p of [1,2,3,4,9,10,11])assert.ok(ROUTE_PRIORITIES[p].color);});
