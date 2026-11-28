import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithRetry, backoffMs, retryAfterMs } from '../site/lib/county3d/fetch-retry.js';

const reply = (status, headers = {}) => new Response(status === 200 ? 'tile' : '', { status, headers });
/** A fetch that plays back `script` (statuses, or Errors to throw) and records calls; sleeps are recorded, not waited. */
function harness(script) {
  const calls = [], sleeps = [];
  const fetchImpl = async url => { calls.push(String(url)); const s = script[calls.length - 1]; if (s instanceof Error) throw s; return reply(...[].concat(s)); };
  return { calls, sleeps, opts: { fetchImpl, sleep: async ms => { sleeps.push(ms); }, random: () => 1 } };
}

test('fetchWithRetry: retries 429 and network errors with growing delays, then returns the tile', async () => {
  const h = harness([429, new TypeError('Failed to fetch'), 503, 200]);
  const retries = [];
  const r = await fetchWithRetry('https://r2.example/13/1/2.bin.gz', undefined, { ...h.opts, baseDelay: 100, onRetry: i => retries.push(i.status ?? i.error.name) });
  assert.equal(await r.text(), 'tile');
  assert.equal(h.calls.length, 4);
  assert.deepEqual(h.sleeps, [100, 200, 400]);
  assert.deepEqual(retries, [429, 'TypeError', 503]);
});

test('fetchWithRetry: honours Retry-After on a 429', async () => {
  const h = harness([[429, { 'Retry-After': '3' }], 200]);
  await fetchWithRetry('u', undefined, { ...h.opts, baseDelay: 100 });
  assert.deepEqual(h.sleeps, [3000]);
});

test('fetchWithRetry: a 404 fails at once, and a lasting 429 fails after the retry budget', async () => {
  const missing = harness([404]);
  await assert.rejects(fetchWithRetry('u', undefined, missing.opts), e => e.status === 404);
  assert.equal(missing.calls.length, 1);

  const limited = harness([429, 429, 429]);
  await assert.rejects(fetchWithRetry('u', undefined, { ...limited.opts, retries: 2 }), e => e.status === 429 && /after 3 tries/.test(e.message));
  assert.equal(limited.calls.length, 3);

  const offline = harness([new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]);
  await assert.rejects(fetchWithRetry('u', undefined, { ...offline.opts, retries: 1 }), TypeError);
});

test('backoff: jitter stays within half to full of the exponential step, capped', () => {
  assert.equal(backoffMs(0, { baseDelay: 500, random: () => 0 }), 250);
  assert.equal(backoffMs(2, { baseDelay: 500, random: () => 1 }), 2000);
  assert.equal(backoffMs(10, { baseDelay: 500, maxDelay: 15_000, random: () => 1 }), 15_000);
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(retryAfterMs('soon'), null);
});
