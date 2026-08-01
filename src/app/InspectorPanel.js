// app/InspectorPanel.js
// Renders editable inspector content into the RightPanel: node title /
// subtitle / kind / spec fields, health, and guarded named action descriptors.
// Edge cards get label + kind + delete.

import { h, clear } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { getSelectedIds, getState, removeNode, removeEdge, updateEdge, updateNodeMeta, setNodeSpec } from "../core/store.js";
import { KINDS, ADDONS, kindMeta, isGroupKind } from "../canvas/nodes/kinds.js";
import { EDGE_KINDS, EDGE_LABELS, EDGE_STYLES } from "../canvas/edges/styles.js";
import { iconSvg } from "../canvas/nodes/icons.js";
import { checkHealth, runAction } from "../core/ops.js";

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
    el.append(namedActionsSection(n));
  }
  el.append(healthRow);
  return el;
}

function namedActionsSection(n) {
  const wrap = h("div", { class: "insp-section" },
    h("div", { class: "insp-section-head" },
      h("span", { class: "insp-section-title" }, "Named actions")));
  if (!(n.actions ?? []).length) {
    wrap.append(h("div", { class: "insp-section-empty" }, "No guarded actions configured."));
    return wrap;
  }
  for (const action of n.actions) {
    const row = h("div", { class: "insp-item" });
    const run = h("button", {
      class: "insp-icon-btn run-btn",
      type: "button",
      title: action.available ? "Run named action" : (action.unavailableReason || "Unavailable"),
      disabled: !action.available,
    }, "▶");
    const output = h("div", { class: "insp-output" });
    run.addEventListener("click", async () => {
      run.disabled = true;
      renderRunOutput(output, await runAction(n.id, action.name));
      run.disabled = !action.available;
    });
    row.append(h("div", { class: "insp-item-row" },
      h("span", { class: "insp-exec t-ssh" }, action.kind),
      h("span", { class: "insp-item-name", title: `Target: ${action.target}` }, action.name),
      run), output);
    wrap.append(row);
  }
  return wrap;
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
