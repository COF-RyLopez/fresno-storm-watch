import { findMapEntries, geometryShardUrl } from "./map-search-model.js";
import { arcGeometry } from "./command-model.js";
/** Public, versioned name indexes load on demand. Only a selected geometry shard is fetched. */
export function createCommandSearch({
  base = new URL("../data/search/", import.meta.url),
  fetcher = fetch,
} = {}) {
  let index, pending;
  const shards = new Map();
  const bases = {
    waterbody: new URL("waterbodies-v0.34.0/", base),
    reference: new URL("v0.31.0/", base),
  };
  async function json(url) {
    const r = await fetcher(url, {
      credentials: "omit",
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw Error("Reference search unavailable");
    return r.json();
  }
  async function find(query) {
    if (query.trim().length < 2) return [];
    if (!index) {
      pending ??= Promise.all([
        json(new URL("index.json", bases.reference)),
        json(new URL("index.json", bases.waterbody)),
      ]);
      try {
        const items = await pending;
        index = items.flatMap((i) =>
          i.entries.map((r) => ({
            ...r,
            sourceTime: i.generatedAt || i.sources?.waterbody?.retrievedAt,
          })),
        );
      } catch (e) {
        pending = null;
        throw e;
      }
    }
    return findMapEntries(index, query, "all", 25).rows;
  }
  async function select(row) {
    const url = geometryShardUrl(row, bases[row.kind] || bases.reference);
    let value = shards.get(url.href);
    if (!value) {
      value = await json(url);
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
  return { find, select };
}
