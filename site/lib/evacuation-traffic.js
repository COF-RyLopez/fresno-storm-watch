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
 * With seg (Int32Array, 1 per trip), also records the sample each car is past, for drawing trails along the path.
 */
export function positionsAt(trips, ts, out, on = [], seg = null) {
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
    if (seg) seg[i] = lo;
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
  // Web Mercator metres relative to the first point, in Float32 (metre precision, half the memory of absolute Float64)
  const origin = ll.length ? toMercator(ll[0], ll[1]) : [0, 0];
  const xy = new Float32Array(ll.length);
  for (let k = 0; k < ll.length; k += 2) { const [x, y] = toMercator(ll[k], ll[k + 1]); xy[k] = x - origin[0]; xy[k + 1] = y - origin[1]; }
  const exits = meta.exits.map(([lon, lat]) => { const [x, y] = toMercator(lon, lat); return [x - origin[0], y - origin[1]]; });
  return { meta, origin, trips: { start, xy, t: Float32Array.from(t16) }, status, exits };
}

/**
 * Canvas over the map; draw(traffic, seconds) paints cars with a short trail, plus exit points, and returns true when it drew.
 * project(origin) returns (x, y) => [screen x, screen y, w] for positions relative to origin (w <= 0: not drawn), or null
 * when the view cannot be drawn yet; the default is the 2D MapView's affine. fullSize sizes the canvas by CSS alone.
 */
export function createTrafficCanvas(view, Point, { project, fullSize = false, carColour = 'rgba(255,181,71,0.9)', lineWidth = 2.5 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', ...(fullSize && { width: '100%', height: '100%' }), pointerEvents: 'none' });
  view.container.append(canvas);
  view.when(() => { const ui = view.container.querySelector('.esri-ui'); if (ui) ui.parentNode.insertBefore(canvas, ui); }); // under the map widgets
  const ctx = canvas.getContext('2d');
  const TRAIL_S = 30; // trail length, model seconds
  let now = null, nowS = 0, pos = null, prev = null, seg = null, segPrev = null;
  const on = [], onPrev = [];
  function transform(sr) { // screen = A * (x, y) + c from three projected points, so rotation is handled
    const c = view.center, d = 1000;
    const p0 = view.toScreen(new Point({ x: c.x, y: c.y, spatialReference: sr }));
    const px = view.toScreen(new Point({ x: c.x + d, y: c.y, spatialReference: sr }));
    const py = view.toScreen(new Point({ x: c.x, y: c.y + d, spatialReference: sr }));
    return { a: (px.x - p0.x) / d, b: (py.x - p0.x) / d, c: (px.y - p0.y) / d, d: (py.y - p0.y) / d, x0: p0.x - (c.x * (px.x - p0.x) + c.y * (py.x - p0.x)) / d,
      y0: p0.y - (c.x * (px.y - p0.y) + c.y * (py.y - p0.y)) / d };
  }
  project ??= ([ox, oy]) => {
    const sr = view.spatialReference; // read now: it is only known once the basemap has loaded
    if (!view.center || !sr?.isWebMercator) return null;
    const T = transform(sr); // positions are relative to traffic.origin
    const X0 = T.x0 + T.a * ox + T.b * oy, Y0 = T.y0 + T.c * ox + T.d * oy;
    return (x, y) => [T.a * x + T.b * y + X0, T.c * x + T.d * y + Y0, 1];
  };
  function draw(traffic = now, seconds = nowS) {
    now = traffic; nowS = seconds;
    const dpr = Math.min(devicePixelRatio || 1, 2), w = view.width, h = view.height; // 3x phone screens: 2x is plenty for lines
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      if (!fullSize) { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; } // fullSize: a px size here fed a SceneView scrollbar resize loop
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const S = traffic && project(traffic.origin);
    if (!S) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = traffic.trips.start.length;
    if (!pos || pos.length !== 2 * n) { pos = new Float64Array(2 * n); prev = new Float64Array(2 * n); seg = new Int32Array(n); segPrev = new Int32Array(n); }
    positionsAt(traffic.trips, seconds, pos, on, seg);
    positionsAt(traffic.trips, seconds - TRAIL_S, prev, onPrev, segPrev);
    const hadPrev = new Uint8Array(n);
    for (const i of onPrev) hadPrev[i] = 1;
    const { start, xy } = traffic.trips;
    for (const [colour, caught] of [[carColour, 0], ['rgba(255,93,115,0.95)', 1]]) {
      ctx.strokeStyle = colour; ctx.lineWidth = lineWidth; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const i of on) {
        if ((traffic.status[i] === 1) !== !!caught) continue;
        const [x, y, z] = S(pos[2 * i], pos[2 * i + 1]);
        if (z <= 0 || x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
        // trail follows the recorded path: from TRAIL_S ago (or the trip start) through every sample passed since
        const k0 = hadPrev[i] ? segPrev[i] : start[i];
        const [mx, my] = hadPrev[i] ? S(prev[2 * i], prev[2 * i + 1]) : S(xy[2 * k0], xy[2 * k0 + 1]);
        ctx.moveTo(mx, my);
        for (let k = k0 + 1; k <= seg[i]; k++) { const [kx, ky] = S(xy[2 * k], xy[2 * k + 1]); ctx.lineTo(kx, ky); }
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgb(126,240,196)'; ctx.strokeStyle = 'rgba(10,16,24,0.9)'; ctx.lineWidth = 1.2;
    for (const [x, y] of traffic.exits) {
      const [X, Y, z] = S(x, y);
      if (z <= 0 || X < -10 || Y < -10 || X > w + 10 || Y > h + 10) continue;
      ctx.beginPath(); ctx.arc(X, Y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    return true;
  }
  return { draw, canvas };
}
