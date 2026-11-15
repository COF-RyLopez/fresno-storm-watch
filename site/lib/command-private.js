import { createPrivateStore } from "./eoc-store.js";
import { loadCoreSdk } from "./sdk.js";
import { isPio } from "./pio-model.js";
import {
  approvalFor,
  briefingSnapshot,
  canonical,
  COLLECTIONS,
  digest,
  emptyRecords,
  headIds,
  heads,
  makeEvent,
  validateEvent,
  validatePayload,
} from "./eoc-model.js";

export const COMMAND_PHASES = ["prepare", "respond", "recover", "closeout"];
const finished = (record) =>
  ["Complete", "Canceled"].includes(record.payload.status);

export function taskRows(records, phase = "all", now = Date.now()) {
  return heads(records.coordination ?? records)
    .filter((row) => !row.heads.some((r) => isPio(r.payload)))
    .filter(
      (row) =>
        phase === "all" ||
        row.heads.some(
          (r) =>
            !COMMAND_PHASES.includes(r.payload.phase) ||
            r.payload.phase === phase,
        ) ||
        (phase === "closeout" && (row.conflict || !finished(row.record))),
    )
    .map((row) => ({
      ...row,
      group: row.conflict
        ? "Conflicting versions"
        : finished(row.record)
          ? "Completed or canceled"
          : row.record.payload.due < now
            ? "Overdue"
            : "Outstanding",
    }));
}

function freezeJson(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

export async function buildCommandBriefing({
  title,
  narrative = "",
  captures = [],
  period,
  records,
  now = Date.now(),
  scope = "all",
  zoneKey = null,
  sourceNotices = [],
}) {
  const evidence = structuredClone(captures);
  const notifications = evidence.map(({ id, evidence: item }) => ({
    key: id,
    revision: String(item.revision ?? item.capturedAt ?? now),
    category: item.category ?? item.kind ?? "Captured evidence",
    location: item.location ?? item.title ?? item.name ?? "Selected evidence",
    change: item.summary ?? item.change ?? "",
    sourceTime: item.sourceTime ?? item.time ?? item.capturedAt ?? now,
    verification: item.verification ?? item.quality ?? "Review source context",
    owner: item.owner ?? "Unassigned",
    nextReview:
      item.nextReview ?? item.nextAction ?? "Review with the responsible team",
    evidence: item,
  }));
  const scoped = Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection,
      (records[collection] ?? []).filter(
        (row) => row.incident === period?.incident,
      ),
    ]),
  );
  const previous = [...scoped.briefings]
    .sort((a, b) => b.created - a.created)
    .find(
      (row) =>
        row.payload.snapshot.scope === scope &&
        (row.payload.snapshot.pioZoneKey ?? null) === zoneKey &&
        approvalFor(row, scoped.approvals)?.payload.status === "Approved",
    );
  const { snapshot } = await briefingSnapshot({
    records: scoped,
    period,
    notifications: [...notifications, ...structuredClone(sourceNotices)],
    sourceHealth: [],
    previous: previous?.payload.snapshot,
    now,
    exercise: true,
    scope,
    pioZoneKey: zoneKey,
  });
  Object.assign(snapshot, {
    title,
    narrative,
    selection: { included: snapshot.notifications.length, excluded: 0 },
  });
  const payload = {
    title,
    periodEvent: period.id,
    snapshot,
    digest: await digest(snapshot),
  };
  return freezeJson(validatePayload("briefings", payload));
}

const initial = () => ({
  allowed: new Set(),
  username: null,
  incidents: [],
  records: emptyRecords(),
  incident: null,
  period: null,
  captures: [],
  loading: false,
  saving: false,
  error: null,
});
const isCurrentPeriod = (records, id) =>
  heads(records.periods).some((h) => !h.conflict && h.record.id === id);

export function createCommandPrivate({
  config,
  onChange = () => {},
  createStore = createPrivateStore,
}) {
  let state = initial();
  let store,
    generation = 0,
    destroyed = false;
  const pending = new Map();
  const update = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  function reset(patch = {}) {
    generation++;
    store?.close();
    store = null;
    pending.clear();
    update({ ...initial(), ...patch });
  }

  async function connect(session) {
    if (destroyed) return;
    reset({ loading: !!session });
    if (!session) return;
    const epoch = generation;
    try {
      if (!config?.enabled || config.environment !== "exercise")
        throw Error("Private exercise storage is not enabled.");
      const opened = await createStore(config, session, {
        loadSdk: loadCoreSdk,
      });
      if (epoch !== generation) {
        opened.close();
        return;
      }
      store = opened;
      const incidents = await store.incidents();
      if (epoch !== generation) return;
      update({
        incidents,
        allowed: new Set(opened.allowed),
        username: opened.username ?? session.username,
        loading: false,
      });
    } catch (error) {
      if (epoch === generation) reset({ error: error.message });
    }
  }

  async function selectIncident(incident) {
    if (!store || state.saving) return;
    if (incident && !state.incidents.some((r) => r.incident === incident))
      throw Error("Choose a recorded incident.");
    const epoch = ++generation;
    const scopeChanged = state.incident !== (incident || null);
    update({
      incident: incident || null,
      period: scopeChanged ? null : state.period,
      captures: scopeChanged ? [] : state.captures,
      records: emptyRecords(),
      loading: !!incident,
      error: null,
    });
    if (!incident) return;
    try {
      const records = await store.load(incident);
      if (epoch !== generation) return;
      update({
        records,
        loading: false,
        period: isCurrentPeriod(records, state.period) ? state.period : null,
      });
    } catch (error) {
      if (epoch === generation) reset({ error: error.message });
    }
  }

  function selectPeriod(period) {
    if (
      state.loading ||
      state.saving ||
      (period && !isCurrentPeriod(state.records, period))
    )
      return false;
    update({ period: period || null, error: null });
    return true;
  }

  function capture(evidence) {
    if (!store || !state.incident || state.loading)
      throw Error("Choose an incident before capturing evidence.");
    const item = freezeJson({
      id: crypto.randomUUID(),
      evidence: JSON.parse(JSON.stringify(evidence)),
    });
    if (
      !item.evidence ||
      typeof item.evidence !== "object" ||
      Array.isArray(item.evidence)
    )
      throw Error("Evidence details are required.");
    update({ captures: [...state.captures, item], error: null });
    return item;
  }

  function removeCapture(id) {
    update({ captures: state.captures.filter((item) => item.id !== id) });
  }

  async function write(collection, prepare, { newIncident = false } = {}) {
    if (!store || (!newIncident && !state.incident) || state.loading)
      throw Error("Choose a recorded incident before saving.");
    if (!store.allowed.has(collection))
      throw Error("Your account is not assigned to this editing group.");
    if (state.saving) throw Error("A private save is already in progress.");
    const epoch = generation;
    const activeStore = store;
    const incident = newIncident ? crypto.randomUUID() : state.incident;
    const ensureCurrent = () => {
      if (epoch !== generation) throw Error("Private session changed.");
    };
    update({ saving: true, error: null });
    try {
      let records;
      try {
        records = newIncident
          ? emptyRecords()
          : await activeStore.load(incident);
      } catch (error) {
        if (epoch === generation) reset({ error: error.message });
        throw error;
      }
      ensureCurrent();
      if (!newIncident)
        update({
          records,
          period: isCurrentPeriod(records, state.period) ? state.period : null,
        });
      const {
        payload,
        entity,
        supersedes = [],
        retryKey,
        event: suppliedEvent,
      } = await prepare(records);
      ensureCurrent();
      const key = canonical([
        collection,
        newIncident ? null : incident,
        entity,
        retryKey ?? [[...supersedes].sort(), payload],
      ]);
      const event =
        pending.get(key) ??
        suppliedEvent ??
        makeEvent(collection, payload, {
          incident,
          entity: newIncident ? incident : entity,
          supersedes,
        });
      const existing = records[collection].find((r) => r.id === event.id);
      if (
        existing &&
        (existing.entity !== event.entity || existing.incident !== event.incident ||
          canonical(existing.supersedes) !== canonical(event.supersedes) ||
          canonical(existing.payload) !== canonical(event.payload))
      ) {
        throw Error("The event ID already belongs to a different record.");
      }
      if (!existing) validateEvent(event, records);
      pending.set(key, event);
      const saved = existing ?? (await activeStore.append(event, records));
      ensureCurrent();
      pending.delete(key);
      const list = records[collection].filter((r) => r.id !== saved.id);
      const incidents =
        collection === "incidents"
          ? [...state.incidents.filter((r) => r.id !== saved.id), saved]
          : state.incidents;
      update({
        records: newIncident
          ? state.records
          : { ...records, [collection]: [...list, saved] },
        incidents,
      });
      return saved;
    } catch (error) {
      if (epoch === generation) update({ error: error.message });
      throw error;
    } finally {
      if (epoch === generation) update({ saving: false });
    }
  }

  function append(collection, payload, { entity, supersedes } = {}) {
    if (["briefings", "approvals"].includes(collection))
      throw Error("Use the briefing workflow to record an exact version.");
    const data = structuredClone(payload);
    if (data.phase && !COMMAND_PHASES.includes(data.phase))
      throw Error("Select a recognized phase.");
    if (
      collection === "coordination" &&
      data.kind === "Follow-up" &&
      !String(data.evidence ?? "").trim()
    )
      throw Error("Follow-up evidence is required.");
    return write(collection, () => ({ payload: data, entity, supersedes }));
  }

  function createIncident(payload) {
    const data = structuredClone(payload);
    return write("incidents", () => ({ payload: data }), { newIncident: true });
  }

  async function commitPio(candidate) {
    const event = structuredClone(candidate);
    if (!((event.collection === "coordination" && isPio(event.payload)) ||
      (event.collection === "approvals" && event.payload?.kind === "pio-outreach")))
      throw Error("Use a PIO outreach, approval or distribution record.");
    if (!state.incident || event.incident !== state.incident)
      throw Error("Choose the matching incident before saving PIO outreach.");
    // The existing editor owns the retry ID and exact-version references.
    return write(event.collection, () => ({ ...event, event, retryKey: event.id }));
  }

  async function reviewPioSource(notice, action = "Acknowledged") {
    if (!notice?.key?.startsWith("pio") || notice.category === "Data failures")
      throw Error("Only an available PIO source revision can be acknowledged.");
    const incident = state.incident, team = config.teamLabel || "F.R.O.G. EOC exercise team";
    const entity = await digest([team, notice.key]);
    if (!incident || state.incident !== incident) throw Error("Private incident changed.");
    const supersedes = headIds(state.records.reviews, entity);
    return write("reviews", () => ({entity, supersedes, payload: {
      sourceKey: notice.key, sourceRevision: notice.revision, team, action,
    }}));
  }

  function saveBriefing({ title, narrative, scope = "all", zoneKey = null, sourceNotices = [] }) {
    if (!state.period)
      throw Error(
        "Choose a recorded operational period before saving a briefing.",
      );
    const selected = state.period;
    const captures = [...state.captures];
    const notices = structuredClone(sourceNotices);
    return write("briefings", async (records) => {
      if (!isCurrentPeriod(records, selected))
        throw Error(
          "The operational period changed. Choose its current version.",
        );
      const period = records.periods.find((r) => r.id === selected);
      const payload = await buildCommandBriefing({
        title,
        narrative,
        captures: scope === "pio" ? [] : captures,
        period,
        records,
        scope,
        zoneKey,
        sourceNotices: notices,
      });
      return { payload, retryKey: [title, narrative, captures, selected, scope, zoneKey, notices] };
    });
  }

  function approveBriefing(record, evidence, status = "Approved") {
    const briefingId = record.id;
    const expectedDigest = record.payload.digest;
    const priorVersions = state.records.approvals.filter(
      (r) => r.payload.briefingEvent === briefingId,
    );
    const entity = priorVersions[0]?.entity ?? "approve-" + briefingId;
    const reviewedHeads = headIds(priorVersions, entity);
    if (
      new Set(priorVersions.map((r) => r.entity)).size > 1 ||
      reviewedHeads.length > 1
    )
      throw Error(
        "Review the conflicting approval history in the EOC workspace.",
      );
    return write("approvals", async (records) => {
      const saved = records.briefings.find((r) => r.id === briefingId);
      if (
        !saved ||
        saved.payload.digest !== expectedDigest ||
        (await digest(saved.payload.snapshot)) !== expectedDigest
      ) {
        throw Error("Approval requires the exact saved briefing and digest.");
      }
      const prior = approvalFor(saved, records.approvals);
      const retryKey = [briefingId, expectedDigest, evidence, status];
      const retry = pending.has(
        canonical(["approvals", state.incident, entity, retryKey]),
      );
      if (
        status === "Withdrawn" &&
        prior?.payload.status !== "Approved" &&
        !retry
      )
        throw Error("An approved briefing is required for withdrawal.");
      return {
        entity,
        retryKey,
        supersedes: reviewedHeads,
        payload: {
          briefingEvent: briefingId,
          digest: expectedDigest,
          evidence,
          status,
        },
      };
    });
  }

  return {
    connect,
    disconnect: () => reset(),
    selectIncident,
    selectPeriod,
    append,
    commitPio,
    reviewPioSource,
    createIncident,
    capture,
    removeCapture,
    saveBriefing,
    approveBriefing,
    get state() {
      return state;
    },
    destroy() {
      destroyed = true;
      reset();
    },
  };
}
