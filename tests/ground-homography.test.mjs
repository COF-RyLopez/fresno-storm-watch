import test from 'node:test';
import assert from 'node:assert/strict';
import { squareToQuad } from '../site/lib/ground-homography.js';

test('square-to-quad homography hits the corners and matches a known perspective map', () => {
  const P = (s, t) => { const w = 1 + 0.3 * s - 0.2 * t; return [(100 + 50 * s + 10 * t) / w, (200 - 5 * s + 80 * t) / w]; };
  const H = squareToQuad([[0, 0], [1, 0], [1, 1], [0, 1]].flatMap(([s, t]) => P(s, t)));
  for (const [s, t] of [[0, 0], [1, 1], [3, -2], [-1.5, 4]]) {
    const [x, y] = H(s, t), [ex, ey] = P(s, t);
    assert.ok(Math.abs(x - ex) < 1e-9 && Math.abs(y - ey) < 1e-9, `${s},${t}`);
  }
});
