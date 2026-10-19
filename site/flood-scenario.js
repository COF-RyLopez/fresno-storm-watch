import { loadSdk } from './lib/map.js';
import { blend, clockLabel, depthAt, summarize } from './lib/flood-scenario-model.js';

const DATA = './data/flood-scenarios/muncie/';
const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

const [scenario, buildingsJson, sdk] = await Promise.all([
  fetch(DATA + 'scenario.json').then(r => r.json()),
  fetch(DATA + 'buildings.geojson').then(r => r.json()),
  loadSdk()
]);
const [Map, MapView, Basemap, TileLayer, MediaLayer, ImageElement, ExtentAndRotationGeoreference, Extent, FeatureLayer, GeoJSONLayer, Graphic] = await sdk.import([
  '@arcgis/core/Map.js', '@arcgis/core/views/MapView.js', '@arcgis/core/Basemap.js', '@arcgis/core/layers/TileLayer.js',
  '@arcgis/core/layers/MediaLayer.js', '@arcgis/core/layers/support/ImageElement.js', '@arcgis/core/layers/support/ExtentAndRotationGeoreference.js',
  '@arcgis/core/geometry/Extent.js', '@arcgis/core/layers/FeatureLayer.js', '@arcgis/core/layers/GeoJSONLayer.js', '@arcgis/core/Graphic.js'
]);

const frames = scenario.frames;
const n = frames.length;
const { wkid, ...bounds } = scenario.extent; // an unknown 'wkid' key zeroes the Extent
const extent = new Extent({ ...bounds, spatialReference: { wkid } });
$('scenario-title').textContent = scenario.title;
$('source').textContent = scenario.source;
$('time').max = n - 1;
const stops = scenario.legend;
$('ramp').style.background = `linear-gradient(to right, ${stops.map(s => `rgba(${s.rgba.slice(0, 3)},${s.rgba[3] / 255}) ${(100 * s.ft) / stops.at(-1).ft}%`).join(',')})`;
$('ramp-labels').innerHTML = stops.map(s => `<span>${s.ft}${s === stops.at(-1) ? '+' : ''}</span>`).join('');

// Depth: one image per model hour; playback cross-fades the two frames around the current fractional hour.
const elements = frames.map(f => new ImageElement({ image: DATA + f.image, opacity: 0, georeference: new ExtentAndRotationGeoreference({ extent }) }));
const depth = new MediaLayer({ source: elements, title: 'Modeled depth', blendMode: 'normal' });

const front = new GeoJSONLayer({
  url: DATA + 'front.geojson', title: 'Flood front', definitionExpression: 'hour = -1',
  renderer: { type: 'simple', symbol: { type: 'simple-fill', color: [0, 0, 0, 0], outline: { color: [255, 176, 0, 0.95], width: 2 } } }
});

// Buildings: hourly depth samples d0..dN are fields; the renderer compares interpolated depth with the first-floor height.
const props = buildingsJson.features.map(f => f.properties);
const fieldType = v => (Number.isInteger(v) ? 'integer' : typeof v === 'number' ? 'double' : 'string');
const sample = props.find(p => p.arrive_hr != null) ?? props[0];
const fields = [{ name: 'oid', type: 'oid' }, ...Object.entries(sample).map(([name, v]) => ({ name, type: /^d\d+$/.test(name) || /_hr$|_max$|_ht$|_pct$/.test(name) ? 'double' : fieldType(v) }))];
const buildings = new FeatureLayer({
  title: 'Buildings (NSI)', objectIdField: 'oid', fields, geometryType: 'point', spatialReference: { wkid: 4326 },
  source: buildingsJson.features.map((f, i) => new Graphic({ geometry: { type: 'point', longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1] }, attributes: { oid: i + 1, ...f.properties } })),
  popupTemplate: {
    title: '{occtype} · NSI {fd_id}',
    content: [
      { type: 'fields', fieldInfos: [
        { fieldName: 'depth_max', label: 'Maximum depth at building (ft)', format: { places: 1 } },
        { fieldName: 'found_ht', label: 'First-floor height (ft)', format: { places: 1 } },
        { fieldName: 'arrive_hr', label: 'Water arrives (0.1 ft), hour', format: { places: 1 } },
        { fieldName: 'arrive2_hr', label: '2 ft deep, hour', format: { places: 1 } },
        { fieldName: 'peak_hr', label: 'Peak depth, hour' },
        { fieldName: 'vel_max', label: 'Maximum velocity (ft/s)', format: { places: 1 } },
        { fieldName: 'struct_pct', label: 'Hazus structure damage (%)', format: { places: 0 } },
        { fieldName: 'loss_usd', label: 'Hazus direct loss, structure + contents ($)', format: { digitSeparator: true, places: 0 } },
        { fieldName: 'pop_night', label: 'Residents, night (NSI)' }, { fieldName: 'pop_day', label: 'Occupants, day (NSI)' }] },
      { type: 'media', mediaInfos: [{ type: 'line-chart', title: 'Depth at building by hour (ft)', value: { fields: frames.map(f => `d${f.hour}`) } }] },
      { type: 'text', text: 'Model values from a demonstration HEC-RAS run. Losses use the Hazus 7.2 per-building flood method at maximum depth.' }]
  }
});
const buildingRenderer = (i0, i1, w) => ({
  type: 'class-breaks',
  valueExpression: `var d = $feature.d${i0} * ${1 - w} + $feature.d${i1} * ${w}; iif(d <= 0, -99, d - $feature.found_ht)`,
  defaultSymbol: { type: 'simple-marker', size: 5, color: '#8b949e', outline: { color: [0, 0, 0, 0.5], width: 0.5 } },
  classBreakInfos: [
    [-99, -98, '#8b949e', 5], [-98, 0, '#f2cc60', 7], [0, 2, '#f0883e', 8], [2, 6, '#da3633', 9], [6, 99, '#8e1519', 10]
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
function render(next) {
  t = Math.min(Math.max(next, 0), n - 1);
  const { i0, i1, w } = blend(t, n);
  elements.forEach((e, i) => { e.opacity = i === i0 ? 1 - w : i === i1 && i1 !== i0 ? w : 0; });
  const hour = Math.round(t);
  if (hour !== shownHour) { shownHour = hour; front.definitionExpression = `hour = ${frames[hour].hour}`; }
  const q = Math.round(t * 4) / 4; // ponytail: building symbols refresh every 15 model minutes; per-frame renderer swaps cost more than they show
  if (q !== shownBlend) { shownBlend = q; const b = blend(q, n); buildings.renderer = buildingRenderer(b.i0, b.i1, Number(b.w.toFixed(2))); }
  const s = summarize(props, t, n);
  $('clock').textContent = clockLabel(t);
  $('s-acres').textContent = fmt.format(Math.round(frames[i0].wet_acres * (1 - w) + frames[i1].wet_acres * w));
  $('s-wet').textContent = fmt.format(s.wet);
  $('s-inside').textContent = fmt.format(s.inside);
  $('s-people').textContent = fmt.format(s.people);
  $('s-loss').textContent = usd.format(s.loss);
  if (Math.abs(Number($('time').value) - t) > 0.01) $('time').value = Number(t.toFixed(2));
}

let playing = false;
let last = 0;
function tick(now) {
  if (!playing) return;
  const rate = Number($('speed').value) || 1;
  if (last) render(t + ((now - last) / 1000) * rate);
  last = now;
  if (t >= n - 1) setPlaying(false); else requestAnimationFrame(tick);
}
function setPlaying(on) {
  playing = on;
  last = 0;
  $('play').iconStart = on ? 'pause' : 'play';
  $('play').textContent = on ? 'Pause' : 'Play';
  if (on) { if (t >= n - 1) render(0); requestAnimationFrame(tick); }
}
$('play').addEventListener('click', () => setPlaying(!playing));
$('time').addEventListener('calciteSliderInput', e => { setPlaying(false); render(Number(e.target.value)); });

// Open on the first hour with water, so the page does not start blank.
const firstWet = frames.findIndex(f => f.wet_acres > 0);
await view.when();
render(Math.max(firstWet - 1, 0));
