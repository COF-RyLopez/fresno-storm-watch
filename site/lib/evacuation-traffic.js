// Evacuation traffic: cars from an agent-based evacuation run (evac-engine), drawn on a canvas over a 2D MapView.
// Data per scenario and departure mode: data/evacuation/<id>/<mode>/meta.json + data.json (gzip+base64 typed arrays).
// No library: one canvas, redrawn on every clock tick and view change.

const R = 6378137;
export const toMercator = (lon, lat) => [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];

/** gzip+base64 text -> typed array. */
export async function decodeArray(b64, Type) {
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Type(await new Response(stream).arrayBuffer());
}

/**
 * Car positions at time ts (seconds after the failure begins), linearly interpolated between trace samples.
 * trips: { start: Uint32Array (first sample of each trip), xy: Float32Array|Float64Array (x, y per sample), t: Float32Array }.
 * Writes [x, y] per car on the road into out (Float64Array, 2 per trip) and returns the indices of those cars.
 */
export function positionsAt(trips, ts, out, on = []) {
  const { start, xy, t } = trips;
  on.length = 0;
  for (let i = 0; i < start.length; i++) {
    const a = start[i], b = (i + 1 < start.length ? start[i + 1] : t.length) - 1;
    if (ts < t[a] || ts > t[b]) continue;
    let lo = a, hi = b; // last sample at or before ts
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= ts) lo = m; else hi = m; }
    const f = t[hi] > t[lo] ? (ts - t[lo]) / (t[hi] - t[lo]) : 0;
    out[2 * i] = xy[2 * lo] + (xy[2 * hi] - xy[2 * lo]) * f;
    out[2 * i + 1] = xy[2 * lo + 1] + (xy[2 * hi + 1] - xy[2 * lo + 1]) * f;
    on.push(i);
  }
  return on;
}

/** Fetch one scenario + mode and convert positions to Web Mercator once. */
export async function loadTraffic(base) {
  const [meta, data] = await Promise.all([fetch(base + 'meta.json'), fetch(base + 'data.json')].map(p => p.then(r => {
    if (!r.ok) throw new Error(`${r.url}: ${r.status}`);
    return r.json();
  })));
  const [ll, t16, start, status] = await Promise.all([
    decodeArray(data.trip_xy, Float32Array), decodeArray(data.trip_t, Uint16Array),
    decodeArray(data.trip_start, Uint32Array), decodeArray(data.trip_status, Uint8Array)]);
  const xy = new Float64Array(ll.length);
  for (let k = 0; k < ll.length; k += 2) [xy[k], xy[k + 1]] = toMercator(ll[k], ll[k + 1]);
  return { meta, trips: { start, xy, t: Float32Array.from(t16) }, status, exits: meta.exits.map(([lon, lat]) => toMercator(lon, lat)) };
}

/** Canvas over the map; draw(traffic, seconds) paints cars with a short trail, plus exit points. */
export function createTrafficCanvas(view, Point) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  view.container.append(canvas);
  view.when(() => { const ui = view.container.querySelector('.esri-ui'); if (ui) ui.parentNode.insertBefore(canvas, ui); }); // under the map widgets
  const ctx = canvas.getContext('2d');
  let now = null, nowS = 0, pos = null, prev = null;
  const on = [], onPrev = [];
  function transform(sr) { // screen = A * (x, y) + c from three projected points, so rotation is handled
    const c = view.center, d = 1000;
    const p0 = view.toScreen(new Point({ x: c.x, y: c.y, spatialReference: sr }));
    const px = view.toScreen(new Point({ x: c.x + d, y: c.y, spatialReference: sr }));
    const py = view.toScreen(new Point({ x: c.x, y: c.y + d, spatialReference: sr }));
    return { a: (px.x - p0.x) / d, b: (py.x - p0.x) / d, c: (px.y - p0.y) / d, d: (py.y - p0.y) / d, x0: p0.x - (c.x * (px.x - p0.x) + c.y * (py.x - p0.x)) / d,
      y0: p0.y - (c.x * (px.y - p0.y) + c.y * (py.y - p0.y)) / d };
  }
  function draw(traffic = now, seconds = nowS) {
    now = traffic; nowS = seconds;
    const dpr = devicePixelRatio || 1, w = view.width, h = view.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sr = view.spatialReference; // read now: it is only known once the basemap has loaded
    if (!traffic || !view.center || !sr?.isWebMercator) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const T = transform(sr), sx = (x, y) => T.a * x + T.b * y + T.x0, sy = (x, y) => T.c * x + T.d * y + T.y0;
    const n = traffic.trips.start.length;
    if (!pos || pos.length !== 2 * n) { pos = new Float64Array(2 * n); prev = new Float64Array(2 * n); }
    positionsAt(traffic.trips, seconds, pos, on);
    positionsAt(traffic.trips, seconds - 60, prev, onPrev);
    const hadPrev = new Uint8Array(n);
    for (const i of onPrev) hadPrev[i] = 1;
    for (const [colour, caught] of [['rgba(255,181,71,0.9)', 0], ['rgba(255,93,115,0.95)', 1]]) {
      ctx.strokeStyle = colour; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const i of on) {
        if ((traffic.status[i] === 1) !== !!caught) continue;
        const x = sx(pos[2 * i], pos[2 * i + 1]), y = sy(pos[2 * i], pos[2 * i + 1]);
        if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        if (hadPrev[i]) ctx.moveTo(sx(prev[2 * i], prev[2 * i + 1]), sy(prev[2 * i], prev[2 * i + 1])); else ctx.moveTo(x - 0.5, y);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgb(126,240,196)'; ctx.strokeStyle = 'rgba(10,16,24,0.9)'; ctx.lineWidth = 1.2;
    for (const [x, y] of traffic.exits) {
      const X = sx(x, y), Y = sy(x, y);
      if (X < -10 || Y < -10 || X > w + 10 || Y > h + 10) continue;
      ctx.beginPath(); ctx.arc(X, Y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
  }
  return { draw, canvas };
}
