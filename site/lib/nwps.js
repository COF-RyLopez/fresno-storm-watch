import { fetchJson } from './nws.js';
import { normalizeGauge } from './river-model.js';
import { pool } from './pool.js';

/** @param {object[]} stations @param {object} config @param {Function} fetcher @param {Function} now @returns {Promise<object[]>} Independent station results; bounded concurrency. */
export async function fetchRiverWatch(stations, config, fetcher = fetch, now = Date.now) {
  if (!stations.length || stations.length>30 || new Set(stations.map(s=>s.id)).size!==stations.length || stations.some(s=>!/^[A-Z0-9]{5}$/.test(s.id))) throw new Error('Invalid river watchlist.');
  return pool(stations,3,async station=>{
    try {
      const base=`${config.baseUrl}/gauges/${station.id.toLowerCase()}`;
      const metadata=await fetchJson(base,{},config.requestTimeoutMs,fetcher);
      const hydrograph=await fetchJson(`${base}/stageflow`,{},config.requestTimeoutMs,fetcher);
      return { id:station.id, gauge:normalizeGauge(metadata,hydrograph,station,now()), error:null };
    } catch (error) { return { id:station.id, gauge:null, error:error.message || 'NWPS station request failed.' }; }
  });
}
