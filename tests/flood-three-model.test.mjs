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
