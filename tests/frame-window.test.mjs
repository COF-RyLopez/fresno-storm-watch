import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameWindow } from '../site/lib/frame-window.js';

test('only the frames on screen and the next one stay in the layer', () => {
  const layer = new Set();
  const elements = { add: e => layer.add(e), remove: e => layer.delete(e) };
  let made = 0;
  const show = createFrameWindow(elements, i => { made += 1; return { i, opacity: 0 }; }, 49);
  const state = () => [...layer].map(e => [e.i, e.opacity]).sort((a, b) => a[0] - b[0]);

  show(0, 1, 0.25);
  assert.deepEqual(state(), [[0, 0.75], [1, 0.25], [2, 0]]);
  show(1, 2, 0.5); // frame 0 leaves, 3 is preloaded
  assert.deepEqual(state(), [[1, 0.5], [2, 0.5], [3, 0]]);
  assert.equal(made, 4, 'frames already in the layer are reused');
  show(48, 48, 0); // last frame: nothing past the end
  assert.deepEqual(state(), [[48, 1]]);
  assert(layer.size <= 3);
});
