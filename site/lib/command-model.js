import {powerScope, validPoint} from "./power-geometry.js";
import {countyGeometry} from "./model.js";
import {METERS_PER_MILE} from "./nearby-search.js";
/** Presentation state is memory-only. Refresh never replaces the selected place or camera. */
export function createCommandState() {
  let value = {
    view: "watch",
    selected: null,
    camera: null,
    filter: "all",
    query: "",
    mobile: "attention",
    weather: "off",
    concerns: [],
  };
  const listeners = new Set();
  return {
    get value() {
      return value;
    },
    patch(next) {
      value = { ...value, ...next };
      for (const f of listeners) f(value);
    },
    subscribe(f) {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}
export function routeState(hash) {
  const [path, query = ""] = String(hash).replace(/^#/, "").split("?");
  const p = new URLSearchParams(query),
    view = path.replace(/^\//, "");
  return {
    view: ["watch", "work", "briefing"].includes(view) ? view : "watch",
    selected: p.get("place") || null,
  };
}
export function orderedConcerns(rows) {
  return [...new Map(rows.map((r) => [r.id, r])).values()].sort(
    (a, b) =>
      (a.group ?? 3) - (b.group ?? 3) ||
      (a.group === 1
        ? (b.time ?? -Infinity) - (a.time ?? -Infinity)
        : (a.time ?? Infinity) - (b.time ?? Infinity)) ||
      a.id.localeCompare(b.id),
  );
}
const coordinate = (p) =>
  Array.isArray(p) &&
  p.length >= 2 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Math.abs(p[0]) <= 180 &&
  Math.abs(p[1]) <= 90;
/** Service queries already request EPSG:4326. Never guess a projected coordinate's datum. */
export function arcGeometry(g) {
  if (!g) return null;
  if (g.type && g.coordinates) return g;
  if (Number.isFinite(g.x) && Number.isFinite(g.y) && coordinate([g.x, g.y]))
    return { type: "Point", coordinates: [g.x, g.y] };
  if (
    g.paths?.length &&
    g.paths.every((r) => r.length >= 2 && r.every(coordinate))
  )
    return { type: "MultiLineString", coordinates: g.paths };
  if (
    g.rings?.length &&
    g.rings.every((r) => r.length >= 4 && r.every(coordinate))
  ) {
    // Nest rings by containment: separate outer rings are islands, not holes.
    const inside = ([x, y], ring) => {
      let result = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i],
          [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
          result = !result;
      }
      return result;
    };
    const area = (r) =>
      Math.abs(
        r.reduce((s, p, i) => {
          const q = r[(i + 1) % r.length];
          return s + p[0] * q[1] - q[0] * p[1];
        }, 0),
      );
    const nodes = g.rings
      .map((r) => ({ ring: r, area: area(r), parent: null, depth: 0 }))
      .sort((a, b) => b.area - a.area);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.parent =
        nodes
          .slice(0, i)
          .filter((p) => inside(n.ring[0], p.ring))
          .at(-1) || null;
      n.depth = n.parent ? n.parent.depth + 1 : 0;
    }
    const polygons = nodes
      .filter((n) => n.depth % 2 === 0)
      .map((n) => [
        n.ring,
        ...nodes
          .filter((h) => h.parent === n && h.depth % 2 === 1)
          .map((h) => h.ring),
      ]);
    return polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}
/** Retain extrema within each time bucket and both endpoints for bounded briefing charts. */
export function boundedFigure(points = [], limit = 96) {
  const rows = points
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .map((p) => ({ time: p.time, value: p.value }))
    .sort((a, b) => a.time - b.time);
  if (rows.length <= limit) return rows;
  const buckets = Math.max(1, Math.floor((limit - 2) / 2)),
    width = (rows.length - 2) / buckets,
    result = [rows[0]];
  for (let b = 0; b < buckets; b++) {
    const part = rows.slice(
      1 + Math.floor(b * width),
      1 + Math.floor((b + 1) * width),
    );
    if (!part.length) continue;
    const lo = part.reduce((a, p) => (p.value < a.value ? p : a)),
      hi = part.reduce((a, p) => (p.value > a.value ? p : a));
    result.push(
      ...(lo === hi ? [lo] : [lo, hi]).sort((a, b) => a.time - b.time),
    );
  }
  result.push(rows.at(-1));
  return result;
}
export function geometryBounds(features) {
  const points = [];
  const walk = (c) => {
    if (coordinate(c)) points.push(c);
    else if (Array.isArray(c)) c.forEach(walk);
  };
  for (const f of features) walk(f.geometry?.coordinates);
  if (!points.length) return null;
  return points.reduce(
    (b, p) => [
      Math.min(b[0], p[0]),
      Math.min(b[1], p[1]),
      Math.max(b[2], p[0]),
      Math.max(b[3], p[1]),
    ],
    [180, 90, -180, -90],
  );
}
export function snapshotConcern(c, now = Date.now()) {
  return structuredClone({
    id: c.id,
    title: c.name,
    name: c.name,
    kind: c.kind,
    capturedAt: now,
    change: c.change,
    quality: c.quality,
    guidance: c.guidance,
    nextAction: c.nextAction,
    time: c.time,
    sourceRevision: c.revision,
    details: [...(c.trigger?.lines || []), ...(c.details || []), ...(c.utilityUpdate ? [
      `Estimated restoration: ${c.utilityUpdate.restoration.label}`,
      `Customers reported: ${c.utilityUpdate.customers ?? 'Not supplied'}`,
      ...(c.utilityUpdate.estimateChange ? [`Restoration estimate review: previously ${c.utilityUpdate.estimateChange.previous}; now ${c.utilityUpdate.restoration.label}. Detected ${new Date(c.utilityUpdate.estimateChange.detected).toISOString()}.`] : []),
    ] : [])],
    evidence: (c.evidence || []).map((e) => ({
      ...e,
      points: boundedFigure(e.points),
    })),
    association: c.association || "Nearby context; impact not established",
  });
}

/** Display guidance only: never derives an impact or an official action from proximity. */
export function advisoryProfile(name = "") {
  const type = /flood|rain/i.test(name) ? "water"
    : /wind|red flag|fire/i.test(name) ? "power"
    : /fog|snow|winter|ice|blizzard|freeze|frost/i.test(name) ? "access"
    : /heat|cold/i.test(name) ? "care" : "general";
  return {
    type,
    kinds: type === "water" ? ["river", "road", "care"]
      : ["power", "care"].includes(type) ? ["power", "road", "care"] : ["road", "care"],
    label: type === "water" ? "River conditions & access"
      : type === "power" ? "Power & access" : type === "access" ? "Travel & access" : "Local context",
    nextAction: type === "water" ? "Review rainfall, gauge trends and crossings with the responsible river and road operators"
      : type === "power" ? "Review utility notices, backup-power readiness and road access with the responsible teams"
      : type === "access" ? "Confirm travel restrictions and access with Road Maintenance and affected facilities"
      : "Review official instructions and confirm local needs with the responsible teams",
    qualification: "Mapped overlap with the advisory; not confirmed impacts. Reported status and timestamps still need review. Overlap does not establish safe access or hydraulic/electrical connections.",
  };
}

export function advisoryForecastMode(concern) {
  if (concern?.kind !== "alert") return null;
  if (/^(?:flash flood|severe thunderstorm|tornado) warning$/i.test(concern.name)) return "radar";
  if (/^(?:(?:flash|areal|river) )?flood (?:advisory|watch|warning)$/i.test(concern.name)) return "rain";
  if (/^(?:(?:high|strong|lake|damaging) )?wind (?:advisory|watch|warning)$/i.test(concern.name)) return "gust";
  return null;
}

/** An accumulation may overlap; an instantaneous gust step must occur during the alert. */
export function advisoryForecastWindow(windows, timing, now = Date.now()) {
  const from = Math.max(timing.start ?? now, now);
  const until = timing.end ?? from + 6 * 3_600_000;
  if (until <= from) return null;
  return windows.reduce((earliest, window) => {
    const {start, end} = window;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start >= until ||
      (start === end ? start < from : end <= from)) return earliest;
    return !earliest || start < earliest.start ? window : earliest;
  }, null);
}

/** One list drives both selectable times and playback; no silent nonmatching picker options. */
export function advisoryForecastFrames(windows, timing, now = Date.now()) {
  return windows.filter(window => advisoryForecastWindow([window],timing,now));
}

export const ADVISORY_GAUGE_RADIUS = 5;

/** Use the actual alert footprint and short horizontal distances, not drainage connectivity. */
export function advisoryGauges(alert, features) {
  const rings = alert.features.flatMap(({geometry}) => geometry?.type === "Polygon" ? geometry.coordinates
    : geometry?.type === "MultiPolygon" ? geometry.coordinates.flat() : []);
  const radius = ADVISORY_GAUGE_RADIUS * METERS_PER_MILE;
  return features.filter(feature => {
    const xy = feature.geometry?.coordinates;
    if (feature.properties?.kind !== "gauge" || feature.geometry?.type !== "Point" || !validPoint(xy)) return false;
    if (advisoryMatches(alert, feature)) return true;
    const xScale = 111195 * Math.cos(xy[1] * Math.PI / 180);
    const relative = ([x, y]) => [(x - xy[0]) * xScale, (y - xy[1]) * 111195];
    return rings.some(ring => ring.slice(1).some((end, i) => {
      const [x, y] = relative(ring[i]), [bx, by] = relative(end);
      const dx = bx - x, dy = by - y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, -(x * dx + y * dy) / lengthSquared)) : 0;
      return Math.hypot(x + t * dx, y + t * dy) <= radius;
    }));
  });
}

const advisoryScopes = new WeakMap();
export function advisoryMatches(alert, feature) {
  const features = alert.features;
  if (!Array.isArray(features)) return false;
  let scopes = advisoryScopes.get(features);
  if (!scopes) {
    scopes = features.flatMap(({geometry:g}) => {
      const polygons = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" ? g.coordinates : [];
      return polygons.flatMap((coordinates) => {
        try {return [powerScope(countyGeometry({type:"Polygon",coordinates}))];} catch {return [];}
      });
    });
    advisoryScopes.set(features, scopes);
  }
  const g = feature?.geometry;
  if (!g) return false;
  try {
    if (g.type === "Point") return scopes.some(s=>s.intersects({x:g.coordinates[0],y:g.coordinates[1]}));
    if (g.type === "LineString" || g.type === "MultiLineString")
      return scopes.some(s=>s.intersectsLine(g.type === "LineString" ? [g.coordinates] : g.coordinates));
    if (g.type === "Polygon" || g.type === "MultiPolygon") {
      const shape=countyGeometry(g); return scopes.some(s=>s.intersects(shape));
    }
  } catch {return false;}
  return false;
}

export function advisoryContext(alert, records) {
  const b = geometryBounds(alert.features ?? []);
  if (!b) return [];
  const {kinds} = advisoryProfile(alert.name);
  return [...new Map(records.filter((r) => {
    if (r.id === alert.id || !(r.private || kinds.includes(r.kind))) return false;
    if (r.kind !== "river" && !r.review && !r.private) return false;
    return (r.features ?? []).some(f=>advisoryMatches(alert,f));
  }).map((r) => [r.id, r])).values()].sort((a,b) => {
    const rank = (r) => r.private ? kinds.length : kinds.indexOf(r.kind);
    return rank(a)-rank(b) || Number(/verification|unverified/i.test(a.quality ?? ""))-Number(/verification|unverified/i.test(b.quality ?? "")) || (b.time ?? 0)-(a.time ?? 0) || a.id.localeCompare(b.id);
  }).slice(0, 24);
}
