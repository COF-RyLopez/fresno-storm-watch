// County 3D base (plan phase 1, stage A): the whole county and its upstream watersheds as one streamed three.js scene,
// to measure the shared engine before layers and Command move onto it. No operational data yet.
import { createCountyScene } from './lib/county3d/core.js';
import { USGS_IMAGERY } from './lib/county3d/terrain.js';
import { createBuildings } from './lib/county3d/buildings.js';
import { CONFIG } from './config.js';

const $ = id => document.getElementById(id);
const PRESETS = {
  county: { label: 'County overview', at: [-119.62, 36.82, 230_000, 40, 0] },
  metro: { label: 'Fresno–Clovis', at: [-119.76, 36.80, 16_000, 62, 20] },
  friant: { label: 'Friant · Millerton Lake', at: [-119.70, 37.00, 9_000, 66, 50] },
  pineflat: { label: 'Pine Flat Lake', at: [-119.31, 36.85, 11_000, 64, 70] },
  sierra: { label: 'Upper San Joaquin · Huntington Lake', at: [-119.22, 37.23, 26_000, 66, 40] },
  coalinga: { label: 'Coalinga', at: [-120.36, 36.14, 14_000, 62, 300] }
};

const params = new URLSearchParams(location.search);
const scene = createCountyScene({
  container: $('view'),
  // ?imagery=usgs: USGS National Map imagery (public domain, NAIP-based, to zoom 16) instead of Esri World Imagery
  terrain: { detail: Number(params.get('detail')) || 1.25, ...(params.get('imagery') === 'usgs' ? { imagery: USGS_IMAGERY, imageryMaxZoom: 16 } : {}) },
  onPerf({ fps, worst, pixelRatio, calls, triangles, terrain }) {
    $('perf').textContent = `${fps.toFixed(0)} fps, worst frame ${Math.round(worst)} ms · resolution ×${pixelRatio} · ${calls} draw calls, `
      + `${(triangles / 1e6).toFixed(2)} M triangles · tiles ${terrain.visible} shown / ${terrain.loaded} loaded, ${terrain.inflight} loading, finest z${terrain.maxZ}`;
  }
});

const go = id => { scene.view(...PRESETS[id].at); $('place').value = id; };
for (const [id, { label }] of Object.entries(PRESETS)) $('place').append(Object.assign(document.createElement('calcite-option'), { value: id, textContent: label }));
$('place').addEventListener('calciteSelectChange', e => go(e.target.value));
go(params.get('place') in PRESETS ? params.get('place') : 'county');

// Time of day (Pacific): moves the sun; the county is dark at night.
const pacificMidnight = () => {
  const now = new Date(), parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric' })
    .formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  return now.getTime() - ((parts.hour % 24) * 60 + parts.minute) * 60_000;
};
const midnight = pacificMidnight();
const showTime = hours => {
  const date = new Date(midnight + hours * 3_600_000), { elevation } = scene.setTime(date);
  $('time-label').textContent = `${date.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' })} PT · sun ${elevation.toFixed(0)}° above the horizon`;
};
const nowHours = (Date.now() - midnight) / 3_600_000;
$('time').value = Number(params.get('hour') ?? nowHours.toFixed(2));
showTime($('time').value);
$('time').addEventListener('calciteSliderInput', e => showTime(e.target.value));
$('now').addEventListener('click', () => { $('time').value = (Date.now() - midnight) / 3_600_000; showTime($('time').value); });

// County buildings from the R2 bucket (CONFIG.county3dBaseUrl), or local tiles from scripts/build-county3d-buildings.mjs
createBuildings({ county: scene, baseUrl: new URL('buildings/', CONFIG.county3dBaseUrl || new URL('./data/county3d/', location.href)) });
window.county3d = scene; // for checks from DevTools
$('loading').hidden = true;
