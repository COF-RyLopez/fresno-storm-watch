// Flood depth from a stormwatch-flood Zarr store, drawn into a canvas shown through a MediaLayer.
// The store holds depth[time, y, x] (UInt16, scale_factor ft per unit, 0 = dry) in spatial tiles that each carry
// every hour, and arrival[y, x] (minutes until depth first reached 0.1 ft, from every 5-minute RAS step; 65535 never).
// Each pixel appears once the clock passes its arrival, with depth blended between the hours around it, so the
// water and its front spread continuously instead of stepping hour by hour. All tiles load once; playback never fetches.
import { openArray } from './zarr-lite.js?v=0.60.0';

const NEVER = 65535;
const FRONT = (230 << 24) | (0 << 16) | (176 << 8) | 255; // #ffb000 at 0.9, little-endian RGBA as the LUT
const REDRAW_MS = 40; // Limit canvas redraws to about 25 per second; tile larger stores.
const STEPS_PER_HOUR = 12; // arrival times come from 5-minute RAS steps, so nothing finer is drawn

/**
 * url: the store; elements: the MediaLayer's element collection; makeElement(canvas) -> ImageElement;
 * legend: [{ft, rgba}] colour stops. Returns { show(i0, i1, w, t), depthAt(x, y, i0, i1, w, t) }: frames i0/i1 and
 * weight w around model hour t (lib/flood-scenario-model.js blend), x/y in the store's CRS.
 * ponytail: every tile of the model area is fetched up front; fetch only tiles in view for county-sized runs.
 */
export async function createZarrFrames(url, elements, makeElement, legend) {
  const [group, depth, arrivalArray, time] = await Promise.all([fetch(new URL('zarr.json', url)).then(r => r.json()),
    openArray(new URL('depth', url).href), openArray(new URL('arrival', url).href), openArray(new URL('time', url).href)]);
  const [, H, W] = depth.shape;
  const [, TH, TW] = depth.chunkShape;
  const [st, sy, sx] = depth.strides;
  const scale = depth.meta.attributes.scale_factor;
  const frameMinute = Array.from(await time.chunk([0]), h => h * 60);
  const reachedDepth = Math.round(arrivalArray.meta.attributes.threshold_ft / scale); // stored value at arrival (0.1 ft)
  const { xmin, xmax, ymin, ymax } = group.attributes.extent;
  const cols = Math.ceil(W / TW);
  const keys = Array.from({ length: Math.ceil(H / TH) * cols }, (_, k) => [Math.floor(k / cols), k % cols]);
  const [tiles, arrivalTiles] = await Promise.all([
    Promise.all(keys.map(([ty, tx]) => depth.chunk([0, ty, tx]).then(d => ({ ty, tx, d })))), // d null: all dry
    Promise.all(keys.map(k => arrivalArray.chunk(k)))
  ]);
  // arrival as one W x H image: the front compares each pixel with its neighbours across tile edges
  const arrival = new Uint16Array(W * H).fill(NEVER);
  const [ATH, ATW] = arrivalArray.chunkShape;
  keys.forEach(([ty, tx], k) => {
    const a = arrivalTiles[k];
    if (!a) return;
    for (let y = 0; y < Math.min(ATH, H - ty * ATH); y++)
      arrival.set(a.subarray(y * ATW, y * ATW + Math.min(ATW, W - tx * ATW)), (ty * ATH + y) * W + tx * ATW);
  });

  // colour for every stored value (0 = transparent), as little-endian RGBA in a Uint32
  const lut = new Uint32Array(65536);
  for (let v = 1; v < 65536; v++) {
    const x = Math.min(v * scale, legend.at(-1).ft);
    const i = Math.min(legend.findLastIndex(s => s.ft <= x), legend.length - 2);
    const f = (x - legend[i].ft) / (legend[i + 1].ft - legend[i].ft);
    const [r, g, b, a] = legend[i].rgba.map((c, k) => Math.round(c + f * (legend[i + 1].rgba[k] - c)));
    lut[v] = (a << 24) | (b << 16) | (g << 8) | r;
  }
  // stored depth at `minute`: hidden before arrival; where frame i0 was still dry, rising from the arrival depth at the
  // arrival time to frame i1; otherwise blended between frames i0 and i1 (at least 0.01 ft while wet)
  const valueAt = (d, s, a, i0, i1, w, minute) => {
    if (a > minute || !d) return 0;
    const d0 = d[s + i0 * st], d1 = d[s + i1 * st];
    if (!d0 && !d1) return 0;
    if (!d0 && a > frameMinute[i0] && frameMinute[i1] > a)
      return Math.max(reachedDepth, Math.round(reachedDepth + ((d1 - reachedDepth) * (minute - a)) / (frameMinute[i1] - a)));
    return Math.max(1, Math.round(d0 + (d1 - d0) * w));
  };
  // edge of the area reached by `minute`, two pixels (~4 m) wide on the wet side, as the old hourly front outline
  const reached = (o, minute) => arrival[o] <= minute;
  function onFront(o, x, y, minute) {
    for (let r = 1; r <= 2; r++)
      if ((x >= r && !reached(o - r, minute)) || (x + r < W && !reached(o + r, minute))
        || (y >= r && !reached(o - r * W, minute)) || (y + r < H && !reached(o + r * W, minute))) return true;
    return false;
  }
  // one pixel buffer and three canvases, reused: two elements on screen (see below) plus the one being drawn
  const img = new ImageData(W, H);
  const px = new Uint32Array(img.data.buffer);
  const canvases = Array.from({ length: 3 }, () => Object.assign(document.createElement('canvas'), { width: W, height: H }));
  let drawn = 0;
  function draw(i0, i1, w, minute) {
    px.fill(0);
    for (const { ty, tx, d } of tiles) {
      if (!d) continue;
      const x0 = tx * TW, y0 = ty * TH, cw = Math.min(TW, W - x0), ch = Math.min(TH, H - y0);
      for (let y = 0; y < ch; y++) {
        for (let x = 0, o = (y0 + y) * W + x0, s = y * sy; x < cw; x++, o++, s += sx) {
          const a = arrival[o];
          if (a > minute) continue;
          px[o] = onFront(o, x0 + x, y0 + y, minute) ? FRONT : lut[valueAt(d, s, a, i0, i1, w, minute)];
        }
      }
    }
    const canvas = canvases[drawn++ % canvases.length];
    canvas.getContext('2d').putImageData(img, 0, 0);
    return canvas;
  }

  // One element on screen, replaced on each redraw. The old one stays a redraw longer, under the new one, so the
  // layer never shows a gap while the new canvas uploads (swapping the image of an element in place does not redraw).
  let shown = [];
  let pending = null;
  let pendingKey = '';
  let timer = 0;
  let drawnAt = -Infinity;
  function flush() {
    timer = 0;
    drawnAt = performance.now();
    const el = makeElement(draw(...pending));
    el.opacity = 1;
    elements.add(el);
    shown.push(el);
    while (shown.length > 2) elements.remove(shown.shift());
  }
  return {
    show(i0, i1, w, t) {
      const step = Math.floor(t * STEPS_PER_HOUR + 1e-9), ws = Math.floor(w * STEPS_PER_HOUR + 1e-9) / STEPS_PER_HOUR;
      const key = `${i0} ${i1} ${ws} ${step}`;
      if (key === pendingKey) return;
      pendingKey = key;
      pending = [i0, i1, ws, (step * 60) / STEPS_PER_HOUR];
      if (!timer) timer = setTimeout(flush, Math.max(0, REDRAW_MS - (performance.now() - drawnAt)));
    },
    /** depth in ft at map coordinates x, y at model hour t; null outside the store */
    depthAt(x, y, i0, i1, w, t) {
      const col = Math.floor(((x - xmin) / (xmax - xmin)) * W), row = Math.floor(((ymax - y) / (ymax - ymin)) * H);
      if (col < 0 || row < 0 || col >= W || row >= H) return null;
      const tile = tiles[Math.floor(row / TH) * cols + Math.floor(col / TW)];
      return valueAt(tile.d, (row % TH) * sy + (col % TW) * sx, arrival[row * W + col], i0, i1, w, t * 60) * scale;
    }
  };
}
