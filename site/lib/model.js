/** Pure data/state rules, shared by the browser and Node's test runner. */
export const COUNTIES = Object.freeze({
  '06019': 'Fresno', '06039': 'Madera', '06047': 'Merced', '06031': 'Kings', '06107': 'Tulare'
});
export const CATEGORIES = Object.freeze({
  Warning: { order: 0, color: '#b43f35' },
  Watch: { order: 1, color: '#986006' },
  Advisory: { order: 2, color: '#216a99' },
  Other: { order: 3, color: '#655c84' }
});

/** @param {unknown} value @returns {number|null} Epoch milliseconds; unknown stays unknown. */
export function sourceTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return null;
  const number = Date.parse(value);
  return Number.isFinite(number) ? number : null;
}

/** @param {string} type @returns {string} Explicit categories; original product name is retained. */
export function category(type) {
  return /warning\b/i.test(type) ? 'Warning' : /watch\b/i.test(type) ? 'Watch' : /advisory\b/i.test(type) ? 'Advisory' : 'Other';
}

/** @param {string} value @returns {string} Nonsecurity fingerprint; excludes volatile object IDs. */
export function fingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16);
}

/** @param {object} geojson @returns {object[]} Require the complete known region, without omission. */
export function validateCounties(geojson) {
  if (geojson?.type !== 'FeatureCollection' || geojson.features?.length !== 5) throw new Error('County scope is incomplete. Expected all five counties.');
  const seen = new Set();
  for (const feature of geojson.features) {
    const id = String(feature.properties?.GEOID ?? '').padStart(5, '0');
    if (!COUNTIES[id] || seen.has(id)) throw new Error('County identifiers do not match the fixed region.');
    countyGeometry(feature.geometry); // Validate all coordinates before any live query.
    seen.add(id);
  }
  return geojson.features;
}

/** @param {object} geometry @returns {object} Convert GeoJSON to clockwise Esri exterior rings, EPSG:4326. */
export function countyGeometry(geometry) {
  const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : null;
  if (!Array.isArray(polygons) || !polygons.length) throw new Error('County geometry must be a nonempty polygon.');
  const rings = polygons.flatMap(polygon => {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error('County polygon has no exterior.');
    return polygon.map((input, index) => {
      if (!Array.isArray(input) || input.length < 4) throw new Error('County ring is incomplete.');
      const ring = input.map(point => {
        if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw new Error('County coordinates must be longitude/latitude.');
        return point.slice(0, 2);
      });
      if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('County polygon ring is not closed.');
      let area = 0;
      for (let i = 1; i < ring.length; i++) area += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
      if (!area) throw new Error('County polygon ring has zero area.');
      if ((index === 0 && area > 0) || (index > 0 && area < 0)) ring.reverse();
      return ring;
    });
  });
  return { rings, spatialReference: { wkid: 4326 } };
}

/** @param {Array<{county:string, features:object[]}>} batches @param {number} now @returns {object[]} O(n + g log g), small regional feeds. */
export function normalizeAlerts(batches, now = Date.now()) {
  const grouped = new Map();
  for (const batch of batches) {
    if (!Object.values(COUNTIES).includes(batch.county) || !Array.isArray(batch.features)) throw new Error('Unexpected county query response.');
    for (const feature of batch.features) {
      const a = feature.attributes;
      if (!a || typeof a.cap_id !== 'string' || !a.cap_id.startsWith('urn:oid:') || a.cap_id.length > 255 || typeof a.prod_type !== 'string' || !a.prod_type.trim() || sourceTime(a.issuance) === null) throw new Error('NWS returned an alert with an invalid identity, type or issuance time.');
      const expires = sourceTime(a.expiration);
      // msg_type is an NWS product code (for example FLS), not a CAP cancellation flag.
      // Cancellation/removal is reflected by the next complete publisher snapshot.
      if (expires !== null && expires <= now) continue;
      if (!feature.geometry?.rings?.length) throw new Error('NWS returned an alert without polygon geometry.');
      for (const ring of feature.geometry.rings) {
        if (!Array.isArray(ring) || ring.length < 4 || ring.some(p => !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) throw new Error('NWS polygon coordinates are invalid.');
        if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) throw new Error('NWS polygon ring is not closed.');
      }
      const key = `${a.cap_id}|${a.issuance}`;
      const content = JSON.stringify([a.prod_type, a.issuance, a.onset ?? '', a.expiration ?? '', a.wfo ?? '']);
      if (!grouped.has(key)) grouped.set(key, {
        key, capId: a.cap_id, type: a.prod_type.trim(), category: category(a.prod_type),
        issued: sourceTime(a.issuance), issuance: a.issuance, onset: sourceTime(a.onset),
        expires, expiration: a.expiration ?? '', office: a.wfo || 'Not supplied',
        ingested: sourceTime(a.idp_ingestdate), content, counties: new Set(), geometries: new Map(),
        sourceUrl: `https://api.weather.gov/alerts/${encodeURIComponent(a.cap_id)}`,
        quality: expires === null ? 'Expiration unavailable; check NWS.' : ''
      });
      const alert = grouped.get(key);
      if (alert.content !== content) throw new Error('NWS returned conflicting attributes for one alert revision. Retry the feed.');
      alert.counties.add(batch.county);
      const geometry = { rings: feature.geometry.rings.map(r => r.map(p => p.slice(0, 2))), spatialReference: { wkid: 4326 } };
      const geometryKey = JSON.stringify(geometry.rings);
      alert.geometries.set(geometryKey, geometry);
      const received = sourceTime(a.idp_ingestdate);
      if (received !== null) alert.ingested = Math.max(alert.ingested ?? 0, received);
    }
  }
  return [...grouped.values()].map(alert => {
    const counties = [...alert.counties].sort();
    const geometryKeys = [...alert.geometries.keys()].sort();
    return { ...alert, counties, geometries: [...alert.geometries.values()], signature: `${alert.key}|${fingerprint(alert.content + JSON.stringify(counties) + geometryKeys.join(''))}` };
  }).sort((a, b) => CATEGORIES[a.category].order - CATEGORIES[b.category].order || b.issued - a.issued || a.key.localeCompare(b.key));
}

/** @returns {object} All notification memory is confined to this open page. */
export function initialState() {
  return { alerts: [], lastSuccess: null, lastAttempt: null, error: null, pending: new Set(), change: null, busy: false, checks: 0 };
}

/** @param {object} state @param {object[]} alerts @param {number} now @returns {object} Atomically replace only after every county query succeeds. */
export function acceptSnapshot(state, alerts, now) {
  const before = new Set(state.alerts.map(a => a.signature));
  const after = new Set(alerts.map(a => a.signature));
  const changed = alerts.filter(a => !before.has(a.signature));
  const removed = state.alerts.filter(a => !alerts.some(current => current.key === a.key));
  const pending = new Set([...state.pending].filter(signature => after.has(signature)));
  changed.forEach(a => pending.add(a.signature));
  return { ...state, alerts, pending, lastSuccess: now, lastAttempt: now, error: null, busy: false, checks: state.checks + 1,
    change: { addedOrChanged: changed.length, noLongerReturned: removed.length, initial: state.lastSuccess === null } };
}

/** @param {object} state @param {string} message @param {number} now @returns {object} Failure never creates an empty successful snapshot. */
export function rejectSnapshot(state, message, now) {
  return { ...state, error: message, lastAttempt: now, busy: false };
}

/** @param {object} state @returns {object} This is not an EOC team acknowledgement. */
export function clearNotice(state) { return { ...state, pending: new Set() }; }

/** @param {object} state @param {number} now @param {number} staleMs @returns {object} Failure/late queries outrank hazard notices. */
export function bannerState(state, now, staleMs) {
  if (state.error) return { tone: 'failure', title: 'NWS update unavailable', detail: state.lastSuccess === null ? 'No successful regional check yet. Open NWS for current information.' : 'Showing the last successful result. Alert counts may be out of date.' };
  if (state.lastSuccess === null) return { tone: 'loading', title: 'Checking regional NWS alerts', detail: 'Waiting for all five county queries. No alert count is available yet.' };
  if (now - state.lastSuccess > staleMs) return { tone: 'failure', title: 'Regional check is overdue', detail: 'Refresh now or open NWS. The displayed result has not been checked recently.' };
  if (!state.alerts.length) return { tone: 'quiet', title: 'No alerts returned for the region', detail: 'This does not establish safe conditions. Continue to monitor official forecasts.' };
  const tone = state.alerts[0].category.toLowerCase();
  return { tone, title: state.pending.size ? `${state.pending.size} new or updated ${state.pending.size === 1 ? 'alert' : 'alerts'}` : `${state.alerts.length} regional ${state.alerts.length === 1 ? 'alert' : 'alerts'} remain visible`,
    detail: state.pending.size ? 'New since this page opened or since you cleared the notification. Select an alert for details.' : 'Clearing the notification does not end a hazard or record a team acknowledgement.' };
}

/** @param {number|null} time @param {string} zone @returns {string} Explicit Pacific zone, including DST. */
export function formatTime(time, zone = 'America/Los_Angeles') {
  return time === null ? 'Not available' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: zone, timeZoneName: 'short' }).format(time);
}
