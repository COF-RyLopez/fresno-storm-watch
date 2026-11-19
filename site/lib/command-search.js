import { findMapEntries, geometryShardUrl } from "./map-search-model.js";
import { arcGeometry } from "./command-model.js";
import { citedRoadEntries } from "./command-alert-guidance.js";
import { pool } from "./pool.js";
/** Public, versioned name indexes load on demand. Only a selected geometry shard is fetched. */
export function createCommandSearch({
  base = new URL("../data/search/", import.meta.url),
  fetcher = fetch,
} = {}) {
  let index, pending, streets, streetRequest;
  const shards = new Map();
  const bases = {
    waterbody: new URL("waterbodies-v0.34.0/", base),
    reference: new URL("v0.31.0/", base),
  };
  async function json(url, signal) {
    const r = await fetcher(url, {
      credentials: "omit",
      signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    });
    if (!r.ok) throw Error("Reference search unavailable");
    return r.json();
  }
  async function loadStreets() {
    if (!streets) {
      streetRequest ??= json(new URL('index.json', bases.reference));
      try {
        const data = await streetRequest;
        if (!Array.isArray(data.entries)) throw Error('County road reference index unavailable');
        streets = data.entries.map(entry => ({...entry, sourceTime:data.generatedAt}));
      } catch (error) {streetRequest = null; throw error;}
    }
    return streets;
  }
  async function find(query) {
    if (query.trim().length < 2) return [];
    if (!index) {
      pending ??= Promise.all([
        loadStreets(),
        json(new URL("index.json", bases.waterbody)),
      ]);
      try {
        const items = await pending;
        index = [...items[0], ...items[1].entries.map((r) => ({
            ...r,
            sourceTime: items[1].generatedAt || items[1].sources?.waterbody?.retrievedAt,
          }))];
      } catch (e) {
        pending = null;
        throw e;
      }
    }
    return findMapEntries(index, query, "all", 25).rows;
  }
  async function select(row, signal) {
    const url = geometryShardUrl(row, bases[row.kind] || bases.reference);
    let value = shards.get(url.href);
    if (!value) {
      value = await json(url, signal);
      if (shards.size >= 4) shards.delete(shards.keys().next().value);
      shards.set(url.href, value);
    }
    const geometry = arcGeometry(value[row.key]);
    if (!geometry) throw Error("Reference geometry unavailable");
    return {
      id: row.key,
      name: row.name,
      kind: row.kind,
      group: 3,
      review: false,
      change: "Mapped reference · current conditions not assessed",
      time: row.sourceTime ? Date.parse(row.sourceTime) : null,
      timeLabel: "Reference prepared",
      quality: "Reference outline; not a current flood or operating boundary",
      nextAction: "Inspect nearby evidence and verify current conditions",
      details: [
        row.reference ||
          "Grouped mapped segments can be disconnected. Geometry does not prove hydraulic connectivity or road access.",
        "Reference search index is versioned separately from the refreshed 3DHP display.",
      ],
      links: [],
      evidence: [],
      features: [
        {
          type: "Feature",
          id: row.key,
          geometry,
          properties: {
            id: row.key,
            name: row.name,
            kind: row.kind,
            color: "#99d9df",
          },
        },
      ],
    };
  }
  async function citedCorridors(routes, {signal} = {}) {
    signal?.throwIfAborted();
    const entries = citedRoadEntries(await loadStreets(), routes);
    const maximum = 24;
    const results = await pool(entries.slice(0,maximum), 2, async ({entry,route}) => {
      signal?.throwIfAborted();
      try {return {route,record:await select(entry,signal)};}
      catch {signal?.throwIfAborted();return {route,error:true};}
    });
    signal?.throwIfAborted();
    const incomplete = new Set([...entries.slice(maximum).map(row=>row.route.label),
      ...results.filter(row=>row.error).map(row=>row.route.label)]);
    return {
      records:results.filter(row=>row.record), failures:results.filter(row=>row.error),
      incomplete:routes.filter(route=>incomplete.has(route.label)),
      unmapped:routes.filter(route=>!entries.some(row=>row.route.label===route.label)), limited:entries.length>maximum,
    };
  }
  return { find, select, citedCorridors };
}
