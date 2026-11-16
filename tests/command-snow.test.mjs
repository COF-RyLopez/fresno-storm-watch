import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { snowWindow, SNOW_SITES } from '../site/lib/command-snow.js';
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
