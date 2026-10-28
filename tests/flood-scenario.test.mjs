import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { blend, clockLabel, depthAt, rampDepth, rowsToObjects, summarize } from '../site/lib/flood-scenario-model.js';

test('fractional hours blend between neighbouring frames and clamp at the ends', () => {
  const hourly = Array.from({ length: 25 }, (_, i) => i);
  assert.deepEqual(blend(7.25, hourly), { i0: 7, i1: 8, w: 0.25 });
  assert.deepEqual(blend(-3, hourly), { i0: 0, i1: 1, w: 0 });
  assert.deepEqual(blend(99, hourly), { i0: 24, i1: 24, w: 0 });
  assert.deepEqual(blend(9, [0, 2, 6, 12]), { i0: 2, i1: 3, w: 0.5 }); // uneven frame times
});

test('building depth interpolates hourly samples and counts water above the first floor', () => {
  const p = { d0: 0, d1: 2, d2: 4, found_ht: 1.5, pop_night: 3, peak_hr: 2, loss_usd: 1000 };
  assert.equal(depthAt(p, 0.5, [0, 1, 2]), 1);
  assert.equal(depthAt({ ...p, arrive_hr: 0.75 }, 0.5, [0, 1, 2]), 0, 'dry until the water arrives');
  assert.equal(depthAt({ ...p, arrive_hr: 0.25 }, 0.5, [0, 1, 2]), 1);
  assert.deepEqual(summarize([p], 0.5, [0, 1, 2]), { wet: 1, inside: 0, people: 3, loss: 0 });
  assert.deepEqual(summarize([p], 2, [0, 1, 2]), { wet: 1, inside: 1, people: 3, loss: 1000 });
  assert.equal(clockLabel(7.5), 'T+7 h 30 min');
});

test('ramp model: dry before arrival, 1 ft at arrival, linear to peak, then held', () => {
  assert.equal(rampDepth(2, 6, 9, 1.9), 0);
  assert.equal(rampDepth(2, 6, 9, 2), 1);
  assert.equal(rampDepth(2, 6, 9, 4), 5);
  assert.equal(rampDepth(2, 6, 9, 30), 9);
  assert.equal(rampDepth(2, 6, 0.4, 3), 0.4); // shallower than 1 ft: maximum at arrival
  assert.equal(rampDepth(null, 6, 9, 30), null);
  assert.equal(depthAt({ arrive_hr: 2, peak_hr: 6, depth_max: 9 }, 4, [0, 48]), 5);
  assert.deepEqual(rowsToObjects({ fields: ['a', 'b'], rows: [[1, 2]] }), [{ a: 1, b: 2 }]);
});

test('missing depth or foundation does not imply dry ground or water inside a building',()=>{
  assert.equal(depthAt({d0:2,d1:null},0.5,[0,1]),null);
  assert.equal(rampDepth(1,null,3,4),null);
  assert.equal(summarize([{d0:2,d1:2,found_ht:null}],0.5,[0,1]).inside,0);
  assert.equal(summarize([{d0:2,d1:2,found_ht:0}],0.5,[0,1]).inside,1);
});

test('published scenario data is consistent', async () => {
  const root = new URL('../site/data/flood-scenarios/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('index.json', root), 'utf8'));
  assert(index.scenarios.length >= 1 && index.scenarios.some(s => s.id === index.default));
  for (const { id } of index.scenarios) {
    const dir = new URL(`${id}/`, root);
    const s = JSON.parse(await readFile(new URL('scenario.json', dir), 'utf8'));
    const b = rowsToObjects(JSON.parse(await readFile(new URL('buildings.json', dir), 'utf8')));
    assert(s.frames.length >= 2);
    assert(s.frames.every((f, i) => i === 0 || f.hour > s.frames[i - 1].hour), `${id}: frame hours must ascend`);
    if (s.depth_zarr) {
      // Zarr depth (stormwatch-flood): one time step per frame, every hour of a tile in one chunk, gzip only
      const z = JSON.parse(await readFile(new URL(`${s.depth_zarr}/depth/zarr.json`, dir), 'utf8'));
      assert.equal(z.shape[0], s.frames.length, `${id}: Zarr time steps`);
      assert.equal(z.chunk_grid.configuration.chunk_shape[0], s.frames.length, `${id}: a chunk holds every hour`);
      assert.deepEqual(z.dimension_names, ['time', 'y', 'x']);
      assert(['uint16', 'uint8'].includes(z.data_type) && z.codecs.every(c => ['transpose', 'bytes', 'gzip'].includes(c.name)), `${id}: codecs the page reads`);
      // arrival[y, x] in minutes (65535 never): the page grows the water and front from it between frames
      const a = JSON.parse(await readFile(new URL(`${s.depth_zarr}/arrival/zarr.json`, dir), 'utf8'));
      assert.deepEqual(a.shape, z.shape.slice(1), `${id}: arrival grid matches depth`);
      assert.equal(a.data_type, 'uint16');
      assert.equal(a.fill_value, 65535);
    } else for (const f of s.frames) await readFile(new URL(f.image, dir));
    if (s.buildings_parquet) assert.equal((await readFile(new URL(s.buildings_parquet, dir))).subarray(0, 4).toString(), 'PAR1', `${id}: Parquet file`);
    assert.equal(b.length, s.totals.buildings);
    assert(['samples', 'ramp'].includes(s.depth_model));
    for (const p of b) {
      assert(Number.isFinite(p.lon) && Number.isFinite(p.lat) && Number.isFinite(p.depth_max), `${id}: building ${p.fd_id}`);
      if (s.depth_model === 'samples') s.frames.forEach((_, i) => assert(Number.isFinite(p[`d${i}`]), `${id}: d${i}`));
    }
  }
});
