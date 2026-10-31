// Shared by the 2D and 3D flood-scenario pages (flood-scenario.js, flood-scenario-3d.js): scenario picker, header and legend,
// building popup fields and classes, themed basemap, evacuation traffic loading, and the play / slider controls.
import { loadTraffic } from './evacuation-traffic.js?v=0.74.0-scenarios';

const $ = id => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');

/** index.json, the scenario asked for in ?scenario= (else the default), and a picker that reloads the page on change. */
export async function pickScenario(root) {
  const index = await fetch(root + 'index.json', { cache: 'no-cache' }).then(r => r.json());
  const requested = new URLSearchParams(location.search).get('scenario');
  const id = index.scenarios.some(s => s.id === requested) ? requested : index.default;
  $('scenario-pick').innerHTML = index.scenarios.map(s => `<calcite-option value="${s.id}"${s.id === id ? ' selected' : ''}>${s.label}</calcite-option>`).join('');
  $('scenario-pick').addEventListener('calciteSelectChange', e => { if (e.target.value !== id) location.search = `?scenario=${encodeURIComponent(e.target.value)}`; });
  return { index, id, DATA: `${root}${id}/` };
}

/** Header, notes, slider bounds and depth legend from scenario.json; returns the frame hours and the model extent. */
export function showScenario(scenario, Extent) {
  const frames = scenario.frames;
  const hours = frames.map(f => f.hour);
  const { wkid, ...bounds } = scenario.extent; // an unknown 'wkid' key zeroes the Extent
  const extent = new Extent({ ...bounds, spatialReference: { wkid } });
  $('scenario-title').textContent = scenario.title;
  $('source').textContent = scenario.source;
  $('notice').innerHTML = scenario.notice;
  $('clock-note').textContent = scenario.clock_note;
  $('time').min = hours[0];
  $('time').max = hours.at(-1);
  const stops = scenario.legend;
  $('ramp').style.background = `linear-gradient(to right, ${stops.map(s => `rgba(${s.rgba.slice(0, 3)},${s.rgba[3] / 255}) ${(100 * s.ft) / stops.at(-1).ft}%`).join(',')})`;
  $('ramp-labels').innerHTML = stops.map(s => `<span>${s.ft}${s === stops.at(-1) ? '+' : ''}</span>`).join('');
  return { frames, hours, extent, stops };
}

/** Building popup rows; arrival labels come from scenario.arrival_labels. */
export const fieldInfos = ([arriveLabel, arrive2Label]) => [
  { fieldName: 'depth_max', label: 'Maximum depth at building (ft)', format: { places: 1 } },
  { fieldName: 'found_ht', label: 'First-floor height (ft)', format: { places: 1 } },
  { fieldName: 'arrive_hr', label: arriveLabel, format: { places: 1 } },
  { fieldName: 'arrive2_hr', label: arrive2Label, format: { places: 1 } },
  { fieldName: 'peak_hr', label: 'Peak depth, hour' },
  { fieldName: 'vel_max', label: 'Maximum velocity (ft/s)', format: { places: 1 } },
  { fieldName: 'struct_pct', label: 'Hazus structure damage (%)', format: { places: 0 } },
  { fieldName: 'loss_usd', label: 'Hazus direct loss, structure + contents ($)', format: { digitSeparator: true, places: 0 } },
  { fieldName: 'pop_night', label: 'Residents, night (NSI)' }, { fieldName: 'pop_day', label: 'Occupants, day (NSI)' }];
/** Per-frame depth chart for 'samples' scenarios (fields d0..dN). */
export const hydrograph = (samples, frames) => (samples ? [{ type: 'media', mediaInfos: [{ type: 'line-chart', title: 'Depth at building by model frame (ft)', value: { fields: frames.map((_, i) => `d${i}`) } }] }] : []);
const INTEGER = new Set(['fd_id', 'stories', 'val_struct', 'pop_night', 'pop_day', 'loss_usd']);
/** FeatureLayer fields for buildings.json columns (lon/lat become the geometry). */
export const buildingFields = names => [{ name: 'oid', type: 'oid' }, ...names.filter(f => f !== 'lon' && f !== 'lat')
  .map(name => ({ name, type: name === 'occtype' ? 'string' : INTEGER.has(name) ? 'integer' : 'double' }))];

/** Building classes [min, max, colour, marker size]: dry, wet below the first floor, then 0-2, 2-6, 6+ ft inside. */
export const CLASSES = [[-99, -98, '#8b949e', 4], [-98, 0, '#f2cc60', 5], [0, 2, '#f0883e', 6], [2, 6, '#da3633', 7], [6, 99, '#8e1519', 8]];
const marker = (color, size, o = 0.6) => ({ type: 'simple-marker', size, color, outline: { color: [0, 0, 0, o], width: o } });
/** Point renderer from an Arcade snippet that sets d (depth at the building); defaultOutline is the grey default marker's outline. */
export const classRenderer = (depth, defaultOutline = 0.6) => ({
  type: 'class-breaks', valueExpression: `${depth} iif(d <= 0, -99, d - $feature.found_ht)`, defaultSymbol: marker('#8b949e', 5, defaultOutline),
  classBreakInfos: CLASSES.map(([minValue, maxValue, color, size]) => ({ minValue, maxValue, symbol: marker(color, size) }))
});

/** () => the Esri gray canvas basemap for the page theme, one instance per theme. */
export function themedBasemaps(Basemap, TileLayer) {
  const basemaps = {};
  return () => {
    const mode = document.documentElement.dataset.theme === 'light' ? 'Light' : 'Dark';
    return basemaps[mode] ??= new Basemap({
      baseLayers: [new TileLayer({ url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${mode}_Gray_Base/MapServer` })],
      referenceLayers: [new TileLayer({ url: `https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${mode}_Gray_Reference/MapServer` })]
    });
  };
}

/** mode => load that evacuation run for scenario id, fill the totals and hand it to use(); a newer request wins. */
export function trafficLoader(id, use) {
  let ticket = 0;
  return async mode => {
    const mine = ++ticket;
    try {
      const next = await loadTraffic(`./data/evacuation/${id}/${mode}/`);
      if (mine !== ticket) return;
      $('t-trap').textContent = fmt.format(next.meta.outcome_people.Waiting);
      $('t-exits').textContent = fmt.format(next.exits.length);
      use(next);
    } catch (error) { console.warn('Evacuation traffic:', error.message); $('traffic').hidden = true; }
  };
}
/** Cars on the road and people safe at model time t (hours). */
export function trafficCounts(traffic, t) {
  const m = Math.min(traffic.meta.minute_on_road.length - 1, Math.max(0, Math.floor(t * 60)));
  $('t-road').textContent = fmt.format(traffic.meta.minute_on_road[m]);
  $('t-safe').textContent = fmt.format(traffic.meta.minute_people_safe[m]);
}

/** Play / pause and the time slider; render(t) draws model time t and time() reads the time shown. player.playing is live. */
export function createPlayer(hours, time, render) {
  const player = { playing: false, setPlaying };
  let last = 0;
  function tick(now) {
    if (!player.playing) return;
    const rate = Number($('speed').value) || 1;
    if (last) render(time() + ((now - last) / 1000) * rate);
    last = now;
    if (time() >= hours.at(-1)) setPlaying(false); else requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    player.playing = on;
    last = 0;
    $('play').iconStart = on ? 'pause' : 'play';
    $('play').textContent = on ? 'Pause' : 'Play';
    if (!on) render(time()); // the throttle may have skipped the last building update
    if (on) { if (time() >= hours.at(-1)) render(hours[0]); requestAnimationFrame(tick); }
  }
  $('play').addEventListener('click', () => setPlaying(!player.playing));
  $('time').addEventListener('calciteSliderInput', e => { const v = Number(e.target.value); setPlaying(false); render(v); }); // read first: pausing re-renders and resets the slider
  return player;
}
