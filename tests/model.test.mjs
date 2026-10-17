import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { sourceTime, category, validateCounties, countyGeometry, normalizeAlerts, initialState, acceptSnapshot, rejectSnapshot, clearNotice, bannerState, formatTime } from '../site/lib/model.js';
import { exerciseBatches } from '../site/lib/exercise.js';

const now = Date.parse('2026-10-17T18:00:00Z');
const sample = () => exerciseBatches('baseline', now);
const alerts = () => normalizeAlerts(sample(), now);

test('Census source is unchanged, complete and valid for geographic queries', async () => {
  const bytes = await readFile(new URL('../site/data/counties.geojson', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'caca43ac4a58464db728d5e92461ff0fcf03b3ca0a63afc796caa9d2f7f066f2');
  const json = JSON.parse(bytes);
  assert.equal(validateCounties(json).length, 5);
  assert.throws(() => validateCounties({ ...json, features: json.features.slice(1) }), /incomplete/);
  assert.throws(() => validateCounties({ ...json, features: Array(5).fill(json.features[0]) }), /identifiers/);
});

test('polygon conversion preserves source and reverses exterior/hole orientation', () => {
  const geometry = { type: 'Polygon', coordinates: [ [[0,0],[2,0],[2,2],[0,2],[0,0]], [[0.5,0.5],[0.5,1],[1,1],[1,0.5],[0.5,0.5]] ] };
  const saved = structuredClone(geometry);
  const converted = countyGeometry(geometry);
  assert.deepEqual(geometry, saved);
  assert.deepEqual(converted.rings[0], [...saved.coordinates[0]].reverse());
  assert.deepEqual(converted.rings[1], [...saved.coordinates[1]].reverse());
  assert.equal(converted.spatialReference.wkid, 4326);
});

test('unknown, open, degenerate and projected county geometry fails', () => {
  for (const geometry of [{ type:'Point', coordinates:[1,2] }, { type:'Polygon', coordinates:[] }, { type:'Polygon', coordinates:[[[0,0],[1,0],[1,1],[0,1]]] }, { type:'Polygon', coordinates:[[[0,0],[0,0],[0,0],[0,0]]] }, { type:'Polygon', coordinates:[[[999,0],[1,0],[1,1],[999,0]]] }]) assert.throws(() => countyGeometry(geometry));
});

test('source times require timezone and finite values; display observes DST', () => {
  assert.equal(sourceTime('2026-10-17 12:00:00'), null);
  assert.equal(sourceTime(NaN), null);
  assert.equal(sourceTime(0), null);
  assert.equal(sourceTime('2026-10-17T18:00:00Z'), now);
  assert.match(formatTime(now), /PDT/);
  assert.match(formatTime(Date.parse('2026-12-17T18:00:00Z')), /PST/);
  assert.equal(formatTime(null), 'Not available');
});

test('product categories preserve an Other fallback', () => {
  assert.equal(category('Flash Flood Warning'), 'Warning');
  assert.equal(category('Flood Watch'), 'Watch');
  assert.equal(category('Wind Advisory'), 'Advisory');
  assert.equal(category('Special Weather Statement'), 'Other');
});

test('duplicate alert polygons and cross-county repeats count once', () => {
  const result = normalizeAlerts(exerciseBatches('duplicate', now), now);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].counties, ['Fresno','Madera']);
  assert.equal(result[0].geometries.length, 1);
});

test('identity/signature ignores object ID and ingestion churn', () => {
  const batches = sample();
  for (const batch of batches) for (const feature of batch.features) {
    feature.attributes.objectid += 700;
    feature.attributes.idp_ingestdate = now;
  }
  assert.deepEqual(normalizeAlerts(batches, now).map(a => a.signature), alerts().map(a => a.signature));
});

test('changed issuance, expiry or geometry produces a new notification', () => {
  const baseline = clearNotice(acceptSnapshot(initialState(), alerts(), now));
  assert.equal(acceptSnapshot(baseline, normalizeAlerts(exerciseBatches('revision', now), now), now + 1).pending.size, 1);
  for (const field of ['expiry', 'geometry']) {
    const batches = sample();
    for (const batch of batches) for (const feature of batch.features.filter(f => f.attributes.objectid === 1)) {
      if (field === 'expiry') feature.attributes.expiration = new Date(now + 8_000_000).toISOString();
      else feature.geometry.rings[0][1][0] += 0.01;
    }
    assert.equal(acceptSnapshot(baseline, normalizeAlerts(batches, now), now + 1).pending.size, 1);
  }
});

test('clear notice retains hazards and unchanged refresh stays cleared', () => {
  const current = acceptSnapshot(initialState(), alerts(), now);
  assert.equal(current.pending.size, 2);
  const cleared = clearNotice(current);
  assert.equal(cleared.alerts.length, 2);
  assert.equal(cleared.pending.size, 0);
  assert.equal(acceptSnapshot(cleared, alerts(), now + 1).pending.size, 0);
  assert.match(bannerState(cleared, now, 420000).title, /remain visible/);
});

test('known expired records leave the list; unknown expiry remains', () => {
  assert.equal(normalizeAlerts(exerciseBatches('expired', now), now).length, 0);
  const batches = sample();
  for (const batch of batches) for (const feature of batch.features) {
    if (feature.attributes.objectid === 1) feature.attributes.expiration = new Date(now - 1).toISOString();
    else feature.attributes.expiration = null;
  }
  const result = normalizeAlerts(batches, now);
  assert.equal(result.length, 1);
  assert.equal(result[0].expires, null);
  assert.match(result[0].quality, /unavailable/);
});

test('invalid identity, time, polygon and contradictory same-revision data fail closed', () => {
  const edits = [f => f.attributes.cap_id = '', f => f.attributes.issuance = 'bad', f => f.geometry = null, f => f.geometry.rings[0][1][0] = Infinity, f => f.geometry.rings[0].pop(), f => f.attributes.expiration = new Date(now + 9_000_000).toISOString()];
  for (const edit of edits) {
    const batches = sample(); edit(batches[0].features[0]);
    assert.throws(() => normalizeAlerts(batches, now));
  }
});

test('failed refresh keeps the last good data, timestamps and notifications', () => {
  const good = acceptSnapshot(initialState(), alerts(), now);
  const failed = rejectSnapshot(good, 'Connection failed', now + 30_000);
  assert.deepEqual(failed.alerts, good.alerts);
  assert.equal(failed.lastSuccess, now);
  assert.equal(failed.lastAttempt, now + 30_000);
  assert.equal(failed.pending.size, 2);
  assert.equal(bannerState(failed, now + 30_000, 420000).tone, 'failure');
  assert.equal(acceptSnapshot(failed, alerts(), now + 60_000).error, null);
});

test('initial failure, overdue query and empty successful result are distinct', () => {
  assert.match(bannerState(initialState(), now, 420000).title, /Checking/);
  assert.match(bannerState(rejectSnapshot(initialState(), 'Offline', now), now, 420000).detail, /No successful/);
  const empty = acceptSnapshot(initialState(), [], now);
  assert.match(bannerState(empty, now, 420000).detail, /does not establish safe/);
  assert.match(bannerState(empty, now + 420001, 420000).title, /overdue/);
});

test('removal clears obsolete notifications and reports change without an all-clear', () => {
  const state = acceptSnapshot(acceptSnapshot(initialState(), alerts(), now), [], now + 1);
  assert.equal(state.pending.size, 0);
  assert.equal(state.change.noLongerReturned, 2);
  assert.equal(state.change.initial, false);
});
