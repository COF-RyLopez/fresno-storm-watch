import test from 'node:test';
import assert from 'node:assert/strict';
import { packTile } from '../scripts/build-county3d-buildings.mjs';

test('BLD1 tiles: header, ring starts, origin-relative coordinates and NaN for unknown heights', async () => {
  globalThis.location ??= { href: 'http://localhost/' }; // buildings.js reads it only inside createBuildings
  const { parseBuildings } = await import('../site/lib/county3d/buildings.js');
  const Z = 13, size = (2 * Math.PI * 6378137) / 2 ** Z, tx = 1370, ty = 3195;
  const ox = -Math.PI * 6378137 + (tx + 0.5) * size, oy = Math.PI * 6378137 - (ty + 0.5) * size;
  const square = [[ox, oy], [ox + 10, oy], [ox + 10, oy + 10], [ox, oy + 10]], tri = [[ox + 50, oy], [ox + 60, oy], [ox + 55, oy + 8]];
  const bytes = packTile(Z, tx, ty, [{ ring: square, height: 12 }, { ring: tri, height: null }]);
  const t = parseBuildings(bytes.buffer);
  assert.equal(t.n, 2); assert.equal(t.nv, 7);
  assert.deepEqual([...t.start], [0, 4, 7]);
  assert.deepEqual(t.origin, [ox, oy]);
  assert.deepEqual([...t.xy.slice(0, 4)], [0, 0, 10, 0]);
  assert.equal(t.height[0], 12); assert.ok(Number.isNaN(t.height[1]));
  assert.throws(() => parseBuildings(new Uint8Array(32).buffer), /BLD1/);
});
