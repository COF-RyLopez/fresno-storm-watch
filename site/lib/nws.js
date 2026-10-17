import { COUNTIES, countyGeometry, normalizeAlerts, validateCounties } from './model.js';

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
      outFields: 'objectid,cap_id,prod_type,issuance,onset,expiration,wfo,idp_ingestdate,msg_type',
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
