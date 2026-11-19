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
const localForecastTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
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
const { createForecastPlayback } = await moduleAt("command-weather-player");
let forecastPlayer: any;
let advisoryPlaybackIntent: string | undefined;
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
  forecastRequest: AbortController | undefined,
  gustTimer: any;
let burnContextPreference = true;
let referenceMatches: any[] = [],
  referenceResults = new Map<string, Concern>(),
  searchGeneration = 0,
  searchLoading = false;
const referenceSearch = (
  await moduleAt("command-search")
).createCommandSearch();
let weatherSuspended = false,
  lastRain: any = null;
let snowRequest: AbortController | undefined,
  snowFrameRequest: AbortController | undefined,
  snowTimer: ReturnType<typeof setTimeout> | undefined,
  snowDraw: (() => void) | null = null;
type AdvisoryTiming = { start: number | null; end: number | null };
let checkedAdvisory: string | undefined,
  advisoryRequest: AbortController | undefined,
  advisoryWeatherId: string | undefined;
let advisoryRoadRequest: AbortController | undefined;
let advisoryRoadContext: {
  id:string; revision?:string; status:string; features:any[];
  matched:string[]; unmatched:string[]; failed:string[]; limited:boolean;
} | undefined;
const snowSummaries = new Map<string, string>();
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
  team: eoc.EOC_CONFIG.teamLabel,
  onNavigate: (view: string) => navigate(view),
  onNotices: () => { renderList(); renderCoverage(); },
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
  const tasks = privateModel
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
  const outreach = (privateView?.pioNotices() ?? []).map((n: any) => ({
    id: "private-pio:" + n.key, kind: "private", private: true,
    name: n.location, change: n.change, time: n.sourceTime, timeLabel: "Recorded",
    quality: n.category === "Overdue follow-ups" ? "Overdue" : n.verification,
    review: true, group: 2, nextAction: `${n.owner || "Unassigned"} · ${n.nextReview}`,
    features: [], evidence: [], details: ["PIO review cue · approved message unchanged"], links: [],
  }));
  return [...tasks, ...outreach];
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
    if (saved && !(pendingFit && current()?.kind === "alert")) {
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
  syncAdvisoryWeather();
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
  advisoryPlaybackIntent = id;
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
    syncAdvisoryWeather(true);
  }
  if (matchMedia("(max-width:700px)").matches) {
    const clicked = feeds.reference.find((c) => c.id === id) ?? referenceResults.get(id);
    pane(["alert", "burn-scar"].includes(clicked?.kind || "") && clicked?.features.length ? "map" : "details");
  }
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
      ...(c.utilityUpdate ? [el("span", `${c.utilityUpdate.publisher}: ${c.utilityUpdate.text}`, "utility-update")] : []),
      ...utilityFacts(c, true),
      el("span", c.change, "reason"),
      el("span", `${c.utilityUpdate ? "Utility updated · " : ""}${c.time ? date(c.time) : "Time not supplied"}`, "when"),
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
function utilityFacts(c: Concern, compact = false) {
  const u = c.utilityUpdate;
  if (!u) return [];
  const tag = compact ? "span" : "p";
  const rows = [
    el(tag, `Estimated restoration: ${u.restoration.label}`, "utility-fact"),
    el(tag, `Customers reported: ${u.customers === null ? "Not supplied" : u.customers.toLocaleString("en-US")}`, "utility-fact"),
  ];
  if (u.estimateChange) {
    rows.push(el(tag, u.estimateChange.type === "conflict" ? "Conflicting restoration estimates — review" : "Restoration estimate changed — review", "estimate-review"));
    if (!compact) rows.push(el("p", `Previously: ${u.estimateChange.previous}. Detected ${date(u.estimateChange.detected)} while this page was open.`, "utility-fact"));
  }
  if (u.restoration.passed) rows.push(el(tag, "Estimate has passed · restoration unconfirmed", "estimate-review"));
  return rows;
}
function nearby(c: Concern): Concern[] {
  if (c.kind === "alert") return model.advisoryContext(c, [...feeds.reference, ...authorizedSites]);
  if (c.trigger?.relatedIds?.length) {
    const byId = new Map(feeds.reference.map(entry => [entry.id, entry]));
    return c.trigger.relatedIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  }
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
    c.utilityUpdate,
    c.guidance,
    advisoryRoadContext?.id === c.id ? [advisoryRoadContext.status, advisoryRoadContext.matched,
      advisoryRoadContext.unmatched, advisoryRoadContext.failed, advisoryRoadContext.limited] : null,
    c.trigger,
    c.mapGap,
    c.memberIds,
    c.watershed ? snowSummaries.get(c.watershed) : null,
    c.evidence,
    nearby(c).map((r: Concern) => [r.id, r.change, r.time, r.quality]),
  ]);
  if (lastEvidence === signature) return;
  lastEvidence = signature;
  $("evidence-name").textContent = c.name;
  const out = $("evidence-content");
  out.replaceChildren(
    ...(c.utilityUpdate ? [el("p", `${c.utilityUpdate.publisher}: ${c.utilityUpdate.text}`, "utility-update")] : []),
    ...utilityFacts(c),
    el("p", c.change, "summary"),
    el("p", c.quality, "quality"),
  );
  if (c.utilityUpdate) out.append(el("p", `Utility updated · ${date(c.time)}`, "when"));
  if (c.guidance) {
    const g = c.guidance, guidance = el("section", undefined, "nws-guidance");
    guidance.append(el("h3", "NWS expects"), el("p", g.what));
    if (g.impacts) guidance.append(el("h3", "Potential impacts"), el("p", g.impacts));
    guidance.append(el("p", g.when || `${date(c.alertTiming?.start)} → ${date(c.alertTiming?.end)}`, "when"));
    guidance.append(el("p", `${g.publisher} · issued ${date(g.issued)}`, "when"));
    for (const tag of g.tags) guidance.append(el("p", `${tag.label} · ${tag.value}`, "quality"));
    const instructions = el("details");
    instructions.append(el("summary", "Affected places & NWS instructions"));
    if (g.where) instructions.append(el("p", g.where));
    if (g.instruction) instructions.append(el("p", g.instruction));
    if (g.source) instructions.append(el("p", "NWS source · " + g.source));
    for (const l of c.links) instructions.append(link(l.label, l.url));
    guidance.append(instructions);
    out.append(guidance);
  }
  if (c.mapGap) out.append(el("p", c.mapGap, "quality"));
  if (c.trigger?.lines.length) {
    const trigger = el("section", undefined, "next-step");
    trigger.append(el("h3", "Why this needs attention"));
    for (const line of c.trigger.lines.slice(0, 5)) trigger.append(el("p", line));
    trigger.append(el("p", c.trigger.question, "quality"));
    out.append(trigger);
  }
  if (c.memberIds?.length) {
    const picker = el("select") as HTMLSelectElement;
    picker.setAttribute("aria-label", "Choose a road verification record");
    picker.append(new Option("Choose a road record to inspect", ""));
    const members = new Map(feeds.reference.map(r => [r.id, r]));
    for (const id of c.memberIds) {
      const member = members.get(id);
      if (member) picker.append(new Option(`${member.name} · ${date(member.time)} · ${member.features.length ? "mapped" : "location unavailable"}`, id));
    }
    picker.onchange = () => { if (picker.value) select(picker.value); };
    out.append(picker);
  }
  const next = el("section", undefined, "next-step");
  next.append(el("h3", "Next review"), el("p", c.nextAction));
  const actions = el("div", undefined, "actions");
  actions.append(
    button(
      c.id.startsWith("private-pio:") ? "Review PIO outreach" : "Assign verification",
      () => {
        if (c.id.startsWith("private-pio:")) { privateView.openPio(); return; }
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
  if (c.watershed && snowSummaries.has(c.watershed)) {
    const snow = el("section", undefined, "next-step");
    snow.append(el("h3", "Rain–snow transition"), el("p", snowSummaries.get(c.watershed)));
    out.append(snow);
  }
  if (c.kind === "alert") {
    out.append(el("p", `${c.timeLabel} ${date(c.time)}`));
    for (const l of c.links) out.append(link(l.label, l.url));
    if (!c.features.length) out.append(el("p", "NWS supplied no usable map footprint. Local overlap is not assessed; review the official affected locations."));
    const tools = el("div", undefined, "actions");
    tools.append(button("Open focused map", () => { pane("map"); pendingFit = true; void ensureMap().then(updateMap); }),
      button("PIO outreach", () => privateView.openPio()));
    const mode = model.advisoryForecastMode(c);
    if (mode) tools.append(button(mode === "rain" ? "Rain forecast" : mode === "radar" ? "Recent radar" : "Gust forecast", () => {
      advisoryPlaybackIntent = c.id;
      pane("map");
      syncAdvisoryWeather(true);
    }));
    out.append(tools);
    const context = advisoryRoadContext?.id === c.id ? advisoryRoadContext : undefined;
    if (c.guidance?.corridors.length) {
      const roads = el("section", undefined, "nws-corridors");
      roads.append(el("h3", "Roads named by NWS"));
      roads.append(el("p", c.guidance.corridors.map(route => route.label).join(" · ")));
      if (!context || context.status === "loading") roads.append(el("p", "Finding county reference segments…", "when"));
      else if (context.status === "unassessed") roads.append(el("p", "Alert geometry is unavailable. Named corridors have not been spatially assessed.", "quality"));
      else if (context.status === "error") roads.append(el("p", "Road reference unavailable. Verify the cited corridors with Road Maintenance.", "quality"));
      else {
        if (context.matched.length) roads.append(el("p", "Dashed map lines · " + context.matched.join(" · "), "when"));
        if (context.unmatched.length) roads.append(el("p", "No overlapping county road reference returned · " + context.unmatched.join(" · "), "when"));
        if (context.failed.length || context.limited) roads.append(el("p", "Some reference segments could not be assessed. Corridor coverage is incomplete.", "quality"));
        roads.append(el("p", "Named-corridor reference. Check current closures and access.", "when"));
      }
      out.append(roads);
    }
  }
  const summaries = [
    ...(c.trigger?.firstCharts || []).map(label => c.evidence.find(e => e.label === label)),
    c.evidence.find((e) => e.label.toLowerCase().includes("rain")),
    c.evidence.find((e) => /release/i.test(e.label)),
    c.evidence.find((e) => !/(rain|pool|release)/i.test(e.label)),
  ].filter(Boolean);
  for (const e of [
    ...new Set(summaries.length ? summaries : c.evidence.slice(0, 3)),
  ].slice(0, 3))
    out.append(chart(e));
  const near = el("details", undefined, "nearby");
  near.append(
    el("summary", c.kind === "alert" ? model.advisoryProfile(c.name).label : "Nearby concerns"),
    el("p", c.kind === "alert" ? model.advisoryProfile(c.name).qualification : "Map proximity only. Connections and access are not established."),
  );
  (near as HTMLDetailsElement).open = c.kind === "alert" || !!c.trigger?.relatedIds?.length;
  const related = nearby(c);
  for (const r of related.slice(0, c.kind === "alert" ? 5 : 8))
    near.append(button(r.name + " · " + r.change, () => select(r.id)));
  if (c.kind === "alert" && related.length > 5) {
    const more = el("details"); more.append(el("summary", `More mapped context · ${related.length - 5}`));
    for (const r of related.slice(5)) more.append(button(r.name + " · " + r.change, () => select(r.id)));
    near.append(more);
  }
  if (c.kind === "alert" && related.length === 24) near.append(el("p", "Showing up to 24 matching records. Inspect a local place for more detail."));
  if (!nearby(c).length)
    near.append(
      el(
        "p",
        "No matching context returned from the loaded sources. This is not an all-clear. County facility and pump coverage requires authorized access.",
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
  const sourceReview = feeds.reference.filter(c => c.sourceReview);
  if (sourceReview.length) {
    const review = el("details");
    review.append(el("summary", `${sourceReview.length} road source test entries · owner review`));
    for (const c of sourceReview) review.append(button(`${c.name} · ${date(c.time)}`, () => select(c.id)));
    target.append(review);
  }
  target.append(
    el(
      "p",
      "Private facilities and drainage are not assessed until authorized data is loaded.",
    ),
  );
  $("coverage-title").textContent = Object.keys(feeds.errors).length
    ? `Coverage · ${Object.keys(feeds.errors).length} checks need review`
    : "Coverage & sources";
  const warnings = feeds.concerns.filter((c) => c.kind === "alert"),
    due = privateTasks().filter(
      (c) => c.quality === "Overdue" || c.quality === "Conflicting versions" || c.id.startsWith("private-pio:"),
    );
  const changedEstimates = feeds.concerns.filter(c => c.utilityUpdate?.estimateChange);
  const important = $("important");
  important.replaceChildren();
  important.hidden =
    !warnings.length && !due.length && !changedEstimates.length && !Object.keys(feeds.errors).length;
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
      button(due.every((c) => c.id.startsWith("private-pio:")) ? "PIO outreach" : "Work", () => {
        if (due.every((c) => c.id.startsWith("private-pio:"))) privateView.openPio();
        else navigate("work");
      }),
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
  if (changedEstimates.length) important.append(button(
    `${changedEstimates.length} restoration estimate${changedEstimates.length === 1 ? "" : "s"} to review`,
    () => select(changedEstimates[0].id),
  ));
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
  const citedRoads = advisoryRoadContext?.id === c?.id && advisoryRoadContext?.revision === c?.revision
    ? advisoryRoadContext?.features || [] : [];
  const floodGauges: any[] = c?.kind === "alert" && model.advisoryProfile(c.name).type === "water"
    ? model.advisoryGauges(c, feeds.features) : [];
  let features = feeds.features;
  const triggerFeatures = c ? [...(c.trigger?.features || []),
    ...(c.trigger?.relatedIds?.length ? nearby(c).flatMap(r => r.features) : [])] : [];
  if (c) {
    const b = model.geometryBounds(c.features);
    features = [
      ...c.features,
      ...citedRoads,
      ...triggerFeatures,
      ...floodGauges,
      ...nearby(c).flatMap((r) => r.features).filter(f => c.kind !== "alert" || model.advisoryMatches(c, f)),
      ...feeds.features.filter((f) => {
        if (c.kind === "alert" && model.advisoryProfile(c.name).type !== "water") return false;
        if (c.kind === "alert") return model.advisoryMatches(c, f);
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
  features = [...new Map(features.map((f) => [JSON.stringify([f.id, f.properties?.id, f.geometry]), f])).values()];
  map.set({ type: "FeatureCollection", features });
  const gauges = features.filter(f => f.properties?.gaugeDisplay);
  const burnFeatures = feeds.reference.find(r=>r.id === "burn-scars")?.features || [];
  $("gauge-key").hidden = !gauges.length && !feeds.counties?.length && !feeds.mapContext && !feeds.errors["Burn scars & city boundaries"];
  $("gauge-readings").replaceChildren(...gauges.map(f => {
    const d = f.properties.gaugeDisplay, row = el("details");
    row.append(el("summary", `${d.name} · ${d.mapLabel}`), el("p", d.readout));
    return row;
  }));
  if (!$("gauge-colors").childElementCount) {
    for (const [label,color] of [["Below published threshold","#68bea5"],["Action","#f2d56f"],["Minor flood","#f0a25a"],["Moderate flood","#ed7478"],["Major flood","#cb96e8"],["Unknown / stale","#aab5bf"]]) {
      const item=el("span",undefined,"legend-band"),swatch=el("i",undefined,"legend-swatch");swatch.style.backgroundColor=color;
      item.append(swatch,document.createTextNode(label));$("gauge-colors").append(item);
    }
  }
  map.highlightTriggers(triggerFeatures);
  const showBurns = c?.kind === "burn-scar" || burnContextPreference;
  $<HTMLInputElement>("show-burn-scars").checked = showBurns;
  $<HTMLInputElement>("show-burn-scars").disabled = c?.kind === "burn-scar";
  const burnFailed = !!feeds.errors["Burn scars & city boundaries"];
  const burnOld = feeds.mapContext && Date.now()-Date.parse(feeds.mapContext.generatedAt)>48*3600000;
  $("burn-context-status").hidden = !showBurns || (!feeds.mapContext && !burnFailed);
  $("burn-context-label").textContent = burnFailed || burnOld ? "Burn reference · check Coverage"
    : !burnFeatures.length ? "No burn areas returned · coverage unassessed" : "Burn areas · reference";
  const selectedBurns = new Set(c?.features.filter(f=>f.properties?.kind === "burn-scar").map(f=>f.properties.id));
  map.context({key:[feeds.mapContext?.generatedAt,showBurns,c?.id].join("|"),counties:feeds.counties,
    cities:feeds.mapContext?.cities,
    burnScars:showBurns?{type:"FeatureCollection",features:burnFeatures.filter(f=>!selectedBurns.has(f.properties.id))}:null});
  $("context-note").textContent = feeds.mapContext ? `Recent mapped fires 2024–26 · reference checked ${date(Date.parse(feeds.mapContext.generatedAt))}. Coverage is incomplete. City boundaries: Census Jan. 1, 2026 reference.`
    : "Burn-scar and city references have not loaded. County outlines remain available when returned.";
  const basin = c?.watershed
    ? feeds.watersheds?.features.find(
        (f: any) => f.properties.reservoir === c.watershed,
      )
    : null;
  map.watershed(basin);
  $("map-place").textContent = c?.name || "Fresno County & upstream watersheds";
  $("map-scope").textContent = c?.mapGap || (triggerFeatures.length
    ? c?.kind === "care" ? "Highlighted records prompted review · proximity only" : "Highlighted points prompted review"
    : c?.kind === "alert"
    ? model.advisoryProfile(c.name).type === "water"
      ? (floodGauges.length ? "Gauge dots · observations near the alert" : "No nearby gauge locations returned")
      : citedRoads.length ? "Dashed corridors named by NWS · verify current access"
      : `${model.advisoryProfile(c.name).label} · mapped overlap, not confirmed impacts`
    : c
    ? "Selected place · nearby context · current observations"
    : "Reference terrain · major waterways");
  if (pendingFit && c) {
    const b = model.geometryBounds(triggerFeatures.length
      ? [...triggerFeatures, ...(c.kind === "care" ? c.features : [])]
      : [...c.features, ...floodGauges, ...(basin ? [basin] : [])]);
    if (b) map.focus(b, true, { top: 75, bottom: c.kind === "alert" ? 205 : 170, left: 50, right: 50 });
    else if (c.mapGap) map.focus([-120.94, 35.89, -118.34, 37.61], false);
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
        onCamera: (camera: any) => {state.patch({ camera });weatherViews.radar?.viewportChanged?.();},
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
function syncAdvisoryRoads() {
  const c = state.value.view === "watch" ? current() : undefined;
  if (c?.id === advisoryRoadContext?.id && c?.revision === advisoryRoadContext?.revision) return;
  advisoryRoadRequest?.abort();
  advisoryRoadContext = undefined;
  if (c?.kind !== "alert" || !c.guidance?.corridors.length) return;
  const routes = c.guidance.corridors;
  const request = new AbortController();
  advisoryRoadRequest = request;
  const context = {id:c.id,revision:c.revision,status:"loading",features:[] as any[],matched:[] as string[],unmatched:[] as string[],failed:[] as string[],limited:false};
  advisoryRoadContext = context;
  renderEvidence();
  if (!c.features.length) {
    context.status = "unassessed";
    renderEvidence();
    return;
  }
  void referenceSearch.citedCorridors(routes, {signal:request.signal}).then((result: any) => {
    if (request.signal.aborted || advisoryRoadContext !== context) return;
    context.features = result.records.flatMap(({route,record}: any) => record.features
      .filter((feature: any) => model.advisoryMatches(c, feature))
      .map((feature: any) => ({...feature, id:`${c.id}:road:${record.id}`, properties:{
        id:c.id,kind:"nws-corridor",name:route.label,citation:route.label,color:"#9cdae1",
        readout:`${route.label} · named in this NWS alert\n${record.name}\nCounty reference prepared ${date(record.time)}\nVerify current road closures and access.`,
      }})));
    context.matched = [...new Set(context.features.map(feature => feature.properties.citation))] as string[];
    context.failed = result.incomplete.map((route: any) => route.label);
    context.unmatched = routes.map(route => route.label).filter(label => !context.matched.includes(label) && !context.failed.includes(label));
    context.limited = result.limited;
    context.status = "ready";
    renderEvidence(); updateMap();
  }).catch(() => {
    if (request.signal.aborted || advisoryRoadContext !== context) return;
    context.status = "error";
    renderEvidence(); updateMap();
  });
}
function syncAdvisoryWeather(reopen = false) {
  syncAdvisoryRoads();
  const c = state.value.view === "watch" ? current() : undefined;
  const id = c && ["alert","burn-scar"].includes(c.kind) ? c.id : undefined;
  if (!reopen && id === checkedAdvisory) return;
  checkedAdvisory = id;
  advisoryRequest?.abort();
  if (advisoryWeatherId && advisoryWeatherId !== id) {
    advisoryWeatherId = undefined;
    pauseWeather();
  }
  if (!c || !id) return;
  const request = new AbortController(), epoch = weatherEpoch;
  const autoplay = advisoryPlaybackIntent === id;
  advisoryPlaybackIntent = undefined;
  advisoryRequest = request;
  void (async () => {
    if (c.kind === "burn-scar") {
      if (matchMedia("(max-width:700px)").matches) pane("map");
      advisoryWeatherId = id;
      await chooseWeather("rain");
      return;
    }
    const mode = model.advisoryForecastMode(c);
    let timing = c.alertTiming ?? { start: null, end: null };
    if (!mode) {
      const source = await moduleAt("command-snow");
      if (request.signal.aborted || epoch !== weatherEpoch || !source.snowAdvisoryCandidate(c)) return;
      timing = await source.loadSnowAdvisory(c, request.signal);
    }
    if (!timing || request.signal.aborted || epoch !== weatherEpoch) return;
    if (matchMedia("(max-width:700px)").matches && state.value.mobile === "attention") pane("map");
    advisoryWeatherId = id;
    await chooseWeather(mode || "snow-forecast", timing, autoplay);
  })().catch(() => {
    if (!request.signal.aborted && advisoryWeatherId === id) {
      advisoryWeatherId = undefined;
      pauseWeather();
      notify("Forecast could not be opened. The official advisory remains available in Details.");
    }
  });
}

async function showSnow(mode: string, epoch: number, rainWindow: any, advisory?: AdvisoryTiming, autoplay = false) {
  let shouldAutoplay = autoplay;
  const source = await moduleAt("command-snow");
  if (epoch !== weatherEpoch) return;
  const info = $("weather-time"), items = $("weather-source"), controls = $("weather-controls");
  const request = new AbortController();
  snowRequest = request;
  const active = () => epoch === weatherEpoch && !request.signal.aborted;
  const update = async () => {
    try {
      if (mode === "snow-now") {
        items.replaceChildren(el("p", "Daily 1 km analysis from satellite and surface evidence. Unshaded areas may be snow-free or have missing coverage. The overlay fades at close zoom."), link("U.S. National Ice Center source", source.IMS));
        const snow = await source.loadSnowCover(request.signal);
        if (!active()) return;
        snowDraw = () => {
          if (!weatherSuspended && active()) map?.snowCover(snow);
        };
        snowDraw();
        info.textContent = "Snow cover · source file " + date(snow.fileTime);
        colors([{ label: "Mapped snow", color: "#eef8ff" }]);
      } else {
        items.replaceChildren(el("p", "NWS six-hour new snowfall in inches. Point guidance is separate; missing coverage stays unknown."),
          link("NWS Hanford snowfall ranges and probabilities", source.HANFORD_WINTER));
        const [sites, grid] = await Promise.all([
          source.loadSnowForecast(request.signal), source.loadSnowGrid(request.signal).catch(() => null),
        ]);
        if (!active()) return;
        const step = 6 * 3600000, first = Math.floor(Date.now() / step) * step;
        const starts = Array.from({length:12},(_,i)=>first+i*step);
        const frames = starts.map(start=>({start,end:start+step,grid:grid?.frames.find((f: any)=>f.start===start)}))
          .filter(w=>(w.grid || sites.some((site: any)=>source.snowWindow(site,w.start,w.end).inches!==null)) &&
            (!advisory || model.advisoryForecastWindow([w],advisory)));
        const picker = el("select") as HTMLSelectElement;
        picker.setAttribute("aria-label", "Six-hour snow forecast window");
        if (!frames.length) picker.append(new Option("No matching snowfall windows", ""));
        for (const w of frames) picker.append(new Option(date(w.start) + " · 6 h",String(w.start)));
        const previous = controls.querySelector<HTMLSelectElement>("select")?.value;
        const desired = previous || String(advisory ? frames[0]?.start : rainWindow?.start ?? frames[0]?.start);
        if ([...picker.options].some(o=>o.value===desired)) picker.value=desired;
        const fit = button(advisory ? "Fit advisory" : "Fit snow",()=>{
          if (advisory) {pendingFit=true;updateMap();}
          else if(grid?.coordinates){const c=grid.coordinates;map?.focus([c[0][0],c[2][1],c[2][0],c[0][1]],true);}
        });
        controls.replaceChildren(picker,...(advisory ? current()?.features.length ? [fit] : [] : grid?.frames.length ? [fit] : []));
        const player = await mountForecastPlayer({frames,picker,key:(w: any)=>String(w.start),epoch,autoplay:shouldAutoplay,
          load: async (w: any,signal: AbortSignal) => w.grid
            ? source.loadSnowGridImage(w.grid,grid.coordinates,signal).catch(()=>null) : null,
          render: (image: any,w: any) => {
            const timeLabel=localForecastTime.formatRange(w.start,w.end);
            const points=sites.map((site: any)=>{
              const values=source.snowWindow(site,w.start,w.end);
              const depth=values.inches===null ? "Unavailable" : values.inches.toLocaleString("en-US",{maximumFractionDigits:1})+" in";
              const level=values.level ? [...new Set<number>(values.level)].map(n=>n.toLocaleString("en-US")).join("–")+" ft" : "unavailable";
              snowSummaries.set(site.basin,`${date(w.start)} to ${date(w.end)} · ${site.name} sample. Snow level ${level}. New snow: ${depth}. ${site.issued ? 'NWS grid updated '+date(site.issued) : 'NWS forecast unavailable.'}`);
              return {type:"Feature",geometry:{type:"Point",coordinates:site.coordinates},properties:{label:site.name+"\n"+depth+(values.inches===null ? "" : " new snow")}};
            });
            if(!weatherSuspended){map?.snowPoints(points);map?.snowfall(image);}
            if(image){
              info.textContent="NWS new snowfall · "+timeLabel+" · issued "+localForecastTime.format(w.grid.issued)+(w.grid.snowCells===0 ? " · No accumulation in valid cells" : "");
              colors([{label:"0",color:"#365f75"},...grid.legend]);
              $("weather-legend").prepend(el("strong","New snow · inches "));
              $("weather-legend").append(el("small","Clear outside grid or where data is missing"));
            } else {
              $("weather-legend").hidden=true;
              info.textContent="Snowfall grid unavailable · point guidance · "+timeLabel;
            }
            renderEvidence();
            if(w.grid&&!image) throw Error("Snowfall frame unavailable");
          },
        });
        shouldAutoplay=false;
        snowDraw=()=>void player.select(frames.findIndex(w=>String(w.start)===picker.value));
        if(!frames.length){
          info.textContent="No six-hour snowfall forecast available during this advisory";
          map?.snowfall(null);map?.snowPoints([]);$("weather-legend").hidden=true;
        }
      }
    } catch {
      if (!active()) return;
      snowDraw = null;
      snowSummaries.clear();
      map?.snowCover(null);
      map?.snowfall(null);
      map?.snowPoints([]);
      controls.replaceChildren();
      $("weather-legend").hidden = true;
      info.textContent = mode === "snow-now" ? "Recent snow cover unavailable" : "Recent snow forecast unavailable";
      renderEvidence();
    }
    if (active()) snowTimer = setTimeout(() => void update(), 15 * 60000);
  };
  await update();
}

function suspendWeather() {
  if (weatherSuspended) return;
  weatherSuspended = true;
  forecastPlayer?.pause();
  weatherViews[weatherMode]?.suspend();
  if (weatherMode === "rain") map?.rain(null);
  if (weatherMode.startsWith("snow-")) {
    snowFrameRequest?.abort();
    map?.snowCover(null);
    map?.snowfall(null);
    map?.snowPoints([]);
  }
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
  snowDraw?.();
  if (weatherMode === "rain" && lastRain) {
    if (lastRain.cycle.end > Date.now()) map?.rain(lastRain);
    else
      $("weather-time").textContent =
        "Selected forecast expired · choose a current window";
  }
}
function pauseWeather() {
  forecastPlayer?.destroy();
  forecastPlayer = undefined;
  snowRequest?.abort();
  snowFrameRequest?.abort();
  snowDraw = null;
  snowSummaries.clear();
  clearTimeout(snowTimer);
  map?.snowCover(null);
  map?.snowfall(null);
  map?.snowPoints([]);
  map?.gust(null);
  map?.gustPoints([]);
  clearTimeout(gustTimer);
  weatherSuspended = false;
  lastRain = null;
  weatherEpoch++;
  forecastRequest?.abort();
  weatherViews.radar?.close();
  weatherViews.clouds?.close();
  map?.rain(null);
  weatherMode = "off";
  $<HTMLSelectElement>("weather").value = "off";
  $("weather-controls").replaceChildren();
  $("weather-purpose").hidden = true;
  $("weather-time").hidden = true;
  delete $("weather-dock").dataset.advisory;
  $("weather-legend").hidden = true;
  $("weather-details").hidden = true;
  renderEvidence();
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

async function mountForecastPlayer({frames,picker,key,load,render,epoch,autoplay=false,onError}: any) {
  forecastPlayer?.destroy();
  const play = button("Play", () => {
    if (player.playing) player.pause();
    else void player.play();
  });
  play.setAttribute("aria-label", "Play forecast animation");
  play.disabled = frames.length < 2;
  const status = el("span", undefined, "forecast-playback-status");
  status.setAttribute("role", "status");
  const player = createForecastPlayback({frames,load,
    available: () => epoch === weatherEpoch && !weatherSuspended && !document.hidden && state.value.view === "watch",
    changed: ({playing,status: phase,index}: any) => {
      if (epoch !== weatherEpoch) return;
      play.textContent = playing ? "Pause" : "Play";
      play.setAttribute("aria-label", playing ? "Pause forecast animation" : "Play forecast animation");
      play.setAttribute("aria-pressed", String(playing));
      status.textContent = phase === "buffering" ? "Buffering next frame…"
        : phase === "error" ? "Frame unavailable · playback stopped"
        : frames.length < 2 ? (frames.length ? "One forecast frame available" : "No playable forecast frames")
        : index >= 0 ? `${index + 1} of ${frames.length}` : "Choose a forecast time";
      if (phase === "error") onError?.();
    },
    render: (value: any, frame: any, index: number) => {
      if (epoch !== weatherEpoch) return;
      picker.value = key(frame);
      render(value,frame,index);
    },
  });
  forecastPlayer = player;
  $("weather-controls").prepend(play);
  $("weather-controls").append(status);
  picker.onchange = () => void player.select(frames.findIndex((frame: any) => key(frame) === picker.value));
  const selected = frames.findIndex((frame: any) => key(frame) === picker.value);
  if (selected >= 0 && await player.select(selected) && autoplay) await player.play({automatic:true});
  return player;
}

async function showGust(epoch: number, advisory?: AdvisoryTiming, preferNws = false, autoplay = false) {
  const source = await moduleAt("command-gust");
  if (epoch !== weatherEpoch) return;
  forecastPlayer?.destroy();
  forecastPlayer = undefined;
  const info = $("weather-time"), items = $("weather-source"), controls = $("weather-controls");
  const previousTime = Number(controls.querySelector<HTMLSelectElement>("select")?.value);
  forecastRequest?.abort();
  const request = new AbortController();
  forecastRequest = request;
  clearTimeout(gustTimer);
  controls.replaceChildren();
  map.gust(null);
  map.gustPoints([]);
  $("weather-legend").hidden = true;
  info.textContent = "Checking current gust forecasts…";
  items.replaceChildren(
    el("p", "Regional HRRR model forecast of surface gusts. Clear areas are outside coverage or have missing values."),
    link("NOAA HRRR model", "https://rapidrefresh.noaa.gov/hrrr/"),
  );
  try {
    const forecast = await source.loadGustForecast(request.signal, {preferNws});
    const { manifest, windows, snapshot } = forecast;
    if (epoch !== weatherEpoch || request.signal.aborted) return;
    items.replaceChildren(...(forecast.provider === 'nws' ? [
      el("p", "NWS gust forecasts at nine named sample locations. Values apply to those samples; coverage between them is unassessed."),
      el("p", "Regional HRRR unavailable. Showing current NWS samples."),
      ...snapshot.sites.filter((site: any) => site.error).map((site: any) => el("p", `${site.name} · source check failed`)),
      link("NWS Hanford", "https://www.weather.gov/hnx/"),
    ] : [el("p", manifest.attribution), link("NOAA HRRR model", "https://rapidrefresh.noaa.gov/hrrr/")]));
    const picker = el("select") as HTMLSelectElement;
    picker.setAttribute("aria-label", "Gust forecast time");
    const frames = advisory ? model.advisoryForecastFrames(windows, advisory) : windows;
    if (advisory && !frames.length) picker.append(new Option("No matching forecast times", ""));
    for (const step of frames) picker.append(new Option(localForecastTime.format(step.start), String(step.start)));
    const retained = windows.find((step: {start:number; end:number}) => step.start === previousTime &&
      (advisory ? model.advisoryForecastWindow([step], advisory) : step.end >= Date.now()));
    const initial = retained || (advisory ? model.advisoryForecastWindow(windows, advisory) : windows[0]);
    picker.value = initial ? String(initial.start) : "";
    controls.replaceChildren(picker);
    await mountForecastPlayer({frames,picker,key:(step: any)=>String(step.start),epoch,autoplay,
      onError: forecast.provider === 'hrrr' ? () => void showGust(epoch,advisory,true,false) : undefined,
      load: async (step: any, signal: AbortSignal) => {
        if (forecast.provider === 'hrrr') return {image:await source.loadGustImage(manifest, step.entry, signal)};
        const features = source.gustPointFeatures(snapshot, step.start);
        if (!features.length) throw Error("Selected NWS forecast time is unavailable");
        return {features};
      },
      render: (value: any,step: any) => {
        const valid = localForecastTime.format(step.start) + (forecast.provider === 'nws' ? ` → ${localForecastTime.format(step.end)}` : "");
        map.gust(null);map.gustPoints([]);
        if (forecast.provider === 'nws') {
          if (!weatherSuspended) map.gustPoints(value.features);
          const issued = Math.min(...value.features.map((feature: any) => feature.properties.issued));
          info.textContent = `NWS gust samples · valid ${valid} · ${value.features.length}/9 locations · earliest issue ${localForecastTime.format(issued)}`;
        } else {
          if (!weatherSuspended) map.gust(value.image);
          info.textContent = `HRRR gusts · valid ${valid} · model run ${localForecastTime.format(Date.parse(manifest.run))}`;
        }
        colors(source.gustLegend);
        $("weather-legend").prepend(el("strong", forecast.provider === 'nws' ? "Sample gusts · mph " : "Surface gusts · mph "));
        if (forecast.provider === 'nws') $("weather-legend").append(el("small", "Dots show named samples. Tap a dot for its forecast period and issue time."));
      },
    });
    if (!frames.length) info.textContent = "No gust forecast time available during this alert";
  } catch {
    if (epoch === weatherEpoch && !request.signal.aborted)
      info.textContent = "Current regional gust forecast unavailable";
  }
  if (epoch === weatherEpoch) {
    clearTimeout(gustTimer);
    gustTimer = setTimeout(() => {
      if (epoch === weatherEpoch) void showGust(epoch, advisory);
    }, 15 * 60000);
  }
}

async function chooseWeather(mode: string, advisory?: AdvisoryTiming, autoplay = false) {
  const rainWindow = currentRainWindow;
  pauseWeather();
  weatherMode = mode;
  $<HTMLSelectElement>("weather").value = mode;
  if (advisory) $("weather-dock").dataset.advisory = mode;
  const epoch = weatherEpoch;
  if (mode === "off") { updateMap(); return; }
  await ensureMap();
  if (epoch !== weatherEpoch || !map) return;
  updateMap();
  const controls = $("weather-controls"),
    info = $("weather-time"),
    items = $("weather-source");
  info.hidden = false;
  $("weather-details").hidden = false;
  info.textContent = "Loading dated weather evidence…";
  $("weather-purpose").hidden = !advisory && current()?.kind !== "burn-scar";
  $("weather-purpose").textContent = current()?.kind === "burn-scar" && mode === "rain" ? "Forecast rainfall · recent burn perimeter context"
    : mode === "radar" ? "Recent precipitation · observed scans, not a forecast"
    : mode === "gust" ? "Expected gusts during this alert"
    : mode === "rain" ? "Expected rainfall during this alert" : "Expected new snowfall during this alert";
  if (mode.startsWith("snow-")) {
    await showSnow(mode, epoch, rainWindow, advisory, autoplay);
    return;
  }
  if (mode === "gust") {
    await showGust(epoch, advisory, false, autoplay);
    return;
  }
  if (mode === "rain") {
    const { loadWatershedRain, regionalForecastBounds } = await moduleAt(
      "watch-watershed-data",
    );
    if (epoch !== weatherEpoch) return;
    const { precipitationTimeline } = await moduleAt("watershed-timeline-model");
    let timeline = feeds.timeline;
    // The alert can arrive before the independent timeline collector finishes.
    if (advisory && !timeline) {
      try {
        const response = await fetch(new URL("data/watershed-timeline.json", root), {
          signal: AbortSignal.timeout(6000), credentials: "omit", cache: "no-store",
        });
        if (response.ok) timeline = await response.json();
      } catch { /* The independently verified 72-hour product remains available. */ }
    }
    if (epoch !== weatherEpoch) return;
    const { windows: allWindows } = precipitationTimeline(timeline, Date.now());
    const windows = advisory ? allWindows.filter((w: any) => model.advisoryForecastWindow([w], advisory)) : allWindows;
    const choose = el("select") as HTMLSelectElement;
    choose.setAttribute("aria-label", "Rain forecast window");
    if (!advisory) choose.append(new Option("72-hour overview", ""));
    else if (!windows.length) choose.append(new Option("No matching forecast windows", ""));
    for (const w of windows) choose.append(new Option(date(w.start) + " · 6 h", String(w.layer)));
    if (advisory && windows.length) choose.value = String(windows[0].layer);
    controls.append(choose);
    const frames = [...(!advisory ? [{layer:"",start:0,end:0}] : []), ...windows];
    await mountForecastPlayer({frames,picker:choose,key:(w: any)=>String(w.layer),epoch,autoplay,
      load: (w: any,signal: AbortSignal) => loadWatershedRain(regionalForecastBounds, {window:w.layer === "" ? null : w,signal}),
      render: (rain: any,w: any) => {
        currentRainWindow = w.layer === "" ? null : w;
        lastRain = rain;
        if (!weatherSuspended) map.rain(rain);
        info.textContent = `${rain.cycle.hours}-hour WPC rain · ${localForecastTime.formatRange(rain.cycle.start, rain.cycle.end)} · issued ${localForecastTime.format(rain.cycle.issue)}${rain.legend.length ? '' : ' · No contours ≥0.01 in shown'}`;
        colors(rain.legend);$("weather-legend").prepend(el("strong", "Forecast rain · inches "));
        if (advisory) $("weather-legend").append(el("small", "Gauge dots are current observations, not forecasts."));
        items.replaceChildren(el("p", "Published rainfall accumulation. Gauges, roads and power records remain current context, not future predictions."),
          link("WPC forecast source", "https://www.wpc.ncep.noaa.gov/qpf/qpf2.shtml"));
      },
    });
    if (!frames.length) info.textContent = "No rainfall forecast window overlaps this alert";
  } else {
    if (!weatherViews[mode]) {
      const mod = await moduleAt("watch-regional-radar-ui");
      if (epoch !== weatherEpoch) return;
      const options = {
        allowVolume: false,
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
      weatherViews[mode] = mod.installRegionalRadar(options);
    }
    const view = weatherViews[mode];
    controls.append(view.controls);
    if (mode === "radar") {
      controls.append(view.cloudButton);
      controls.append(view.cloudStatus, view.cloudLegend);
    }
    view.open({autoplay: autoplay && !matchMedia("(prefers-reduced-motion: reduce)").matches});
    if (weatherSuspended) view.suspend();
  }
}
function selectWeather(mode: string) {
  advisoryRequest?.abort();
  advisoryWeatherId = undefined;
  void chooseWeather(mode).catch(() => {
    pauseWeather();
    notify("Weather display unavailable. Try another product.");
  });
}
$<HTMLSelectElement>("weather").onchange = () => selectWeather($<HTMLSelectElement>("weather").value);
$("explore-burn-scars").onclick = () => {
  if (feeds.reference.some(r=>r.id === "burn-scars")) {burnContextPreference=true;select("burn-scars");}
  else notify("Burn-scar references have not loaded. Check Coverage & sources.");
};
$<HTMLInputElement>("show-burn-scars").onchange = () => {burnContextPreference=$<HTMLInputElement>("show-burn-scars").checked;updateMap();};
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
    syncAdvisoryWeather();
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
    advisoryRequest?.abort();
    pauseWeather();
    collector.destroy();
    privateView.destroy();
    privateController.destroy();
    assets.destroy();
    map?.destroy();
  },
  { once: true },
);
