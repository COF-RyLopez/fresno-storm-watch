import assert from 'node:assert/strict';
import test from 'node:test';
import {createCommandAssets} from '../site/lib/command-assets.js';
import {FACILITY_PRESETS} from '../site/lib/facility-presets.js';
import {DRAINAGE_LAYERS, drainageRecord} from '../site/lib/drainage-model.js';
import {preparePumpCopy, pumpCopyLayer} from '../site/lib/pump-copy-model.js';
import {EOC_CONFIG} from '../site/eoc-config.js';
import {PUMP_INVENTORY_CONFIG} from '../site/pump-inventory-config.js';

const county = {properties: {GEOID: '06019'}, geometry: {type: 'Polygon', coordinates: [[[-120, 36], [-119, 36], [-119, 37], [-120, 37], [-120, 36]]]}};
const token = 'offline-test-token';
const session = (groups = [EOC_CONFIG.groups.viewers]) => ({
  portal: {id: EOC_CONFIG.orgId, user: {fetchGroups: async () => groups.map(id => ({id}))}},
  username: 'viewer',
  getToken: async () => token
});
const facility = FACILITY_PRESETS.find(p => p.id === 'facilities');
const pumpUrl = PUMP_INVENTORY_CONFIG.readUrl;
const facilityMetadata = {
  geometryType: 'esriGeometryPoint',
  objectIdField: 'OBJECTID',
  fields: [{name: 'OBJECTID', type: 'esriFieldTypeOID'}, ...Object.values(facility.fields).map(name => ({name, type: name === 'GlobalID' ? 'esriFieldTypeGlobalID' : 'esriFieldTypeString'}))]
};
const facilityAttributes = {OBJECTID: 1, [facility.fields.id]: 'private-original-id', [facility.fields.name]: 'Exercise facility'};
const pumpSpec = DRAINAGE_LAYERS.find(row => row.kind === 'pump');
const testPump = drainageRecord(pumpSpec, {attributes: {OBJECTID: 941, DA: 'Exercise pump', SUBTYPE: 1}, geometry: {x: -119.5, y: 36.5}}, 'OBJECTID');
const copy = await preparePumpCopy([testPump]);
const fakeResponse = (url, query) => {
  if (url === facility.url) return {layers: [{id: 0, name: 'Facilities'}]};
  if (url === facility.url + '/0') return facilityMetadata;
  if (url === facility.url + '/0/query') {
    if (query.returnIdsOnly) return {objectIds: [1]};
    return {spatialReference: {wkid: 4326}, features: [{attributes: facilityAttributes, geometry: {x: -119.5, y: 36.5}}]};
  }
  if (url === pumpUrl.replace(/\/0$/, '')) return {serviceItemId: PUMP_INVENTORY_CONFIG.readItemId, isView: true, capabilities: 'Query'};
  if (url === pumpUrl) return pumpCopyLayer();
  if (url === pumpUrl + '/query') {
    if (query.returnIdsOnly) return {objectIds: [1]};
    return {features: copy.features.map(row => ({attributes: {...row.attributes, OBJECTID: 1}}))};
  }
  if (url.endsWith('/data') && url.includes(PUMP_INVENTORY_CONFIG.readItemId)) return {};
  assert.fail('Unexpected endpoint: ' + url);
};

const loader = request => async () => ({import: async () => [request]});

test('authorized sites are opt-in, county AGOL only, private, opaque and read-only', async () => {
  const urls = [];
  const assets = createCommandAssets({loadSdk: loader(async (url, options) => {
    urls.push(url);
    assert.equal(options.method, 'post');
    assert.equal(options.authMode, 'no-prompt');
    assert.equal(options.query.token, token);
    assert.doesNotMatch(url, /token=|gisprod|applyEdits/i);
    return {data: fakeResponse(url, options.query)};
  })});
  assets.connect(session());
  assert.equal(urls.length, 0);
  await assets.load(county);
  assert.equal(assets.state.error, null);
  assert.deepEqual(assets.state.concerns.map(row => row.kind), ['asset', 'pump']);
  const opaqueId = /^authorized-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  assert.ok(assets.state.concerns.every(row => row.private && opaqueId.test(row.id) && !row.links.length));
  assert.ok(assets.state.features.every(feature => feature.properties.private));
  // A random opaque UUID can legitimately contain 941; inspect source leakage outside those IDs.
  const withoutOpaqueIds = JSON.stringify(assets.state, (_key, value) =>
    typeof value === 'string' && opaqueId.test(value) ? 'opaque-id' : value);
  assert.doesNotMatch(withoutOpaqueIds, /private-original-id|941|offline-test-token/);
  const ids = assets.state.concerns.map(row => row.id);
  await assets.load(county);
  assert.deepEqual(assets.state.concerns.map(row => row.id), ids);
  assets.clear();
  assert.deepEqual(assets.state, {features: [], concerns: [], loading: false, error: null});
  await assets.load(county);
  assert.notDeepEqual(assets.state.concerns.map(row => row.id), ids);
});

test('missing EOC viewer access performs no source requests', async () => {
  const assets = createCommandAssets({loadSdk: async () => assert.fail('SDK should not load')});
  assets.connect(session([]));
  await assets.load(county);
  assert.match(assets.state.error, /viewer/);
  assert.deepEqual(assets.state.concerns, []);
});

test('sign-out prevents late requests from restoring cleared assets', async () => {
  let finish;
  let started;
  const requested = new Promise(resolve => {started = resolve;});
  const assets = createCommandAssets({loadSdk: loader(async (url, options) => {
    if (url === facility.url) {
      started();
      return new Promise(resolve => {finish = () => resolve({data: fakeResponse(url, options.query)});});
    }
    return {data: fakeResponse(url, options.query)};
  })});
  assets.connect(session());
  const loading = assets.load(county);
  await requested;
  assert.equal(assets.state.loading, true);
  assets.connect(null);
  finish();
  await loading;
  assert.deepEqual(assets.state, {features: [], concerns: [], loading: false, error: null});
});

test('one denied source does not imply the other was denied or return credentials', async () => {
  const assets = createCommandAssets({loadSdk: loader(async (url, options) => {
    if (url.startsWith(facility.url)) throw new Error(token);
    return {data: fakeResponse(url, options.query)};
  })});
  assets.connect(session());
  await assets.load(county);
  assert.deepEqual(assets.state.concerns.map(row => row.kind), ['pump']);
  assert.match(assets.state.error, /facility points unavailable/);
  assert.doesNotMatch(assets.state.error, /offline-test-token/);
});
