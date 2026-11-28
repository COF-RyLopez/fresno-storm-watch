/**
 * Pack the county's Overture building footprints (site/data/power-buildings/<release>/, 0.05° JSON tiles) into XYZ zoom-13
 * binary tiles for the three.js county scene, written to site/data/county3d/buildings/ (git-ignored) for upload to the
 * R2 bucket fsw-county-3d (scripts/upload-county3d.mjs). Layout of each tile, little-endian, then gzip:
 *   b'BLD1' uint32 version=1 uint32 n uint32 nv float64 ox float64 oy  (32-byte header; origin = tile's Web Mercator centre)
 *   uint32 ring_start[n+1] | float32 xy[2 nv] (Mercator metres from origin, outer ring, no repeated end point)
 *   float32 height_m[n] (Overture height; NaN = unknown)
 * Usage: node scripts/build-county3d-buildings.mjs [--release 2026-10-21.0]
 */
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

const ROOT = new URL('../site/data/', import.meta.url), Z = 13, R = 6378137, HALF = Math.PI * R;
const mx = lon => (R * lon * Math.PI) / 180, my = lat => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const tileOf = (x, y) => [Math.floor(((x + HALF) / (2 * HALF)) * 2 ** Z), Math.floor(((HALF - y) / (2 * HALF)) * 2 ** Z)];

export function packTile(z, tx, ty, buildings) {
  const size = (2 * HALF) / 2 ** z, ox = -HALF + (tx + 0.5) * size, oy = HALF - (ty + 0.5) * size;
  const nv = buildings.reduce((s, b) => s + b.ring.length, 0), n = buildings.length;
  const buf = new ArrayBuffer(32 + 4 * (n + 1) + 8 * nv + 4 * n), view = new DataView(buf);
  [66, 76, 68, 49].forEach((c, i) => view.setUint8(i, c)); // 'BLD1'
  view.setUint32(4, 1, true); view.setUint32(8, n, true); view.setUint32(12, nv, true); view.setFloat64(16, ox, true); view.setFloat64(24, oy, true);
  const start = new Uint32Array(buf, 32, n + 1), xy = new Float32Array(buf, 32 + 4 * (n + 1), 2 * nv), height = new Float32Array(buf, 32 + 4 * (n + 1) + 8 * nv, n);
  let v = 0;
  buildings.forEach((b, i) => {
    start[i] = v;
    for (const [x, y] of b.ring) { xy[2 * v] = x - ox; xy[2 * v + 1] = y - oy; v++; }
    height[i] = Number.isFinite(b.height) && b.height > 0 ? b.height : NaN;
  });
  start[n] = v;
  return new Uint8Array(buf);
}

async function main() {
  const args = process.argv.slice(2), release = args[args.indexOf('--release') + 1] || (await readdir(new URL('power-buildings/', ROOT))).filter(n => /^\d{4}-/.test(n)).sort().at(-1);
  const src = new URL(`power-buildings/${release}/`, ROOT), out = new URL('county3d/buildings/', ROOT);
  const tiles = new Map(); let count = 0, withHeight = 0;
  for (const file of (await readdir(src)).filter(f => f.endsWith('.json.gz'))) {
    const { rows } = JSON.parse(gunzipSync(await readFile(new URL(file, src))));
    for (const r of rows) {
      let ring = r.geometry?.rings?.[0];
      if (!ring || ring.length < 4) continue;
      if (ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
      const merc = ring.map(([lon, lat]) => [mx(lon), my(lat)]);
      const cx = merc.reduce((s, p) => s + p[0], 0) / merc.length, cy = merc.reduce((s, p) => s + p[1], 0) / merc.length;
      const key = tileOf(cx, cy).join('/'); // each building goes to the tile holding its centre: no duplicates across tiles
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push({ ring: merc, height: r.height });
      count++; if (Number.isFinite(r.height) && r.height > 0) withHeight++;
    }
  }
  await rm(out, { recursive: true, force: true });
  let bytes = 0;
  const index = [];
  for (const [key, list] of tiles) {
    const [tx, ty] = key.split('/').map(Number), blob = gzipSync(packTile(Z, tx, ty, list), { level: 9 });
    await mkdir(new URL(`${Z}/${tx}/`, out), { recursive: true });
    await writeFile(new URL(`${Z}/${tx}/${ty}.bin.gz`, out), blob);
    bytes += blob.length; index.push([tx, ty, list.length]);
  }
  const manifest = { schemaVersion: 1, kind: 'county3d-buildings', format: 'BLD1 (scripts/build-county3d-buildings.mjs)', zoom: Z,
    source: `Overture Maps Foundation buildings, release ${release}, via site/data/power-buildings`, license: 'ODbL-1.0 (OpenStreetMap-derived) and CDLA-Permissive-2.0; © OpenStreetMap contributors, Overture Maps Foundation',
    generatedAt: new Date().toISOString(), buildings: count, withHeight, bytes, tiles: index };
  await writeFile(new URL('manifest.json', out), JSON.stringify(manifest));
  console.log(`${count} buildings (${withHeight} with height) in ${index.length} z${Z} tiles, ${(bytes / 1e6).toFixed(1)} MB gzipped`);
}
if (import.meta.main) await main();
