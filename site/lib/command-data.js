import { POWER_COLORS, POWER_STATES } from "./power-model.js";
import { CATEGORIES } from "./model.js";
import { pilotAssessment, validatePilot } from "./pilot-model.js";
import { refreshPilotSnapshot } from "./pilot-data.js";
import {
  fetchRoads,
  roadInCurrentView,
  roadConflictBacklog,
  missingRoadRecords,
  ROAD_MAP,
} from "./roads.js";
import { fetchRegionalAlerts, loadCounties } from "./nws.js";
import { CONFIG } from "../config.js";
import { concernSummary } from "./mission-model.js";
import {
  arcGeometry,
  boundedFigure,
  orderedConcerns,
  geometryBounds,
} from "./command-model.js";
import { readCareCollection } from "./care-data.js";
import { CARE_SOURCES, ZONE_STATUS, zonesAt } from "./care-model.js";

const num = (n) => (Number.isFinite(n) ? n : null);
const point = (id, name, p, color = "#7dc6d6", kind = "gauge") => ({
  type: "Feature",
  id,
  properties: { id, name, kind, color },
  geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
});
const base = (id, kind, name) => ({
  id,
  kind,
  name,
  group: 3,
  review: false,
  time: null,
  timeLabel: "Source time",
  quality: "Not assessed",
  nextAction: "Review source evidence",
  features: [],
  evidence: [],
  details: [],
  links: [],
});
export function riverConcerns(bundle, now = Date.now()) {
  const assessment = pilotAssessment(validatePilot(bundle, now), now),
    input = bundle.input;
  const rows = assessment.areas.map((row) => {
    const s = concernSummary(row),
      id = "river:" + row.area.id,
      c = base(id, "river", row.area.name);
    c.change = row.status;
    c.review = row.review || row.gaps.length > 0;
    c.quality = row.gaps.length
      ? "Evidence needs verification"
      : "Publisher evidence available";
    c.details = [
      row.area.id === "kings-lower" && row.gauges.some((g) => g.id === "PFQC1")
        ? "Near-dam Kings stage is shown with Pine Flat releases. Farther-downstream routing, distributary operations and travel times remain unverified."
        : row.area.note,
      ...row.gaps,
    ];
    c.nextAction = s.nextReview;
    c.time = s.forecast || row.rainfall?.cycle?.start || s.observed;
    c.timeLabel = s.forecast
      ? "Forecast peak"
      : row.rainfall?.cycle
        ? "Rain window starts"
        : "Observation";
    c.features = [
      ...new Map(row.samplePoints.map((p) => [p.id, p])).values(),
    ].map((p) =>
      point(id, p.name, p, row.review ? "#e2ba75" : "#7dc6d6", "area"),
    );
    c.watershed = {
      "san-joaquin-lower": "MIL",
      "san-joaquin-upper": "MIL",
      "kings-lower": "PNF",
      "kings-upper": "PNF",
    }[row.area.id];
    const rain = row.rainfall;
    c.evidence.push({
      label: "Rain forecast · 72 h",
      value: num(rain.maximum),
      units: "in",
      time: rain.cycle?.start || null,
      start: rain.cycle?.start,
      end: rain.cycle?.end,
      issued: rain.cycle?.issue,
      quality: rain.usable
        ? "Maximum at configured sample points"
        : "Unavailable or expired",
      source: "https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml",
      points: [],
    });
    for (const g of row.gauges) {
      const a = g.assessment;
      c.evidence.push({
        label: g.gauge?.name || g.id,
        value: num(a.observed?.value),
        units: g.gauge?.observed.units || "",
        time: a.observed?.time || null,
        quality: a.current ? "Observed" : "Old / unavailable observation",
        source: g.gauge?.sourceUrl || `https://water.noaa.gov/gauges/${g.id}`,
        points: boundedFigure(g.gauge?.observed.points),
        forecast: boundedFigure(g.gauge?.forecast?.points),
        issued: g.gauge?.forecast?.issued,
      });
    }
    for (const metric of [...(row.releases || []), ...(row.pools || [])]) {
      const station = metric.station || metric.id,
        series = input.reservoirs.stations.find((r) => r.id === station)
          ?.metrics?.[metric.metric];
      c.evidence.push({
        label:
          metric.label ||
          metric.name ||
          metric.metric ||
          "Reservoir observation",
        value: num(metric.value ?? metric.sample?.value),
        units: metric.units || series?.units || "",
        time: metric.time || metric.sample?.time || null,
        quality: metric.current ? "Observed" : "Verify source freshness",
        source: metric.source,
        points: boundedFigure(series?.samples),
      });
    }
    c.links = [
      { label: "NWS Hanford", url: "https://www.weather.gov/hnx/" },
      {
        label: "River and release detail",
        url: `../?view=reservoirs${c.watershed ? "&trends=" + c.watershed : ""}`,
      },
    ];
    c.revision = bundle.dataId;
    return c;
  });
  const features = assessment.gauges.map((g) =>
    point(
      rows.find((r) =>
        assessment.areas
          .find((a) => "river:" + a.area.id === r.id)
          ?.gauges.some((x) => x.id === g.station.id),
      )?.id || "gauge:" + g.station.id,
      g.station.name,
      g.station,
    ),
  );
  for (const r of input.reservoirSettings.stations)
    features.push(
      point(
        r.id === "MIL" ? "river:san-joaquin-lower" : "river:kings-lower",
        r.name,
        r,
        "#d8bc7e",
        "reservoir",
      ),
    );
  const power = assessment.powerRows
    .filter((r) => !["restored", "cancelled"].includes(r.status))
    .map((r) => {
      const c = base("power:" + r.key, "power", `${r.utility} · ${r.name}`);
      c.change = POWER_STATES[r.status] || "Status needs verification";
      c.review = true;
      c.group = 1;
      c.time = r.updated?.time || null;
      c.quality = r.health || "Utility published area";
      c.nextAction = "Verify affected sites and backup power";
      c.details = [
        r.details,
        ...(r.issues || []),
        "Building or site service is unverified.",
      ];
      c.features = input.utilityFeatures
        .filter((f) => f.properties.powerKey === r.key)
        .map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            id: c.id,
            name: c.name,
            kind: "power",
            color: POWER_COLORS[r.status] || POWER_COLORS.unknown,
          },
        }));
      c.links = [
        { label: "Official utility source", url: r.official },
        { label: "Utility evidence", url: "../?view=power" },
      ];
      c.revision = r.revision;
      return c;
    });
  return { rows: [...rows, ...power], features };
}
export function roadConcerns(snapshot, error = null, now = Date.now()) {
  if (!snapshot) return [];
  const rows = snapshot.rows;
  const conflicts = roadConflictBacklog(rows, now);
  const result = rows.map((r) => {
    const c = base(r.key, "road", r.name),
      geometry = arcGeometry(r.geometry);
    c.change = r.status;
    c.review = roadInCurrentView(r, now);
    c.group = 1;
    c.time = r.sourceTime || r.edited;
    c.quality = error
      ? "Last successful query; current status unverified"
      : r.issues.length
        ? "Record needs verification"
        : "County published record";
    c.nextAction = "Confirm road status and access with Road Maintenance";
    c.details = [
      r.location,
      r.reason,
      r.comment,
      r.alternateRoute,
      ...r.issues,
    ].filter(Boolean);
    c.features = geometry
      ? [
          {
            type: "Feature",
            id: c.id,
            properties: {
              id: c.id,
              name: c.name,
              kind: "road",
              color:
                r.issues.length || error
                  ? "#a9b0b5"
                  : r.layer === 2
                    ? "#73c8bd"
                    : "#f2ac6e",
              detour: r.layer === 2,
            },
            geometry,
          },
        ]
      : [];
    c.links = [{ label: "County road source", url: ROAD_MAP }];
    c.revision = r.revision;
    return c;
  });
  if (conflicts.length)
    result.push({
      ...base("roads:legacy-review", "road", "County road records"),
      change: conflicts.length + " elapsed-date records need verification",
      review: true,
      group: 3,
      quality: "Older active flags; reopening is not confirmed",
      nextAction:
        "Reconcile old dates with Road Maintenance before treating these roads as open or closed",
      details: conflicts.map((r) => r.name + " · " + r.status),
      links: [{ label: "County road status source", url: ROAD_MAP }],
    });
  return result;
}
export function alertConcerns(alerts) {
  return alerts
    .filter((a) => a.counties.includes("Fresno"))
    .map((a) => ({
      ...base("nws:" + a.key, "alert", a.type),
      change: a.type,
      group: 0,
      review: true,
      time: a.onset || a.issued,
      timeLabel: "Issued / effective",
      quality: a.quality || "Official NWS " + a.category,
      nextAction: "Review official instructions and affected locations",
      details: [
        `Issuing office ${a.office}`,
        "Expires " +
          (a.expires ? new Date(a.expires).toISOString() : "not supplied"),
      ],
      links: [{ label: "Official NWS alert", url: a.sourceUrl }],
      revision: a.signature,
      features: a.geometries.map((g, i) => ({
        type: "Feature",
        id: a.key + ":" + i,
        geometry: arcGeometry(g),
        properties: {
          id: "nws:" + a.key,
          name: a.type,
          kind: "alert",
          color: (CATEGORIES[a.category] || CATEGORIES.Other).color,
        },
      })),
    }));
}

/** Progressive independent source refresh. Failed updates retain their source times and carry explicit failures. */
export function createCommandFeeds({
  baseUrl = new URL("../", import.meta.url),
  onChange = () => {},
  fetchImpl = fetch,
} = {}) {
  let alive = true,
    busy = false,
    timer,
    epoch = 0;
  const sources = {},
    errors = {},
    checked = {};
  let bundle,
    assessment = { rows: [], features: [] },
    roads,
    missing = new Map(),
    counties,
    care = [],
    zones = [],
    watersheds,
    timeline;
  const read = async (name) => {
    const r = await fetchImpl(new URL("data/" + name, baseUrl), {
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) throw Error("Source unavailable");
    return r.json();
  };
  function publish() {
    if (!alive) return;
    const all = [...assessment.rows, ...Object.values(sources).flat()];
    onChange({
      concerns: orderedConcerns(all.filter((c) => c.review)),
      reference: all,
      features: assessment.features,
      errors: { ...errors },
      checked: { ...checked },
      loading: busy,
      bundle,
      watersheds,
      timeline,
      counties,
    });
  }
  async function job(name, fn) {
    const e = epoch;
    try {
      await fn();
      if (!alive || e !== epoch) return;
      delete errors[name];
      checked[name] = Date.now();
    } catch (error) {
      if (!alive || e !== epoch) return;
      errors[name] = error.message || "Source could not be checked";
    }
    publish();
  }
  async function refresh() {
    if (busy || !alive) return;
    busy = true;
    publish();
    await Promise.allSettled([
      job("River & reservoir evidence", async () => {
        const next = await read("map-pilot-latest.json");
        validatePilot(next);
        if (!alive) return;
        bundle = next;
        assessment = riverConcerns(next);
        if (Date.now() - Date.parse(next.generatedAt) > 45 * 60000)
          errors["Published source bundle"] = "Scheduled collection overdue";
        else delete errors["Published source bundle"];
        publish();
        const refreshed = await refreshPilotSnapshot(next, { fetchImpl });
        if (alive) {
          bundle = refreshed;
          assessment = riverConcerns(refreshed);
        }
      }),
      job("County roads", async () => {
        const next = await fetchRoads(fetchImpl);
        if (!alive) return;
        missing = missingRoadRecords(roads?.rows || [], next.rows, missing);
        roads = next;
        sources.roads = roadConcerns(next);
        sources.missing = [...missing.values()]
          .map(({ row }) => ({
            ...roadConcerns({ rows: [row] }, "Source record disappeared")[0],
            change: "No longer returned · access unconfirmed",
          }))
          .filter((r) => r.id);
      }),
      job("NWS alerts", async () => {
        counties ??= await loadCounties(
          new URL("data/counties.geojson", baseUrl),
          fetchImpl,
        );
        const alerts = await fetchRegionalAlerts(counties, CONFIG, fetchImpl);
        if (alive) sources.alerts = alertConcerns(alerts);
      }),
      job("Watershed timing", async () => {
        const [w, t] = await Promise.all([
          read("reservoir-watersheds.geojson"),
          read("watershed-timeline.json"),
        ]);
        if (alive) {
          watersheds = w;
          timeline = t;
        }
      }),
    ]);
    if (!alive) return;
    if (errors["County roads"])
      sources.roads = roadConcerns(roads, errors["County roads"]);
    if (errors["NWS alerts"])
      sources.alerts = (sources.alerts || []).map((c) => ({
        ...c,
        quality: "Last returned alert; current source check failed",
      }));
    busy = false;
    publish();
    clearTimeout(timer);
    timer = setTimeout(refresh, 300000);
  }
  async function loadPlaces() {
    await job("Care & evacuation context", async () => {
      counties ??= await loadCounties(
        new URL("data/counties.geojson", baseUrl),
        fetchImpl,
      );
      const county = counties.find((c) => c.properties.GEOID === "06019");
      const result = await Promise.all([
        readCareCollection("facilities", { county, fetcher: fetchImpl }),
        readCareCollection("zones", { county, fetcher: fetchImpl }),
      ]);
      if (!alive) return;
      care = result[0].rows;
      zones = result[1].rows;
      sources.zones = zones.map((z) => ({
        ...base(z.key, "zone", `Evacuation zone ${z.name}`),
        change: ZONE_STATUS[z.status] || "Published zone reference",
        review: ["Order", "Warn"].includes(z.status),
        group: z.status === "Order" ? 0 : 1,
        quality: "Individual issue time unavailable",
        nextAction: "Confirm current instructions with Sheriff / OES",
        details: [
          "Population estimates describe residents, not people currently present.",
        ],
        features: [
          {
            type: "Feature",
            id: z.key,
            properties: {
              id: z.key,
              name: z.name,
              kind: "zone",
              color: z.status === "Order" ? "#e78278" : "#d5c28a",
            },
            geometry: arcGeometry(z.geometry),
          },
        ],
        links: [
          {
            label: "Population & outreach context",
            url: `../zone-population.html?zone=${encodeURIComponent(z.name)}&id=${z.oid}`,
          },
          { label: "Official zone reference", url: CARE_SOURCES.zoneItem },
        ],
      }));
      sources.care = care.map((r) => {
        const zs = zonesAt(r.geometry, zones).filter((z) =>
          ["Order", "Warn"].includes(z.status),
        );
        return {
          ...base(r.key, "care", r.name),
          change: zs.length
            ? "Mapped in evacuation area"
            : "Resident-care reference",
          review: !!zs.length,
          group: 1,
          quality: "Facility operating / evacuation status unverified",
          nextAction: "Verify contact, backup power and transport needs",
          details: [
            r.address,
            r.kind,
            ...zs.map((z) => z.name + " · " + ZONE_STATUS[z.status]),
          ],
          features: [
            {
              type: "Feature",
              id: r.key,
              geometry: arcGeometry(r.geometry),
              properties: {
                id: r.key,
                name: r.name,
                kind: "facility",
                color: "#c3b7de",
              },
            },
          ],
          links: [
            { label: "Resident-care evidence", url: "../?view=watch&care=1" },
          ],
        };
      });
    });
  }
  return {
    refresh,
    loadPlaces,
    destroy() {
      alive = false;
      epoch++;
      clearTimeout(timer);
    },
    get state() {
      return { bundle, roads };
    },
  };
}
