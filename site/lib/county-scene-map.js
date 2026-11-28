/** Command's map in three.js: the same TerrainMap interface as watch-terrain-map.js (MapLibre), drawn on the shared
 *  county scene (lib/county3d). Polygons, lines and weather images are draped onto the terrain; points, gauges and labels
 *  are screen-sized markers standing on the ground. Selected with ?renderer=three while MapLibre stays the default.
 *  Plan: docs/county-3d-plan.md, phase 2. Not yet ported (no-ops here): GOES 3D cloud-top surface, Hanford radar points
 *  and volume, HRRR cloud volume and wind trails, which Command does not enable today. */
import * as THREE from '../vendor/three-0.187.0/three.module.js';
import { createCountyScene } from './county3d/core.js';
import { createDrape } from './county3d/drape.js';
import { COUNTY_BOUNDS, createFrame } from './county3d/frame.js';
import { IMAGERY, USGS_IMAGERY } from './county3d/terrain.js';
import { createBuildings } from './county3d/buildings.js';
import { CONFIG } from '../config.js';
import { gaugeIcon } from './command-gauge.js';
import { createMapPreview } from './map-preview.js';
import { cloudTopHeightBand } from './cloud-top-style.js';
import { cloudTopReadout } from './cloud-top-inspection.js';
import { RADAR_BANDS } from './hanford-radar-data.js';

const ML_TILE = 512, EARTH = 40075016.686; // MapLibre zoom: 512 px tiles
const CREDIT = 'Terrain: Mapzen/AWS Terrarium · Imagery: USGS The National Map (NAIP); Esri, Maxar where unavailable · Buildings: © OpenStreetMap contributors, Overture Maps Foundation · 3D renderer preview';
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
    // The selected place: a dark-edged white halo under its own colour, so it reads against imagery, weather and night.
    for (const f of records.features) {
      const p = f.properties || {};
      if (!p.selected) continue;
      const c = p.color || '#ffce91';
      if (rings(f.geometry).length) { polygon(f.geometry, hexAlpha(c, 0.2), null, 0); polygon(f.geometry, null, '#172126', 9); polygon(f.geometry, null, '#ffffff', 6); polygon(f.geometry, null, c, 3.5); }
      if (paths(f.geometry).length) { line(f.geometry, '#172126', 11); line(f.geometry, '#ffffff', 7); line(f.geometry, c, 4, p.detour ? [3, 2] : []); }
    }
    for (const f of triggers) {
      if (paths(f.geometry).length) { ctx.globalAlpha = 0.85; line(f.geometry, '#ffce91', 5, f.properties?.detour ? [3, 2] : []); ctx.globalAlpha = 1; }
      if (rings(f.geometry).length) { ctx.globalAlpha = 0.85; polygon(f.geometry, null, '#ffce91', 5); ctx.globalAlpha = 1; }
    }
  }
  const drape = createDrape({ frame, paint });

  let selectedName = '', selectedKind = '';
  const county = createCountyScene({ container: host, bounds: COUNTY_BOUNDS, nightFloor: 0.6,
    // USGS National Map imagery (public domain, NAIP-based; one consistent source, where Esri's composite changes source between
    // zoom levels and shows seams), Esri World Imagery for any tile USGS does not serve.
    terrain: { decorate: drape.decorate, detail: 0.9, imagery: USGS_IMAGERY, imageryMaxZoom: 16, imageryFallback: IMAGERY } });
  const { scene, camera, controls, renderer } = county;
  const clock = setInterval(() => county.setTime(new Date()), 60_000); // the sun follows real time
  // County buildings (reference context, shown within about 14 km): the R2 bucket when configured, else locally built tiles.
  const buildings = createBuildings({ county, baseUrl: new URL('buildings/', CONFIG.county3dBaseUrl || new URL('../data/county3d/', import.meta.url)) });

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
  // A beacon over the selected place: its name on a stem above the ground point, so "what am I looking at" is answered on the map.
  const beacon = (name, kind, color) => texture(`beacon:${color}:${kind}:${name}`, c => {
    const g = c.getContext('2d'), title = String(name).slice(0, 60), sub = String(kind || '').slice(0, 60), s = 2;
    const fontA = `700 ${15 * s}px "Avenir Next", system-ui, sans-serif`, fontB = `500 ${11 * s}px "Avenir Next", system-ui, sans-serif`;
    g.font = fontA; const wA = g.measureText(title).width; g.font = fontB; const wB = sub ? g.measureText(sub).width : 0;
    const w = Math.ceil(Math.max(wA, wB)) + 28 * s, boxH = (sub ? 44 : 30) * s;
    c.width = w; c.height = boxH;
    g.fillStyle = 'rgba(23,33,38,.92)'; g.strokeStyle = color; g.lineWidth = 2 * s;
    g.beginPath(); g.roundRect(s, s, w - 2 * s, boxH - 2 * s, 6 * s); g.fill(); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#f4f8fa'; g.font = fontA; g.fillText(title, w / 2, 7 * s);
    if (sub) { g.fillStyle = '#c3d2d8'; g.font = fontB; g.fillText(sub, w / 2, 27 * s); }
  });
  const stemTex = color => texture(`stem:${color}`, c => { c.width = 16; c.height = 72; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(6.5, 0, 3, 64); g.beginPath(); g.arc(8, 64, 7, 0, 7); g.fill(); });
  const pulseRing = color => texture(`pulse:${color}`, c => { c.width = c.height = 128; const g = c.getContext('2d'); g.beginPath(); g.arc(64, 64, 52, 0, 7); g.lineWidth = 9; g.strokeStyle = color; g.stroke(); });
  let pulses = [];
  /** @type {{sprite: THREE.Sprite, lon: number, lat: number, px: number, lift: number, record?: object, minDistance?: number}[]} */
  let placed = [];
  function marker(tex, lon, lat, { px, anchor = [0.5, 0.5], lift = 0, record, maxDistance = Infinity, order = 0, keepInView = false }) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
    sprite.center.set(anchor[0], anchor[1]); sprite.renderOrder = 10 + order;
    const aspect = tex.image.width / tex.image.height;
    markers.add(sprite);
    const m = { sprite, lon, lat, px, aspect, lift, record, maxDistance, keepInView, anchorX: anchor[0] };
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
    const chosen = records.features.filter(f => f.properties?.selected && f.geometry);
    pulses = [];
    if (chosen.length) {
      const all = chosen.flatMap(f => points(f.geometry).length ? points(f.geometry) : paths(f.geometry).length ? paths(f.geometry).flat() : rings(f.geometry).flat(2));
      if (all.length) {
        const lons = all.map(q => q[0]), lats = all.map(q => q[1]), one = paths(chosen[0].geometry)[0];
        // a line's own middle vertex keeps the beacon on the road; otherwise the bounds centre
        const at = one && chosen.length === 1 ? one[one.length >> 1] : [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
        const p = chosen[0].properties, color = p.color && /^#/.test(p.color) ? p.color : '#ffce91';
        pulses.push(marker(pulseRing(color), at[0], at[1], { px: 46, order: 5 }));
        // stem fixed on the place; the label box sits on top of it and slides sideways to stay inside the map
        marker(stemTex(color), at[0], at[1], { px: 36, anchor: [0.5, 0.1], order: 6 });
        const box = beacon(selectedName || p.name || 'Selected place', selectedKind, color), boxPx = selectedKind ? 44 : 30;
        marker(box, at[0], at[1], { px: boxPx, anchor: [0.5, -(34 / boxPx)], order: 6, keepInView: true });
      }
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
  const tan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), screen = new THREE.Vector3();
  county.onFrame(() => {
    const H = host.clientHeight || 1, d = camera.position.distanceTo(controls.target);
    drape.track(controls.target.x, controls.target.z, d, (2 * d * tan()) / H);
    const unit = (2 * tan()) / H; // sprite scale per screen pixel (sizeAttenuation off)
    for (const m of placed) {
      const [x, z] = frame.project(m.lon, m.lat), g = county.terrain.groundAt(x, z) ?? 0;
      m.sprite.position.set(x, g + m.lift * k, z);
      m.sprite.scale.set(m.px * m.aspect * unit, m.px * unit, 1);
      m.sprite.visible = d / k < m.maxDistance;
      if (m.keepInView) { // slide a wide label sideways so it stays inside the map; its stem still marks the place
        const W = host.clientWidth || 1, x = (screen.copy(m.sprite.position).project(camera).x + 1) * W / 2, half = (m.px * m.aspect) / 2;
        const shift = Math.max(0, half + 8 - x) - Math.max(0, x + half + 8 - W);
        m.sprite.center.x = m.anchorX - shift / (m.px * m.aspect);
      }
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
    const t = reduced() ? 0.35 : (now % 1800) / 1800;
    for (const m of pulses) { m.sprite.material.opacity = 1 - t; m.px = 30 + 60 * t; }
  });
  county.onFrame(now => {
    if (!tween) return;
    const u = Math.min(1, (now - tween.start) / tween.ms), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
    controls.target.lerpVectors(tween.from.t, tween.to.t, e); camera.position.lerpVectors(tween.from.p, tween.to.p, e);
    if (u === 1) { tween = null; emitCamera(); }
  });
  let cameraTimer = 0;
  const emitCamera = () => { clearTimeout(cameraTimer); cameraTimer = setTimeout(() => !destroyed && onCamera(currentCamera()), 250); };
  controls.addEventListener('end', emitCamera);
  // The last fit is re-applied when the map changes size (panels open/close, phone rotation, a hidden map gaining a
  // size), until the person moves the camera themselves.
  let lastFit = null, userMoved = false, size = '';
  controls.addEventListener('start', () => { tween = null; preview.remove(); userMoved = true; });
  county.onFrame(() => {
    const now = `${host.clientWidth}x${host.clientHeight}`;
    if (now === size) return;
    size = now;
    if (lastFit && !userMoved && host.clientWidth && host.clientHeight) fit(lastFit.bounds, false, lastFit.padding, true);
    credit.textContent = host.clientWidth < 600 ? 'USGS NAIP · Esri · Terrarium · 3D preview' : CREDIT;
  });
  function fit(bounds, animate = true, padding, refit = false) {
    if (!refit) { lastFit = { bounds, padding }; userMoved = false; }
    if (!host.clientWidth || !host.clientHeight) return; // applied when the map gets a size
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
    if (!record) { const text = cloudAt(); if (text) onInspect?.({ name: 'GOES cloud top', readout: text }); return; }
    if (record.readout) onInspect ? onInspect(record) : null;
    else onSelect(record);
  });
  canvas.addEventListener('pointermove', e => {
    if (!matchMedia('(hover: hover)').matches || e.buttons) return;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => {
      const record = recordAt(e), at = screenRay(e);
      const text = record?.name ? null : cloudAt();
      if (record?.name) { canvas.style.cursor = 'pointer'; preview.show(record.readout || record.hoverText || record.name, at); }
      else if (text) { canvas.style.cursor = 'pointer'; preview.show(text, at); }
      else { canvas.style.cursor = ''; preview.remove(); }
    });
  });
  canvas.addEventListener('pointerleave', () => { preview.remove(); canvas.style.cursor = ''; });

  // ---------- attribution ----------
  const credit = Object.assign(document.createElement('div'), { className: 'county3d-credit', textContent: CREDIT });
  credit.style.cssText = 'position:absolute;right:6px;bottom:4px;max-width:calc(100% - 12px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:11px system-ui;color:#dfe7ea;background:rgba(23,33,38,.72);padding:2px 6px;border-radius:3px;pointer-events:none';
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

  // ---------- GOES-18 cloud-top surface at its retrieved altitude (observation) ----------
  // vertices: Float32Array of lon, lat, geopotential height (m) per vertex, three vertices per triangle. Coloured by the
  // legend's fixed altitude classes (not severity); lit by the scene sun so tops read as a surface; crossfades between scans.
  const clouds = { current: null, previous: null, fade: null, meta: null };
  // Unlit, one side, light baked into the vertex colours once per scan: the deck can cover the whole view, and per-pixel
  // lighting cost about 5 ms at 3 Mpx (double-sided transparent PBR about 15 ms). Measured 2026-11-27.
  const cloudMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.FrontSide, depthWrite: false });
  const CLOUD_OPACITY = 0.78;
  function cloudMesh(vertices) {
    const n = vertices.length / 3, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [x, z] = frame.project(vertices[3 * i], vertices[3 * i + 1]), h = vertices[3 * i + 2];
      pos.set([x, h * k, z], 3 * i);
      const rgb = cloudTopHeightBand(h)?.rgb ?? [200, 200, 200];
      col.set(rgb.map(v => (v / 255) ** 2.2), 3 * i); // sRGB legend colours to linear
    }
    // wind every triangle counter-clockwise seen from above, so the front side is the cloud top
    for (let t = 0; t + 2 < n; t += 3) {
      const a = 3 * t, b = a + 3, c = a + 6;
      const cross = (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]) - (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]);
      if (cross > 0) for (let j = 0; j < 3; j++) { [pos[b + j], pos[c + j]] = [pos[c + j], pos[b + j]]; [col[b + j], col[c + j]] = [col[c + j], col[b + j]]; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals(); g.computeBoundingSphere();
    // bake the key light (sun, or the night light) into the colours: lit tops, shaded flanks
    const light = county.sun.position.clone().normalize(), nor = g.attributes.normal.array, day = Math.min(1, county.sun.intensity / 2.2);
    for (let i = 0; i < n; i++) {
      const lambert = Math.max(0, nor[3 * i] * light.x + nor[3 * i + 1] * light.y + nor[3 * i + 2] * light.z);
      const shade = 0.68 + 0.32 * (0.35 + 0.65 * day) * lambert;
      for (let j = 0; j < 3; j++) col[3 * i + j] *= shade;
    }
    g.attributes.color.needsUpdate = true;
    const mesh = new THREE.Mesh(g, cloudMaterial());
    mesh.renderOrder = 5; mesh.userData.vertices = vertices;
    return mesh;
  }
  const dropCloud = m => { if (!m) return; scene.remove(m); m.geometry.dispose(); m.material.dispose(); };
  county.onFrame(now => {
    const f = clouds.fade;
    if (!f) { if (clouds.current) clouds.current.material.opacity = CLOUD_OPACITY; return; }
    const u = Math.min(1, (now - f.start) / f.ms);
    if (clouds.current) clouds.current.material.opacity = CLOUD_OPACITY * u;
    if (clouds.previous) clouds.previous.material.opacity = CLOUD_OPACITY * (1 - u);
    if (u === 1) { dropCloud(clouds.previous); clouds.previous = null; clouds.fade = null; f.resolve(); }
  });
  function cloudTops(vertices, options = {}) {
    if (destroyed) return Promise.resolve();
    if (!vertices?.length) {
      clouds.fade?.resolve(); clouds.fade = null; dropCloud(clouds.previous); dropCloud(clouds.current);
      clouds.previous = clouds.current = clouds.meta = null; return undefined;
    }
    if (clouds.current?.userData.vertices === vertices) { clouds.meta = options; return clouds.fade?.promise ?? Promise.resolve(); }
    try {
      const next = cloudMesh(vertices), ms = reduced() ? 0 : options.durationMs || 0;
      clouds.fade?.resolve(); clouds.fade = null; dropCloud(clouds.previous); clouds.previous = null;
      if (clouds.current && ms > 0) {
        clouds.previous = clouds.current;
        let resolve; const promise = new Promise(done => { resolve = done; });
        clouds.fade = { start: performance.now(), ms, resolve, promise };
      } else dropCloud(clouds.current);
      clouds.current = next; clouds.meta = options; scene.add(next);
      return clouds.fade?.promise ?? Promise.resolve();
    } catch (error) { queueMicrotask(() => options.onFailure?.()); return Promise.reject(error); }
  }
  /** Cloud-top readout under a screen ray, unless terrain is in front or a transition is running. */
  function cloudAt() {
    if (!clouds.current || clouds.fade || !Number.isFinite(clouds.meta?.observedAt)) return null;
    const hit = raycaster.intersectObject(clouds.current, false)[0];
    if (!hit) return null;
    const ground = raycaster.intersectObject(county.terrain.group, true)[0];
    if (ground && ground.distance < hit.distance) return null;
    return cloudTopReadout(hit.point.y / k, clouds.meta.observedAt);
  }

  // ---------- HRRR 10 m wind trails for the selected gust forecast hour (forecast) ----------
  // Direction and relative speed come from the forecast grid; the motion is sped up so it reads at the current view scale.
  const WIND_N = 1800, TRAIL = 7;
  // Trails are screen-space ribbons (each segment a quad widened in the vertex shader): WebGL lines are one device pixel,
  // half a CSS pixel on a Retina screen, and disappear.
  const SEGS = WIND_N * (TRAIL - 1), windGeom = new THREE.BufferGeometry();
  windGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGS * 4 * 3), 3)); // unused, sizes the draw
  windGeom.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(SEGS * 4 * 3), 3));
  windGeom.setAttribute('aB', new THREE.BufferAttribute(new Float32Array(SEGS * 4 * 3), 3));
  windGeom.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(SEGS * 4 * 4), 4));
  {
    const end = new Float32Array(SEGS * 4), side = new Float32Array(SEGS * 4), index = new Uint32Array(SEGS * 6);
    for (let q = 0; q < SEGS; q++) {
      end.set([0, 0, 1, 1], 4 * q); side.set([-1, 1, -1, 1], 4 * q);
      index.set([4 * q, 4 * q + 1, 4 * q + 2, 4 * q + 2, 4 * q + 1, 4 * q + 3], 6 * q);
    }
    windGeom.setAttribute('aEnd', new THREE.BufferAttribute(end, 1)); windGeom.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    windGeom.setIndex(new THREE.BufferAttribute(index, 1));
  }
  const windMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uView: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 2 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aA, aB; attribute float aEnd, aSide; attribute vec4 aColor; uniform vec2 uView; uniform float uWidth; varying vec4 vColor;
      void main() {
        vec4 a = projectionMatrix * modelViewMatrix * vec4(aA, 1.0), b = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
        vec2 d = b.xy / b.w - a.xy / a.w; d *= uView; float l = length(d);
        vec2 n = l > 1e-6 ? vec2(-d.y, d.x) / l : vec2(0.0);
        vec4 p = mix(a, b, aEnd);
        p.xy += n * aSide * uWidth / uView * p.w;
        gl_Position = p; vColor = aColor;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec4 vColor;
      void main() {
        #include <logdepthbuf_fragment>
        gl_FragColor = vColor;
        #include <colorspace_fragment>
      }`
  });
  const windLines = new THREE.Mesh(windGeom, windMaterial);
  windLines.frustumCulled = false; windLines.visible = false; windLines.renderOrder = 6; scene.add(windLines);
  const windNote = Object.assign(document.createElement('div'), { textContent: 'Lines: HRRR 10 m wind for this forecast hour · motion sped up to show direction' });
  windNote.style.cssText = 'position:absolute;left:6px;bottom:4px;max-width:calc(100% - 12px);font:11px system-ui;color:#dfe7ea;background:rgba(23,33,38,.72);padding:2px 6px;border-radius:3px;pointer-events:none';
  windNote.hidden = true; host.append(windNote);
  const wind = { field: null, lon: new Float32Array(WIND_N), lat: new Float32Array(WIND_N), age: new Float32Array(WIND_N), life: new Float32Array(WIND_N),
    hist: new Float32Array(WIND_N * TRAIL * 3), speed: new Float32Array(WIND_N) };
  function windAt(lon, lat) {
    const f = wind.field, { x0, y0, dx, dy, width, height } = f.grid;
    const c = (lon - x0) / dx, r = (lat - y0) / dy;
    if (c < 0 || r < 0 || c > width - 1 || r > height - 1) return null;
    const i0 = Math.floor(c), j0 = Math.floor(r), i1 = Math.min(i0 + 1, width - 1), j1 = Math.min(j0 + 1, height - 1), fx = c - i0, fy = r - j0;
    const at = (a, i, j) => a[j * width + i];
    const corners = [[i0, j0], [i1, j0], [i0, j1], [i1, j1]];
    if (corners.some(([i, j]) => at(f.u, i, j) === null || at(f.v, i, j) === null)) return null;
    const lerp = a => (at(a, i0, j0) * (1 - fx) + at(a, i1, j0) * fx) * (1 - fy) + (at(a, i0, j1) * (1 - fx) + at(a, i1, j1) * fx) * fy;
    return [lerp(f.u), lerp(f.v)];
  }
  function windSpawn(i, b) {
    wind.lon[i] = b[0] + Math.random() * (b[2] - b[0]); wind.lat[i] = b[1] + Math.random() * (b[3] - b[1]);
    wind.age[i] = 0; wind.life[i] = 50 + Math.random() * 70;
    const [x, z] = frame.project(wind.lon[i], wind.lat[i]), y = (county.terrain.groundAt(x, z) ?? 0) + windLift();
    for (let t = 0; t < TRAIL; t++) wind.hist.set([x, y, z], 3 * (i * TRAIL + t));
  }
  const windLift = () => Math.max(60 * k, camera.position.distanceTo(controls.target) * 0.002);
  /** Spawn area: the ground around the view target, not the whole visible area out to the horizon. */
  function windArea(viewWidth) {
    const [lon, lat] = frame.unproject(controls.target.x, controls.target.z), r = viewWidth * 0.75;
    const dLat = r / 110540, dLon = r / (111320 * Math.cos(lat * Math.PI / 180));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }
  const GUST_COLORS = [[0, '#f4f9fb'], [15, '#8fb7c7'], [30, '#9fd2ff'], [45, '#c7f0c0'], [60, '#ffe08a'], [75, '#ff9b6a']].map(([mph, c]) => [mph, new THREE.Color(c)]);
  let windBounds = null, windFrame = 0;
  county.onFrame((now, dt) => {
    if (!wind.field || reduced()) { windLines.visible = false; return; }
    windLines.visible = true;
    const d = camera.position.distanceTo(controls.target) / k, aspect = (host.clientWidth || 1) / (host.clientHeight || 1);
    const viewWidth = 2 * d * tan() * aspect, gain = viewWidth * 0.013; // a 5 m/s wind draws a trail about 3% of the view across
    if (!windBounds || ++windFrame % 30 === 0) windBounds = windArea(viewWidth);
    const record = windFrame % 4 === 0, lift = windLift(); // trail points every 4th frame so trails have visible length
    const step = Math.min(dt, 50) / 1000, A = windGeom.attributes.aA.array, B = windGeom.attributes.aB.array, col = windGeom.attributes.aColor.array;
    renderer.getDrawingBufferSize(windMaterial.uniforms.uView.value); windMaterial.uniforms.uWidth.value = 1.6 * renderer.getPixelRatio(); // half-width in device px
    for (let i = 0; i < WIND_N; i++) {
      const uv = windAt(wind.lon[i], wind.lat[i]);
      if (!uv || wind.age[i] > wind.life[i] || wind.lon[i] < windBounds[0] || wind.lon[i] > windBounds[2] || wind.lat[i] < windBounds[1] || wind.lat[i] > windBounds[3]) { windSpawn(i, windBounds); continue; }
      const cos = Math.cos(wind.lat[i] * Math.PI / 180);
      wind.lon[i] += (uv[0] * gain * step) / (111320 * cos); wind.lat[i] += (uv[1] * gain * step) / 110540;
      wind.age[i]++; wind.speed[i] = Math.hypot(uv[0], uv[1]) * 2.23694;
      if (record) wind.hist.copyWithin(3 * i * TRAIL, 3 * i * TRAIL + 3, 3 * (i + 1) * TRAIL);
      const [x, z] = frame.project(wind.lon[i], wind.lat[i]), head = 3 * (i * TRAIL + TRAIL - 1);
      wind.hist[head] = x; wind.hist[head + 1] = (county.terrain.groundAt(x, z) ?? 0) + lift; wind.hist[head + 2] = z;
    }
    for (let i = 0; i < WIND_N; i++) {
      const color = GUST_COLORS.findLast(([mph]) => wind.speed[i] >= mph)?.[1] ?? GUST_COLORS[0][1];
      // fade in and out with age, and toward the edge of the spawn area so it has no visible border
      const cx = (windBounds[0] + windBounds[2]) / 2, cy = (windBounds[1] + windBounds[3]) / 2;
      const edge = Math.max(Math.abs(wind.lon[i] - cx) / ((windBounds[2] - windBounds[0]) / 2), Math.abs(wind.lat[i] - cy) / ((windBounds[3] - windBounds[1]) / 2));
      const fade = Math.min(1, wind.age[i] / 8, (wind.life[i] - wind.age[i]) / 8) * (1 - THREE.MathUtils.smoothstep(edge, 0.55, 1));
      const hist = wind.hist, r = color.r, g = color.g, b = color.b;
      for (let t = 0; t < TRAIL - 1; t++) {
        const q = i * (TRAIL - 1) + t, h = 3 * (i * TRAIL + t), a0 = (t / (TRAIL - 1)) * fade, a1 = ((t + 1) / (TRAIL - 1)) * fade;
        for (let v = 0; v < 4; v++) {
          const o = (4 * q + v) * 3, c = (4 * q + v) * 4; // plain writes: no subarray views or temporary arrays per frame
          A[o] = hist[h]; A[o + 1] = hist[h + 1]; A[o + 2] = hist[h + 2];
          B[o] = hist[h + 3]; B[o + 1] = hist[h + 4]; B[o + 2] = hist[h + 5];
          col[c] = r; col[c + 1] = g; col[c + 2] = b; col[c + 3] = v < 2 ? a0 : a1;
        }
      }
    }
    windGeom.attributes.aA.needsUpdate = true; windGeom.attributes.aB.needsUpdate = true; windGeom.attributes.aColor.needsUpdate = true;
  });
  function setWind(field) {
    const changed = !!field !== !!wind.field;
    wind.field = field && field.u?.length === field.grid.width * field.grid.height ? field : null;
    windNote.hidden = !wind.field || reduced();
    if (changed && wind.field) { windBounds = windArea(2 * (camera.position.distanceTo(controls.target) / k) * tan() * ((host.clientWidth || 1) / (host.clientHeight || 1))); for (let i = 0; i < WIND_N; i++) { windSpawn(i, windBounds); wind.age[i] = Math.random() * wind.life[i]; } }
  }

  // ---------- KHNX radar reflectivity volume (observation) ----------
  // volume: {values Float32Array [height 24][y 48, northward][x 64], shape, bounds3857, heightRange} from radar-volume-data.js.
  // Each sampled cell at or above the threshold is drawn as a translucent box at its true extent (about 3 km x 3 km x 500 m,
  // 0-12 km MSL), coloured by RADAR_BANDS: nearest cell, no interpolation; -999 (unknown) cells are not drawn. Boxes rather
  // than ray-marching: a few hundred occupied cells of 73,728 is typical, and a full-box ray march cost about 11 ms per frame.
  const bandColors = RADAR_BANDS.map(({ min, color }) => [min, new THREE.Color().setRGB(...color.map(c => c / 255), THREE.SRGBColorSpace)]);
  const radarBox = { mesh: null, volume: null, minDbz: null };
  function radarVolume(volume, minDbz = 20) {
    if (destroyed) return;
    if (radarBox.mesh) { scene.remove(radarBox.mesh); radarBox.mesh.geometry.dispose(); radarBox.mesh.material.dispose(); radarBox.mesh = null; }
    radarBox.volume = volume || null; radarBox.minDbz = minDbz;
    if (!volume) return;
    if (!Number.isFinite(minDbz) || minDbz < 10 || minDbz > 79.5) throw Error('Invalid Hanford volume threshold');
    const [nz, ny, nx] = volume.shape, [west, south, east, north] = volume.bounds3857, [h0, h1] = volume.heightRange, v = volume.values;
    const x0 = west - frame.ox, x1 = east - frame.ox, zNorth = -(north - frame.oy), zSouth = -(south - frame.oy);
    const dx = (x1 - x0) / nx, dz = (zSouth - zNorth) / ny, dy = ((h1 - h0) / nz) * k;
    const cells = [];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const dbz = v[(z * ny + y) * nx + x]; if (dbz !== -999 && dbz >= minDbz) cells.push([x, y, z, dbz]); }
    if (!cells.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55, depthWrite: false, emissive: 0xffffff, emissiveIntensity: 0.15 }), cells.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    cells.forEach(([x, y, z, dbz], i) => {
      m.makeScale(dx * 0.94, dy * 0.94, dz * 0.94).setPosition(x0 + (x + 0.5) * dx, h0 * k + (z + 0.5) * dy, zSouth - (y + 0.5) * dz); // rows run northward
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.copy(bandColors.findLast(([min]) => dbz >= min)?.[1] ?? bandColors[0][1]));
    });
    mesh.renderOrder = 7; mesh.computeBoundingSphere();
    scene.add(mesh); radarBox.mesh = mesh;
  }

  const noop = () => {};
  const api = {
    /** Feature flag read by the shared weather UIs: this renderer can draw true-altitude 3D surfaces. */
    volumetric: true,
    set(data) {
      if (destroyed) return;
      records = data || empty;
      rebuildMarkers(); drape.invalidate();
      // Command's map caption names the selected place (it is written just after set); reuse it for the beacon rather than
      // guessing from feature names. Fall back to the feature's own name.
      setTimeout(() => {
        if (destroyed) return;
        const doc = host.ownerDocument, name = doc.getElementById('map-place')?.textContent?.trim() || '', kind = doc.getElementById('map-scope')?.textContent?.trim() || '';
        if (name === selectedName && kind === selectedKind) return;
        selectedName = records.features.some(f => f.properties?.selected) ? name : ''; selectedKind = selectedName ? kind : '';
        rebuildMarkers();
      }, 0);
    },
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
    gust(image) { setWind(image?.wind ?? null); return setRaster('gust', image, 0.42, true); },
    snowCover(image) { setRaster('snow-cover', image, 0.6, true); },
    snowfall(image) { return setRaster('snowfall', image, 0.65, true); },
    regionalRadar(image) { return setRaster('regional-radar', image, 0.65); },
    cloud(image) { setRaster('goes', image, 0.55); },
    cloudTops, radarVolume,
    // Not yet ported to three.js (Command does not enable them).
    radar: noop, forecastClouds: noop, forecastWind: noop,
    destroy() {
      if (destroyed) return; destroyed = true;
      clearInterval(clock); clearTimeout(cameraTimer); preview.destroy(); credit.remove(); drape.dispose(); buildings.dispose();
      for (const r of rasters.values()) r.bitmap.close?.();
      cloudTops(null); radarVolume(null); setWind(null); windGeom.dispose(); windLines.material.dispose(); windNote.remove();
      for (const t of textures.values()) t.dispose();
      county.destroy();
      delete host.county3dMap;
    }
  };
  host.county3dMap = api; // for checks from DevTools
  return api;
}

function hexAlpha(color, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const v = parseInt(m[1], 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`;
}
