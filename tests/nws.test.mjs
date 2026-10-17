import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchJson, queryCounty, fetchRegionalAlerts } from '../site/lib/nws.js';
import { exerciseBatches } from '../site/lib/exercise.js';
import { CONFIG } from '../site/config.js';

const counties = JSON.parse(await readFile(new URL('../site/data/counties.geojson', import.meta.url), 'utf8')).features;
const now = Date.parse('2026-10-17T18:00:00Z');
const record = () => exerciseBatches('baseline', now)[0].features[0];
const ok = (features = [], more = false) => ({ ok:true, json: async () => ({ features, exceededTransferLimit:more, spatialReference:{ wkid:4326 } }) });

test('fixed county query uses all vertices, polygon intersection and geographic output', async () => {
  await queryCounty(counties[0], CONFIG, async (url, options) => {
    assert.equal(url, CONFIG.nwsLayerUrl + '/query');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.body.get('spatialRel'), 'esriSpatialRelIntersects');
    assert.equal(options.body.get('outSR'), '4326');
    assert(JSON.parse(options.body.get('geometry')).rings[0].length > 100);
    assert.equal(options.body.get('returnZ'), 'false');
    return ok();
  });
});

test('pagination retrieves later pages instead of accepting a truncated result', async () => {
  const offsets = [];
  const result = await queryCounty(counties[0], CONFIG, async (url, { body }) => {
    offsets.push(body.get('resultOffset'));
    const feature = record(); feature.attributes.objectid = offsets.length;
    return ok([feature], offsets.length === 1);
  });
  assert.deepEqual(offsets, ['0','1']);
  assert.equal(result.features.length, 2);
});

test('pagination repetition and empty continuation fail rather than silently truncate', async () => {
  await assert.rejects(queryCounty(counties[0], CONFIG, async () => ok([record()], true)), /pagination/);
  await assert.rejects(queryCounty(counties[0], CONFIG, async () => ok([], true)), /pagination/);
});

test('nongeographic or missing coordinate reference with features is rejected', async () => {
  for (const spatialReference of [{ wkid:3857 }, undefined]) await assert.rejects(queryCounty(counties[0], CONFIG, async () => ({ ok:true, json:async () => ({ features:[record()], spatialReference }) })), /coordinate system/);
});

test('HTTP failure and ArcGIS JSON error are not empty successes', async () => {
  await assert.rejects(fetchJson('https://example.invalid', {}, 50, async () => ({ ok:false, status:503 })), /503/);
  await assert.rejects(fetchJson('https://example.invalid', {}, 50, async () => ({ ok:true, json:async () => ({ error:{ code:400 } }) })), /400/);
});

test('a stalled request times out', async () => {
  await assert.rejects(fetchJson('https://example.invalid', {}, 5, async (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))), /timed out/);
});

test('regional fetch waits for all five counties with bounded concurrency and deduplicates', async () => {
  let active = 0, maximum = 0, calls = 0;
  const result = await fetchRegionalAlerts(counties, CONFIG, async () => {
    active++; calls++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    return ok([record()]);
  }, () => now);
  assert.equal(calls, 5);
  assert.equal(maximum, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].counties.length, 5);
});

test('one failed county rejects the whole regional update', async () => {
  let calls = 0;
  await assert.rejects(fetchRegionalAlerts(counties, CONFIG, async () => ++calls === 2 ? { ok:false, status:502 } : ok(), () => now), /502/);
});

test('an incomplete region cannot be queried', async () => {
  await assert.rejects(fetchRegionalAlerts(counties.slice(1), CONFIG, async () => ok()), /incomplete/);
});
