import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { advisorySnowWindow, snowAdvisoryCandidate, snowAdvisoryTiming, snowWindow, SNOW_SITES } from '../site/lib/command-snow.js';
import { countyGeometry } from '../site/lib/model.js';
import { pointInRings } from '../site/lib/power-geometry.js';

test('snow samples are inside their mapped reservoir catchments', async () => {
  const data = JSON.parse(await readFile(new URL('../site/data/reservoir-watersheds.geojson', import.meta.url)));
  for (const site of SNOW_SITES) {
    const basin = data.features.find(feature => feature.properties.reservoir === site.basin);
    assert.ok(pointInRings(site.coordinates, countyGeometry(basin.geometry).rings), site.name);
  }
});

test('snow forecast distinguishes zero, missing accumulation and incomplete snow-level coverage', () => {
  const site = { snow: [{ start: 0, end: 6, value: 25.4 }], level: [
    { start: 0, end: 3, value: 1500 }, { start: 3, end: 6, value: 1800 },
  ] };
  assert.deepEqual(snowWindow(site, 0, 6), { inches: 1, level: [4900, 5900] });
  assert.equal(snowWindow(site, 0, 3).inches, null);
  site.snow[0].value = 0;
  assert.equal(snowWindow(site, 0, 3).inches, 0);
  assert.deepEqual(snowWindow(site, 3, 9), { inches: null, level: null });
  site.level[1].start = 4;
  assert.equal(snowWindow(site, 0, 6).level, null);
});

const H = 3600000;
const at = hour => Date.UTC(2026, 10, 16) + hour * H;
const advisory = { kind: 'alert', name: 'Winter Weather Advisory', time: at(6), timeLabel: 'Effective' };

test('mixed winter products open snowfall only for accumulation or falling snow in the selected product', () => {
  const details = { onset: new Date(at(8)).toISOString(), ends: new Date(at(21)).toISOString(), expires: new Date(at(10)).toISOString() };
  assert.equal(snowAdvisoryCandidate(advisory), true);
  assert.equal(snowAdvisoryCandidate({ ...advisory, name: 'Ice Storm Warning' }), false);
  assert.deepEqual(snowAdvisoryTiming(advisory, { ...details, description: '* WHAT...For the Winter Weather Advisory, snow accumulations up to 6 inches. For the Winter Storm Watch Above 5,000 feet, heavy snow possible.' }),
    { start: at(8), end: at(21) });
  assert.equal(snowAdvisoryTiming(advisory, { ...details, description: '* WHAT...For the Winter Weather Advisory, freezing rain. For the Winter Storm Watch, heavy snow possible.\n\n* IMPACTS...Snow on untreated roads.' }), null);
  assert.equal(snowAdvisoryTiming(advisory, { description: '* WHAT...Blowing snow and patches of ice.' }), null);
  assert.equal(snowAdvisoryTiming(advisory, null), null);
  assert.deepEqual(snowAdvisoryTiming({ ...advisory, name: 'Lake Effect Snow Warning' }, null), {start: at(6), end: null});
});

test('automatic window skips elapsed or unrelated six-hour grids and reports no match', () => {
  const starts = [0, 6, 12, 18, 24].map(at);
  const timing = { start: at(8), end: at(19) };
  const frame = start => ({ start: at(start), end: at(start + 6) });
  assert.equal(advisorySnowWindow(starts, [frame(0), frame(12), frame(18)], timing, at(5)), at(12));
  assert.equal(advisorySnowWindow(starts, [frame(0), frame(24)], timing, at(5)), null);
  assert.equal(advisorySnowWindow(starts, [frame(6), frame(12)], timing, at(12)), at(12));
  assert.equal(advisorySnowWindow(starts, [frame(12)], {start: at(6), end: at(12)}, at(5)), null);
});
