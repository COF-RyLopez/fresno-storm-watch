import {createEvidencePane} from './lib/evidence-ui.js';
import { CONFIG } from './config.js';
import { CATEGORIES, initialState, acceptSnapshot, rejectSnapshot, clearNotice, bannerState, formatTime, normalizeAlerts } from './lib/model.js';
import { loadCounties, fetchRegionalAlerts } from './lib/nws.js';
import { clockLabel } from './lib/flood-scenario-model.js';
import { createMap } from './lib/map.js?v=0.27.0';
import { setupAuth } from './lib/auth.js';
import { setupSceneCompanion } from './lib/scene-companion.js';
import { exerciseBatches } from './lib/exercise.js';
import { createRiverWatch } from './lib/river-ui.js?v=0.27.0';
import { createCameraWatch } from './lib/camera-ui.js?v=0.27.0';
import { createEnvironmentWatch } from './lib/environment-ui.js?v=0.27.0';
import { createPlanningWatch } from './lib/planning-ui.js?v=0.27.0';
import { createWorkspace } from './lib/workspace-ui.js?v=0.25.0';
import {createCountyStrip,reportHealth} from './lib/source-health.js?v=0.20.0';
import { createPowerWatch } from './lib/power-ui.js?v=0.27.0';
import { createFacilityWatch } from './lib/facility-ui.js?v=0.27.0';
import { createRoadWatch } from './lib/roads-ui.js?v=0.27.0';
import {createHanfordBriefing} from './lib/briefing-ui.js?v=0.26.0';
import {createBriefingLayers} from './lib/briefing-layer-ui.js?v=0.26.0';
import {createBriefingContextView} from './lib/briefing-context-ui.js?v=0.22.0';
import { createReleaseTrends } from './lib/release-trend-ui.js?v=0.27.0';

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
let briefingLayers;
let planning;
let latestPlanningPower=null;
let roads;
let planningExerciseEntries=null;
let riverView=true;
const evidence=createEvidencePane({timeZone:CONFIG.timeZone,onChange:open=>{if(open)workspace.showMap();else workspace.refreshLayout();cameras?.setSuspended(open);}});
const workspace=createWorkspace({evidence,onCameraChange:open=>cameras?.setOpen(open)});

/** Topic selection never alters source queries or countywide counts. */
function renderScope(){/* The workspace controller owns map and scope headings. */}
function planningView(showRivers){workspace.showPanel(showRivers?'rivers':'alerts');}
function openEnvironment(){workspace.showPanel('weather');}
function openReservoirs(){workspace.showPanel('reservoirs');}
function openPlanning(){workspace.showPanel('watch');}
function openRoads(){workspace.showPanel('roads');}
function openPower(){workspace.showPanel('power');}
for(const [id,topic]of [['view-watch','watch'],['view-rivers','rivers'],['view-environment','weather'],['view-alerts','alerts'],['view-power','power'],['view-roads','roads']])$(id).addEventListener('click',()=>workspace.showPanel(topic));
const strip=createCountyStrip({onOpen:topic=>workspace.showPanel(topic),exercise,timeZone:CONFIG.timeZone});
const context=createBriefingContextView({timeZone:CONFIG.timeZone,exercise,onBriefing:(...args)=>briefings.open(...args),onArea:id=>planning?.selectArea(id),onRoad:key=>roads?.select(key),onFacility:key=>facilities.select(key),onConnect:()=>{openPower();document.querySelector('.facility-section calcite-accordion-item').expanded=true;},onMap:workspace.showMap});
const briefings=createHanfordBriefing({timeZone:CONFIG.timeZone,exercise,onUpdate:strip.briefing,onImpacts:context.setBriefings,onMapTour:id=>briefingLayers?.open(id),onSlide:context=>briefingLayers?.followSlide(context)});
const facilities=createFacilityWatch({timeZone:CONFIG.timeZone,exercise,onOpen:openPower,onMap:workspace.showMap,onData:context.setFacilities});
const power=createPowerWatch({timeZone:CONFIG.timeZone,exercise,onOpen:openPower,onMap:workspace.showMap,onData:(rows,feeds,health)=>{facilities.setPower(rows,feeds);strip.power(rows.filter(r=>!['restored','cancelled'].includes(r.status)).length);latestPlanningPower={rows,feeds,...health};planning?.setPowerData(latestPlanningPower);}});
roads=createRoadWatch({exercise,timeZone:CONFIG.timeZone,onOpen:openRoads,onMap:workspace.showMap,onData:context.setRoads});
const releaseTrends=createReleaseTrends({config:CONFIG,timeZone:CONFIG.timeZone,exercise,onLocate:(id,gauge)=>{workspace.showMap();if(gauge)map?.focusGauge(gauge);else environment?.focusReservoir(id);}});
$('eoc-link').addEventListener('click',()=>location.assign(exercise?'./eoc.html?exercise=1':'./eoc.html'));
planning=createPlanningWatch({config:CONFIG,timeZone:CONFIG.timeZone,exercise,onOpen:openPlanning,onMap:workspace.showMap,onData:context.setPlanning,onGauge:id=>rivers?.select(id),onConditions:openEnvironment,onPower:openPower,onSummary:n=>strip.areas(n),onTrends:id=>{openReservoirs();releaseTrends.open(id);},onExercise:(entries,reservoirs)=>{planningExerciseEntries=entries;rivers?.setExerciseEntries(entries);releaseTrends.setRiverData({entries});releaseTrends.setReservoirData(reservoirs);}});
if(latestPlanningPower)planning.setPowerData(latestPlanningPower);
environment=createEnvironmentWatch({config:CONFIG.environment,timeZone:CONFIG.timeZone,exercise,onOpen:openEnvironment,onMap:workspace.showMap,onOverlayChange:()=>{briefings.setFollow(false);briefingLayers?.stop(false);},onTrends:id=>{openReservoirs();releaseTrends.open(id);},onReservoirData:data=>{planning.setReservoirData(data);if(!exercise)releaseTrends.setReservoirData(data);},onWindData:data=>planning.setWindData(data)});
briefingLayers=createBriefingLayers({timeZone:CONFIG.timeZone,exercise,onOpen:openEnvironment,onMap:workspace.showMap,onStart:()=>environment.selectOverlay('off',false),onStop:()=>environment.selectOverlay('radar',false),onBriefing:(...args)=>briefings.open(...args),onManual:()=>briefings.setFollow(false)});

void createRiverWatch({config:CONFIG.rivers,timeZone:CONFIG.timeZone,exercise,onOpen:()=>planningView(true),onMap:workspace.showMap,onTrends:(id,gauge)=>{openReservoirs();releaseTrends.open(id,gauge);},onData:data=>{planning.setRiverData(data);releaseTrends.setRiverData(data);}}).then(controller=>{rivers=controller;if(planningExerciseEntries)rivers.setExerciseEntries(planningExerciseEntries);if(map)rivers.setMap(map);});
void createCameraWatch({config:CONFIG.cameras,timeZone:CONFIG.timeZone,exercise,initialOpen:workspace.camerasOpen,onOpenChange:workspace.setCameras,onMap:workspace.showMap,onGauge:id=>rivers?.select(id)}).then(controller=>{cameras=controller;cameras.setOpen(workspace.camerasOpen,{notify:false});cameras.setSuspended(evidence.isOpen);if(map)cameras.setMap(map);});

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
  strip.alerts(state.lastSuccess===null?null:state.alerts.length);
  if(!exercise)reportHealth('nws-region','NWS regional alerts',{checked:state.lastSuccess,error:state.error,maxAgeMs:CONFIG.staleMs});
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
  if(state.alerts.some(a=>a.key===key))$('alert-evidence').setAttribute('open','');
  workspace.showMap();map?.select(state.alerts.find(a => a.key === key),true);
}

/** @returns {void} Preserve source timestamps and original product names in the detail panel. */
function renderDetail() {
  const alert = state.alerts.find(a => a.key === selectedKey);
  const host = $('alert-detail');
  host.replaceChildren();
  $('alert-detail-open').disabled=!alert;
  if (!alert) {
    $('alert-evidence').removeAttribute('open');
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
$('alert-detail-open').addEventListener('click',()=>selectAlert(selectedKey));
$('clear-notice').addEventListener('click', () => { state = clearNotice(state); renderBanner(); renderList(); });
$('fit-region').addEventListener('click', () => map?.fit());
$('alert-filter').addEventListener('calciteSelectChange', event => { filter = event.target.value; renderList(); });
$('alert-list').addEventListener('calciteListChange', event => {
  const key = event.target.selectedItems?.[0]?.value;
  if (key && key !== selectedKey) selectAlert(key);
});
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('[data-evidence],calcite-dialog').removeAttribute('open')));
$('about').addEventListener('click', () => $('sources-dialog').setAttribute('open', ''));
const interfaceTimeout = setTimeout(() => { $('interface-status').hidden = false; }, 15_000);
void Promise.all(['calcite-shell','calcite-shell-panel','calcite-action-bar','calcite-block','calcite-notice','calcite-panel','calcite-list','calcite-select','calcite-button','calcite-action'].map(name => customElements.whenDefined(name))).then(() => { clearTimeout(interfaceTimeout); $('interface-status').hidden = true; });
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
void setupAuth(CONFIG.arcgis, exercise,session=>facilities.setSession(session));
setupSceneCompanion(CONFIG.arcgis, () => map?.sceneViewpoint(), exercise);
renderBanner(); renderList(); renderDetail();
try {
  counties = await loadCounties(new URL('./data/counties.geojson', import.meta.url));
  // Fetches run even if the SDK, graphics driver, or basemap fails.
  void refresh();
  power.setCounty(counties.find(f=>f.properties.GEOID==='06019'));
  facilities.setCounty(counties.find(f=>f.properties.GEOID==='06019'));
  createMap(counties, key=>{planningView(false);selectAlert(key);}, id=>rivers?.select(id),riverView?'fresno':'regional',id=>cameras?.select(id),key=>roads.select(key),key=>power.select(key),key=>facilities.select(key),id=>{openPlanning();planning.selectArea(id);},evidence.openFeatures).then(controller => {
    map = controller;
    workspace.setMap(map);

    rivers?.setMap(map);
    cameras?.setMap(map);
    planning.setMap(map);
    roads.setMap(map);
    power.setMap(map);
    facilities.setMap(map);
    context.setMap(map);
    void briefingLayers.setMap(map);
    void environment.setMap(map);
    map.update(state.alerts);
    map.select(state.alerts.find(a => a.key === selectedKey),!!selectedKey);
    $('map-status').hidden = true;
    $('fit-region').removeAttribute('disabled');
    void setupInundation(map);
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

// Inundation layers: scenarios listed in data/flood-scenarios/index.json (unless main_map is false).
// Choosing one flies the map to it and opens a player over the map; the playback page adds buildings and statistics.
async function setupInundation(map){
  const root='./data/flood-scenarios/',index=await fetch(root+'index.json').then(r=>r.json()),group=$('inundation-options');
  for(const s of index.scenarios.filter(s=>s.main_map!==false)){const item=document.createElement('calcite-dropdown-item');item.dataset.scenario=s.id;item.textContent=s.label;group.append(item);}
  $('inundation-open').removeAttribute('disabled');
  let player=null,chosen='',t=0,playing=false,last=0;
  const render=next=>{
    t=Math.min(Math.max(next,player.hours[0]),player.hours.at(-1));player.setTime(t);$('inundation-clock').textContent=clockLabel(t);
    if(Math.abs(Number($('inundation-time').value)-t)>0.01)$('inundation-time').value=Number(t.toFixed(2));
  };
  const tick=now=>{
    if(!playing)return;if(last)render(t+((now-last)/1000)*(Number($('inundation-speed').value)||1));last=now;
    if(t>=player.hours.at(-1))setPlaying(false);else requestAnimationFrame(tick);
  };
  const setPlaying=on=>{
    playing=on&&!!player;last=0;$('inundation-play').iconStart=playing?'pause':'play';$('inundation-play').textContent=playing?'Pause':'Play';
    if(playing){if(t>=player.hours.at(-1))render(player.hours[0]);requestAnimationFrame(tick);}
  };
  $('inundation-play').addEventListener('click',()=>setPlaying(!playing));
  $('inundation-time').addEventListener('calciteSliderInput',e=>{setPlaying(false);if(player)render(Number(e.target.value));});
  $('inundation-menu').addEventListener('calciteDropdownSelect',async e=>{
    const id=e.target.selectedItems[0]?.dataset.scenario||'',link=$('inundation-playback');chosen=id;
    setPlaying(false);player=null;$('inundation-player').hidden=true;
    link.hidden=!id;link.href=`./flood-scenario.html?scenario=${encodeURIComponent(id)}`;
    $('inundation-open').appearance=id?'solid':'outline';
    try{
      const scenario=id?await fetch(`${root}${id}/scenario.json`).then(r=>r.json()):null,next=await map.showInundation(root+id+'/',scenario);
      if(!next||chosen!==id)return;
      player=next;$('inundation-title').textContent=scenario.title;
      $('inundation-time').min=player.hours[0];$('inundation-time').max=player.hours.at(-1);
      // Open on the first hour with water, as the playback page does.
      render(player.hours[Math.max(scenario.frames.findIndex(f=>f.wet_acres>0)-1,0)]);$('inundation-player').hidden=false;
    }catch(error){link.hidden=true;console.warn('Inundation layer:',error.message);}
  });
}
