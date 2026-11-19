import { COUNTIES, CATEGORIES, category, fingerprint, sourceTime, countyGeometry, normalizeAlerts, validateCounties } from './model.js';

/** @param {string} url @param {object} options @param {number} timeout @param {Function} fetcher @returns {Promise<object>} */
export async function fetchJson(url, options = {}, timeout = 25_000, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(url, { credentials: 'omit', cache: 'no-store', ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Source request failed (HTTP ${response.status}).`);
    const json = await response.json();
    if (json.error) throw new Error(`NWS service reported an error (${json.error.code ?? 'unknown'}).`);
    return json;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('NWS request timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

/** @param {URL|string} url @param {Function} fetcher @returns {Promise<object[]>} */
export async function loadCounties(url, fetcher = fetch) {
  return validateCounties(await fetchJson(url, {}, 20_000, fetcher));
}

/** @param {object} feature @param {object} config @param {Function} fetcher @returns {Promise<object>} Complete paginated query for one fixed county. */
export async function queryCounty(feature, config, fetcher = fetch) {
  const county = COUNTIES[String(feature.properties.GEOID).padStart(5, '0')];
  const geometry = JSON.stringify(countyGeometry(feature.geometry));
  const features = [];
  const pageFingerprints = new Set();
  for (let offset = 0; offset < 20_000; ) {
    const body = new URLSearchParams({
      f: 'json', where: '1=1', geometry, geometryType: 'esriGeometryPolygon', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outSR: '4326', returnGeometry: 'true', returnZ: 'false',
      outFields: 'objectid,cap_id,prod_type,issuance,onset,ends,expiration,wfo,idp_ingestdate,msg_type',
      orderByFields: 'objectid ASC', resultOffset: String(offset), resultRecordCount: '1000'
    });
    const data = await fetchJson(`${config.nwsLayerUrl}/query`, { method: 'POST', body }, config.requestTimeoutMs, fetcher);
    if (!Array.isArray(data.features)) throw new Error(`NWS returned an unexpected ${county} response.`);
    if (data.features.length && data.spatialReference?.wkid !== 4326) throw new Error('NWS response uses an unexpected or missing coordinate system.');
    const pageKey = JSON.stringify(data.features.map(f => f.attributes?.objectid));
    if (data.exceededTransferLimit && (!data.features.length || pageFingerprints.has(pageKey))) throw new Error('NWS pagination did not advance. Regional result is incomplete.');
    pageFingerprints.add(pageKey);
    features.push(...data.features);
    if (!data.exceededTransferLimit) return { county, features };
    offset += data.features.length;
  }
  throw new Error('NWS result exceeds the prototype limit. No partial result was accepted.');
}

/** @param {object[]} counties @param {object} config @param {Function} fetcher @param {Function} now @returns {Promise<object[]>} No extent dependency; bounded two-request concurrency. */
export async function fetchRegionalAlerts(counties, config, fetcher = fetch, now = Date.now) {
  validateCounties({ type: 'FeatureCollection', features: counties });
  const batches = [];
  for (let i = 0; i < counties.length; i += 2) {
    // allSettled waits for both in-flight requests before allowing a later refresh.
    const pair = await Promise.allSettled(counties.slice(i, i + 2).map(c => queryCounty(c, config, fetcher)));
    const failed = pair.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    batches.push(...pair.map(result => result.value));
  }
  return normalizeAlerts(batches, now());
}

/** The NWS county list controls membership; intersecting forecast-zone polygons can include neighboring alerts. */
export async function fetchFresnoAlerts(county, config, fetcher = fetch, now = Date.now) {
  if (county?.properties?.GEOID !== '06019') throw Error('Fresno county geometry is required.');
  // Geometry refresh is optional. A new county alert must remain visible before the map service catches up.
  const geometryRequest = queryCounty(county, config, fetcher)
    .then(batch => normalizeAlerts([batch], now())).catch(() => []);
  const features = [], visited = new Set();
  let url = 'https://api.weather.gov/alerts/active?zone=CAC019';
  while (url) {
    const next = new URL(url);
    if (visited.size >= 20 || visited.has(url) || next.origin !== 'https://api.weather.gov' ||
        next.pathname !== '/alerts/active' || next.searchParams.get('zone') !== 'CAC019')
      throw Error('NWS county pagination is invalid or incomplete.');
    visited.add(url);
    const page = await fetchJson(url, {}, config.requestTimeoutMs, fetcher);
    if (page.type !== 'FeatureCollection' || !Array.isArray(page.features)) throw Error('NWS county alert response is incomplete.');
    features.push(...page.features);
    url = page.pagination?.next ?? null;
  }
  const geometry = new Map((await geometryRequest).map(alert => [alert.capId, alert.geometries]));
  const stamp = now(), alerts = new Map(), superseded = new Set();
  for (const feature of features) {
    const p = feature.properties;
    if (!p || typeof p.id !== 'string' || !p.id.startsWith('urn:oid:') || p.id.length > 255 ||
        typeof p.event !== 'string' || !p.event.trim() || sourceTime(p.sent) === null ||
        !['Actual','Test','Exercise','System','Draft'].includes(p.status) ||
        !['Alert','Update','Cancel','Ack','Error'].includes(p.messageType)) throw Error('NWS county alert identity or status is invalid.');
    const issued = sourceTime(p.sent), expires = sourceTime(p.expires), ends = sourceTime(p.ends);
    if (issued > stamp + 120000) throw Error('NWS county alert issuance is in the future.');
    if (p.status === 'Actual' && ['Update','Cancel'].includes(p.messageType)) {
      for (const reference of p.references || []) {
        const sent = sourceTime(reference.sent);
        if (typeof reference.identifier !== 'string' || sent === null || sent >= issued)
          throw Error('NWS county alert revision reference is invalid.');
        superseded.add(reference.identifier);
      }
    }
    if (p.status !== 'Actual' || !['Alert','Update'].includes(p.messageType) ||
        expires !== null && expires <= stamp) continue;
    const content = JSON.stringify(p);
    const previous = alerts.get(p.id);
    if (previous && previous.content !== content) throw Error('NWS county alert revision conflicts across pages.');
    const geometries = feature.geometry ? [countyGeometry(feature.geometry)] : geometry.get(p.id) || [];
    const key = `${p.id}|${p.sent}`;
    alerts.set(p.id, {
      key, capId:p.id, type:p.event.trim(), category:category(p.event), counties:['Fresno'],
      issued, issuance:p.sent, onset:sourceTime(p.onset), ends, expires, office:p.senderName || 'Not supplied',
      headline:p.headline || '', area:p.areaDesc || '', description:p.description || '', instruction:p.instruction || '',
      parameters:p.parameters,
      sourceUrl:`https://api.weather.gov/alerts/${encodeURIComponent(p.id)}`, geometries, content,
      quality:expires === null ? 'Expiration unavailable; check NWS.' : ends !== null && ends <= stamp
        ? 'NWS still returns this alert; stated end time has passed. Verify with NWS.' : '',
      signature:`${key}|${fingerprint(content + JSON.stringify(geometries))}`,
    });
  }
  return [...alerts.values()].filter(alert => !superseded.has(alert.capId))
    .sort((a,b) => CATEGORIES[a.category].order-CATEGORIES[b.category].order || b.issued-a.issued || a.key.localeCompare(b.key));
}
