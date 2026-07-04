// app/InspectorPanel.js
// Renders editable inspector content into the RightPanel: node title /
// subtitle / kind / spec fields, plus full CRUD for actions (ad-hoc
// scripts run over SSH, with inline output) and crons (scheduled scripts
// whose results drive node health — the "alive" part). Edge cards get
// label + kind + delete.

import { h, clear } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { getSelectedIds, getState, removeNode, removeEdge, updateEdge, updateNodeMeta, setNodeSpec } from "../core/store.js";
import { KINDS, ADDONS, kindMeta, isGroupKind } from "../canvas/nodes/kinds.js";
import { EDGE_KINDS, EDGE_LABELS, EDGE_STYLES } from "../canvas/edges/styles.js";
import { iconSvg } from "../canvas/nodes/icons.js";
import { checkHealth, runAction, runCronNow, getCronResults, effectiveExec } from "../core/ops.js";
import api from "../core/api.js";

// Ad-hoc run output survives re-renders (keyed nodeId:kind:index).
const runOutputs = new Map();

export function mountInspectorContent(root) {
  function render() {
    // Don't clobber an in-progress edit: background events (health ticks,
    // cron results, other users' saves) re-render the panel, which would
    // wipe uncommitted input text. The commit itself re-renders.
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;

    const ids = getSelectedIds();
    clear(root);
    if (ids.length === 0) {
      root.append(h("div", { class: "inspector-empty" }, "Nothing selected"));
      return;
    }
    if (ids.length > 1) {
      root.append(h("div", { class: "inspector-empty" }, `${ids.length} selected`));
      return;
    }
    const n = getState().topology.nodes[ids[0]];
    if (n) { root.append(card(n)); return; }
    const e = getState().topology.edges[ids[0]];
    if (e) root.append(edgeCard(e));
  }

  bus.on("selection:changed", render);
  bus.on("topology:changed", render);
  bus.on("node:meta", render);
  bus.on("health:tick", render);
  bus.on("cron:result", render);
  bus.on("cron:status", render);
  render();
}

function card(n) {
  const meta = kindMeta(n.kind);
  const group = isGroupKind(n.kind);
  const el = h("div", { class: "inspector-card", "data-kind": n.kind, "data-cat": meta.category });

  // Header with icon + editable title
  const head = h("div", { class: "inspector-card-head" },
    h("span", { class: "inspector-card-icon" }, iconSvg(n.kind, 22)),
    h("div", { class: "inspector-card-titles" },
      editableField(n.title, (val) => updateNodeMeta(n.id, { title: val }), "Title"),
      editableField(n.subtitle || "", (val) => updateNodeMeta(n.id, { subtitle: val }), "Subtitle"),
    ),
  );

  // Action buttons
  const actions = h("div", { class: "inspector-actions" });
  if (!group && (meta.modes.includes("ssh") || meta.modes.includes("kubectl"))) {
    const shellBtn = btn("Shell", "shell-btn", () => bus.emit("terminal:open", { nodeId: n.id }));
    shellBtn.title = "Open an SSH/kubectl shell on this node (⌘⏎)";
    actions.appendChild(shellBtn);
  }
  if (!group) {
    actions.appendChild(btn("Check", "check-btn", async () => {
      const b = actions.querySelector(".check-btn"); b.disabled = true;
      await checkHealth(n.id); b.disabled = false;
    }));
    actions.appendChild(btn("Edit", "edit-btn", () => bus.emit("inspector:edit", { id: n.id })));
  }
  actions.appendChild(btn("Delete", "del-btn", () => removeNode(n.id)));

  // Build editable fields
  const rows = [];
  rows.push(["kind", kindSelect(n)]);
  rows.push(kv("id", n.id));

  if (!group) {
    // SSH endpoint — the default target for ssh-type actions/crons.
    if (meta.modes.includes("ssh") || n.spec?.host) {
      rows.push(["host", editableField(n.spec?.host || "", (val) => setNodeSpec(n.id, { host: val }), "Host")]);
      rows.push(["port", editableField(String(n.spec?.port ?? 22), (val) => setNodeSpec(n.id, { port: parseInt(val) || 22 }), "Port")]);
      rows.push(["user", editableField(n.spec?.user || "", (val) => setNodeSpec(n.id, { user: val }), "User")]);
    }
    // Kube fields
    if (meta.modes.includes("kubectl") || n.spec?.kubeContext) {
      rows.push(["context", editableField(n.spec?.kubeContext || "", (val) => setNodeSpec(n.id, { kubeContext: val }), "Context")]);
      rows.push(["namespace", editableField(n.spec?.namespace || "", (val) => setNodeSpec(n.id, { namespace: val }), "Namespace")]);
      rows.push(["name", editableField(n.spec?.name || "", (val) => setNodeSpec(n.id, { name: val }), "Name")]);
    }
    // Interpreter for scripts (bash default; powershell/pwsh for Windows)
    rows.push(["interpreter", editableField(n.spec?.interpreter || "", (val) => setNodeSpec(n.id, { interpreter: val || undefined }), "bash")]);
  }

  // Build the kv list — values can be strings or DOM elements (for editable fields)
  const dlChildren = [];
  for (const [k, v] of rows) {
    dlChildren.push(h("dt", {}, k));
    if (typeof v === "string") {
      dlChildren.push(h("dd", {}, v));
    } else {
      dlChildren.push(h("dd", {}, v));
    }
  }

  // Health
  const healthRow = h("div", { class: "inspector-card-health" },
    h("span", { class: "health-pill", "data-state": (n.health?.state) || "unknown" },
      h("span", { class: "dot" }),
      ((n.health?.state) || "unknown").toUpperCase(),
    ),
  );

  el.append(
    head,
    h("div", { class: "inspector-card-actions-bar" }, actions),
    h("dl", { class: "kv" }, ...dlChildren),
    addonsSection(n),
    notesSection(n),
  );
  if (!group) {
    el.append(scriptsSection(n, "actions"), scriptsSection(n, "crons"));
  }
  el.append(healthRow);
  return el;
}

/** Attached resources — GPU, disk, IP… Pure indicators with an optional
 *  free-text label ("2× A100 80G"). Also attachable by dragging from the
 *  palette's Add-ons section onto a node. */
function addonsSection(n) {
  const addons = n.addons ?? [];
  const wrap = h("div", { class: "insp-section" });

  const add = h("button", { class: "insp-btn add-btn", type: "button" }, "+ add");
  const chooser = h("div", { class: "insp-add-choices" });
  chooser.style.display = "none";
  for (const [id, m] of Object.entries(ADDONS)) {
    const chip = h("button", { class: "insp-type-chip", type: "button", title: m.label });
    chip.append(iconSvg(id, 13), document.createTextNode(" " + m.label));
    chip.addEventListener("click", () => {
      updateNodeMeta(n.id, { addons: [...addons, { kind: id, label: "" }] });
    });
    chooser.append(chip);
  }
  add.addEventListener("click", () => {
    chooser.style.display = chooser.style.display === "none" ? "" : "none";
  });

  wrap.append(h("div", { class: "insp-section-head" },
    h("span", { class: "insp-section-title" }, "Add-ons"),
    add,
  ), chooser);

  if (!addons.length) {
    wrap.append(h("div", { class: "insp-section-empty" },
      "Attached resources — GPUs, disks, IPs. Drag from the palette or add here."));
    return wrap;
  }

  for (const [i, a] of addons.entries()) {
    const row = h("div", { class: "insp-item insp-addon-row" });
    const icon = h("span", { class: "insp-addon-icon" });
    icon.append(iconSvg(a.kind, 15));
    const kindName = h("span", { class: "insp-addon-kind" }, ADDONS[a.kind]?.label ?? a.kind);
    const label = editableField(a.label || "", (val) => {
      const list = addons.map((it, idx) => (idx === i ? { ...it, label: val } : it));
      updateNodeMeta(n.id, { addons: list });
    }, ADDONS[a.kind]?.hint ?? "label");
    label.classList.add("insp-addon-label");
    const del = h("button", { class: "insp-icon-btn del-icon-btn", type: "button", title: "Detach" }, "×");
    del.addEventListener("click", () => {
      const list = [...addons];
      list.splice(i, 1);
      updateNodeMeta(n.id, { addons: list });
    });
    row.append(h("div", { class: "insp-item-row" }, icon, kindName, label, del));
    wrap.append(row);
  }
  return wrap;
}

/** Free-form multi-line notes, persisted with the node in the YAML. */
function notesSection(n) {
  const wrap = h("div", { class: "insp-section" });
  wrap.append(h("div", { class: "insp-section-head" },
    h("span", { class: "insp-section-title" }, "Notes")));
  const ta = h("textarea", {
    class: "inspector-input insp-notes",
    rows: Math.min(10, Math.max(3, (n.notes || "").split("\n").length + 1)),
    placeholder: "Context, gotchas, runbook links — anything worth remembering about this node.",
    spellcheck: false,
  });
  ta.value = n.notes || "";
  ta.addEventListener("change", () => updateNodeMeta(n.id, { notes: ta.value }));
  ta.addEventListener("keydown", (e) => e.stopPropagation());
  wrap.append(ta);
  return wrap;
}

/** Kind picker — stays within the node/group family so a server doesn't
 *  accidentally become a VPC (the renderer handles the swap if it does). */
function kindSelect(n) {
  const group = isGroupKind(n.kind);
  const sel = h("select", { class: "inspector-input" },
    ...Object.entries(KINDS)
      .filter(([k]) => isGroupKind(k) === group)
      .map(([k, m]) => {
        const o = h("option", { value: k }, m.label);
        if (k === n.kind) o.selected = true;
        return o;
      }),
  );
  sel.addEventListener("change", () => updateNodeMeta(n.id, { kind: sel.value }));
  return sel;
}

/* ---- actions & crons ----
 * Same editing UI for both lists; crons add an interval field, a last
 * scheduled-run line, and their results drive node health. `kind` is
 * "actions" | "crons".
 */
function scriptsSection(n, kind) {
  const isCron = kind === "crons";
  const items = n[kind] ?? [];
  const wrap = h("div", { class: "insp-section" });

  // "+ add" opens a one-step type chooser: what kind of execution?
  //   actions:  ssh shell · local shell
  //   crons:    ssh shell · local shell · http
  const add = h("button", { class: "insp-btn add-btn", type: "button" }, "+ add");
  const chooser = h("div", { class: "insp-add-choices" });
  chooser.style.display = "none";
  for (const t of ["ssh", "local", "http"]) {
    const chip = h("button", { class: `insp-type-chip t-${t}`, type: "button" },
      t === "http" ? "http check" : `${t} shell`);
    chip.addEventListener("click", () => {
      const base = isCron
        ? { name: `check-${items.length + 1}`, interval: "60s", exec: t }
        : { name: `action-${items.length + 1}`, exec: t };
      const fresh = t === "http"
        ? { ...base, url: "", status: "", jq: "" }
        : { ...base, script: "" };
      updateNodeMeta(n.id, { [kind]: [...items, fresh] });
    });
    chooser.append(chip);
  }
  add.addEventListener("click", () => {
    chooser.style.display = chooser.style.display === "none" ? "" : "none";
  });

  wrap.append(h("div", { class: "insp-section-head" },
    h("span", { class: "insp-section-title" }, isCron ? "Crons" : "Actions"),
    add,
  ), chooser);

  if (!items.length) {
    wrap.append(h("div", { class: "insp-section-empty" },
      isCron ? "Scheduled checks — results drive this node's health." : "Scripts you run on demand."));
    return wrap;
  }

  items.forEach((item, i) => wrap.append(scriptRow(n, kind, item, i)));
  return wrap;
}

function scriptRow(n, kind, item, i) {
  const isCron = kind === "crons";
  const outKey = `${n.id}:${kind}:${i}`;
  const row = h("div", { class: "insp-item" });
  const exec = effectiveExec(n, item);

  const patch = (p) => {
    const list = (n[kind] ?? []).map((it, idx) => (idx === i ? { ...it, ...p } : it));
    updateNodeMeta(n.id, { [kind]: list });
  };

  // Execution type chip — a select disguised as a badge, so the type can
  // be changed after creation too.
  const typeSel = h("select", { class: `insp-exec t-${exec}`, title: "Where this runs" },
    h("option", { value: "ssh" }, "ssh"),
    h("option", { value: "local" }, "local"),
    h("option", { value: "http" }, "http"),
  );
  typeSel.value = exec;
  typeSel.addEventListener("change", () => patch({ exec: typeSel.value }));

  const name = editableField(item.name, (val) => patch({ name: val }), "name");
  name.classList.add("insp-item-name");

  const topRow = h("div", { class: "insp-item-row" }, typeSel, name);
  if (isCron) {
    const interval = editableField(item.interval || "60s", (val) => patch({ interval: val }), "60s");
    interval.classList.add("insp-interval");
    interval.title = "Interval: 30s / 5m / 1h";
    topRow.append(interval);
  }

  const run = h("button", { class: "insp-icon-btn run-btn", type: "button", title: "Run now" }, "▶");
  const del = h("button", { class: "insp-icon-btn del-icon-btn", type: "button", title: "Delete" }, "×");
  del.addEventListener("click", () => {
    const list = [...(n[kind] ?? [])];
    list.splice(i, 1);
    runOutputs.delete(outKey);
    updateNodeMeta(n.id, { [kind]: list });
  });
  topRow.append(run, del);
  row.append(topRow);

  if (exec === "http") {
    // url on its own line; status + jq side by side
    const url = editableField(item.url || "", (v) => patch({ url: v }), "https://host/healthz");
    url.classList.add("insp-http-url");
    const status = editableField(item.status || "", (v) => patch({ status: v }), "2xx");
    status.classList.add("insp-http-status");
    status.title = "Healthy status: 2xx · 200 · 200-204 · 200,204";
    const jq = editableField(item.jq || "", (v) => patch({ jq: v }), 'jq: .status == "ok"');
    jq.classList.add("insp-http-jq");
    jq.title = "Optional jq over the JSON body — truthy = healthy";
    row.append(url, h("div", { class: "insp-http-row" }, status, jq));
  } else {
    const script = h("textarea", {
      class: "inspector-input insp-script",
      rows: Math.min(5, Math.max(1, (item.script || "").split("\n").length)),
      placeholder: exec === "local" ? "runs on this host…" : "runs over ssh…",
      spellcheck: false,
    });
    script.value = item.script || "";
    script.addEventListener("change", () => patch({ script: script.value }));
    script.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { script.value = item.script || ""; script.blur(); }
    });
    row.append(script);
  }

  // Last scheduled run (crons only) — fed by cron-result events / status.
  if (isCron) {
    const last = getCronResults(n.id)?.get(item.name);
    if (last) {
      row.append(h("div", { class: "insp-last" + (last.success ? " ok" : " err") },
        h("span", { class: "dot" }),
        last.success ? "last run ok" : `last run exit ${last.exit_code ?? "?"}`,
        h("span", { class: "insp-last-time" }, timeAgo(last.timestamp)),
      ));
    }
  }

  const outWrap = h("div", { class: "insp-output" });
  renderRunOutput(outWrap, runOutputs.get(outKey));
  row.append(outWrap);

  const readonly = api.ready && !api.canWrite;
  if (readonly) {
    run.disabled = true;
    run.title = "read-only access";
  }
  run.addEventListener("click", async () => {
    run.disabled = true;
    runOutputs.set(outKey, { running: true });
    renderRunOutput(outWrap, runOutputs.get(outKey));
    const res = isCron ? await runCronNow(n.id, item.name) : await runAction(n.id, item.name);
    runOutputs.set(outKey, res ?? { success: false, exitCode: -1, stdout: "", stderr: "not found" });
    renderRunOutput(outWrap, runOutputs.get(outKey));
    run.disabled = false;
  });

  return row;
}

function renderRunOutput(el, res) {
  clear(el);
  if (!res) { el.style.display = "none"; return; }
  el.style.display = "";
  if (res.running) {
    el.append(h("div", { class: "insp-output-head" }, h("span", { class: "insp-exit" }, "running…")));
    return;
  }
  const badge = h("span", { class: "insp-exit " + (res.success ? "ok" : "err") },
    `exit ${res.exitCode ?? (res.success ? 0 : "?")}`);
  const copy = h("button", { class: "insp-icon-btn", type: "button", title: "Copy output" }, "⧉");
  const text = [(res.stdout || "").trimEnd(), (res.stderr || "").trimEnd()].filter(Boolean).join("\n");
  copy.addEventListener("click", () => navigator.clipboard?.writeText(text));
  const close = h("button", { class: "insp-icon-btn", type: "button", title: "Dismiss" }, "×");
  close.addEventListener("click", () => { clear(el); el.style.display = "none"; });
  el.append(
    h("div", { class: "insp-output-head" }, badge, h("span", { class: "sb-spacer", style: "flex:1" }), copy, close),
    h("pre", { class: "insp-output-pre" }, text || "(no output)"),
  );
}

function timeAgo(ts) {
  if (!ts) return "";
  const ms = Date.now() - (ts < 2e10 ? ts * 1000 : ts); // backend sends seconds
  if (ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

/** Inspector card for a selected edge: editable label, kind picker, delete. */
function edgeCard(e) {
  const nodes = getState().topology.nodes;
  const el = h("div", { class: "inspector-card", "data-kind": e.kind });

  const head = h("div", { class: "inspector-card-head" },
    h("div", { class: "inspector-card-titles" },
      h("div", { class: "inspector-edge-route" },
        `${nodes[e.from]?.title ?? e.from} → ${nodes[e.to]?.title ?? e.to}`),
    ),
  );

  // Kind IS the visual language — no free color picking. Each chip shows
  // the actual line style (color, weight, dash) that kind draws with and
  // that the PDF legend explains. Pick the meaning, get the color.
  const kindPick = h("div", { class: "edge-kind-pick" },
    ...EDGE_KINDS.map((k) => {
      const st = EDGE_STYLES[k] || EDGE_STYLES.tcp;
      const chip = h("button", {
        class: "edge-kind-chip" + (k === e.kind ? " is-active" : ""),
        type: "button",
        title: EDGE_LABELS[k] ?? k,
      });
      chip.innerHTML =
        `<svg width="26" height="8" aria-hidden="true"><line x1="1" y1="4" x2="25" y2="4" ` +
        `stroke="${st.color}" stroke-width="${Math.min(st.width, 2.6)}"` +
        `${st.dash ? ` stroke-dasharray="${st.dash}"` : ""}/></svg>` +
        `<span>${EDGE_LABELS[k] ?? k}</span>`;
      chip.addEventListener("click", () => updateEdge(e.id, { kind: k }));
      return chip;
    }),
  );

  const actions = h("div", { class: "inspector-actions" });
  actions.appendChild(btn("Delete", "del-btn", () => removeEdge(e.id)));

  const dl = h("dl", { class: "kv" },
    h("dt", {}, "label"),
    h("dd", {}, editableField(e.label || "", (val) => updateEdge(e.id, { label: val }), "tcp/5432")),
    h("dt", {}, "kind"),
    h("dd", {}, kindPick),
    h("dt", {}, "id"),
    h("dd", {}, e.id),
  );

  el.append(head, h("div", { class: "inspector-card-actions-bar" }, actions), dl);
  return el;
}

/** Create an inline-editable field. Click to edit, Enter/blur to commit. */
function editableField(value, onCommit, placeholder = "") {
  const el = h("input", {
    class: "inspector-input",
    type: "text",
    value: String(value || ""),
    placeholder,
  });
  el.addEventListener("change", () => {
    const val = el.value.trim();
    if (val !== value) onCommit(val);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.blur();
    if (e.key === "Escape") { el.value = value; el.blur(); }
  });
  return el;
}

function kv(k, v) { return [k, v]; }
function btn(label, cls, onClick) {
  const b = h("button", { class: `insp-btn ${cls}`, type: "button" }, label);
  b.addEventListener("click", onClick);
  return b;
}