import "./style.css";
import type { Concern, FeedState } from "./contracts";

// Existing verified collectors stay separate from this build and its rendering engine.
const root = new URL("../", document.baseURI);
const moduleAt = (name: string): Promise<any> =>
  import(/* @vite-ignore */ new URL(`lib/${name}.js`, root).href);
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const el = (tag: string, text?: string, className?: string) => {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const button = (text: string, action: () => void, cls?: string) => {
  const b = el("button", text, cls) as HTMLButtonElement;
  b.type = "button";
  b.onclick = action;
  return b;
};
const date = (value: any) => {
  const n = typeof value === "string" ? Date.parse(value) : value;
  return Number.isFinite(n)
    ? new Date(n).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "Time not supplied";
};
const link = (text: string, href: string) => {
  const a = el("a", text) as HTMLAnchorElement;
  try {
    const u = new URL(href, location.href);
    if (!["https:", "http:"].includes(u.protocol)) return el("span", text);
    a.href = u.href;
    a.target = "_blank";
    a.rel = "noopener";
  } catch {
    return el("span", text);
  }
  return a;
};
const [model, data, privateModel, privateUI, config, eoc] = await Promise.all([
  moduleAt("command-model"),
  moduleAt("command-data"),
  moduleAt("command-private"),
  moduleAt("command-private-ui"),
  import(/* @vite-ignore */ new URL("config.js", root).href),
  import(/* @vite-ignore */ new URL("eoc-config.js", root).href),
]);
const { current: currentRecord } = await moduleAt("eoc-model");
const state = model.createCommandState();
const cameras = new Map<string, any>();
let feeds: FeedState = {
  concerns: [],
  reference: [],
  features: [],
  errors: {},
  checked: {},
  loading: true,
};
let map: any,
  mapLoading: Promise<void> | undefined,
  privateView: any,
  auth: any,
  authLoading: Promise<void> | undefined;
let showAll = false,
  pendingFit = false,
  lastEvidence = "",
  weatherEpoch = 0,
  weatherMode = "off",
  weatherViews: any = {},
  rainRequest: AbortController | undefined,
  rainTimer: any,
  rainPlaying = false;
let referenceMatches: any[] = [],
  referenceResults = new Map<string, Concern>(),
  searchGeneration = 0,
  searchLoading = false;
const referenceSearch = (
  await moduleAt("command-search")
).createCommandSearch();
let weatherSuspended = false,
  lastRain: any = null;
let currentRainWindow: any = null,
  privateSelection: Concern | undefined;
let authorizedSites: Concern[] = [];
let privateScope = "";
let privateCamera = false;
function invalidateSearch() {
  searchGeneration++;
  searchLoading = false;
}
function clearPrivateContext() {
  const wasPrivate = !!privateSelection || privateCamera;
  privateCamera = false;
  privateSelection = undefined;
  lastEvidence = "";
  invalidateSearch();
  referenceMatches = [];
  state.patch({ query: "" });
  $<HTMLInputElement>("find-place").value = "";
  $("save-message").textContent = "";
  $("save-message").hidden = true;
  if (wasPrivate) {
    state.patch({ camera: null });
    map?.restore({
      center: [-119.65, 36.85],
      zoom: 7.7,
      pitch: 30,
      bearing: 0,
    });
  }
  renderEvidence();
  updateMap();
}
const assets = (await moduleAt("command-assets")).createCommandAssets({
  onChange: (s: any) => {
    authorizedSites = s.concerns;
    if (
      privateSelection?.kind !== "report" &&
      privateSelection &&
      !authorizedSites.some((c) => c.id === privateSelection?.id)
    )
      privateSelection = undefined;
    const b = $("load-assets");
    b.textContent = s.loading
      ? "Loading authorized sites…"
      : "Load authorized facilities & pumps";
    $("asset-status").textContent =
      (s.error ? s.error + " " : "") +
      (s.concerns.length
        ? `${s.concerns.length} authorized inventory records loaded. Current readiness is unverified.`
        : "Private inventory not assessed.");
    lastEvidence = "";
    renderList();
    renderEvidence();
    updateMap();
  },
});
const privateController = privateModel.createCommandPrivate({
  config: eoc.EOC_CONFIG,
  onChange: (s: any) => {
    const nextScope = JSON.stringify([s.username || "", s.incident || ""]);
    if (privateScope !== nextScope) {
      privateScope = nextScope;
      clearPrivateContext();
    }
    privateView?.render();
    renderIncident();
    renderList();
    renderCoverage();
  },
});
privateView = privateUI.mountCommandPrivate({
  work: $("work-view"),
  briefing: $("briefing-view"),
  controller: privateController,
  onFocus: (id: any) => {
    if (typeof id === "string" && feeds.reference.some((c) => c.id === id))
      select(id);
    else if (id?.payload) {
      privateCamera = true;
      const p = id.payload,
        g = model.arcGeometry({ x: p.longitude, y: p.latitude });
      privateSelection = {
        id: "private-report",
        name: p.location || "Private field report",
        kind: "report",
        private: true,
        change: p.condition,
        time: p.observed,
        timeLabel: "Observed",
        quality: "Reported condition · review verification history in Work",
        group: 1,
        review: true,
        nextAction: p.requestedFollowup,
        features: g
          ? [
              {
                type: "Feature",
                geometry: g,
                properties: {
                  id: "private-report",
                  name: p.location,
                  kind: "facility",
                  color: "#c3b7de",
                },
              },
            ]
          : [],
        details: [p.evidence],
        evidence: [],
        links: [],
      };
      lastEvidence = "";
      pendingFit = true;
      navigate("watch", null);
      renderEvidence();
      updateMap();
      pane("details");
    }
  },
});
function privateTasks(): Concern[] {
  const s = privateController.state;
  if (!s.username || !s.incident || s.loading) return [];
  return privateModel
    .taskRows(s.records)
    .filter((r: any) => r.group !== "Completed or canceled")
    .map((r: any) => {
      const p = r.record.payload,
        place = feeds.reference.find((c) => c.id === p.publicPlaceId);
      return {
        id: "private-task:" + r.record.id,
        kind: "private",
        private: true,
        name: p.location || p.title,
        change: p.title,
        time: p.due,
        timeLabel: "Due",
        quality: r.conflict ? "Conflicting versions" : r.group,
        review: true,
        group: 2,
        nextAction: `${p.owner || "Unassigned"} · ${p.nextReview}`,
        features: place?.features || [],
        evidence: [],
        details: [p.evidence || "No progress evidence recorded"],
        links: [],
      };
    });
}
const current = (): Concern | undefined =>
  privateSelection ||
  feeds.reference.find((c) => c.id === state.value.selected) ||
  referenceResults.get(state.value.selected);
function notify(text: string) {
  $("save-message").textContent = text;
  $("save-message").hidden = false;
}
$("save-message").onclick = () => {
  $("save-message").hidden = true;
};
function navigate(
  view: string,
  selected: string | null = state.value.selected,
) {
  invalidateSearch();
  const params = new URLSearchParams();
  if (selected) params.set("place", selected);
  location.hash = `/${view}${params.size ? "?" + params : ""}`;
}
function pane(value: string) {
  state.patch({ mobile: value });
  document.body.dataset.pane = value;
  document
    .querySelectorAll<HTMLButtonElement>("[data-pane]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.pane === value)),
    );
  if (value === "map") {
    void ensureMap();
    resumeWeather();
  } else if (matchMedia("(max-width:700px)").matches) suspendWeather();
  map?.resize();
}
function route() {
  invalidateSearch();
  const next = model.routeState(location.hash);
  const changed = next.selected !== state.value.selected;
  if (changed && state.value.selected && state.value.camera)
    cameras.set(state.value.selected, state.value.camera);
  if (next.selected) privateSelection = undefined;
  state.patch(next);
  if (changed) {
    const saved = cameras.get(next.selected);
    if (saved) {
      state.patch({ camera: saved });
      map?.restore(saved);
      pendingFit = false;
    } else pendingFit = true;
  }
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) => {
    if (b.dataset.view === next.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  for (const view of ["watch", "work", "briefing"])
    $(view + "-view").hidden = next.view !== view;
  document.querySelector<HTMLElement>(".mobile-panes")!.hidden =
    next.view !== "watch";
  if (next.view !== "watch") suspendWeather();
  else {
    resumeWeather();
    map?.resize();
    if (
      !matchMedia("(max-width:700px)").matches ||
      state.value.mobile === "map"
    )
      void ensureMap();
  }
  renderList();
  renderEvidence();
  updateMap();
}
window.addEventListener("hashchange", route);
document
  .querySelectorAll<HTMLButtonElement>("[data-view]")
  .forEach((b) => (b.onclick = () => navigate(b.dataset.view!)));
document
  .querySelectorAll<HTMLButtonElement>("[data-pane]")
  .forEach((b) => (b.onclick = () => pane(b.dataset.pane!)));
document
  .querySelectorAll<HTMLButtonElement>("[data-place]")
  .forEach((b) => (b.onclick = () => select(b.dataset.place!)));
function select(id: string) {
  invalidateSearch();
  const site = [...authorizedSites, ...privateTasks()].find((c) => c.id === id);
  if (site) {
    privateCamera = true;
    privateSelection = site;
    pendingFit = true;
    lastEvidence = "";
    navigate("watch", null);
    renderEvidence();
    updateMap();
    pane("details");
    return;
  }
  privateSelection = undefined;
  privateCamera = false;
  pendingFit = true;
  lastEvidence = "";
  navigate("watch", id);
  if (state.value.selected === id) {
    renderEvidence();
    updateMap();
  }
  if (matchMedia("(max-width:700px)").matches) pane("details");
}
$("evidence-close").onclick = () => {
  privateSelection = undefined;
  navigate("watch", null);
  renderEvidence();
  updateMap();
  pane("attention");
};
$("search").onsubmit = (e) => {
  e.preventDefault();
  state.patch({ query: $<HTMLInputElement>("find-place").value.trim() });
  showAll = true;
  renderList();
};
$<HTMLInputElement>("find-place").oninput = () => {
  state.patch({ query: $<HTMLInputElement>("find-place").value.trim() });
  void searchReferences();
  renderList();
};
$<HTMLSelectElement>("concern-filter").onchange = () => {
  state.patch({ filter: $<HTMLSelectElement>("concern-filter").value });
  renderList();
};
$("show-all").onclick = () => {
  showAll = !showAll;
  renderList();
};
const category = [
  "Official agency alert",
  "Reported impact",
  "Follow-up due",
  "Planning review",
];
async function searchReferences() {
  const epoch = ++searchGeneration;
  const q = state.value.query;
  referenceMatches = [];
  if (q.length < 2) {
    searchLoading = false;
    return;
  }
  searchLoading = true;
  try {
    const rows = await referenceSearch.find(q);
    if (epoch === searchGeneration) referenceMatches = rows;
  } catch {
    if (epoch === searchGeneration)
      notify(
        "Reference names could not be checked. Loaded conditions remain searchable.",
      );
  } finally {
    if (epoch === searchGeneration) {
      searchLoading = false;
      renderList();
    }
  }
}
function renderList() {
  const q = state.value.query.toLowerCase(),
    filter = state.value.filter;
  let rows: Concern[] = model
    .orderedConcerns(
      q
        ? [...feeds.reference, ...authorizedSites, ...privateTasks()]
        : [...feeds.concerns, ...privateTasks()],
    )
    .filter(
      (c: Concern) =>
        (filter === "all" || c.kind === filter) &&
        (!q || `${c.name} ${c.change}`.toLowerCase().includes(q)),
    );
  const target = $("attention-list");
  target.replaceChildren();
  if (filter === "private") {
    const s = privateController.state;
    if (!s.username)
      target.append(el("p", "Sign in to view private follow-ups.", "empty"));
    else if (!s.incident)
      target.append(
        button("Choose an incident in Work", () => navigate("work")),
      );
    else {
      const tasks = privateModel
        .taskRows(s.records)
        .filter((r: any) => r.group !== "Completed or canceled");
      for (const t of tasks.slice(0, showAll ? tasks.length : 5)) {
        const b = button("", () => navigate("work"), "concern");
        b.append(
          el(
            "strong",
            t.record.payload.title || t.record.payload.location || "Follow-up",
          ),
          el("span", t.group, "kind"),
          el(
            "span",
            `${t.record.payload.owner || "Unassigned"} · ${date(t.record.payload.due)}`,
            "when",
          ),
        );
        target.append(b);
      }
      if (!tasks.length)
        target.append(
          el(
            "p",
            "No outstanding follow-ups returned for this incident.",
            "empty",
          ),
        );
    }
    $("show-all").hidden = true;
    return;
  }
  $("list-title").textContent = q ? "Matching places" : "Needs attention";
  for (const c of rows.slice(0, showAll || q ? rows.length : 5)) {
    const b = button("", () => select(c.id), "concern");
    b.setAttribute("aria-pressed", String(c.id === state.value.selected));
    b.append(
      el("span", category[c.group] || "Reference", "kind"),
      el("strong", c.name),
      el("span", c.change, "reason"),
      el("span", c.time ? date(c.time) : "Time not supplied", "when"),
      el("span", c.quality, "quality"),
    );
    target.append(b);
  }
  if (q) {
    for (const r of referenceMatches) {
      const b = button(
        "",
        () => {
          const epoch = ++searchGeneration;
          notify("Loading selected outline…");
          void referenceSearch
            .select(r)
            .then((c: Concern) => {
              if (epoch !== searchGeneration) return;
              referenceResults.set(c.id, c);
              $("save-message").hidden = true;
              select(c.id);
            })
            .catch(() => {
              if (epoch === searchGeneration)
                notify("Selected outline could not be loaded.");
            });
        },
        "concern",
      );
      b.append(
        el("strong", r.name),
        el(
          "span",
          r.kind === "waterbody"
            ? "Lake / reservoir outline"
            : r.kind === "waterway"
              ? "Waterway reference"
              : "Road reference",
          "when",
        ),
      );
      target.append(b);
    }
    if (searchLoading)
      target.append(el("p", "Checking reference names…", "empty"));
  }
  if (!rows.length && !referenceMatches.length && !searchLoading)
    target.append(
      el(
        "p",
        feeds.loading
          ? "Checking sources…"
          : q
            ? "No matching place returned. Try a river or reservoir name."
            : "No concerns returned for this filter. Coverage is shown below; this is not a declaration of safe conditions.",
        "empty",
      ),
    );
  $("show-all").hidden = rows.length <= 5 || !!q;
  $("show-all").textContent = showAll
    ? "Show first five"
    : `Show all ${rows.length} concerns`;
}
function nearby(c: Concern) {
  const b = model.geometryBounds(c.features);
  if (!b) return [];
  const pad = 0.05,
    search = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  return [...feeds.reference, ...authorizedSites]
    .filter(
      (r) =>
        r.id !== c.id &&
        ((["road", "care", "power"].includes(r.kind) && r.review) || r.private),
    )
    .filter((r) => {
      const q = model.geometryBounds(r.features);
      return (
        q &&
        q[0] <= search[2] &&
        q[2] >= search[0] &&
        q[1] <= search[3] &&
        q[3] >= search[1]
      );
    })
    .slice(0, 8);
}
function chart(e: any) {
  const section = el("section", undefined, "chart");
  section.append(el("h3", e.label));
  const value = el(
    "div",
    Number.isFinite(e.value)
      ? e.value.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : "Unavailable",
    "value",
  );
  value.append(el("small", " " + (e.units || "")));
  section.append(value);
  const points = e.points || [];
  if (points.length > 1) {
    const x0 = points[0].time,
      x1 = points.at(-1).time,
      values = points.map((p: any) => p.value),
      lo = Math.min(...values),
      hi = Math.max(...values);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 300 90");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `${e.label}: ${date(x0)} to ${date(x1)}, range ${lo} to ${hi} ${e.units}.`,
    );
    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute(
      "points",
      points
        .map(
          (p: any) =>
            `${10 + (280 * (p.time - x0)) / (x1 - x0 || 1)},${72 - (60 * (p.value - lo)) / (hi - lo || 1)}`,
        )
        .join(" "),
    );
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#9cdae1");
    line.setAttribute("stroke-width", "2");
    svg.append(line);
    section.append(
      svg,
      el(
        "p",
        `${date(x0)} → ${date(x1)} · ${lo.toLocaleString()}–${hi.toLocaleString()} ${e.units}`,
      ),
    );
  }
  section.append(el("p", `${e.quality} · ${date(e.time)}`));
  if (e.end) section.append(el("p", `Valid through ${date(e.end)}`));
  if (e.issued) section.append(el("p", `Forecast issued ${date(e.issued)}`));
  return section;
}
function renderEvidence() {
  const c = current();
  $("watch-view").classList.toggle("has-selection", !!c);
  $("evidence").hidden = !c;
  if (!c) {
    lastEvidence = "";
    $("evidence-name").textContent = "";
    $("evidence-content").replaceChildren();
    return;
  }
  const signature = JSON.stringify([
    c.id,
    c.revision,
    c.change,
    c.quality,
    c.evidence,
  ]);
  if (lastEvidence === signature) return;
  lastEvidence = signature;
  $("evidence-name").textContent = c.name;
  const out = $("evidence-content");
  out.replaceChildren(
    el("p", c.change, "summary"),
    el("p", c.quality, "quality"),
  );
  const next = el("section", undefined, "next-step");
  next.append(el("h3", "Next review"), el("p", c.nextAction));
  const actions = el("div", undefined, "actions");
  actions.append(
    button(
      "Assign verification",
      () => {
        navigate("work");
        privateView.focusAssignment?.(c);
        notify(
          privateController.state.incident
            ? `Assign a follow-up for ${c.name}.`
            : "Choose your incident in Work before saving this follow-up.",
        );
      },
      "primary",
    ),
    button("Add to briefing", () => {
      try {
        privateController.capture({
          ...model.snapshotConcern(c),
          rendering: {
            camera: state.value.camera,
            weather: weatherMode,
            window: currentRainWindow,
          },
          revision: c.revision,
        });
        notify("Evidence captured in the private briefing draft.");
      } catch (e: any) {
        notify(e.message);
        navigate("briefing");
      }
    }),
  );
  next.append(actions);
  out.append(next);
  const summaries = [
    c.evidence.find((e) => e.label.toLowerCase().includes("rain")),
    c.evidence.find((e) => /release/i.test(e.label)),
    c.evidence.find((e) => !/(rain|pool|release)/i.test(e.label)),
  ].filter(Boolean);
  for (const e of [
    ...new Set(summaries.length ? summaries : c.evidence.slice(0, 3)),
  ])
    out.append(chart(e));
  const near = el("details", undefined, "nearby");
  near.append(
    el("summary", "Nearby concerns"),
    el("p", "Map proximity only. Connections and access are not established."),
  );
  for (const r of nearby(c))
    near.append(button(r.name + " · " + r.change, () => select(r.id)));
  if (!nearby(c).length)
    near.append(
      el(
        "p",
        "No nearby road, power or care records returned. County facility and pump coverage requires authorized access.",
      ),
    );
  out.append(near);
  const details = el("details");
  details.append(el("summary", "Sources, limits & other observations"));
  for (const d of c.details.filter(Boolean)) details.append(el("p", d));
  for (const e of c.evidence.filter((e) => !summaries.includes(e)))
    details.append(chart(e));
  for (const l of c.links) details.append(link(l.label, l.url));
  for (const e of c.evidence)
    if (e.source && /^https?:\/\//.test(e.source))
      details.append(link(e.label + " source", e.source));
  out.append(details);
}
function renderCoverage() {
  const target = $("coverage-list");
  target.replaceChildren();
  for (const [name, t] of Object.entries(feeds.checked))
    target.append(el("p", `${name} · checked ${date(t)}`));
  for (const [name, error] of Object.entries(feeds.errors))
    target.append(el("p", `${name}: ${error}`, "quality"));
  target.append(
    el(
      "p",
      "Private facilities and drainage are not assessed until authorized data is loaded.",
    ),
  );
  $("coverage-title").textContent = Object.keys(feeds.errors).length
    ? `Coverage · ${Object.keys(feeds.errors).length} checks need review`
    : "Coverage & sources";
  const warnings = feeds.concerns.filter((c) => c.group === 0),
    due = privateTasks().filter(
      (c) => c.quality === "Overdue" || c.quality === "Conflicting versions",
    );
  const important = $("important");
  important.replaceChildren();
  important.hidden =
    !warnings.length && !due.length && !Object.keys(feeds.errors).length;
  if (warnings.length)
    important.append(
      el(
        "span",
        `${warnings.length} official alert${warnings.length === 1 ? "" : "s"} · county scope`,
      ),
      button("Review", () => select(warnings[0].id)),
    );
  else if (due.length)
    important.append(
      el(
        "span",
        `${due.length} follow-up${due.length === 1 ? "" : "s"} need review for the selected incident`,
      ),
      button("Work", () => navigate("work")),
    );
  else if (Object.keys(feeds.errors).length)
    important.append(
      el(
        "span",
        "Some conditions could not be checked. Review coverage before relying on this picture.",
      ),
      button("Coverage", () => {
        navigate("watch");
        pane("attention");
        (document.querySelector(".coverage") as HTMLDetailsElement).open = true;
        document
          .querySelector(".coverage")
          ?.scrollIntoView({ block: "nearest" });
      }),
    );
}
function renderIncident() {
  const s = privateController.state;
  const incident = currentRecord(s.records.incidents);
  $("incident-context").textContent =
    "Exercise · " + (incident?.payload.name || "No incident selected");
  $("activation-context").textContent = incident?.payload.level
    ? `Recorded ${incident.payload.level}`
    : "Activation unconfirmed";
  const p = s.records.periods.find((r: any) => r.id === s.period);
  $("period-context").textContent = p?.payload.label || "Exercise records only";
}
function updateMap() {
  if (!map) return;
  const c = current();
  let features = feeds.features;
  if (c) {
    const b = model.geometryBounds(c.features);
    features = [
      ...c.features,
      ...nearby(c).flatMap((r) => r.features),
      ...feeds.features.filter((f) => {
        const p = f.geometry.coordinates;
        return (
          b &&
          p[0] >= b[0] - 0.2 &&
          p[0] <= b[2] + 0.2 &&
          p[1] >= b[1] - 0.2 &&
          p[1] <= b[3] + 0.2
        );
      }),
    ];
  }
  map.set({ type: "FeatureCollection", features });
  const basin = c?.watershed
    ? feeds.watersheds?.features.find(
        (f: any) => f.properties.reservoir === c.watershed,
      )
    : null;
  map.watershed(basin);
  $("map-place").textContent = c?.name || "Fresno County & upstream watersheds";
  $("map-scope").textContent = c
    ? "Selected place · nearby context · current observations"
    : "Reference terrain · major waterways";
  if (pendingFit && c) {
    const b = model.geometryBounds([...c.features, ...(basin ? [basin] : [])]);
    if (b) map.focus(b, true, { top: 100, bottom: 170, left: 50, right: 50 });
    pendingFit = false;
  }
}
async function ensureMap() {
  if (map) return;
  if (mapLoading) return mapLoading;
  mapLoading = (async () => {
    try {
      const { createWatchTerrain } = await moduleAt("watch-terrain-map");
      map = await createWatchTerrain({
        container: $("command-map"),
        onSelect: (p: any) => {
          if (
            [...feeds.reference, ...authorizedSites].some((c) => c.id === p.id)
          )
            select(p.id);
          else {
            const c = feeds.reference.find((c) =>
              c.features.some((f) => f.properties?.id === p.id),
            );
            if (c) select(c.id);
          }
        },
        onCamera: (camera: any) => state.patch({ camera }),
        onError: () => {
          $("map-failure").textContent =
            "Some reference map tiles are unavailable. Evidence and Work remain accessible.";
          $("map-failure").hidden = false;
        },
      });
      const attribution = $("command-map").querySelector<HTMLDetailsElement>(
        ".maplibregl-ctrl-attrib",
      );
      if (attribution) {
        attribution.open = false;
        attribution.classList.remove("maplibregl-compact-show");
      }
      map.restore(
        state.value.camera || {
          center: [-119.65, 36.85],
          zoom: 7.7,
          pitch: 30,
          bearing: 0,
        },
      );
      updateMap();
    } catch (e: any) {
      $("map-failure").hidden = false;
      $("map-failure").textContent =
        "3D map unavailable. Use Attention and Details to inspect conditions and continue working.";
    } finally {
      mapLoading = undefined;
    }
  })();
  return mapLoading;
}
$("map-fit").onclick = () => {
  if (current()) {
    pendingFit = true;
    updateMap();
  } else
    map?.restore({
      center: [-119.65, 36.85],
      zoom: 7.7,
      pitch: 30,
      bearing: 0,
    });
};
$("map-overhead").onclick = () => {
  const b = $("map-overhead"),
    pressed = b.getAttribute("aria-pressed") !== "true";
  b.setAttribute("aria-pressed", String(pressed));
  map?.overhead(pressed);
};
async function initializeAuth() {
  if (auth) return;
  if (authLoading) return authLoading;
  authLoading = (async () => {
    try {
      const [{ setupAuth }, { loadCoreSdk }] = await Promise.all([
        moduleAt("auth"),
        moduleAt("sdk"),
      ]);
      auth = await setupAuth(
        config.CONFIG.arcgis,
        false,
        (s: any) => {
          if (!s) clearPrivateContext();
          assets.connect(s);
          if (s)
            void privateController
              .connect(s)
              .catch((e: any) => notify(e.message));
          else {
            privateController.disconnect();
            lastEvidence = "";
            renderEvidence();
            updateMap();
          }
        },
        { loadSdk: loadCoreSdk },
      );
    } catch {
      notify(
        "County sign-in could not load. Public evidence remains available.",
      );
    } finally {
      authLoading = undefined;
    }
  })();
  return authLoading;
}
$("sign-in").addEventListener(
  "click",
  async () => {
    if (auth) return;
    $("identity-status").textContent = "Loading county sign-in…";
    await initializeAuth();
    if (auth && !(await auth.check())) $("sign-in").click();
  },
  { once: true },
);
function suspendWeather() {
  if (weatherSuspended) return;
  weatherSuspended = true;
  clearTimeout(rainTimer);
  rainPlaying = false;
  document
    .querySelector("[data-rain-play]")
    ?.replaceChildren(document.createTextNode("Play"));
  weatherViews[weatherMode]?.suspend();
  if (weatherMode === "rain") map?.rain(null);
}
function resumeWeather() {
  if (
    !weatherSuspended ||
    document.hidden ||
    state.value.view !== "watch" ||
    (matchMedia("(max-width:700px)").matches && state.value.mobile !== "map")
  )
    return;
  weatherSuspended = false;
  weatherViews[weatherMode]?.resume();
  if (weatherMode === "rain" && lastRain) {
    if (lastRain.cycle.end > Date.now()) map?.rain(lastRain);
    else
      $("weather-time").textContent =
        "Selected forecast expired · choose a current window";
  }
}
function pauseWeather() {
  weatherSuspended = false;
  lastRain = null;
  weatherEpoch++;
  rainRequest?.abort();
  clearTimeout(rainTimer);
  rainPlaying = false;
  weatherViews.radar?.close();
  weatherViews.clouds?.close();
  map?.rain(null);
  weatherMode = "off";
  $<HTMLSelectElement>("weather").value = "off";
  $("weather-controls").replaceChildren();
  $("weather-time").hidden = true;
  $("weather-legend").hidden = true;
  $("weather-details").hidden = true;
}
function colors(bands: any[]) {
  const box = $("weather-legend");
  box.replaceChildren();
  box.hidden = false;
  for (const b of bands) {
    const span = el("span", undefined, "legend-band"),
      swatch = el("i", undefined, "legend-swatch");
    swatch.style.backgroundColor = b.color;
    span.append(swatch, document.createTextNode(String(b.label ?? b.value)));
    box.append(span);
  }
}
async function chooseWeather(mode: string) {
  pauseWeather();
  weatherMode = mode;
  $<HTMLSelectElement>("weather").value = mode;
  const epoch = weatherEpoch;
  if (mode === "off") return;
  await ensureMap();
  if (epoch !== weatherEpoch || !map) return;
  const controls = $("weather-controls"),
    info = $("weather-time"),
    items = $("weather-source");
  info.hidden = false;
  $("weather-details").hidden = false;
  info.textContent = "Loading dated weather evidence…";
  if (mode === "rain") {
    const { loadWatershedRain, regionalForecastBounds } = await moduleAt(
      "watch-watershed-data",
    );
    if (epoch !== weatherEpoch) return;
    const windows = (feeds.timeline?.windows || []).filter(
      (w: any) => Number.isFinite(w.end) && w.end > Date.now(),
    );
    const choose = el("select") as HTMLSelectElement;
    choose.setAttribute("aria-label", "Rain forecast window");
    choose.append(new Option("72-hour overview", ""));
    for (const w of windows)
      choose.append(new Option(date(w.start) + " · 6 h", String(w.layer)));
    const play = button("Play", () => {
      rainPlaying = !rainPlaying;
      play.textContent = rainPlaying ? "Pause" : "Play";
      if (rainPlaying) advance();
      else clearTimeout(rainTimer);
    });
    play.dataset.rainPlay = "true";
    play.disabled = !windows.length;
    controls.append(play, choose);
    const draw = async () => {
      rainRequest?.abort();
      const request = new AbortController();
      rainRequest = request;
      currentRainWindow =
        windows.find((w: any) => String(w.layer) === choose.value) || null;
      info.textContent = "Loading selected forecast window…";
      try {
        const rain = await loadWatershedRain(regionalForecastBounds, {
          window: currentRainWindow,
          signal: request.signal,
        });
        if (epoch !== weatherEpoch || request.signal.aborted) return;
        lastRain = rain;
        if (!weatherSuspended) map.rain(rain);
        info.textContent = `${currentRainWindow ? "6-hour" : "72-hour"} forecast · ${date(rain.cycle.start)} → ${date(rain.cycle.end)}`;
        colors(rain.legend);
        items.replaceChildren(
          el(
            "p",
            `Rainfall accumulation in inches. Issued ${date(rain.cycle.issue)}. Current gauges, roads and power records remain current context; they are not future predictions.`,
          ),
          link(
            "WPC forecast source",
            "https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml",
          ),
        );
      } catch (e: any) {
        if (request.signal.aborted || epoch !== weatherEpoch) return;
        lastRain = null;
        map.rain(null);
        $("weather-legend").hidden = true;
        info.textContent = "Forecast window unavailable · gap retained";
        items.textContent = e.message;
        rainPlaying = false;
        play.textContent = "Play";
      }
    };
    const advance = async () => {
      if (!rainPlaying || epoch !== weatherEpoch || document.hidden) return;
      choose.selectedIndex =
        choose.selectedIndex >= choose.options.length - 1
          ? 1
          : choose.selectedIndex + 1;
      await draw();
      if (rainPlaying) rainTimer = setTimeout(advance, 1800);
    };
    choose.onchange = () => {
      rainPlaying = false;
      play.textContent = "Play";
      clearTimeout(rainTimer);
      void draw();
    };
    await draw();
  } else {
    if (!weatherViews[mode]) {
      const mod = await moduleAt(
        mode === "radar" ? "watch-radar-ui" : "watch-forecast-cloud-ui",
      );
      if (epoch !== weatherEpoch) return;
      const options = {
        session: map,
        info,
        items,
        source: link,
        visible: () =>
          state.value.view === "watch" &&
          (!matchMedia("(max-width:700px)").matches ||
            state.value.mobile === "map"),
        renderColors: (title: string, bands: any[]) => {
          colors(bands);
          $("weather-legend").prepend(el("strong", title + " "));
        },
      };
      weatherViews[mode] =
        mode === "radar"
          ? mod.installWatchRadar(options)
          : mod.installForecastClouds(options);
    }
    const view = weatherViews[mode];
    controls.append(view.controls);
    if (mode === "radar") {
      controls.append(view.cloudButton);
      controls.append(view.cloudStatus, view.cloudLegend);
    }
    view.open();
    if (mode === "radar") items.append(view.volumeButton);
    if (weatherSuspended) view.suspend();
  }
}
$<HTMLSelectElement>("weather").onchange = () =>
  void chooseWeather($<HTMLSelectElement>("weather").value).catch(() => {
    pauseWeather();
    notify("Weather display unavailable. Try another product.");
  });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspendWeather();
  else resumeWeather();
});
const collector = data.createCommandFeeds({
  baseUrl: root,
  onChange: (value: FeedState) => {
    feeds = value;
    renderList();
    renderCoverage();
    renderEvidence();
    updateMap();
  },
});
$("refresh").onclick = () => void collector.refresh();
$("load-places").onclick = () => {
  void collector.loadPlaces();
  $("load-places").textContent = "Refreshing care & evacuation context…";
};
$("load-assets").onclick = () => {
  if (!privateController.state.username) {
    notify("Sign in with county AGOL to load authorized sites.");
    (document.querySelector(".account") as HTMLDetailsElement).open = true;
    return;
  }
  void assets.load(
    feeds.counties?.find((c: any) => c.properties.GEOID === "06019"),
  );
};
pane("attention");
route();
void collector.refresh();
try {
  if (
    new URLSearchParams(location.search).has("code") ||
    localStorage.getItem("frog-county-signin") === "1"
  )
    void initializeAuth();
} catch {
  /* Storage can be disabled; sign-in remains explicit. */
}
window.addEventListener(
  "pagehide",
  () => {
    pauseWeather();
    collector.destroy();
    privateView.destroy();
    privateController.destroy();
    assets.destroy();
    map?.destroy();
  },
  { once: true },
);
