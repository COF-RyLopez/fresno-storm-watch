// 3D prototype of flood-scenario.js: the same playback in a SceneView, with NSI buildings as extruded Overture footprints.
// Footprints come from a published scene layer (index.json "scene_buildings", scripts/build-flood-scene-buildings.py) or, until
// then, from scripts/build-flood-footprints.py (footprints.geojson); scenarios without either fall back to points only.
// Desktop prototype: the phone-tuned 2D page is flood-scenario.html.
import { loadSdk } from './lib/map.js';
import { blend, clockLabel, rowsToObjects, summarize } from './lib/flood-scenario-model.js';
import { createTrafficCanvas } from './lib/evacuation-traffic.js?v=0.74.0-scenarios';
import { createFrameWindow } from './lib/frame-window.js';
import { squareToQuad } from './lib/ground-homography.js';
import { buildingFields, CLASSES, classRenderer, createPlayer, fieldInfos as popupFields, hydrograph as popupChart, pickScenario, showScenario, themedBasemaps, trafficCounts, trafficLoader } from './lib/flood-scenario-page.js?v=0.74.0-scenarios';

const ROOT = './data/flood-scenarios/';
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const params = new URLSearchParams(location.search);

const { index, id, DATA } = await pickScenario(ROOT);
$('link-2d').href = `./flood-scenario.html?scenario=${encodeURIComponent(id)}`;
const [scenario, buildingsJson, unmatched, sdk] = await Promise.all([
  fetch(DATA + 'scenario.json').then(r => r.json()),
  fetch(DATA + 'buildings.json').then(r => r.json()),
  fetch(DATA + 'footprints-unmatched.json').then(r => (r.ok ? r.json() : null)),
  loadSdk()
]);
const [Map, SceneView, Basemap, TileLayer, MediaLayer, ImageElement, ExtentAndRotationGeoreference, Extent, FeatureLayer, GeoJSONLayer, Graphic, Point, reactiveUtils, SceneLayer] = await sdk.import([
  '@arcgis/core/Map.js', '@arcgis/core/views/SceneView.js', '@arcgis/core/Basemap.js', '@arcgis/core/layers/TileLayer.js',
  '@arcgis/core/layers/MediaLayer.js', '@arcgis/core/layers/support/ImageElement.js', '@arcgis/core/layers/support/ExtentAndRotationGeoreference.js',
  '@arcgis/core/geometry/Extent.js', '@arcgis/core/layers/FeatureLayer.js', '@arcgis/core/layers/GeoJSONLayer.js', '@arcgis/core/Graphic.js',
  '@arcgis/core/geometry/Point.js', '@arcgis/core/core/reactiveUtils.js', '@arcgis/core/layers/SceneLayer.js'
]);

const { frames, hours, extent } = showScenario(scenario, Extent);

// Depth frames and flood front, draped on the terrain (as in the 2D page).
const depth = new MediaLayer({ source: [], title: 'Modeled depth', blendMode: 'normal' });
const showFrames = createFrameWindow(depth.source.elements,
  i => new ImageElement({ image: DATA + frames[i].image, opacity: 0, georeference: new ExtentAndRotationGeoreference({ extent }) }), frames.length);
const front = new GeoJSONLayer({
  url: DATA + 'front.geojson', title: 'Flood front', definitionExpression: 'hour = -1', elevationInfo: { mode: 'on-the-ground' },
  renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 176, 0, 0.9], width: 1.5 } } }
});

// Buildings: depth at the displayed time vs first-floor height, the same expression and classes as flood-scenario.js.
const samples = scenario.depth_model === 'samples';
const props = rowsToObjects(buildingsJson);
const fieldInfos = popupFields(scenario.arrival_labels);
const hydrograph = popupChart(samples, frames);
const fields = buildingFields(buildingsJson.fields);
const unmatchedSet = unmatched && new Set(unmatched);
const points = new FeatureLayer({ // NSI points with no Overture footprint (all of them when there is no footprint file)
  title: unmatched ? 'Buildings without a footprint (NSI)' : 'Buildings (NSI)', minScale: 150_000, objectIdField: 'oid', fields, geometryType: 'point',
  spatialReference: { wkid: 4326 }, elevationInfo: { mode: 'on-the-ground' },
  source: props.filter(p => !unmatchedSet || unmatchedSet.has(p.fd_id))
    .map(({ lon, lat, ...a }, i) => new Graphic({ geometry: { type: 'point', longitude: lon, latitude: lat }, attributes: { oid: i + 1, ...a } })),
  popupTemplate: { title: '{occtype} · NSI {fd_id}', content: [{ type: 'fields', fieldInfos: fieldInfos.filter(f => fields.some(x => x.name === f.fieldName)) }, ...hydrograph, { type: 'text', text: scenario.popup_note }] }
});
const footprintPopup = {
    title: '{occtype} · NSI {fd_id}',
    content: [{ type: 'fields', fieldInfos: [...fieldInfos.filter(f => f.fieldName !== 'arrive2_hr'),
      { fieldName: 'n_points', label: 'NSI points on this footprint (attributes of the worst; people and loss summed)' },
      { fieldName: 'height_ft', label: 'Drawn height (ft)', format: { places: 0 } }, { fieldName: 'gers_id', label: 'Overture GERS ID' }] },
    { type: 'text', text: scenario.popup_note }]
};
const depthExpression = (q, { i0, i1, w }) => samples
  ? `var d = $feature.d${i0} * ${1 - w} + $feature.d${i1} * ${w};`
  : `var a = $feature.arrive_hr; var pk = $feature.peak_hr; var m = $feature.depth_max; var t = ${q}; var f = Min(1, m);
     var d = IIf(IsEmpty(a) || t < a, 0, IIf(t >= pk || pk <= a, m, f + (m - f) * (t - a) / (pk - a)));`;

// Footprints (ramp scenarios): a client-side layer whose 'cls' field holds each footprint's class (index into CLASSES) at the
// time shown, under one fixed renderer. The ramp depth only rises, so the build script stores the hour each footprint enters
// each class (arrive_hr, t_in0/2/6), and playback edits only the footprints whose class changed (~1k per step for Big Dry
// Creek). Rebuilding a time-dependent renderer instead regenerated every extrusion (~5 s for 41k) and playback fell to ~7 fps;
// SDK 5.1 SceneView renderers get no Arcade $view, so the time cannot live in the renderer.
const classAt = (p, t) => (p.arrive_hr == null || t < p.arrive_hr ? 0 : p.t_in0 == null || t < p.t_in0 ? 1
  : p.t_in2 == null || t < p.t_in2 ? 2 : p.t_in6 == null || t < p.t_in6 ? 3 : 4);
// The published scene layer (?buildings=<portal item id> to try one before it goes in index.json) holds every scenario's
// footprints with per-scenario class hours <sid>_arr/_t0/_t2/_t6 and is coloured by one renderer expression of the clock: a
// scene layer applies a new renderer in ~50 ms. Its popup shows the footprint's worst NSI point (<sid>_fd) from buildings.json.
const sceneItem = !samples && unmatched && (params.get('buildings') || index.scene_buildings);
const sid = id.replace(/-/g, '_');
const fillMesh = color => ({ type: 'mesh-3d', symbolLayers: [{ type: 'fill', material: { color } }] });
const sceneRenderer = at => ({
  type: 'unique-value', defaultSymbol: fillMesh(CLASSES[0][2]),
  valueExpression: `var t = ${at}; var a = $feature.${sid}_arr; var t0 = $feature.${sid}_t0; var t2 = $feature.${sid}_t2; var t6 = $feature.${sid}_t6;
    IIf(IsEmpty(a) || t < a, 0, IIf(IsEmpty(t0) || t < t0, 1, IIf(IsEmpty(t2) || t < t2, 2, IIf(IsEmpty(t6) || t < t6, 3, 4))))`,
  uniqueValueInfos: CLASSES.map(([, , color], value) => ({ value, symbol: fillMesh(color) }))
});
const byFd = new globalThis.Map(props.map(p => [p.fd_id, p])); // Map is the ArcGIS class here
const fmtField = (v, f) => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: f.format?.places ?? 2 }) : v);
const scenePopup = {
  outFields: [`${sid}_fd`, 'height_ft', 'gers_id'],
  title: ({ graphic }) => { const p = byFd.get(graphic.attributes[`${sid}_fd`]); return p ? `${p.occtype} · NSI ${p.fd_id}` : 'Building'; },
  content: ({ graphic }) => {
    const p = byFd.get(graphic.attributes[`${sid}_fd`]) ?? {};
    const rows = [...fieldInfos.filter(f => f.fieldName !== 'arrive2_hr' && p[f.fieldName] != null).map(f => [f.label, fmtField(p[f.fieldName], f)]),
      ['Drawn height (ft)', Math.round(graphic.attributes.height_ft)], ['Overture GERS ID', graphic.attributes.gers_id]];
    return `<table class="esri-widget__table"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`
      + `<p>Attributes of the worst-affected NSI point on this footprint. ${scenario.popup_note}</p>`;
  }
};
const footprintsJson = unmatched && !samples && !sceneItem ? await fetch(DATA + 'footprints.geojson').then(r => r.json()) : null;
const fpProps = footprintsJson?.features.map(f => f.properties);
const fpClass = fpProps && Int8Array.from(fpProps, p => classAt(p, hours[0]));
// No edges: outlining the extrusions cost up to 2-3x the frame rate at 1:70k (the SDK extracts every edge).
const extrude = color => ({ type: 'polygon-3d', symbolLayers: [{ type: 'extrude', material: { color } }] });
const footprints = sceneItem ? new SceneLayer({ portalItem: { id: sceneItem }, title: 'Buildings (Overture footprints)',
  definitionExpression: `${sid}_fd IS NOT NULL`, renderer: sceneRenderer(hours[0]), popupTemplate: scenePopup })
  : footprintsJson && new FeatureLayer({
  title: 'Buildings (Overture footprints)', objectIdField: 'oid', geometryType: 'polygon', spatialReference: { wkid: 4326 },
  elevationInfo: { mode: 'on-the-ground' }, minScale: 150_000, popupTemplate: footprintPopup,
  fields: [{ name: 'oid', type: 'oid' }, { name: 'cls', type: 'integer' }, ...fields.filter(f => f.type !== 'oid'),
    ...['t_in0', 't_in2', 't_in6', 'height_ft'].map(name => ({ name, type: 'double' })), { name: 'n_points', type: 'integer' }, { name: 'gers_id', type: 'string' }],
  source: footprintsJson.features.map(({ geometry: g, properties }, i) => new Graphic({
    geometry: { type: 'polygon', rings: g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(), spatialReference: { wkid: 4326 } },
    attributes: { oid: i + 1, cls: fpClass[i], ...properties } })),
  renderer: { type: 'unique-value', field: 'cls', uniqueValueInfos: CLASSES.map(([, , color], value) => ({ value, symbol: extrude(color) })),
    visualVariables: [{ type: 'size', field: 'height_ft', valueUnit: 'feet' }] }
});
const EDIT_MS = Number(params.get('editms')) || (sceneItem ? 100 : 330); // ?editms= to tune
let editing = false;
let wantedAt = null;
function updateFootprints(at) { // one applyEdits at a time; a newer time asked for meanwhile is applied when it finishes
  if (sceneItem) {
    if (at !== wantedAt) { wantedAt = at; swapStart = performance.now(); footprints.renderer = sceneRenderer(at); }
    return;
  }
  wantedAt = at;
  if (editing) return;
  const changed = [];
  fpProps.forEach((p, i) => { const c = classAt(p, at); if (c !== fpClass[i]) { fpClass[i] = c; changed.push(new Graphic({ attributes: { oid: i + 1, cls: c } })); } });
  if (!changed.length) return;
  editing = true;
  swapStart = performance.now();
  footprints.applyEdits({ updateFeatures: changed }).catch(e => console.warn('Footprint classes:', e.message))
    .finally(() => { editing = false; if (wantedAt !== at) updateFootprints(wantedAt); });
}

const themedBasemap = themedBasemaps(Basemap, TileLayer);
const map = new Map({ basemap: themedBasemap(), ground: 'world-elevation', layers: [depth, front, ...(footprints ? [footprints] : []), points] });
// Local (flat) Web Mercator scene: the car overlay maps the ground plane to the screen with one homography.
const view = new SceneView({ container: 'view', map, viewingMode: 'local', clippingArea: extent.clone().expand(1.6), extent: extent.clone().expand(1.05),
  environment: { atmosphereEnabled: false, starsEnabled: false }, qualityProfile: params.get('quality') || 'medium' });
window.addEventListener('storm-theme-change', () => { map.basemap = themedBasemap(); });

let t = 0;
let shownHour = null;
let shownBlend = null;
let rendererAt = 0;
let editAt = 0;
let summaryAt = 0;
let swapStart = 0;
let lastSwapMs = 0;
// The scene draws at most a quality-dependent number of features per layer (8,500 on 'medium'); ?maxfeatures= changes it.
const capFeatures = lv => { if (params.get('maxfeatures')) lv.maximumNumberOfFeatures = Number(params.get('maxfeatures')); };
const watchRedraw = lv => reactiveUtils.watch(() => lv.updating, u => {
  if (!u && swapStart) { lastSwapMs = performance.now() - swapStart; perf.swaps.push({ ms: Math.round(lastSwapMs) }); swapStart = 0; }
});
function render(next) {
  t = Math.min(Math.max(next, hours[0]), hours.at(-1));
  const { i0, i1, w } = blend(t, hours);
  showFrames(i0, i1, w);
  const hour = w < 0.5 ? frames[i0].hour : frames[i1].hour;
  if (hour !== shownHour) { shownHour = hour; front.definitionExpression = `hour = ${hour}`; }
  // ponytail: footprint classes in 5-minute steps, sent at most every EDIT_MS while playing; each batch makes the scene
  // re-process the edited extrusions (a frame of 100-200 ms), so fewer, larger batches play smoother
  if (footprints && (!player.playing || performance.now() - editAt > EDIT_MS)) { editAt = performance.now(); updateFootprints(Math.round(t * 12) / 12); }
  const q = Math.round(t * 4) / 4; // point colours step every 15 model minutes, as in the 2D page
  // ponytail: while playing, rebuild the point renderer at most ~3 times a second, as in the 2D page
  if (q !== shownBlend && (!player.playing || performance.now() - rendererAt > 330)) {
    shownBlend = q; rendererAt = performance.now();
    if (!footprints) swapStart = rendererAt;
    const b = blend(q, hours), bb = { ...b, w: Number(b.w.toFixed(2)) };
    points.renderer = classRenderer(depthExpression(q, bb));
  }
  $('clock').textContent = clockLabel(t);
  $('s-acres').textContent = fmt.format(Math.round(frames[i0].wet_acres * (1 - w) + frames[i1].wet_acres * w));
  // ponytail: the 44k-building tally took a quarter of each frame here; 5 times a second is enough for the counters
  if (!player.playing || performance.now() - summaryAt > 200) {
    summaryAt = performance.now();
    const s = summarize(props, t, hours);
    $('s-wet').textContent = fmt.format(s.wet);
    $('s-inside').textContent = fmt.format(s.inside);
    $('s-people').textContent = fmt.format(s.people);
    $('s-loss').textContent = usd.format(s.loss);
  }
  if (Math.abs(Number($('time').value) - t) > 0.01) $('time').value = Number(t.toFixed(2));
  drawTraffic();
}

// Evacuation cars: a canvas over the scene. In a local scene the ground near the view centre is a plane, and a plane maps to
// the screen by a homography, fitted from four projected points each redraw (no per-car toScreen).
// ponytail: plane at the centre's ground height, cars are not hidden by buildings; per-car elevation + a 3D layer if that matters.
const entry = index.scenarios.find(s => s.id === id);
function groundToScreen() {
  const c = view.center;
  if (!c) return null;
  const D = Math.max(50, view.scale / 3780 * 300); // ~300 px across at the centre
  const q = [[0, 0], [D, 0], [D, D], [0, D]].map(([dx, dy]) => view.toScreen(new Point({ x: c.x + dx, y: c.y + dy, z: c.z, spatialReference: c.spatialReference })));
  if (q.some(p => !p)) return null;
  const H = squareToQuad(q.flatMap(p => [p.x, p.y]));
  return (x, y) => H((x - c.x) / D, (y - c.y) / D);
}

const carCanvas = createTrafficCanvas(view, Point, { fullSize: true, carColour: 'rgba(255,181,71,0.95)', lineWidth: 3,
  project: ([ox, oy]) => { const P = groundToScreen(); return P && ((x, y) => P(x + ox, y + oy)); } });
let traffic = null;
function drawTraffic() {
  if (carCanvas.draw($('traffic-show').checked ? traffic : null, t * 3600)) trafficCounts(traffic, t);
}
const showTraffic = trafficLoader(id, next => { traffic = next; drawTraffic(); });
if (entry.evacuation) {
  $('traffic').hidden = false;
  $('traffic-note').textContent = 'Same evac-engine run as the 2D page: one car per household of night-time residents on OpenStreetMap roads, '
    + 'Greenshields speed-density with spillback and rerouting around roads deeper than 0.5 ft. Departure delays are a placeholder, not a calibrated warning curve.';
  $('speed').value = '0.016667';
  $('traffic-mode').addEventListener('calciteSegmentedControlChange', e => showTraffic(e.target.value));
  $('traffic-show').addEventListener('calciteSwitchChange', () => { if ($('traffic-show').checked && !traffic) showTraffic($('traffic-mode').value); else drawTraffic(); });
  reactiveUtils.watch(() => [view.camera, view.size], () => drawTraffic(), { initial: false });
  showTraffic('base');
}

const player = createPlayer(hours, () => t, render);

// Smoothness readout: frame rate and worst frame over the last second, how long the buildings take to redraw after a
// colour change, and the scene's own memory estimate. window.perf3d keeps the samples for benchmarking.
const perf = (window.perf3d = { frames: [], swaps: [] });
let fpsT = performance.now(), fpsN = 0, worst = 0, prevT = fpsT;
requestAnimationFrame(function loop(now) {
  const dt = now - prevT; prevT = now; fpsN += 1; worst = Math.max(worst, dt);
  if (now - fpsT >= 1000) {
    const fps = (fpsN * 1000) / (now - fpsT);
    perf.frames.push({ at: Math.round(now), fps: Number(fps.toFixed(1)), worst: Math.round(worst), playing: player.playing });
    const mem = view.performanceInfo?.usedMemory, heap = performance.memory?.usedJSHeapSize;
    $('perf').textContent = `${fps.toFixed(0)} fps, worst frame ${Math.round(worst)} ms · buildings redraw ${Math.round(lastSwapMs)} ms`
      + (mem ? ` · scene memory ${Math.round(mem / 2 ** 20)} MB` : '') + (heap ? ` · JS heap ${Math.round(heap / 2 ** 20)} MB` : '');
    fpsT = now; fpsN = 0; worst = 0;
  }
  requestAnimationFrame(loop);
});

const firstWet = frames.findIndex(f => f.wet_acres > 0);
await view.when();
view.whenLayerView(footprints || points).then(lv => { watchRedraw(lv); capFeatures(lv); });
// Open tilted over the first neighbourhoods with water above the first floor (Clovis / NE Fresno for Big Dry Creek).
const wet = props.filter(p => p.depth_max - p.found_ht > 2 && p.arrive_hr <= 6);
if (wet.length) await view.goTo({ center: [wet.reduce((s, p) => s + p.lon, 0) / wet.length, wet.reduce((s, p) => s + p.lat, 0) / wet.length], scale: 40_000, tilt: 60 }, { animate: false });
window.scene3d = { view, footprints, points, render, setPlaying: player.setPlaying, sceneRenderer, classAt }; // for benchmarking and checks from DevTools
render(hours[Math.max(firstWet - 1, 0)]);
