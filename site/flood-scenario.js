import { loadSdk } from './lib/map.js?v=0.40.0';
import { blend, clockLabel, rowsToObjects, summarize } from './lib/flood-scenario-model.js?v=0.39.0';
import { createTrafficCanvas, loadTraffic } from './lib/evacuation-traffic.js?v=0.19.0';
import { createFrameWindow } from './lib/frame-window.js?v=0.39.0';

const ROOT = './data/flood-scenarios/';
// Phones get the map first: the panel starts collapsed behind Details, and traffic loads only when switched on.
const PHONE = matchMedia('(max-width: 760px)').matches;
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

const index = await fetch(ROOT + 'index.json').then(r => r.json());
const requested = new URLSearchParams(location.search).get('scenario');
const id = index.scenarios.some(s => s.id === requested) ? requested : index.default;
const DATA = `${ROOT}${id}/`;
$('scenario-pick').innerHTML = index.scenarios.map(s => `<calcite-option value="${s.id}"${s.id === id ? ' selected' : ''}>${s.label}</calcite-option>`).join('');
$('scenario-pick').addEventListener('calciteSelectChange', e => { if (e.target.value !== id) location.search = `?scenario=${encodeURIComponent(e.target.value)}`; });
const [scenario, buildingsJson, sdk] = await Promise.all([
  fetch(DATA + 'scenario.json').then(r => r.json()),
  fetch(DATA + 'buildings.json').then(r => r.json()),
  loadSdk()
]);
const [Map, MapView, Basemap, TileLayer, MediaLayer, ImageElement, ExtentAndRotationGeoreference, Extent, FeatureLayer, GeoJSONLayer, Graphic, Point, reactiveUtils] = await sdk.import([
  '@arcgis/core/Map.js', '@arcgis/core/views/MapView.js', '@arcgis/core/Basemap.js', '@arcgis/core/layers/TileLayer.js',
  '@arcgis/core/layers/MediaLayer.js', '@arcgis/core/layers/support/ImageElement.js', '@arcgis/core/layers/support/ExtentAndRotationGeoreference.js',
  '@arcgis/core/geometry/Extent.js', '@arcgis/core/layers/FeatureLayer.js', '@arcgis/core/layers/GeoJSONLayer.js', '@arcgis/core/Graphic.js',
  '@arcgis/core/geometry/Point.js', '@arcgis/core/core/reactiveUtils.js'
]);

const frames = scenario.frames;
const hours = frames.map(f => f.hour);
const { wkid, ...bounds } = scenario.extent; // an unknown 'wkid' key zeroes the Extent
const extent = new Extent({ ...bounds, spatialReference: { wkid } });
$('scenario-title').textContent = scenario.title;
$('source').textContent = scenario.source;
$('notice').innerHTML = scenario.notice;
$('clock-note').textContent = scenario.clock_note;
const [arriveLabel, arrive2Label] = scenario.arrival_labels;
$('time').min = hours[0];
$('time').max = hours.at(-1);
const stops = scenario.legend;
$('ramp').style.background = `linear-gradient(to right, ${stops.map(s => `rgba(${s.rgba.slice(0, 3)},${s.rgba[3] / 255}) ${(100 * s.ft) / stops.at(-1).ft}%`).join(',')})`;
$('ramp-labels').innerHTML = stops.map(s => `<span>${s.ft}${s === stops.at(-1) ? '+' : ''}</span>`).join('');

// Depth: one image per model hour; playback cross-fades the two frames around the current fractional hour.
// Only the frames on screen (plus the next) are in the layer: all of them at once exhausted phone memory (lib/frame-window.js).
const depth = new MediaLayer({ source: [], title: 'Modeled depth', blendMode: 'normal' });
const showFrames = createFrameWindow(depth.source.elements,
  i => new ImageElement({ image: DATA + frames[i].image, opacity: 0, georeference: new ExtentAndRotationGeoreference({ extent }) }), frames.length);

const front = new GeoJSONLayer({
  url: DATA + 'front.geojson', title: 'Flood front', definitionExpression: 'hour = -1',
  renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 176, 0, 0.9], width: 1.5 } } }
});

// Buildings: the renderer compares depth at the displayed time with the first-floor height.
// Depth comes from per-frame samples d0..dN ('samples') or from arrival / peak / maximum ('ramp'); see lib/flood-scenario-model.js.
const samples = scenario.depth_model === 'samples';
const props = rowsToObjects(buildingsJson);
const INTEGER = new Set(['fd_id', 'stories', 'val_struct', 'pop_night', 'pop_day', 'loss_usd']);
const fields = [{ name: 'oid', type: 'oid' }, ...buildingsJson.fields.filter(f => f !== 'lon' && f !== 'lat')
  .map(name => ({ name, type: name === 'occtype' ? 'string' : INTEGER.has(name) ? 'integer' : 'double' }))];
const buildings = new FeatureLayer({
  title: 'Buildings (NSI)', minScale: 150_000, objectIdField: 'oid', fields, geometryType: 'point', spatialReference: { wkid: 4326 },
  source: props.map(({ lon, lat, ...a }, i) => new Graphic({ geometry: { type: 'point', longitude: lon, latitude: lat }, attributes: { oid: i + 1, ...a } })),
  popupTemplate: {
    title: '{occtype} · NSI {fd_id}',
    content: [
      { type: 'fields', fieldInfos: [
        { fieldName: 'depth_max', label: 'Maximum depth at building (ft)', format: { places: 1 } },
        { fieldName: 'found_ht', label: 'First-floor height (ft)', format: { places: 1 } },
        { fieldName: 'arrive_hr', label: arriveLabel, format: { places: 1 } },
        { fieldName: 'arrive2_hr', label: arrive2Label, format: { places: 1 } },
        { fieldName: 'peak_hr', label: 'Peak depth, hour' },
        { fieldName: 'vel_max', label: 'Maximum velocity (ft/s)', format: { places: 1 } },
        { fieldName: 'struct_pct', label: 'Hazus structure damage (%)', format: { places: 0 } },
        { fieldName: 'loss_usd', label: 'Hazus direct loss, structure + contents ($)', format: { digitSeparator: true, places: 0 } },
        { fieldName: 'pop_night', label: 'Residents, night (NSI)' }, { fieldName: 'pop_day', label: 'Occupants, day (NSI)' }]
        .filter(f => fields.some(x => x.name === f.fieldName)) },
      ...(samples ? [{ type: 'media', mediaInfos: [{ type: 'line-chart', title: 'Depth at building by model frame (ft)', value: { fields: frames.map((_, i) => `d${i}`) } }] }] : []),
      { type: 'text', text: scenario.popup_note }]
  }
});
const depthExpression = (q, { i0, i1, w }) => samples
  ? `var d = $feature.d${i0} * ${1 - w} + $feature.d${i1} * ${w};`
  : `var a = $feature.arrive_hr; var pk = $feature.peak_hr; var m = $feature.depth_max; var t = ${q}; var f = Min(1, m);
     var d = IIf(IsEmpty(a) || t < a, 0, IIf(t >= pk || pk <= a, m, f + (m - f) * (t - a) / (pk - a)));`;
const buildingRenderer = (q, b) => ({
  type: 'class-breaks',
  valueExpression: `${depthExpression(q, b)} iif(d <= 0, -99, d - $feature.found_ht)`,
  defaultSymbol: { type: 'simple-marker', size: 5, color: '#8b949e', outline: { color: [0, 0, 0, 0.5], width: 0.5 } },
  classBreakInfos: [
    [-99, -98, '#8b949e', 4], [-98, 0, '#f2cc60', 5], [0, 2, '#f0883e', 6], [2, 6, '#da3633', 7], [6, 99, '#8e1519', 8]
  ].map(([minValue, maxValue, color, size]) => ({ minValue, maxValue, symbol: { type: 'simple-marker', size, color, outline: { color: [0, 0, 0, 0.6], width: 0.6 } } }))
});

const basemaps = {};
const themedBasemap = () => {
  const mode = document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark';
  return basemaps[mode] ??= new Basemap({
    baseLayers: [new TileLayer({ url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${mode}_Gray_Base/MapServer` })],
    referenceLayers: [new TileLayer({ url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${mode}_Gray_Reference/MapServer` })]
  });
};
const map = new Map({ basemap: themedBasemap(), layers: [depth, front, buildings] });
const view = new MapView({ container: 'view', map, extent: extent.clone().expand(1.15), constraints: { snapToZoom: false } });
window.addEventListener('storm-theme-change', () => { map.basemap = themedBasemap(); });

let t = 0;
let shownHour = null;
let shownBlend = null;
let rendererAt = 0;
function render(next) {
  t = Math.min(Math.max(next, hours[0]), hours.at(-1));
  const { i0, i1, w } = blend(t, hours);
  showFrames(i0, i1, w);
  const hour = w < 0.5 ? frames[i0].hour : frames[i1].hour;
  if (hour !== shownHour) { shownHour = hour; front.definitionExpression = `hour = ${hour}`; }
  const q = Math.round(t * 4) / 4; // ponytail: building symbols refresh every 15 model minutes; per-frame renderer swaps cost more than they show
  // ponytail: while playing, rebuild the building renderer at most ~3 times a second (44k points in the Fresno scenario)
  if (q !== shownBlend && (!playing || performance.now() - rendererAt > 330)) { shownBlend = q; rendererAt = performance.now(); const b = blend(q, hours); buildings.renderer = buildingRenderer(q, { ...b, w: Number(b.w.toFixed(2)) }); }
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
let trafficLoad = 0;
function drawTraffic() {
  if (!carCanvas) return;
  carCanvas.draw($('traffic-show').checked ? traffic : null, t * 3600);
  if (!traffic) return;
  const m = Math.min(traffic.meta.minute_on_road.length - 1, Math.max(0, Math.floor(t * 60)));
  $('t-road').textContent = fmt.format(traffic.meta.minute_on_road[m]);
  $('t-safe').textContent = fmt.format(traffic.meta.minute_people_safe[m]);
}
async function showTraffic(mode) {
  const ticket = ++trafficLoad;
  try {
    const next = await loadTraffic(`./data/evacuation/${id}/${mode}/`);
    if (ticket !== trafficLoad) return;
    traffic = next;
    $('t-trap').textContent = fmt.format(traffic.meta.outcome_people.Waiting);
    $('t-exits').textContent = fmt.format(traffic.exits.length);
    drawTraffic();
  } catch (error) { console.warn('Evacuation traffic:', error.message); $('traffic').hidden = true; }
}
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

let playing = false;
let last = 0;
function tick(now) {
  if (!playing) return;
  const rate = Number($('speed').value) || 1;
  if (last) render(t + ((now - last) / 1000) * rate);
  last = now;
  if (t >= hours.at(-1)) setPlaying(false); else requestAnimationFrame(tick);
}
function setPlaying(on) {
  playing = on;
  last = 0;
  $('play').iconStart = on ? 'pause' : 'play';
  $('play').textContent = on ? 'Pause' : 'Play';
  if (!on) render(t); // the throttle may have skipped the last building update
  if (on) { if (t >= hours.at(-1)) render(hours[0]); requestAnimationFrame(tick); }
}
$('play').addEventListener('click', () => setPlaying(!playing));
$('time').addEventListener('calciteSliderInput', e => { const v = Number(e.target.value); setPlaying(false); render(v); }); // read first: pausing re-renders and resets the slider

// Open on the first hour with water, so the page does not start blank.
const firstWet = frames.findIndex(f => f.wet_acres > 0);
await view.when();
render(hours[Math.max(firstWet - 1, 0)]);
