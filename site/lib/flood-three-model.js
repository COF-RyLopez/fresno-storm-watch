/** Pure helpers for flood-scenario-3js.js: footprint binaries, depth from the coloured depth PNGs, elevation tiles. */

/** footprints-3js.bin (already gunzipped) -> typed views; layout in scripts/build-flood-footprints-3js.py. */
export function parseFootprints(buffer) {
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'FP3J' || view.getUint32(4, true) !== 1) throw new Error('Not a footprints-3js v1 file');
  const n = view.getUint32(8, true), nv = view.getUint32(12, true);
  let at = 32;
  const take = (Type, count) => { const a = new Type(buffer, at, count); at += count * 4; return a; };
  const start = take(Uint32Array, n + 1), xy = take(Float32Array, 2 * nv), attr = take(Float32Array, 5 * n), fd = take(Int32Array, n);
  return { n, nv, origin: [view.getFloat64(16, true), view.getFloat64(24, true)], start, xy, attr, fd };
}

/** Depth (ft) of a legend colour: the nearest point on the legend's RGBA ramp. The depth PNGs are that ramp quantized to a
 *  64-colour palette (within ~2 RGBA units), so this recovers depth to about a quarter foot. Transparent is dry (0). */
export function legendDepth(legend) {
  const segs = legend.slice(1).map((b, k) => {
    const A = legend[k].rgba, d = b.rgba.map((v, i) => v - A[i]);
    return { A, d, dd: d.reduce((s, v) => s + v * v, 0), f0: legend[k].ft, f1: b.ft };
  });
  return (r, g, b, a) => {
    if (a === 0) return 0;
    const c = [r, g, b, a];
    let best = Infinity, ft = 0;
    for (const { A, d, dd, f0, f1 } of segs) {
      const u = Math.min(1, Math.max(0, c.reduce((s, v, i) => s + (v - A[i]) * d[i], 0) / dd));
      const e = c.reduce((s, v, i) => s + (v - A[i] - u * d[i]) ** 2, 0);
      if (e < best) { best = e; ft = f0 + u * (f1 - f0); }
    }
    return ft;
  };
}

export const DEPTH_STEPS_PER_FT = 12; // R8 depth texture: 0..21 ft in 1/12 ft steps

/** RGBA pixels of a depth PNG -> Uint8Array of depth * DEPTH_STEPS_PER_FT, one byte per pixel (each palette colour solved once). */
export function decodeDepth(rgba, toFt) {
  const out = new Uint8Array(rgba.length / 4), memo = new Map();
  for (let p = 0, q = 0; q < out.length; p += 4, q++) {
    if (rgba[p + 3] === 0) continue;
    const key = (rgba[p] << 24 | rgba[p + 1] << 16 | rgba[p + 2] << 8 | rgba[p + 3]) >>> 0;
    let v = memo.get(key);
    if (v === undefined) memo.set(key, v = Math.min(255, Math.max(1, Math.round(toFt(rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]) * DEPTH_STEPS_PER_FT))));
    out[q] = v;
  }
  return out;
}

const WORLD = 2 * Math.PI * 6378137, HALF = WORLD / 2;
/** XYZ tile columns/rows at zoom z covering an EPSG:3857 extent, and the extent those tiles span. */
export function tileRange({ xmin, ymin, xmax, ymax }, z) {
  const size = WORLD / 2 ** z;
  const x0 = Math.floor((xmin + HALF) / size), x1 = Math.floor((xmax + HALF) / size);
  const y0 = Math.floor((HALF - ymax) / size), y1 = Math.floor((HALF - ymin) / size);
  return { x0, x1, y0, y1, span: { xmin: x0 * size - HALF, xmax: (x1 + 1) * size - HALF, ymin: HALF - (y1 + 1) * size, ymax: HALF - y0 * size } };
}

/** Terrarium-encoded elevation tile pixel -> metres. */
export const terrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Bilinear sample of a row-major grid (row 0 = north) at fractional column u, row v. */
export function sampleGrid(grid, w, h, u, v) {
  const x = Math.min(Math.max(u, 0), w - 1), y = Math.min(Math.max(v, 0), h - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1), fx = x - x0, fy = y - y0;
  const top = grid[y0 * w + x0] * (1 - fx) + grid[y0 * w + x1] * fx, bottom = grid[y1 * w + x0] * (1 - fx) + grid[y1 * w + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Hip roof for a near-rectangular footprint, on its minimum-area bounding rectangle (so the eaves overhang the walls a
 *  little): 18 vertices [x, rise, z] (rise above the eaves), or null to keep a flat roof (irregular, many-sided or large
 *  footprints: mostly commercial). pts are [x, z] pairs; maxArea is in the same units squared. */
export function hipRoof(pts, { minFill = 0.88, maxVerts = 16, maxArea = 600, pitch = 5 / 12 } = {}) {
  const m = pts.length;
  if (m < 4 || m > maxVerts) return null;
  let area = 0;
  for (let i = 0; i < m; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % m]; area += x0 * z1 - x1 * z0; }
  area = Math.abs(area) / 2;
  if (area > maxArea) return null;
  let best = null;
  for (let i = 0; i < m; i++) { // the minimum-area rectangle has a side along one of the polygon's edges (convex hull edges suffice)
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % m], L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-9) continue;
    const u = [(x1 - x0) / L, (z1 - z0) / L], v = [-u[1], u[0]];
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of pts) {
      const a = x * u[0] + z * u[1], b = x * v[0] + z * v[1];
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const A = (a1 - a0) * (b1 - b0);
    if (!best || A < best.A) best = { A, u, v, ca: (a0 + a1) / 2, cb: (b0 + b1) / 2, ha: (a1 - a0) / 2, hb: (b1 - b0) / 2 };
  }
  if (!best || area / best.A < minFill) return null;
  let { u, v, ca, cb, ha, hb } = best;
  const c = [u[0] * ca + v[0] * cb, u[1] * ca + v[1] * cb];
  if (ha < hb) [u, v, ha, hb] = [v, u, hb, ha]; // ridge along the long axis
  const rise = hb * pitch, r = ha - hb;
  const P = (a, b, y = 0) => [c[0] + u[0] * a + v[0] * b, y, c[1] + u[1] * a + v[1] * b];
  const [ppp, pmp, ppm, pmm, rp, rm] = [P(ha, hb), P(-ha, hb), P(ha, -hb), P(-ha, -hb), P(r, 0, rise), P(-r, 0, rise)];
  return new Float32Array([ppp, pmp, rm, ppp, rm, rp, ppm, pmm, rm, ppm, rm, rp, ppm, ppp, rp, pmm, pmp, rm].flat());
}
