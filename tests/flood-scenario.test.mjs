import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blend, clockLabel, depthAt, summarize } from '../site/lib/flood-scenario-model.js';

test('fractional hours blend between neighbouring frames and clamp at the ends', () => {
  assert.deepEqual(blend(7.25, 25), { i0: 7, i1: 8, w: 0.25 });
  assert.deepEqual(blend(-3, 25), { i0: 0, i1: 1, w: 0 });
  assert.deepEqual(blend(99, 25), { i0: 24, i1: 24, w: 0 });
});

test('building depth interpolates hourly samples and counts water above the first floor', () => {
  const p = { d0: 0, d1: 2, d2: 4, found_ht: 1.5, pop_night: 3, peak_hr: 2, loss_usd: 1000 };
  assert.equal(depthAt(p, 0.5, 3), 1);
  assert.deepEqual(summarize([p], 0.5, 3), { wet: 1, inside: 0, people: 3, loss: 0 });
  assert.deepEqual(summarize([p], 2, 3), { wet: 1, inside: 1, people: 3, loss: 1000 });
  assert.equal(clockLabel(7.5), 'T+7 h 30 min');
});

test('published Muncie scenario data is consistent', async () => {
  const dir = new URL('../site/data/flood-scenarios/muncie/', import.meta.url);
  const s = JSON.parse(await readFile(new URL('scenario.json', dir), 'utf8'));
  const b = JSON.parse(await readFile(new URL('buildings.geojson', dir), 'utf8'));
  assert.equal(s.frames.length, 25);
  for (const f of s.frames) await readFile(new URL(f.image, dir));
  assert.equal(b.features.length, s.totals.buildings);
  for (const { properties: p } of b.features) for (const f of s.frames) assert(Number.isFinite(p[`d${f.hour}`]));
});
