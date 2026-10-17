import { CONFIG } from './config.js';
import { CATEGORIES, initialState, acceptSnapshot, rejectSnapshot, clearNotice, bannerState, formatTime, normalizeAlerts } from './lib/model.js';
import { loadCounties, fetchRegionalAlerts } from './lib/nws.js';
import { createMap } from './lib/map.js';
import { setupAuth } from './lib/auth.js';
import { exerciseBatches } from './lib/exercise.js';
import { createRiverWatch } from './lib/river-ui.js';
import { createCameraWatch } from './lib/camera-ui.js';
import { createEnvironmentWatch } from './lib/environment-ui.js';
import { createPlanningWatch } from './lib/planning-ui.js';
import { createWorkspace } from './lib/workspace-ui.js';

const $ = id => document.getElementById(id);
const exercise = new URLSearchParams(location.search).get('exercise') === '1';
const exerciseClock = Date.now();
let scenario = 'baseline';
let state = initialState();
let counties;
let map;
let selectedKey = null;
let filter = 'All';
let timer;
let nextCheck = null;
let expirationCheck = null;
let rivers;
let cameras;
let environment;
let planning;
let planningExerciseEntries=null;
let riverView=true;
const workspace=createWorkspace({onCameraChange:open=>cameras?.setOpen(open)});

/** @returns {void} Keep the river geography distinct from the weather-alert query region. */
function renderScope() {
  $('scope-label').textContent=riverView?'Fresno County · boundary river reaches':'Fresno · Madera · Merced · Kings · Tulare';
  $('map-panel').setAttribute('heading',`${riverView?'Fresno County river areas':'Five-county weather overview'}${exercise?' · EXERCISE':''}`);
  $('fit-region').setAttribute('text',riverView?'Fit Fresno County':'Fit region');
  $('scope-note').textContent=riverView?'Fresno river reaches · counts stay fixed when panning':state.error?'Last successful polygons · source check failed':'Panning does not change the regional alert count';
}

/** @param {boolean} showRivers @returns {void} Change the work panel without changing either source's scope. */
function planningView(showRivers) {
  riverView=showRivers;
  $('environment-panel').hidden=true;
  $('watch-panel').hidden=true;
  for(const id of ['river-panel','river-metrics']) $(id).hidden=!showRivers;
  for(const id of ['weather-panel','weather-banner-wrap','weather-metrics','weather-footer']) $(id).hidden=showRivers;
  workspace.showPanel(showRivers?'rivers':'alerts');
  renderScope();map?.setScope(showRivers?'fresno':'regional');
}
$('view-rivers').addEventListener('click',()=>planningView(true));
$('view-alerts').addEventListener('click',()=>planningView(false));
function openEnvironment(){
  planningView(true);$('river-panel').hidden=true;$('environment-panel').hidden=false;
  workspace.showPanel('environment');
}
$('view-environment').addEventListener('click',openEnvironment);
function openPlanning(){
  planningView(true);$('river-panel').hidden=true;$('watch-panel').hidden=false;
  workspace.showPanel('watch');
}
$('view-watch').addEventListener('click',openPlanning);
planning=createPlanningWatch({config:CONFIG,timeZone:CONFIG.timeZone,exercise,onOpen:openPlanning,onMap:workspace.showMap,onGauge:id=>rivers?.select(id),onConditions:openEnvironment,onExercise:entries=>{planningExerciseEntries=entries;rivers?.setExerciseEntries(entries);}});
environment=createEnvironmentWatch({config:CONFIG.environment,timeZone:CONFIG.timeZone,exercise,onOpen:openEnvironment,onMap:workspace.showMap,onReservoirData:data=>planning.setReservoirData(data)});
if(new URLSearchParams(location.search).get('view')==='conditions')openEnvironment();
if(new URLSearchParams(location.search).get('view')==='watch')openPlanning();
void createRiverWatch({config:CONFIG.rivers,timeZone:CONFIG.timeZone,exercise,onOpen:()=>planningView(true),onMap:workspace.showMap,onData:data=>planning.setRiverData(data)}).then(controller=>{rivers=controller;if(planningExerciseEntries)rivers.setExerciseEntries(planningExerciseEntries);if(map)rivers.setMap(map);});
void createCameraWatch({config:CONFIG.cameras,timeZone:CONFIG.timeZone,exercise,initialOpen:workspace.camerasOpen,onOpenChange:workspace.setCameras,onMap:workspace.showMap,onGauge:id=>rivers?.select(id)}).then(controller=>{cameras=controller;cameras.setOpen(workspace.camerasOpen);if(map)cameras.setMap(map);});

/** @param {string} tag @param {string} text @param {string} className @returns {HTMLElement} Publisher values are always text, never HTML. */
function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

/** @param {string} tag @param {string} text @param {object} attributes @returns {HTMLElement} Attributes are safe before custom-element upgrade. */
function component(tag, text, attributes = {}) {
  const node = element(tag, text);
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== false && value !== null) node.setAttribute(name, value === true ? '' : String(value));
  }
  return node;
}

/** @returns {void} Render health separately from hazard counts. */
function renderBanner() {
  const banner = bannerState(state, Date.now(), CONFIG.staleMs);
  $('banner').dataset.tone = banner.tone;
  $('banner').setAttribute('kind', ['failure', 'warning'].includes(banner.tone) ? 'danger' : banner.tone === 'watch' ? 'warning' : 'info');
  $('banner').setAttribute('icon', ['failure', 'warning'].includes(banner.tone) ? 'exclamation-mark-triangle' : 'bell');
  const content = `${banner.title}|${banner.detail}`;
  if ($('banner').dataset.content !== content) {
    $('banner-title').textContent = banner.title;
    $('banner-detail').textContent = banner.detail;
    $('banner').dataset.content = content;
  }
  $('clear-notice').toggleAttribute('disabled', !state.pending.size);
  $('clear-notice').setAttribute('text', state.pending.size ? `Clear notification (${state.pending.size})` : 'Notifications cleared');
  $('clear-notice').setAttribute('slot', matchMedia('(max-width:680px)').matches ? 'link' : 'actions-end');
  $('clear-notice').hidden = state.lastSuccess === null || state.alerts.length === 0;
  $('feed-status').textContent = state.busy ? 'Checking NWS…' : state.error ? 'Update failed' : banner.tone === 'failure' ? 'Check overdue' : state.lastSuccess === null ? 'Waiting for NWS' : exercise ? 'Exercise data' : 'NWS check complete';
  $('feed-status').setAttribute('label', $('feed-status').textContent);
  $('feed-status').dataset.tone = state.error || banner.tone === 'failure' ? 'failure' : 'normal';
  $('last-check').textContent = formatTime(state.lastSuccess, CONFIG.timeZone);
  $('attempt-time').textContent = formatTime(state.lastAttempt, CONFIG.timeZone);
  $('feed-error').hidden = !state.error;
  $('feed-error').textContent = state.error || '';
  $('refresh').toggleAttribute('disabled', state.busy || !counties);
  $('refresh').toggleAttribute('loading', state.busy);
  $('refresh').textContent = state.busy ? 'Checking…' : 'Refresh now';
  $('next-check').textContent = exercise ? 'Manual exercise controls' : document.hidden ? 'Resumes when tab is visible' : nextCheck ? `Next check in ${Math.max(0, Math.ceil((nextCheck - Date.now()) / 1000))}s` : 'Checking now';
  const newest = state.alerts.map(a => a.ingested).filter(t => t !== null);
  $('source-ingested').textContent = newest.length ? formatTime(Math.max(...newest), CONFIG.timeZone) : state.lastSuccess === null ? 'No successful result yet' : state.alerts.length ? 'Not supplied by NWS' : 'Not supplied for an empty result';
  for (const type of Object.keys(CATEGORIES)) $('count-' + type).textContent = state.lastSuccess === null ? '—' : state.alerts.filter(a => a.category === type).length;
  $('view-alerts').setAttribute('text', `Weather alerts${state.lastSuccess!==null?` · ${state.alerts.length}`:''}${state.pending.size?` · ${state.pending.size} new`:''}${state.error?' · check failed':banner.tone==='failure'?' · check overdue':''}`);
  $('view-alerts').toggleAttribute('indicator',!!state.pending.size||!!state.error);
  $('count-context').textContent = state.error || banner.tone === 'failure' ? 'Last successful result · may be outdated' : 'Alerts intersecting the fixed five-county region';
  renderScope();
}

/** @returns {void} Draw the fixed-region list; the category filter is local to this list. */
function renderList() {
  const host = $('alert-list');
  host.replaceChildren();
  const visible = state.alerts.filter(a => filter === 'All' || a.category === filter);
  $('list-count').textContent = state.lastSuccess === null ? '—' : String(state.alerts.length);
  $('list-count').setAttribute('label', `Regional alert count: ${state.lastSuccess === null ? 'not available' : state.alerts.length}`);
  if (!visible.length) {
    const box = element('div', '', 'empty-state');
    box.slot = 'empty-content';
    box.append(component('calcite-icon', '', { icon:'information', scale:'l' }), element('h3', state.lastSuccess === null ? 'Waiting for a complete check' : state.alerts.length ? 'No alerts in this category' : 'No alerts returned'),
      element('p', state.error ? 'The NWS update could not be completed. Check the source link below.' : state.alerts.length ? 'The regional banner still includes every alert category.' : 'An empty result is not an all-clear. Continue to monitor official forecasts.'));
    host.append(box);
  }
  for (const alert of visible) {
    const item = component('calcite-list-item', '', {
      class:`alert-card ${alert.category.toLowerCase()}`, value:alert.key, label:alert.type,
      description:`${alert.category} · ${alert.counties.join(' · ')}`, selected:selectedKey === alert.key,
      'icon-start': alert.category === 'Warning' ? 'exclamation-mark-triangle' : alert.category === 'Watch' ? 'clock' : 'information'
    });
    const meta = element('div', `Expires ${formatTime(alert.expires, CONFIG.timeZone)}`, 'alert-meta');
    meta.slot = 'content-bottom';
    if (alert.expires !== null && alert.expires <= Date.now()) meta.append(element('p', 'Expiration passed · verify source', 'quality'));
    if (alert.quality) meta.append(element('p', alert.quality, 'quality'));
    item.append(meta);
    if (state.pending.has(alert.signature)) item.append(component('calcite-chip', 'New', { class:'new-chip', slot:'content-end', label:'New or updated alert', scale:'s' }));
    host.append(item);
  }
  $('result-change').textContent = state.change && !state.change.initial && state.change.noLongerReturned
    ? `${state.change.noLongerReturned} previous ${state.change.noLongerReturned === 1 ? 'revision is' : 'revisions are'} no longer in this result. This is not an all-clear.` : '';
}

/** @param {string|null} key @returns {void} Selection opens details; it does not clear notifications or acknowledge. */
function selectAlert(key) {
  selectedKey = key;
  for (const item of $('alert-list').querySelectorAll('calcite-list-item')) item.toggleAttribute('selected', item.getAttribute('value') === key);
  renderDetail();
  map?.select(state.alerts.find(a => a.key === key));
}

/** @returns {void} Preserve source timestamps and original product names in the detail panel. */
function renderDetail() {
  const alert = state.alerts.find(a => a.key === selectedKey);
  const host = $('alert-detail');
  host.replaceChildren();
  if (!alert) {
    host.append(element('p', 'Select an alert to see its NWS issue time, expiration and official source.', 'muted'));
    return;
  }
  host.append(component('calcite-chip', alert.category, { class:`category-chip ${alert.category.toLowerCase()}`, label:alert.category, scale:'s' }), element('h3', alert.type));
  const data = element('dl');
  for (const [label, value] of [['Issuing office', alert.office], ['Issued', formatTime(alert.issued, CONFIG.timeZone)], ['Effective / onset', formatTime(alert.onset, CONFIG.timeZone)], ['Expires', formatTime(alert.expires, CONFIG.timeZone)], ['NWS ingestion', formatTime(alert.ingested, CONFIG.timeZone)], ['Intersecting counties', alert.counties.join(', ')]]) {
    data.append(element('dt', label), element('dd', value));
  }
  host.append(data);
  if (alert.quality) host.append(element('p', alert.quality, 'quality'));
  if (exercise) host.append(element('p', 'Fictional exercise record. There is no official NWS alert for this record.', 'quality'));
  const actions = element('div', '', 'detail-actions');
  if (!exercise) actions.append(component('calcite-button', 'NWS alert record', { href:alert.sourceUrl, target:'_blank', rel:'noopener noreferrer', appearance:'outline', scale:'s', 'icon-end':'launch' }));
  const zoom = component('calcite-button', 'Zoom to alert', { appearance:'outline', scale:'s', 'icon-start':'extent', disabled:!map });
  zoom.addEventListener('click', () => { workspace.showMap(); map?.select(alert, true); });
  actions.append(zoom);
  host.append(actions);
}

/** @returns {Promise<void>} Serialized polls; a failed county prevents all five from committing. */
async function refresh() {
  if (state.busy || !counties) return;
  clearTimeout(timer);
  state = { ...state, busy: true, lastAttempt: Date.now() };
  nextCheck = null;
  renderBanner();
  try {
    const alerts = exercise ? normalizeAlerts(exerciseBatches(scenario, exerciseClock), Date.now()) : await fetchRegionalAlerts(counties, CONFIG);
    state = acceptSnapshot(state, alerts, Date.now());
    expirationCheck = Math.min(...alerts.filter(a => a.expires !== null).map(a => a.expires));
    if (!state.alerts.some(a => a.key === selectedKey)) selectedKey = null;
    map?.update(state.alerts);
    map?.select(state.alerts.find(a => a.key === selectedKey));
  } catch (error) {
    state = rejectSnapshot(state, error.message || 'The regional update did not complete.', Date.now());
  } finally {
    nextCheck = exercise ? null : Date.now() + CONFIG.pollMs;
    renderBanner(); renderList(); renderDetail();
    if (!exercise) timer = setTimeout(() => { if (!document.hidden) void refresh(); }, CONFIG.pollMs);
  }
}

$('refresh').addEventListener('click', () => void refresh());
$('clear-notice').addEventListener('click', () => { state = clearNotice(state); renderBanner(); renderList(); });
$('fit-region').addEventListener('click', () => map?.fit());
$('alert-filter').addEventListener('calciteSelectChange', event => { filter = event.target.value; renderList(); });
$('alert-list').addEventListener('calciteListChange', event => {
  const key = event.target.selectedItems?.[0]?.value;
  if (key && key !== selectedKey) selectAlert(key);
});
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('calcite-dialog').removeAttribute('open')));
$('about').addEventListener('click', () => $('sources-dialog').setAttribute('open', ''));
const interfaceTimeout = setTimeout(() => { $('interface-status').hidden = false; }, 15_000);
void Promise.all(['calcite-shell','calcite-shell-panel','calcite-action-bar','calcite-block','calcite-notice','calcite-panel','calcite-list','calcite-select','calcite-dialog','calcite-button','calcite-action'].map(name => customElements.whenDefined(name))).then(() => { clearTimeout(interfaceTimeout); $('interface-status').hidden = true; });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!state.lastSuccess || Date.now() >= (nextCheck ?? 0))) void refresh();
});
window.addEventListener('online', () => { if (!document.hidden) void refresh(); });
window.addEventListener('offline', () => { state = rejectSnapshot(state, 'This browser is offline.', Date.now()); renderBanner(); });
setInterval(() => {
  renderBanner();
  if (!exercise && !document.hidden && !state.busy && expirationCheck && Date.now() >= expirationCheck) { expirationCheck = null; void refresh(); }
}, 1000);

if (exercise) {
  document.body.classList.add('exercise-mode');
  $('identity-status').textContent = 'Fictional exercise view';
  $('exercise-controls').hidden = false;
  $('eyebrow').textContent = 'FICTIONAL EXERCISE · NOT LIVE NWS DATA';
  renderScope();
  document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
    scenario = button.dataset.scenario;
    document.querySelectorAll('[data-scenario]').forEach(control => {
      control.setAttribute('aria-pressed', String(control === button));
      control.setAttribute('appearance', control === button ? 'solid' : 'outline');
    });
    void refresh();
  }));
}
void setupAuth(CONFIG.arcgis, exercise);
renderBanner(); renderList(); renderDetail();
try {
  counties = await loadCounties(new URL('./data/counties.geojson', import.meta.url));
  // Fetches run even if the SDK, graphics driver, or basemap fails.
  void refresh();
  createMap(counties, key=>{planningView(false);selectAlert(key);}, id=>rivers?.select(id),riverView?'fresno':'regional',id=>cameras?.select(id)).then(controller => {
    map = controller;
    map.setScope(riverView?'fresno':'regional');
    rivers?.setMap(map);
    cameras?.setMap(map);
    planning.setMap(map);
    void environment.setMap(map);
    map.update(state.alerts);
    map.select(state.alerts.find(a => a.key === selectedKey));
    $('map-status').hidden = true;
    $('fit-region').removeAttribute('disabled');
    renderDetail();
  }).catch(error => {
    console.error('Storm Watch map initialization:', error.name, error.message, error.stack);
    $('map-status').textContent = 'Map unavailable. The regional alert list and notification banner continue independently.';
    $('map-status').dataset.failed = 'true';
  });
} catch (error) {
  state = rejectSnapshot(state, error.message || 'County boundary scope could not be loaded. Reload the page to retry.', Date.now());
  $('map-status').textContent = 'County scope unavailable. Reload this page to retry.';
  $('refresh').setAttribute('disabled', '');
  renderBanner(); renderList();
}
