import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { decodeDepth, DEPTH_STEPS_PER_FT, legendDepth, parseFootprints, sampleGrid, terrarium, tileRange } from '../site/lib/flood-three-model.js';

const site = new URL('../site/data/flood-scenarios/', import.meta.url);
const scenario = id => readFile(new URL(`${id}/scenario.json`, site), 'utf8').then(JSON.parse);

test('legend inversion returns each stop depth and interpolates between stops', async () => {
  const { legend } = await scenario('big-dry-creek');
  const ft = legendDepth(legend);
  for (const s of legend) assert.ok(Math.abs(ft(...s.rgba) - s.ft) < 1e-9, `stop ${s.ft}`);
  const [a, b] = legend.slice(2, 4), mid = a.rgba.map((v, i) => (v + b.rgba[i]) / 2);
  assert.ok(Math.abs(ft(...mid) - (a.ft + b.ft) / 2) < 1e-9);
  assert.equal(ft(0, 0, 0, 0), 0);
  const px = decodeDepth(new Uint8ClampedArray([0, 0, 0, 0, ...legend[1].rgba]), ft);
  assert.deepEqual([...px], [0, legend[1].ft * DEPTH_STEPS_PER_FT]);
});

test('every committed footprint binary parses, has an origin at its scenario extent centre and finite rings', async () => {
  const index = JSON.parse(await readFile(new URL('index.json', site), 'utf8'));
  for (const { id } of index.scenarios) {
    const raw = gunzipSync(await readFile(new URL(`${id}/footprints-3js.bin`, site)));
    const fp = parseFootprints(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    const { extent } = await scenario(id);
    assert.deepEqual(fp.origin, [(extent.xmin + extent.xmax) / 2, (extent.ymin + extent.ymax) / 2], id);
    assert.equal(fp.start.at(-1), fp.nv, id);
    for (let i = 0; i < fp.n; i++) assert.ok(fp.start[i + 1] - fp.start[i] >= 3, `${id} ring ${i}`);
    assert.ok(fp.xy.every(v => Math.abs(v) < 60_000), `${id} coordinates inside the scenario area`);
  }
});

test('tile range covers the extent; terrarium and bilinear sampling', () => {
  const e = { xmin: -13389213.6, ymin: 4376832.7, xmax: -13314692.0, ymax: 4425529.7 };
  const r = tileRange(e, 12);
  assert.ok(r.span.xmin <= e.xmin && r.span.xmax >= e.xmax && r.span.ymin <= e.ymin && r.span.ymax >= e.ymax);
  assert.ok(r.x1 - r.x0 < 10 && r.y1 - r.y0 < 7);
  assert.equal(terrarium(128, 100, 128), 100.5);
  assert.equal(sampleGrid([0, 10, 20, 30], 2, 2, 0.5, 0.5), 15);
  assert.equal(sampleGrid([0, 10, 20, 30], 2, 2, 5, -1), 10);
});

test('hip roofs: rectangles get a ridge along the long side; irregular or large footprints stay flat', async () => {
  const { hipRoof } = await import('../site/lib/flood-three-model.js');
  const rect = [[0, 0], [20, 0], [20, 10], [0, 10]], roof = hipRoof(rect);
  assert.equal(roof.length, 18 * 3);
  const ys = [], xs = [], zs = [];
  for (let i = 0; i < roof.length; i += 3) { xs.push(roof[i]); ys.push(roof[i + 1]); zs.push(roof[i + 2]); }
  assert.ok(Math.abs(Math.max(...ys) - 5 * 5 / 12) < 1e-6, 'rise = half-width x pitch');
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map(v => Math.round(v * 1e6) / 1e6), [0, 20, 0, 10]);
  const ridge = [];
  for (let i = 0; i < roof.length; i += 3) if (roof[i + 1] > 1) ridge.push(Math.round(roof[i] * 1e6) / 1e6);
  assert.deepEqual([...new Set(ridge)].sort((a, b) => a - b), [5, 15], 'ridge runs along x, inset by the half-width');
  assert.equal(hipRoof([[0, 0], [20, 0], [20, 4], [4, 4], [4, 20], [0, 20]]), null, 'L-shape stays flat');
  assert.equal(hipRoof([[0, 0], [40, 0], [40, 30], [0, 30]]), null, 'over 600 square units stays flat');
  assert.ok(hipRoof([[0, 0], [10, 10], [5, 15], [-5, 5]]), 'rotated rectangles are found');
});
