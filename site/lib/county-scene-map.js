/** Command's map in three.js: the same TerrainMap interface as watch-terrain-map.js (MapLibre), drawn on the shared
 *  county scene (lib/county3d). Polygons, lines and weather images are draped onto the terrain; points, gauges and labels
 *  are screen-sized markers standing on the ground. Selected with ?renderer=three while MapLibre stays the default.
 *  Plan: docs/county-3d-plan.md, phase 2. Not yet ported (no-ops here): GOES 3D cloud-top surface, Hanford radar points
 *  and volume, HRRR cloud volume and wind trails, which Command does not enable today. */
import * as THREE from '../vendor/three-0.187.0/three.module.js';
import { createCountyScene } from './county3d/core.js';
import { createDrape } from './county3d/drape.js';
import { COUNTY_BOUNDS, createFrame } from './county3d/frame.js';
import { gaugeIcon } from './command-gauge.js';
import { createMapPreview } from './map-preview.js';

const ML_TILE = 512, EARTH = 40075016.686; // MapLibre zoom: 512 px tiles
const empty = { type: 'FeatureCollection', features: [] };
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const rings = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const paths = g => !g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
const points = g => !g ? [] : g.type === 'Point' ? [g.coordinates] : g.type === 'MultiPoint' ? g.coordinates : [];

/** @param {import("../../command/src/module-contracts.ts").TerrainOptions} options
 *  @returns {Promise<Awaited<ReturnType<typeof import('./watch-terrain-map.js').createWatchTerrain>>>} */
export async function createWatchTerrain({ container, onSelect, onError, onCamera = () => {}, onInspect }) {
  const host = typeof container === 'string' ? document.getElementById(container) : container;
  if (!host) throw Error('Map container missing');
  host.style.position ||= 'relative';
  const frame = createFrame(COUNTY_BOUNDS), k = frame.k;

  // ---------- state shown on the map ----------
  let records = empty, triggers = [], snowPts = [], gustPts = [], basin = null, context = { counties: [], cities: null, burnScars: null };
  let contextKey, countiesRef, destroyed = false, overhead = false;
  const rasters = new Map(); // id -> {bitmap, coordinates, opacity}
  const RASTER_ORDER = ['snow-cover', 'goes', 'regional-radar', 'rain', 'gust', 'snowfall'];

  // ---------- drape painting: same order as the MapLibre style (weather under reference under records) ----------
  function paint(ctx, level) {
    const { project, linePx } = level;
    const pathOf = coords => { coords.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); };
    const polygon = (g, fill, stroke, width, dash = []) => {
      for (const poly of rings(g)) {
        ctx.beginPath(); poly.forEach(r => { pathOf(r); ctx.closePath(); });
        if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
        if (stroke) { ctx.setLineDash(dash.map(linePx)); ctx.lineWidth = linePx(width); ctx.strokeStyle = stroke; ctx.stroke(); ctx.setLineDash([]); }
      }
    };
    const line = (g, stroke, width, dash = []) => {
      ctx.setLineDash(dash.map(linePx)); ctx.lineWidth = linePx(width); ctx.strokeStyle = stroke; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const p of paths(g)) { ctx.beginPath(); pathOf(p); ctx.stroke(); }
      ctx.setLineDash([]);
    };
    for (const id of RASTER_ORDER) {
      const r = rasters.get(id);
      if (!r) continue;
      const [nw, , se] = r.coordinates, [ax, ay] = project(nw[0], nw[1]), [bx, by] = project(se[0], se[1]);
      ctx.globalAlpha = r.opacity; ctx.imageSmoothingEnabled = !r.nearest;
      ctx.drawImage(r.bitmap, ax, ay, bx - ax, by - ay);
      ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = true;
    }
    for (const f of context.burnScars?.features ?? []) polygon(f.geometry, 'rgba(205,169,134,.07)', '#cda986', 1.5, [2, 2]);
    for (const f of context.counties ?? []) {
      const fresno = f.properties?.GEOID === '06019';
      ctx.globalAlpha = 0.7; polygon(f.geometry, null, fresno ? '#d7dfe0' : '#8b9da6', fresno ? 2 : 1, [6, 3]); ctx.globalAlpha = 1;
    }
    for (const f of context.cities?.features ?? []) { ctx.globalAlpha = 0.7; polygon(f.geometry, null, '#b0c3bb', 1.1); ctx.globalAlpha = 1; }
    if (basin) polygon(basin.geometry, null, '#e4d8aa', 2, [3, 2]);
    for (const f of records.features) {
      const p = f.properties || {};
      if (!rings(f.geometry).length) continue;
      const c = p.color || '#9fb3bd';
      polygon(f.geometry, hexAlpha(c, 0.13), null, 0);
      if (p.kind === 'alert') { ctx.globalAlpha = 0.85; polygon(f.geometry, null, '#edf5fb', 4); ctx.globalAlpha = 1; }
      polygon(f.geometry, null, c, 2);
    }
    for (const f of records.features) {
      const p = f.properties || {};
      if (!paths(f.geometry).length) continue;
      if (p.kind === 'nws-corridor') line(f.geometry, p.color || '#7fd3e6', 3, [3, 2]);
      else if (p.detour) line(f.geometry, p.color || '#5fc9b6', 2.5, [2, 1.5]);
      else line(f.geometry, p.color || '#ffb547', 3);
    }
    for (const f of triggers) {
      if (paths(f.geometry).length) { ctx.globalAlpha = 0.85; line(f.geometry, '#ffce91', 5, f.properties?.detour ? [3, 2] : []); ctx.globalAlpha = 1; }
      if (rings(f.geometry).length) { ctx.globalAlpha = 0.85; polygon(f.geometry, null, '#ffce91', 5); ctx.globalAlpha = 1; }
    }
  }
  const drape = createDrape({ frame, paint });

  const county = createCountyScene({ container: host, bounds: COUNTY_BOUNDS, nightFloor: 0.6, terrain: { decorate: drape.decorate, detail: 0.9 } });
  const { scene, camera, controls, renderer } = county;
  const clock = setInterval(() => county.setTime(new Date()), 60_000); // the sun follows real time

  // ---------- screen-sized markers ----------
  const markers = new THREE.Group(); markers.renderOrder = 10; scene.add(markers);
  const textures = new Map();
  const texture = (key, draw) => {
    let t = textures.get(key);
    if (!t) { const c = document.createElement('canvas'); draw(c); t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; textures.set(key, t); }
    return t;
  };
  const dot = (color, r, stroke = '#ffffff') => texture(`dot:${color}:${r}:${stroke}`, c => {
    c.width = c.height = (r + 3) * 4; const g = c.getContext('2d'); g.scale(2, 2);
    g.beginPath(); g.arc(r + 3, r + 3, r, 0, 7); g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = stroke; g.stroke();
  });
  const ring = color => texture(`ring:${color}`, c => { c.width = c.height = 52; const g = c.getContext('2d'); g.beginPath(); g.arc(26, 26, 20, 0, 7); g.lineWidth = 6; g.strokeStyle = color; g.stroke(); });
  const diamond = color => texture(`diamond:${color}`, c => {
    c.width = c.height = 32; const g = c.getContext('2d'); g.beginPath(); g.moveTo(16, 2); g.lineTo(30, 16); g.lineTo(16, 30); g.lineTo(2, 16); g.closePath();
    g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = '#ffffff'; g.stroke();
  });
  const cross = color => texture(`cross:${color}`, c => {
    c.width = c.height = 36; const g = c.getContext('2d'); g.lineCap = 'round';
    for (const [w, s] of [[9, '#172126'], [5, color]]) { g.lineWidth = w; g.strokeStyle = s; g.beginPath(); g.moveTo(8, 8); g.lineTo(28, 28); g.moveTo(28, 8); g.lineTo(8, 28); g.stroke(); }
  });
  const label = (text, color = '#eef8ff', size = 13) => texture(`label:${size}:${color}:${text}`, c => {
    const lines = String(text).split('\n').slice(0, 3), g = c.getContext('2d'), font = `600 ${size * 2}px "Avenir Next", system-ui, sans-serif`;
    g.font = font; const w = Math.ceil(Math.max(...lines.map(l => g.measureText(l).width))) + 16, h = lines.length * size * 2.4 + 8;
    c.width = w; c.height = h; g.font = font; g.textAlign = 'center'; g.textBaseline = 'top'; g.lineJoin = 'round';
    lines.forEach((l, i) => { g.lineWidth = 6; g.strokeStyle = '#172126'; g.strokeText(l, w / 2, 4 + i * size * 2.4); g.fillStyle = color; g.fillText(l, w / 2, 4 + i * size * 2.4); });
  });
  /** @type {{sprite: THREE.Sprite, lon: number, lat: number, px: number, lift: number, record?: object, minDistance?: number}[]} */
  let placed = [];
  function marker(tex, lon, lat, { px, anchor = [0.5, 0.5], lift = 0, record, maxDistance = Infinity, order = 0 }) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
    sprite.center.set(anchor[0], anchor[1]); sprite.renderOrder = 10 + order;
    const aspect = tex.image.width / tex.image.height;
    markers.add(sprite);
    const m = { sprite, lon, lat, px, aspect, lift, record, maxDistance };
    placed.push(m);
    return m;
  }
  function rebuildMarkers() {
    for (const m of placed) { markers.remove(m.sprite); m.sprite.material.dispose(); }
    placed = [];
    for (const f of records.features) {
      const p = f.properties || {};
      for (const [lon, lat] of points(f.geometry)) {
        if (p.gaugeDisplay) {
          const key = 'gauge:' + JSON.stringify(p.gaugeDisplay);
          let t = textures.get(key);
          if (!t) { const img = gaugeIcon(p.gaugeDisplay), c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; textures.set(key, t); }
          marker(t, lon, lat, { px: 42, anchor: [0.5, 0], record: p, order: 3 });
          if (p.gaugeLabel || p.gaugeId) marker(label(`${p.gaugeLabel ?? ''}\n${p.gaugeId ?? ''}`.trim(), '#eef8ff', 11), lon, lat, { px: 26, anchor: [0.5, 1.05], record: p, maxDistance: 120_000, order: 2 });
        } else if (p.kind === 'facility') marker(diamond(p.color || '#b48ce8'), lon, lat, { px: 15, record: p, order: 1 });
        else if (p.kind === 'road') marker(cross(p.color || '#ff8a3d'), lon, lat, { px: 20, record: p, order: 1 });
        else marker(dot(p.color || '#9fb3bd', p.kind === 'facility' ? 5 : 7), lon, lat, { px: 18, record: p, order: 1 });
        if (!p.gaugeDisplay && p.name && p.kind !== 'gauge') marker(label(p.name, '#eef8ff', 12), lon, lat, { px: 20, anchor: [0.5, 1.4], record: p, maxDistance: 45_000 });
      }
      // Lines and polygons are draped; give lines a label anchor at their middle for close views
      if (p.kind === 'nws-corridor' && p.citation) { const path = paths(f.geometry)[0]; if (path) { const [lon, lat] = path[path.length >> 1]; marker(label(p.citation, '#bfe8f2', 11), lon, lat, { px: 20, maxDistance: 120_000 }); } }
    }
    for (const f of triggers) for (const [lon, lat] of points(f.geometry)) {
      marker(ring('#ffce91'), lon, lat, { px: 26, order: 4 });
      if (f.properties?.name) marker(label(f.properties.name, '#ffe5c4', 13), lon, lat, { px: 22, anchor: [0.5, -0.4], order: 4 });
    }
    for (const f of snowPts) for (const [lon, lat] of points(f.geometry)) {
      marker(dot('#cde8ff', 6, '#172126'), lon, lat, { px: 16, record: f.properties, order: 2 });
      if (f.properties?.label) marker(label(f.properties.label, '#eef8ff', 13), lon, lat, { px: 22, anchor: [0.5, -0.3], order: 2 });
    }
    for (const f of gustPts) for (const [lon, lat] of points(f.geometry)) {
      marker(dot(f.properties?.color || '#9fd2ff', 8, '#eef8ff'), lon, lat, { px: 20, record: f.properties, order: 2 });
      if (f.properties?.label) marker(label(f.properties.label, '#eef8ff', 13), lon, lat, { px: 22, anchor: [0.5, -0.3], order: 2 });
    }
  }
  const tan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  county.onFrame(() => {
    const H = host.clientHeight || 1, d = camera.position.distanceTo(controls.target);
    drape.track(controls.target.x, controls.target.z, d, (2 * d * tan()) / H);
    const unit = (2 * tan()) / H; // sprite scale per screen pixel (sizeAttenuation off)
    for (const m of placed) {
      const [x, z] = frame.project(m.lon, m.lat), g = county.terrain.groundAt(x, z) ?? 0;
      m.sprite.position.set(x, g + m.lift * k, z);
      m.sprite.scale.set(m.px * m.aspect * unit, m.px * unit, 1);
      m.sprite.visible = d / k < m.maxDistance;
    }
  });

  // ---------- camera: MapLibre-compatible {center, zoom, pitch, bearing} ----------
  const metresPerPx = (zoom, lat) => (EARTH * Math.cos(THREE.MathUtils.degToRad(lat))) / (ML_TILE * 2 ** zoom);
  const distanceFor = (zoom, lat) => (((host.clientHeight || 600) / 2) * metresPerPx(zoom, lat)) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  function currentCamera() {
    const t = controls.target, [lon, lat] = frame.unproject(t.x, t.z), off = camera.position.clone().sub(t), d = off.length() / k;
    const pitch = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, off.y / off.length())));
    const bearing = (THREE.MathUtils.radToDeg(Math.atan2(-off.x, off.z)) + 360) % 360;
    const zoom = Math.log2((EARTH * Math.cos(THREE.MathUtils.degToRad(lat)) * ((host.clientHeight || 600) / 2)) / (ML_TILE * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)));
    return { center: [lon, lat], zoom, pitch, bearing };
  }
  let tween = null;
  function fly(lon, lat, distance, pitch, bearing, ms) {
    const from = { t: controls.target.clone(), p: camera.position.clone() };
    county.view(lon, lat, distance, Math.max(pitch, 0.5), bearing);
    const to = { t: controls.target.clone(), p: camera.position.clone() };
    if (!ms || reduced()) { controls.update(); emitCamera(); return; }
    controls.target.copy(from.t); camera.position.copy(from.p);
    tween = { from, to, start: performance.now(), ms };
  }
  county.onFrame(now => {
    if (!tween) return;
    const u = Math.min(1, (now - tween.start) / tween.ms), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    controls.target.lerpVectors(tween.from.t, tween.to.t, e); camera.position.lerpVectors(tween.from.p, tween.to.p, e);
    if (u === 1) { tween = null; emitCamera(); }
  });
  let cameraTimer = 0;
  const emitCamera = () => { clearTimeout(cameraTimer); cameraTimer = setTimeout(() => !destroyed && onCamera(currentCamera()), 250); };
  controls.addEventListener('end', emitCamera);
  controls.addEventListener('start', () => { tween = null; preview.remove(); });
  function fit(bounds, animate = true, padding) {
    const [w, s, e, n] = bounds, lon = (w + e) / 2, lat = (s + n) / 2;
    const pad = typeof padding === 'number' ? padding : padding ? Math.max(padding.top + padding.bottom, padding.left + padding.right) / 2 : 40;
    const W = Math.max(host.clientWidth - 2 * pad, 80), H = Math.max(host.clientHeight - 2 * pad, 80);
    const [x0, z0] = frame.project(w, n), [x1, z1] = frame.project(e, s), spanX = (x1 - x0) / k, spanZ = (z1 - z0) / k;
    const vfov = THREE.MathUtils.degToRad(camera.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * (W / H));
    const pitch = overhead ? 0 : 50;
    // fit the footprint; a tilted view needs a little more distance to keep the near edge in frame
    const distance = Math.max(spanX / (2 * Math.tan(hfov / 2)), (spanZ * Math.cos(THREE.MathUtils.degToRad(pitch * 0.6))) / (2 * Math.tan(vfov / 2))) * 1.12 * ((host.clientHeight || H) / H);
    fly(lon, lat, Math.max(distance, 400), pitch, currentCamera().bearing, animate ? 850 : 0);
  }

  // ---------- picking and hover ----------
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const preview = createMapPreview({ getContainer: () => host });
  function screenRay(event) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  const PRIORITY = { gauge: 0, gust: 1, road: 3, facility: 3 };
  function recordAt(event) {
    screenRay(event);
    const hits = raycaster.intersectObjects(placed.filter(m => m.record && m.sprite.visible).map(m => m.sprite), false);
    if (hits.length) {
      const m = placed.find(p => p.sprite === hits[0].object);
      return m.record;
    }
    const ground = raycaster.intersectObject(county.terrain.group, true)[0];
    if (!ground) return null;
    const [lon, lat] = frame.unproject(ground.point.x, ground.point.z), d = camera.position.distanceTo(ground.point);
    const tolerance = ((6 * 2 * d * tan()) / (host.clientHeight || 1)) / k; // 6 screen px in ground metres
    const near = (a, b) => { const [ax, az] = frame.project(...a), [bx, bz] = frame.project(...b); return [ax, az, bx, bz]; };
    const [px, pz] = frame.project(lon, lat);
    let best = null;
    for (const f of records.features) {
      const p = f.properties || {};
      for (const path of paths(f.geometry)) for (let i = 1; i < path.length; i++) {
        const [ax, az, bx, bz] = near(path[i - 1], path[i]), dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
        const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
        const dist = Math.hypot(px - ax - t * dx, pz - az - t * dz) / k;
        if (dist < tolerance && (!best || dist < best.dist)) best = { p, dist };
      }
    }
    if (best) return best.p;
    const inside = (poly) => { let c = false; for (const ring of poly) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const polys = records.features.filter(f => rings(f.geometry).some(inside)).map(f => f.properties || {});
    return polys.sort((a, b) => (PRIORITY[a.kind] ?? 5) - (PRIORITY[b.kind] ?? 5))[0] ?? null;
  }
  let down = null, hoverFrame = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    preview.remove();
    const record = recordAt(e);
    if (!record) return;
    if (record.readout) onInspect ? onInspect(record) : null;
    else onSelect(record);
  });
  canvas.addEventListener('pointermove', e => {
    if (!matchMedia('(hover: hover)').matches || e.buttons) return;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => {
      const record = recordAt(e), at = screenRay(e);
      if (record?.name) { canvas.style.cursor = 'pointer'; preview.show(record.readout || record.hoverText || record.name, at); }
      else { canvas.style.cursor = ''; preview.remove(); }
    });
  });
  canvas.addEventListener('pointerleave', () => { preview.remove(); canvas.style.cursor = ''; });

  // ---------- attribution ----------
  const credit = Object.assign(document.createElement('div'), { className: 'county3d-credit',
    textContent: 'Terrain: Mapzen/AWS Terrarium · Imagery: Esri, Maxar, Earthstar Geographics · 3D renderer preview' });
  credit.style.cssText = 'position:absolute;right:6px;bottom:4px;font:11px system-ui;color:#dfe7ea;background:rgba(23,33,38,.72);padding:2px 6px;border-radius:3px;pointer-events:none';
  host.append(credit);

  // ---------- weather rasters: Mercator PNG + four corners, drawn into the drape ----------
  async function setRaster(id, image, opacity, nearest = false) {
    if (destroyed) return false;
    if (!image?.blob) { rasters.get(id)?.bitmap.close?.(); rasters.delete(id); drape.invalidate(); return true; }
    try {
      const bitmap = await createImageBitmap(image.blob);
      if (destroyed) { bitmap.close(); return false; }
      rasters.get(id)?.bitmap.close?.();
      rasters.set(id, { bitmap, coordinates: image.coordinates, opacity, nearest });
      drape.invalidate();
      return true;
    } catch (error) { onError?.(error); return false; }
  }

  const noop = () => {};
  return {
    set(data) { if (destroyed) return; records = data || empty; rebuildMarkers(); drape.invalidate(); },
    focus(bounds, animate = true, padding) { if (!destroyed) fit(bounds, animate, padding); },
    overhead(value) {
      overhead = value; const c = currentCamera();
      fly(c.center[0], c.center[1], camera.position.distanceTo(controls.target) / k, value ? 0 : 50, c.bearing, reduced() ? 0 : 400);
    },
    restore(view) { if (destroyed || !view) return; const [lon, lat] = view.center; fly(lon, lat, distanceFor(view.zoom, lat), view.pitch ?? 0, view.bearing ?? 0, 0); },
    resize() {},
    watershed(feature) { basin = feature || null; drape.invalidate(); },
    context({ key, counties, cities, burnScars }) {
      if (destroyed || (key === contextKey && counties === countiesRef)) return;
      contextKey = key; countiesRef = counties; context = { counties: counties || [], cities, burnScars }; drape.invalidate();
    },
    highlightTriggers(features) { triggers = features || []; rebuildMarkers(); drape.invalidate(); },
    snowPoints(features) { snowPts = features || []; rebuildMarkers(); },
    gustPoints(features) { gustPts = features || []; rebuildMarkers(); },
    viewBounds() {
      const out = [];
      for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        raycaster.setFromCamera(ndc.set(x, y), camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -controls.target.y), hit = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(plane, hit)) hit.copy(raycaster.ray.at(camera.position.distanceTo(controls.target) * 4, hit));
        out.push(frame.unproject(hit.x, hit.z));
      }
      const lons = out.map(p => p[0]), lats = out.map(p => p[1]);
      return [Math.max(-180, Math.min(...lons)), Math.max(-85, Math.min(...lats)), Math.min(180, Math.max(...lons)), Math.min(85, Math.max(...lats))];
    },
    rain(image) { return setRaster('rain', image, 0.55); },
    gust(image) { return setRaster('gust', image, 0.42, true); },
    snowCover(image) { setRaster('snow-cover', image, 0.6, true); },
    snowfall(image) { return setRaster('snowfall', image, 0.65, true); },
    regionalRadar(image) { return setRaster('regional-radar', image, 0.65); },
    cloud(image) { setRaster('goes', image, 0.55); },
    // Not yet ported to three.js (Command does not enable them): report "not displayed".
    cloudTops(vertices) { return vertices?.length ? Promise.resolve(false) : undefined; },
    radar: noop, radarVolume: noop, forecastClouds: noop, forecastWind: noop,
    destroy() {
      if (destroyed) return; destroyed = true;
      clearInterval(clock); clearTimeout(cameraTimer); preview.destroy(); credit.remove(); drape.dispose();
      for (const r of rasters.values()) r.bitmap.close?.();
      for (const t of textures.values()) t.dispose();
      county.destroy();
    }
  };
}

function hexAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const v = parseInt(m[1], 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`;
}
