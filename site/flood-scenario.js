import { loadSdk } from './lib/map.js?v=0.74.0-infra-weather';
import { blend, clockLabel, rowsToObjects, summarize } from './lib/flood-scenario-model.js?v=0.60.0';
import { createTrafficCanvas } from './lib/evacuation-traffic.js?v=0.74.0-scenarios';
import { createFrameWindow } from './lib/frame-window.js?v=0.39.0';
import { createZarrFrames } from './lib/zarr-frames.js?v=0.73.1';
import { buildingFields, classRenderer, createPlayer, fieldInfos, hydrograph, pickScenario, showScenario, themedBasemaps, trafficCounts, trafficLoader } from './lib/flood-scenario-page.js?v=0.74.0-scenarios';

const ROOT = './data/flood-scenarios/';
// Phones get the map first: the panel starts collapsed behind Details, and traffic loads only when switched on.
const PHONE = matchMedia('(max-width: 760px)').matches;
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

const { index, id, DATA } = await pickScenario(ROOT);
// Data formats per scenario: depth from hourly PNG frames, or from a Zarr store (scenario.depth_zarr) with real
// values; buildings from buildings.json, or from Parquet (scenario.buildings_parquet). Both written by stormwatch-flood.
const [scenario, sdk] = await Promise.all([fetch(DATA + 'scenario.json').then(r => r.json()), loadSdk()]);
const buildingsJson = scenario.buildings_parquet ? null : await fetch(DATA + 'buildings.json').then(r => r.json());
const [Map, MapView, Basemap, TileLayer, MediaLayer, ImageElement, ExtentAndRotationGeoreference, Extent, FeatureLayer, GeoJSONLayer, Graphic, Point, reactiveUtils, ParquetLayer, ParquetFilesData] = await sdk.import([
  '@arcgis/core/Map.js', '@arcgis/core/views/MapView.js', '@arcgis/core/Basemap.js', '@arcgis/core/layers/TileLayer.js',
  '@arcgis/core/layers/MediaLayer.js', '@arcgis/core/layers/support/ImageElement.js', '@arcgis/core/layers/support/ExtentAndRotationGeoreference.js',
  '@arcgis/core/geometry/Extent.js', '@arcgis/core/layers/FeatureLayer.js', '@arcgis/core/layers/GeoJSONLayer.js', '@arcgis/core/Graphic.js',
  '@arcgis/core/geometry/Point.js', '@arcgis/core/core/reactiveUtils.js', '@arcgis/core/layers/ParquetLayer.js', '@arcgis/core/layers/support/ParquetFilesData.js'
]);

const { frames, hours, extent, stops } = showScenario(scenario, Extent);

// Depth: PNG scenarios have one image per model hour, cross-faded around the current fractional hour, and only the frames
// on screen (plus the next) in the layer: all of them at once exhausted phone memory (lib/frame-window.js). Zarr
// scenarios redraw one canvas from arrival times and real depths, flood front included (lib/zarr-frames.js).
const depth = new MediaLayer({ source: [], title: 'Modeled depth', blendMode: 'normal' });
const georeference = new ExtentAndRotationGeoreference({ extent });
const zarr = scenario.depth_zarr
  ? await createZarrFrames(new URL(`${DATA}${scenario.depth_zarr}/`, location.href), depth.source.elements,
    image => new ImageElement({ image, opacity: 0, georeference }), stops)
  : null;
const showFrames = zarr ? zarr.show
  : createFrameWindow(depth.source.elements, i => new ImageElement({ image: DATA + frames[i].image, opacity: 0, georeference }), frames.length);

const front = zarr ? null : new GeoJSONLayer({
  url: DATA + 'front.geojson', title: 'Flood front', definitionExpression: 'hour = -1',
  renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 176, 0, 0.9], width: 1.5 } } }
});

// Buildings: the renderer compares depth at the displayed time with the first-floor height.
// Depth comes from per-frame samples d0..dN ('samples') or from arrival / peak / maximum ('ramp'); see lib/flood-scenario-model.js.
const samples = scenario.depth_model === 'samples';
const fields = buildingsJson && buildingFields(buildingsJson.fields);
const popupTemplate = fieldNames => ({
    title: '{occtype} · NSI {fd_id}',
    content: [
      { type: 'fields', fieldInfos: fieldInfos(scenario.arrival_labels).filter(f => fieldNames.includes(f.fieldName)) },
      ...hydrograph(samples, frames),
      { type: 'text', text: scenario.popup_note }]
});
let props;
let buildings;
if (buildingsJson) {
  props = rowsToObjects(buildingsJson);
  buildings = new FeatureLayer({
    title: 'Buildings (NSI)', minScale: 150_000, objectIdField: 'oid', fields, geometryType: 'point', spatialReference: { wkid: 4326 },
    source: props.map(({ lon, lat, ...a }, i) => new Graphic({ geometry: { type: 'point', longitude: lon, latitude: lat }, attributes: { oid: i + 1, ...a } })),
    popupTemplate: popupTemplate(fields.map(f => f.name))
  });
} else {
  // Parquet with longitude/latitude columns (the SDK's ParquetLayer, beta, reads those but not WKB points)
  buildings = new ParquetLayer({ title: 'Buildings (NSI)', minScale: 150_000, data: new ParquetFilesData({ urls: [new URL(DATA + scenario.buildings_parquet, location.href).href] }) });
  await buildings.load();
  buildings.popupTemplate = popupTemplate(buildings.fields.map(f => f.name));
  props = (await buildings.queryFeatures({ where: '1=1', outFields: ['*'], returnGeometry: false })).features.map(f => f.attributes); // for the summary panel
}
const depthExpression = (q, { i0, i1, w }) => samples
  ? `var a = $feature.arrive_hr; var d = IIf(!IsEmpty(a) && ${q} < a, 0, $feature.d${i0} * ${1 - w} + $feature.d${i1} * ${w});`
  : `var a = $feature.arrive_hr; var pk = $feature.peak_hr; var m = $feature.depth_max; var t = ${q}; var f = Min(1, m);
     var d = IIf(IsEmpty(a) || t < a, 0, IIf(t >= pk || pk <= a, m, f + (m - f) * (t - a) / (pk - a)));`;
const buildingRenderer = (q, b) => classRenderer(depthExpression(q, b), 0.5);

const themedBasemap = themedBasemaps(Basemap, TileLayer);
const map = new Map({ basemap: themedBasemap(), layers: [depth, front, buildings].filter(Boolean) });
const view = new MapView({ container: 'view', map, extent: extent.clone().expand(1.15), constraints: { snapToZoom: false } });
window.addEventListener('storm-theme-change', () => { map.basemap = themedBasemap(); });

let t = 0;
let shownHour = null;
let shownBlend = null;
let rendererAt = 0;
function render(next) {
  t = Math.min(Math.max(next, hours[0]), hours.at(-1));
  const { i0, i1, w } = blend(t, hours);
  showFrames(i0, i1, w, t);
  const hour = w < 0.5 ? frames[i0].hour : frames[i1].hour;
  if (front && hour !== shownHour) { shownHour = hour; front.definitionExpression = `hour = ${hour}`; }
  // ponytail: building symbols refresh every 15 model minutes (5 for small scenarios); per-frame renderer swaps cost more than they show
  const steps = props.length < 5000 ? 12 : 4;
  const q = Math.round(t * steps) / steps;
  // While playing, limit building renderer rebuilds to about three per second to preserve frame rate.
  if (q !== shownBlend && (!player.playing || performance.now() - rendererAt > 330)) { shownBlend = q; rendererAt = performance.now(); const b = blend(q, hours); buildings.renderer = buildingRenderer(q, { ...b, w: Number(b.w.toFixed(2)) }); }
  const s = summarize(props, t, hours);
  $('clock').textContent = clockLabel(t);
  $('s-acres').textContent = fmt.format(Math.round(frames[i0].wet_acres * (1 - w) + frames[i1].wet_acres * w));
  $('s-wet').textContent = fmt.format(s.wet);
  $('s-inside').textContent = fmt.format(s.inside);
  $('s-people').textContent = fmt.format(s.people);
  $('s-loss').textContent = usd.format(s.loss);
  if (Math.abs(Number($('time').value) - t) > 0.01) $('time').value = Number(t.toFixed(2));
  drawTraffic();
}

// Evacuation traffic (scenarios with "evacuation": true in index.json): cars from an evac-engine run, drawn over the map.
const entry = index.scenarios.find(s => s.id === id);
const carCanvas = entry.evacuation ? createTrafficCanvas(view, Point) : null;
let traffic = null;
function drawTraffic() {
  if (!carCanvas) return;
  carCanvas.draw($('traffic-show').checked ? traffic : null, t * 3600);
  if (traffic) trafficCounts(traffic, t);
}
const showTraffic = trafficLoader(id, next => { traffic = next; drawTraffic(); });
if (PHONE) {
  $('side-panel').collapsed = true;
  $('panel-toggle').hidden = false;
  $('panel-toggle').addEventListener('click', () => { $('side-panel').collapsed = !$('side-panel').collapsed; });
}
if (carCanvas) {
  $('traffic').hidden = false;
  $('traffic-note').textContent = 'Agent-based evacuation model following the LifeSim technical reference (Greenshields speed-density, spillback, '
    + 'rerouting around roads deeper than 0.5 ft). One car per household of night-time residents (NSI) on OpenStreetMap roads; exits are major roads '
    + 'half a mile beyond mapped water. Warning at 15 minutes; departure delays are a placeholder (mean 45 minutes), not a calibrated warning curve. '
    + 'The stress test compresses them to a quarter. No intersection or signal delay is modelled.';
  $('speed').value = '0.016667'; // one model minute per second: a typical trip takes a few minutes
  $('traffic-mode').addEventListener('calciteSegmentedControlChange', e => showTraffic(e.target.value));
  // load on first use: on phones the switch starts off, so the car data is only fetched when asked for
  $('traffic-show').addEventListener('calciteSwitchChange', () => { if ($('traffic-show').checked && !traffic) showTraffic($('traffic-mode').value); else drawTraffic(); });
  reactiveUtils.watch(() => [view.extent, view.size], () => carCanvas.draw(), { initial: false });
  if (PHONE) $('traffic-show').checked = false; else showTraffic('base');
}
// Click for depth (Zarr scenarios carry real values, not pictures): the modeled depth at that point, at the time shown.
if (zarr) {
  $('probe').hidden = false;
  view.on('click', e => {
    const { i0, i1, w } = blend(t, hours);
    const d = zarr.depthAt(e.mapPoint.x, e.mapPoint.y, i0, i1, w, t);
    $('probe').textContent = d == null ? 'Clicked point: outside the model area.'
      : d > 0 ? `Clicked point: ${d.toFixed(2)} ft of water at ${clockLabel(t)}.` : `Clicked point: dry at ${clockLabel(t)}.`;
  });
}

const player = createPlayer(hours, () => t, render);

// Open on the first hour with water, so the page does not start blank.
const firstWet = frames.findIndex(f => f.wet_acres > 0);
await view.when();
render(hours[Math.max(firstWet - 1, 0)]);
