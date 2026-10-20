import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeArray, positionsAt, toMercator } from '../site/lib/evacuation-traffic.js';

test('car positions interpolate between trace samples and drop cars off the road', () => {
  // trip 0: (0,0) at 0 s -> (10,0) at 10 s -> (10,10) at 20 s; trip 1: (100,100) at 30 s -> (110,100) at 40 s
  const trips = { start: Uint32Array.from([0, 3]), xy: Float64Array.from([0, 0, 10, 0, 10, 10, 100, 100, 110, 100]), t: Float32Array.from([0, 10, 20, 30, 40]) };
  const out = new Float64Array(4);
  assert.deepEqual(positionsAt(trips, 5, out), [0]);
  assert.deepEqual([...out.slice(0, 2)], [5, 0]);
  assert.deepEqual(positionsAt(trips, 15, out), [0]);
  assert.deepEqual([...out.slice(0, 2)], [10, 5]);
  assert.deepEqual(positionsAt(trips, 25, out), []); // between trips
  assert.deepEqual(positionsAt(trips, 40, out), [1]);
  assert.deepEqual([...out.slice(2, 4)], [110, 100]);
  const [x, y] = toMercator(0, 0);
  assert.equal(x, 0); assert(Math.abs(y) < 1e-6);
});

test('published evacuation runs decode and agree with their metadata', async () => {
  const root = new URL('../site/data/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('flood-scenarios/index.json', root), 'utf8'));
  const withTraffic = index.scenarios.filter(s => s.evacuation);
  assert(withTraffic.length >= 1);
  for (const { id } of withTraffic) {
    for (const mode of ['base', 'fast']) {
      const dir = new URL(`evacuation/${id}/${mode}/`, root);
      const meta = JSON.parse(await readFile(new URL('meta.json', dir), 'utf8'));
      const data = JSON.parse(await readFile(new URL('data.json', dir), 'utf8'));
      const [xy, t, start, status] = await Promise.all([decodeArray(data.trip_xy, Float32Array), decodeArray(data.trip_t, Uint16Array),
        decodeArray(data.trip_start, Uint32Array), decodeArray(data.trip_status, Uint8Array)]);
      assert.equal(start.length, meta.counts.trips, `${id}/${mode}: trips`);
      assert.equal(status.length, start.length, `${id}/${mode}: status per trip`);
      assert.equal(xy.length, 2 * t.length, `${id}/${mode}: two coordinates per sample`);
      assert(start.every((s, i) => i === 0 || s > start[i - 1]), `${id}/${mode}: trips are non-empty and ordered`);
      assert(meta.exits.length >= 1 && meta.minute_on_road.length === meta.minute_people_safe.length, `${id}/${mode}: per-minute series`);
      assert(Number.isFinite(meta.outcome_people.Waiting), `${id}/${mode}: never-left count`);
    }
  }
});
