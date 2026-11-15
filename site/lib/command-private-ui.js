import { COMMAND_PHASES, taskRows } from "./command-private.js";
import { FORMS, localDateValue } from "./eoc-forms.js";
import { approvalFor, heads, reportStatus } from "./eoc-model.js";
import { isPio } from "./pio-model.js";

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const titleCase = (label) => label[0].toUpperCase() + label.slice(1);
const date = (value) =>
  Number.isFinite(value)
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        timeZoneName: "short",
      })
    : "Unspecified";
const link = (label, href) => Object.assign(el("a", label), { href });
const paragraph = (text) => el("p", text);
const group = (label, ...nodes) => {
  const section = el("section", null, "cmd-private-section");
  section.append(el("h3", label), ...nodes);
  return section;
};
function button(label, act) {
  const node = el("button", label, "cmd-button");
  node.type = "button";
  node.onclick = act;
  return node;
}
function field([name, title, type, choices, optional], value) {
  const label = el("label", title, "cmd-field");
  const input = el(type === "select" || type === "textarea" ? type : "input");
  input.name = name;
  input.required = !optional && type !== "number";
  if (type === "select")
    input.append(
      ...choices.map(
        (choice) => new Option(...(Array.isArray(choice) ? choice : [choice])),
      ),
    );
  else if (type === "number") {
    input.type = "number";
    input.step = "any";
  } else if (type === "date") input.type = "datetime-local";
  if (value != null)
    input.value = type === "date" ? localDateValue(value) : value;
  label.append(input);
  return { label, input };
}
function figureSeries(figure) {
  return [
    ["Observed samples", figure.points],
    ["Forecast samples", figure.forecast],
  ].flatMap(([label, values]) => {
    const points = (Array.isArray(values) ? values : []).filter(
      (point) => Number.isFinite(point.time) && Number.isFinite(point.value),
    );
    return points.length ? [{ label, points }] : [];
  });
}
function figureSummary(figure) {
  return figureSeries(figure).map(({ label, points }) => {
    const times = points.map((p) => p.time);
    const values = points.map((p) => p.value);
    const range = [Math.min(...values), Math.max(...values)].join(" to ");
    const window = [date(Math.min(...times)), date(Math.max(...times))].join(
      " to ",
    );
    return [
      label,
      points.length + " saved",
      range + (figure.units ? " " + figure.units : ""),
      window,
    ].join(" · ");
  });
}
function operationalLines(records = {}) {
  const labels = {
    coordination: "Follow-ups, decisions and information gaps",
    reports: "Field reports",
    verifications: "Report verification",
    checklists: "Readiness checks",
    staging: "Staging",
    references: "External references",
  };
  return Object.entries(labels).flatMap(([collection, title]) => {
    const rows = heads(records[collection] ?? []);
    if (!rows.length) return [];
    return [
      title +
        "\n" +
        rows
          .flatMap((row) =>
            row.heads.map(({ payload: p, author, created }) =>
              [
                row.conflict && "Conflicting current version",
                p.title ??
                  p.location ??
                  p.check ??
                  p.pumpLabel ??
                  p.label ??
                  p.system ??
                  p.finding,
                p.title && p.location,
                p.kind,
                p.status ?? p.outcome,
                p.owner && "Owner " + p.owner,
                p.backup && "Backup power " + p.backup,
                p.connection && "Backup connection " + p.connection,
                p.fuel && "Fuel " + p.fuel,
                Number.isFinite(p.runtimeHours) &&
                  "Reported runtime " + p.runtimeHours + " hours",
                Number.isFinite(p.due) && "Due " + date(p.due),
                Number.isFinite(p.observed) && "Observed " + date(p.observed),
                Number.isFinite(p.verifiedAt) &&
                  "Verified " + date(p.verifiedAt),
                Number.isFinite(p.validUntil) &&
                  "Access review " + date(p.validUntil),
                p.nextReview,
                p.condition,
                p.requestedFollowup,
                p.evidence,
                p.externalId,
                p.link,
                author && "Recorded by " + author + " · " + date(created),
              ]
                .filter((value) => typeof value === "string" && value.trim())
                .join(" · "),
            ),
          )
          .join("\n"),
    ];
  });
}
function chart(document, figure) {
  const series = figureSeries(figure);
  if (!series.length) return null;
  const points = series.flatMap((row) => row.points);
  const times = points.map((p) => p.time),
    values = points.map((p) => p.value);
  const start = Math.min(...times),
    end = Math.max(...times);
  const low = Math.min(...values),
    high = Math.max(...values);
  const svg = (tag, attributes) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes))
      node.setAttribute(key, value);
    return node;
  };
  const wrap = document.createElement("figure");
  wrap.style.breakInside = "avoid";
  const caption = document.createElement("figcaption");
  caption.textContent = [
    figure.label,
    ...figureSummary(figure),
    "Observed solid blue · forecast dashed brown",
  ].join(" · ");
  const plot = svg("svg", {
    viewBox: "0 0 500 115",
    width: "500",
    height: "115",
    role: "img",
    "aria-label": caption.textContent,
  });
  plot.style.cssText = "max-width:100%;height:auto;background:#f3f8fb";
  const x = (time) =>
    15 + 470 * (end === start ? 0.5 : (time - start) / (end - start));
  const y = (value) =>
    100 - 85 * (high === low ? 0.5 : (value - low) / (high - low));
  for (const { label, points: rows } of series) {
    const color = label === "Observed samples" ? "#076389" : "#914810";
    if (rows.length === 1)
      plot.append(
        svg("circle", {
          cx: x(rows[0].time),
          cy: y(rows[0].value),
          r: 4,
          fill: color,
        }),
      );
    else
      plot.append(
        svg("polyline", {
          points: rows.map((p) => x(p.time) + "," + y(p.value)).join(" "),
          fill: "none",
          stroke: color,
          "stroke-width": 3,
          ...(label === "Forecast samples"
            ? { "stroke-dasharray": "6 4" }
            : {}),
        }),
      );
  }
  wrap.append(caption, plot);
  return wrap;
}
function briefingCharts(document, briefing, parent) {
  for (const notice of briefing.payload.snapshot.notifications ?? []) {
    const figures = notice.evidence?.evidence;
    if (!Array.isArray(figures)) continue;
    for (const figure of figures) {
      const plot = chart(document, figure);
      if (plot) parent.append(plot);
    }
  }
}
function evidenceLines(item = {}) {
  const figures = Array.isArray(item.evidence) ? item.evidence : [];
  return [
    item.title ?? item.location ?? item.name ?? item.kind,
    item.change ?? item.summary,
    item.quality,
    item.association,
    item.nextAction,
    Number.isFinite(item.time) && "Source time " + date(item.time),
    Number.isFinite(item.capturedAt) && "Captured " + date(item.capturedAt),
    ...(Array.isArray(item.details) ? item.details : []),
    ...figures.flatMap((figure) => [
      figure.label +
        (figure.value == null
          ? " — unavailable"
          : " — " +
            [figure.value, figure.units]
              .filter((v) => v !== undefined && v !== "")
              .join(" ")),
      figure.source && "Source " + figure.source,
      Number.isFinite(figure.time) && "Source time " + date(figure.time),
      Number.isFinite(figure.issued) && "Issued " + date(figure.issued),
      Number.isFinite(figure.start) &&
        Number.isFinite(figure.end) &&
        [date(figure.start), date(figure.end)].join(" to "),
      figure.quality,
      ...figureSummary(figure),
    ]),
  ].filter((value) => typeof value === "string" && value.trim());
}

export function commandBriefingText(briefing, approval) {
  const { title, digest, snapshot } = briefing.payload;
  const incident = snapshot.incident?.payload;
  const period = snapshot.period?.payload;
  const approvalLine = approval
    ? [
        approval.payload.status,
        approval.author,
        date(approval.created),
        approval.payload.evidence,
      ].join(" · ")
    : "Pending approval";
  return [
    snapshot.exercise ? "EXERCISE ONLY" : "PRIVATE COUNTY EOC",
    title,
    [date(briefing.created), briefing.author, approvalLine].join(" · "),
    "Version " + briefing.id + " · SHA-256 " + digest,
    incident &&
      [
        incident.name,
        incident.level,
        incident.authority,
        incident.decisionBy,
        incident.evidence,
      ]
        .filter(Boolean)
        .join(" · "),
    period &&
      [
        period.label,
        date(period.start) + " to " + date(period.end),
        "Next briefing " + date(period.nextBriefing),
        period.objectives,
      ].join(" · "),
    snapshot.narrative,
    ...(snapshot.notifications ?? []).map((notice) =>
      [
        [notice.category, notice.location].filter(Boolean).join(" · "),
        notice.change,
        [
          date(notice.sourceTime),
          notice.verification,
          notice.owner,
          notice.nextReview,
        ]
          .filter(Boolean)
          .join(" · "),
        ...evidenceLines(notice.evidence).filter(
          (line) => line !== notice.location && line !== notice.change,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
    ...(snapshot.changes?.length
      ? [
          "Changes since the previous approved briefing" +
            "\n" +
            snapshot.changes.join("\n"),
        ]
      : []),
    ...operationalLines(snapshot.records),
    ...(snapshot.sourceHealth ?? []).map((source) =>
      [source.name, source.status, date(source.checked)].join(" · "),
    ),
    snapshot.handoff,
  ]
    .filter(Boolean)
    .join("\n\n");
}
function recordForm(
  collection,
  submit,
  { initial = {}, label, reviewHeads = [] } = {},
) {
  const template = FORMS[collection];
  const details = el("details", null, "cmd-record-form");
  const form = el("form", null, "cmd-form");
  const error = el("p", "", "cmd-error");
  error.setAttribute("role", "alert");
  const fields = [...template.fields];
  if (collection === "coordination")
    fields.push([
      "phase",
      "Operational phase",
      "select",
      [["Unclassified", ""], ...COMMAND_PHASES.map((p) => [titleCase(p), p])],
      true,
    ]);
  details.append(el("summary", label ?? template.title), form);
  form.append(paragraph(template.note));
  if (reviewHeads.length > 1) {
    for (const record of reviewHeads)
      form.append(recordHistory(record, collection, "Conflicting version"));
    const review = field([
      "review",
      "I reviewed every current version",
      "checkbox",
    ]);
    review.input.type = "checkbox";
    form.append(review.label);
  }
  for (const spec of fields) {
    const [name] = spec;
    form.append(
      field(
        name === "evidence" && initial.kind === "Follow-up"
          ? [name, "Progress / completion evidence", "textarea"]
          : spec,
        initial[name],
      ).label,
    );
  }
  const save = Object.assign(el("button", "Save record", "cmd-button"), {
    type: "submit",
  });
  form.append(save, error);
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = { ...initial };
    for (const [name, , type] of fields) {
      const value = form.elements.namedItem(name).value;
      data[name] =
        type === "date"
          ? value
            ? new Date(value).getTime()
            : null
          : type === "number"
            ? value
              ? Number(value)
              : null
            : value.trim();
    }
    if (!data.phase) delete data.phase;
    delete data.review;
    save.disabled = true;
    try {
      await submit(data);
      details.open = false;
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      save.disabled = false;
    }
  };
  return details;
}
function recordHistory(record, collection, label = "Record version") {
  const details = el("details", null, "cmd-record-history");
  details.append(
    el("summary", label + " · " + date(record.created) + " · " + record.author),
  );
  const dl = el("dl");
  for (const [key, title, type] of FORMS[collection]?.fields ?? []) {
    const value = record.payload[key];
    if (value == null || value === "") continue;
    dl.append(
      el("dt", title),
      el("dd", type === "date" ? date(value) : String(value)),
    );
  }
  details.append(dl);
  return details;
}

export function mountCommandPrivate({
  work,
  briefing,
  controller,
  onFocus = () => {},
}) {
  let phase = "all",
    title = "",
    narrative = "",
    priorScope,
    savedDraft = null,
    dead = false,
    printNode = null;
  let lastState, stateMessage, assignment;
  const taskFilters = { location: "", owner: "", status: "" };
  const expanded = new Set();
  function collapsible(label, count, content) {
    const node = el("details", null, "cmd-private-section");
    node.open = expanded.has(label);
    node.ontoggle = () => {
      if (node.open) expanded.add(label);
      else expanded.delete(label);
    };
    if (content.firstElementChild?.localName === "h3")
      content.firstElementChild.remove();
    node.append(el("summary", label + " · " + count), content);
    return node;
  }
  function focusWhenVisible(node) {
    requestAnimationFrame(() => {
      if (!node.isConnected) return;
      if (!work.hidden) node.focus();
      else
        requestAnimationFrame(() => {
          if (node.isConnected && !work.hidden) node.focus();
        });
    });
  }
  const statusText = (state) =>
    state.error ??
    (state.loading
      ? "Loading private records…"
      : state.username
        ? "Exercise records · " + state.username
        : "Sign in with your county account to open the exercise workspace.");
  const sameRecords = (left, right) =>
    Object.keys(left).every(
      (key) =>
        left[key].length === right[key].length &&
        left[key].every((row, i) => row.id === right[key][i].id),
    );
  function setPhase(value) {
    phase = value;
    render(true);
  }
  const digestDraft = (state) =>
    JSON.stringify([title, narrative, state.captures.map((r) => r.id)]);
  const hasDraft = (state) =>
    Boolean(title || narrative || state.captures.length) &&
    digestDraft(state) !== savedDraft;
  function discardDraft() {
    title = "";
    narrative = "";
    savedDraft = null;
  }
  function warnBeforeUnload(event) {
    if (hasDraft(controller.state)) {
      event.preventDefault();
      event.returnValue = "";
    }
  }
  window.addEventListener("beforeunload", warnBeforeUnload);

  function recordCard(state, collection, row, label, summary) {
    const { record, conflict } = row;
    const card = el("article", null, "cmd-record");
    card.append(
      el("h4", label),
      paragraph(conflict ? "Conflicting versions require review." : summary),
    );
    for (const item of state.records[collection]
      .filter((r) => r.entity === record.entity)
      .sort((a, b) => b.created - a.created)) {
      card.append(
        recordHistory(
          item,
          collection,
          row.heads.includes(item) ? "Current version" : "Earlier version",
        ),
      );
    }
    if (
      state.allowed.has(collection) &&
      !record.payload.pumpTask &&
      !isPio(record.payload) &&
      record.payload.kind !== "pump-readiness"
    ) {
      const supersedes = row.heads.map((r) => r.id);
      card.append(
        recordForm(
          collection,
          (payload) =>
            controller.append(collection, payload, {
              entity: record.entity,
              supersedes,
            }),
          {
            initial: record.payload,
            label: conflict
              ? "Review and reconcile current versions"
              : "Record a correction",
            reviewHeads: row.heads,
          },
        ),
      );
    }
    return card;
  }

  function tasks(state) {
    const panel = group(
      phase === "closeout" ? "Closeout review" : "Follow-ups and decisions",
    );
    if (phase === "closeout") {
      const briefings = state.records.briefings;
      const signed = briefings.filter(
        (r) =>
          approvalFor(r, state.records.approvals)?.payload.status ===
          "Approved",
      ).length;
      panel.append(
        paragraph(
          `${signed} approved briefing versions across ${briefings.length} saved. Review outstanding work before handoff.`,
        ),
      );
    }
    if (assignment && !state.allowed.has("coordination")) {
      panel.append(
        paragraph(
          "Your account needs coordination permissions to assign verification.",
        ),
      );
    }
    if (assignment && state.allowed.has("coordination")) {
      const form = recordForm(
        "coordination",
        async (payload) => {
          await controller.append("coordination", payload);
          assignment = null;
          render(true);
        },
        { initial: assignment, label: "Assign verification" },
      );
      form.open = true;
      panel.append(
        form,
        button("Cancel verification assignment", () => {
          assignment = null;
          render(true);
        }),
      );
      focusWhenVisible(form.querySelector('[name="owner"]'));
    }
    if (state.allowed.has("coordination")) {
      for (const kind of ["Follow-up", "Decision", "Information gap"]) {
        panel.append(
          recordForm(
            "coordination",
            (payload) => controller.append("coordination", payload),
            {
              initial: { kind, phase: phase === "all" ? "" : phase },
              label: "Add " + kind.toLowerCase(),
            },
          ),
        );
      }
    }
    const allRows = taskRows(state.records, phase);
    const filterPanel = el("div", null, "cmd-task-filters");
    for (const [key, title] of [
      ["location", "Place"],
      ["owner", "Owner"],
      ["status", "Status"],
    ]) {
      const values = [
        ...new Set(
          allRows
            .flatMap((r) => r.heads.map((h) => h.payload[key]))
            .filter(Boolean),
        ),
      ].sort();
      if (taskFilters[key] && !values.includes(taskFilters[key]))
        taskFilters[key] = "";
      const filter = field(
        [key, title, "select", [["All", ""], ...values], true],
        taskFilters[key],
      );
      filter.input.onchange = () => {
        taskFilters[key] = filter.input.value;
        render(true);
      };
      filterPanel.append(filter.label);
    }
    panel.append(filterPanel);
    const rows = allRows.filter((row) =>
      row.heads.some((h) =>
        Object.entries(taskFilters).every(
          ([key, value]) => !value || h.payload[key] === value,
        ),
      ),
    );
    if (!rows.length) panel.append(paragraph("No tasks in this view."));
    for (const status of [
      "Conflicting versions",
      "Overdue",
      "Outstanding",
      "Completed or canceled",
    ]) {
      const list = rows.filter((r) => r.group === status);
      if (!list.length) continue;
      const target = status === "Completed or canceled" ? el("details") : panel;
      if (target !== panel) {
        target.append(el("summary", status + " · " + list.length));
        panel.append(target);
      } else target.append(el("h4", status));
      for (const row of list) {
        const p = row.record.payload;
        const card = recordCard(
          state,
          "coordination",
          row,
          p.title,
          [
            p.kind,
            p.status,
            p.owner,
            date(p.due),
            p.phase || "Unclassified",
          ].join(" · "),
        );
        if (p.pumpTask || isPio(p))
          card.append(
            link(
              p.pumpTask ? "Open pump task workflow" : "Open PIO outreach",
              p.pumpTask
                ? "../eoc-guide.html#pump-followups"
                : "../eoc.html#outreach",
            ),
          );
        if (typeof p.publicPlaceId === "string")
          card.append(
            button("Focus public place", () => onFocus(p.publicPlaceId)),
          );
        target.append(card);
      }
    }
    return panel;
  }

  function reports(state) {
    const panel = group("Field reports");
    if (state.allowed.has("reports"))
      panel.append(
        recordForm("reports", (payload) =>
          controller.append("reports", payload),
        ),
      );
    for (const row of heads(state.records.reports)) {
      const r = row.record;
      const card = recordCard(
        state,
        "reports",
        row,
        r.payload.location,
        [
          reportStatus(r, state.records.verifications),
          r.payload.condition,
        ].join(" · "),
      );
      card.append(button("Focus report", () => onFocus(r)));
      const verifications = state.records.verifications.filter(
        (v) => v.payload.reportEvent === r.id,
      );
      const verificationHeads = heads(verifications).flatMap((h) => h.heads);
      for (const v of verifications)
        card.append(recordHistory(v, "verifications", "Verification history"));
      if (verificationHeads.length > 1)
        card.append(paragraph("Verification has conflicting versions."));
      if (
        !row.conflict &&
        state.allowed.has("verifications") &&
        heads(verifications).length <= 1
      ) {
        const entity = verificationHeads[0]?.entity ?? "verify-" + r.id;
        card.append(
          recordForm(
            "verifications",
            (payload) =>
              controller.append("verifications", payload, {
                entity,
                supersedes: verificationHeads.map((v) => v.id),
              }),
            {
              initial: { ...verificationHeads[0]?.payload, reportEvent: r.id },
              reviewHeads: verificationHeads,
            },
          ),
        );
      }
      panel.append(card);
    }
    return panel;
  }

  function collectionPanel(state, collection, label, main) {
    const panel = group(label);
    if (state.allowed.has(collection))
      panel.append(
        recordForm(collection, (payload) =>
          controller.append(collection, payload),
        ),
      );
    for (const row of heads(state.records[collection])) {
      const p = row.record.payload;
      if (p.kind === "pump-readiness") continue;
      panel.append(
        recordCard(
          state,
          collection,
          row,
          p[main],
          p.status ?? p.objectives ?? p.evidence,
        ),
      );
    }
    return panel;
  }

  function renderWork(state) {
    work.append(el("h1", "Work"));
    stateMessage = paragraph(statusText(state));
    stateMessage.setAttribute("role", state.error ? "alert" : "status");
    work.append(stateMessage);
    if (!state.username) {
      if (assignment)
        work.append(
          paragraph(
            "Sign in, then choose an incident to open the verification assignment.",
          ),
        );
      return;
    }
    const incidents = [...new Set(state.incidents.map((r) => r.incident))].map(
      (id) => {
        const versions = heads(
          state.incidents.filter((r) => r.incident === id),
        );
        return [
          versions.length === 1 && !versions[0].conflict
            ? versions[0].record.payload.name
            : "Incident with conflicting records",
          id,
        ];
      },
    );
    const picker = field(
      [
        "incident",
        "Exercise incident",
        "select",
        [["Choose an incident", ""], ...incidents],
        true,
      ],
      state.incident,
    );
    picker.input.onchange = () => {
      const next = picker.input.value;
      if (controller.state.saving) {
        picker.input.value = state.incident ?? "";
        return;
      }
      if (
        hasDraft(state) &&
        !window.confirm("Switch incident and clear this briefing draft?")
      ) {
        picker.input.value = state.incident ?? "";
        return;
      }
      void controller.selectIncident(next);
    };
    work.append(picker.label);
    if (assignment && !state.incident) {
      work.append(
        paragraph(
          "Choose an incident to assign verification for " +
            assignment.location +
            ".",
        ),
      );
      focusWhenVisible(picker.input);
    }
    if (state.allowed.has("incidents")) {
      work.append(
        recordForm("incidents", controller.createIncident, {
          label: "Record a new authorized incident",
        }),
      );
    }
    if (!state.incident || state.loading) return;
    const periods = heads(state.records.periods).filter((h) => !h.conflict);
    const period = field(
      [
        "period",
        "Operational period",
        "select",
        [
          ["Choose an operational period", ""],
          ...periods.map(({ record }) => [record.payload.label, record.id]),
        ],
        true,
      ],
      state.period,
    );
    period.input.onchange = () => controller.selectPeriod(period.input.value);
    work.append(
      period.label,
      button(
        "Refresh private records",
        () => void controller.selectIncident(state.incident),
      ),
    );
    for (const row of heads(state.records.incidents)) {
      work.append(
        recordCard(
          state,
          "incidents",
          row,
          row.record.payload.name,
          row.record.payload.level,
        ),
      );
    }
    const phasePicker = field(
      [
        "phase",
        "Show tasks by phase",
        "select",
        [
          ["All phases", "all"],
          ...COMMAND_PHASES.map((p) => [titleCase(p), p]),
        ],
      ],
      phase,
    );
    phasePicker.input.onchange = () => setPhase(phasePicker.input.value);
    work.append(
      phasePicker.label,
      tasks(state),
      collapsible(
        "Field reports",
        heads(state.records.reports).length,
        reports(state),
      ),
    );
    for (const [collection, label, fieldName] of [
      ["periods", "Operational periods", "label"],
      ["checklists", "Readiness checks", "check"],
      ["staging", "Staging status", "location"],
      ["references", "Manual references", "system"],
    ]) {
      const count = heads(state.records[collection]).filter(
        (row) => row.record.payload.kind !== "pump-readiness",
      ).length;
      work.append(
        collapsible(
          label,
          count,
          collectionPanel(state, collection, label, fieldName),
        ),
      );
    }
    const workflows = el("div", null, "cmd-specialized-links");
    workflows.append(
      link("PIO outreach and approval", "../eoc.html#outreach"),
      link("Pump readiness update form", "../pump-readiness.html"),
      link("Open County Watch for pump assignments", "../?view=watch"),
    );
    work.append(
      collapsible(
        "Specialized workflows",
        workflows.children.length,
        workflows,
      ),
    );
  }

  function renderBriefing(state) {
    briefing.append(el("h1", "Briefing"));
    if (!state.incident || state.loading) {
      briefing.append(
        paragraph(
          "Choose an exercise incident to prepare or review briefings.",
        ),
      );
      return;
    }
    if (state.allowed.has("briefings")) {
      const form = el("form", null, "cmd-form");
      const t = field(["title", "Briefing title"], title);
      const n = field(
        ["narrative", "Briefing narrative", "textarea", null, true],
        narrative,
      );
      t.input.oninput = () => {
        title = t.input.value;
      };
      n.input.oninput = () => {
        narrative = n.input.value;
      };
      const save = Object.assign(
        el("button", "Save briefing version", "cmd-button"),
        { type: "submit", disabled: !state.period },
      );
      const status = paragraph(
        state.period
          ? ""
          : "Choose an operational period in the private workspace before saving.",
      );
      status.setAttribute("role", "status");
      form.append(t.label, n.label, save, status);
      form.onsubmit = async (event) => {
        event.preventDefault();
        save.disabled = true;
        const revision = digestDraft(state);
        try {
          await controller.saveBriefing({ title: title.trim(), narrative });
          savedDraft = revision;
          render(true);
        } catch (failure) {
          status.textContent = failure.message;
        } finally {
          save.disabled = false;
        }
      };
      briefing.append(form);
    }
    const captured = group("Captured evidence");
    if (!state.captures.length)
      captured.append(paragraph("No evidence captured."));
    for (const item of state.captures) {
      const details = el("details");
      const evidence = item.evidence;
      details.append(
        el(
          "summary",
          evidence.title ??
            evidence.location ??
            evidence.name ??
            evidence.kind ??
            "Selected evidence",
        ),
        el("pre", evidenceLines(evidence).join("\n"), "cmd-briefing-text"),
        button("Remove captured evidence", () =>
          controller.removeCapture(item.id),
        ),
      );
      captured.append(details);
    }
    briefing.append(captured);
    const versions = group("Saved briefing versions");
    for (const r of [...state.records.briefings].sort(
      (a, b) => b.created - a.created,
    )) {
      const prior = approvalFor(r, state.records.approvals);
      const approvalRows = heads(
        state.records.approvals.filter((a) => a.payload.briefingEvent === r.id),
      );
      const conflict =
        approvalRows.length > 1 || approvalRows.some((row) => row.conflict);
      const panel = el("details", null, "cmd-briefing-version");
      panel.append(
        el(
          "summary",
          [
            r.payload.title,
            date(r.created),
            conflict
              ? "Approval conflict"
              : (prior?.payload.status ?? "Pending approval"),
          ].join(" · "),
        ),
      );
      const output = el(
        "pre",
        commandBriefingText(r, prior),
        "cmd-briefing-text",
      );
      if (!Object.hasOwn(r.payload.snapshot, "narrative")) {
        panel.append(
          paragraph(
            "Open the EOC workspace to review, print or approve the full original handoff.",
          ),
          link("Open EOC briefing workspace", "../eoc.html"),
        );
        versions.append(panel);
        continue;
      }
      panel.append(
        output,
        button("Print exact saved version", () => {
          printNode?.remove();
          const frame = el("iframe", null, "cmd-briefing-print");
          frame.title = "Print saved briefing";
          frame.style.cssText =
            "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
          printNode = frame;
          document.body.append(frame);
          const printDocument = frame.contentDocument;
          const text = printDocument.createElement("pre");
          text.style.cssText =
            "white-space:pre-wrap;overflow-wrap:anywhere;font:11pt system-ui";
          text.textContent = output.textContent;
          printDocument.title = "Saved exercise briefing";
          printDocument.body.append(text);
          briefingCharts(printDocument, r, printDocument.body);
          const clear = () => {
            frame.remove();
            if (printNode === frame) printNode = null;
          };
          frame.contentWindow.addEventListener("afterprint", clear, {
            once: true,
          });
          try {
            frame.contentWindow.print();
          } catch (error) {
            clear();
            throw error;
          }
        }),
      );
      briefingCharts(document, r, panel);
      if (state.allowed.has("approvals") && !conflict) {
        panel.append(
          recordForm(
            "approvals",
            (p) => controller.approveBriefing(r, p.evidence, p.status),
            {
              initial: {
                status:
                  prior?.payload.status === "Approved"
                    ? "Withdrawn"
                    : "Approved",
              },
              label: "Record approval or withdrawal",
            },
          ),
        );
      }
      versions.append(panel);
    }
    if (!state.records.briefings.length)
      versions.append(paragraph("No saved versions for this incident."));
    briefing.append(versions);
  }

  function render(force = false) {
    if (dead) return;
    const state = controller.state;
    if (
      (lastState?.username && !state.username) ||
      (priorScope && state.incident !== priorScope)
    )
      assignment = null;
    if (state.incident !== priorScope || !state.username) {
      discardDraft();
      Object.keys(taskFilters).forEach((key) => {
        taskFilters[key] = "";
      });
      expanded.clear();
      printNode?.remove();
      printNode = null;
    }
    priorScope = state.incident;
    if (!force && lastState === state) return;
    if (!force && state.saving && lastState?.incident === state.incident)
      return;
    const before = lastState;
    lastState = state;
    if (
      !force &&
      before &&
      state.error &&
      before.username === state.username &&
      before.incident === state.incident &&
      before.period === state.period &&
      before.captures === state.captures &&
      sameRecords(before.records, state.records)
    ) {
      stateMessage.setAttribute("role", "alert");
      stateMessage.textContent = statusText(state);
      return;
    }
    work.replaceChildren();
    briefing.replaceChildren();
    renderWork(state);
    renderBriefing(state);
  }

  render();
  function focusAssignment(concern) {
    const {
      id,
      name,
      change,
      nextAction,
      time,
      quality,
      evidence,
      details,
      private: isPrivate,
    } = concern;
    assignment = {
      kind: "Follow-up",
      title: "Verify " + name,
      location: name,
      status: "Open",
      nextReview:
        nextAction ?? "Verify the current condition with the responsible team.",
      sourceKey: id,
      ...(isPrivate ? {} : { publicPlaceId: id }),
      evidence: evidenceLines({
        change,
        time,
        quality,
        evidence,
        details,
      }).join("\n"),
    };
    render(true);
  }
  return {
    render,
    focusAssignment,
    destroy() {
      dead = true;
      window.removeEventListener("beforeunload", warnBeforeUnload);
      discardDraft();
      assignment = null;
      printNode?.remove();
      work.replaceChildren();
      briefing.replaceChildren();
    },
  };
}
