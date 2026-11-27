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
