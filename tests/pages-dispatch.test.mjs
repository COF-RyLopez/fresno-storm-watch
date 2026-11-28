import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../services/pages-dispatch/worker.mjs';

test('pages dispatcher posts a workflow_dispatch for main and fails loudly otherwise', async () => {
  let call;
  const ok = async (url, init) => { call = { url, init }; return new Response(null, { status: 204 }); };
  assert.equal(await dispatch({ GITHUB_TOKEN: 't' }, ok), 204);
  assert.equal(call.url, 'https://api.github.com/repos/COF-RyLopez/fresno-storm-watch/actions/workflows/pages.yml/dispatches');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(call.init.body), { ref: 'main' });
  await assert.rejects(dispatch({}, ok), /GITHUB_TOKEN/);
  await assert.rejects(dispatch({ GITHUB_TOKEN: 't' }, async () => new Response('nope', { status: 403 })), /403/);
});
