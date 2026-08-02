// app/InspectorPanel.js
// Renders editable inspector content into the RightPanel: node title /
// subtitle / kind / spec fields, health, and guarded named action descriptors.
// Edge cards get label + kind + delete.

import { h, clear } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { clearHistory, getSelectedIds, getState, removeNode, removeEdge, updateEdge, updateNodeDetails, updateNodeMeta } from "../core/store.js";
import { KINDS, ADDONS, kindMeta, isGroupKind } from "../canvas/nodes/kinds.js";
import { EDGE_KINDS, EDGE_LABELS, EDGE_STYLES } from "../canvas/edges/styles.js";
import { iconSvg } from "../canvas/nodes/icons.js";
import { checkHealth, runAction } from "../core/ops.js";
import api from "../core/api.js";
import { flushPendingPersistence } from "../core/persistence.js";
import {
  collectorActionReferences, getOperationsState, nodeHasOperations,
  operationsForNode, removeEditableAction, removeEditableCollector, removeEditableOperationsForNode,
  saveEditableOperations, setEditableAction, setEditableCollector,
} from "../core/operations.js";
import {
  defaultAction, defaultCollector, validateAction, validateCollector,
} from "../core/operationsModel.js";

const actionRuns = new Map();
let actionRunGeneration = 0;
bus.on("workspace:switched", () => {
  actionRunGeneration += 1;
  actionRuns.clear();
});

export function mountInspectorContent(root) {
  function render() {
    // Don't clobber an in-progress edit: background events (health ticks,
    // cron results, other users' saves) re-render the panel, which would
    // wipe uncommitted input text. The commit itself re-renders.
    const ae = document.activeElement;
    if (ae && root.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    if (root.querySelector(".insp-operation-form")) return;
    if (root.querySelector(".inspector-card.is-dirty")) return;

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
  bus.on("operations:changed", render);
  bus.on("operations:runtime", render);
  bus.on("operations:error", render);
  bus.on("operations:saved", render);
  bus.on("operations:refresh", render);
  bus.on("action:changed", render);
  render();
}

function card(n) {
  const meta = kindMeta(n.kind);
  const group = isGroupKind(n.kind);
  const el = h("div", { class: "inspector-card", "data-kind": n.kind, "data-cat": meta.category });
  const draft = {
    title: n.title,
    subtitle: n.subtitle || "",
    kind: n.kind,
    spec: { ...(n.spec ?? {}) },
  };
  let saveDetails;
  let discardDetails;
  const draftId = `details:${n.id}`;
  const changed = () => {
    el.classList.add("is-dirty");
    if (saveDetails) saveDetails.disabled = false;
    if (discardDetails) discardDetails.disabled = false;
    for (const control of el.querySelectorAll(".check-btn, .run-btn, .shell-btn")) {
      control.disabled = true;
    }
    bus.emit("inspector:draft", { id: draftId, dirty: true });
  };

  const titleField = editableField(n.title, (value) => { draft.title = value; changed(); }, "Title", true);
  titleField.classList.add("inspector-card-title");
  const subtitleField = editableField(n.subtitle || "", (value) => { draft.subtitle = value; changed(); }, "Subtitle", true);
  subtitleField.classList.add("inspector-card-sub");
  const health = h("span", { class: "health-pill", "data-state": (n.health?.state) || "unknown" },
    h("span", { class: "dot" }), ((n.health?.state) || "unknown").toUpperCase());
  const head = h("div", { class: "inspector-card-head node-card-head" },
    h("span", { class: "inspector-card-icon" }, iconSvg(n.kind, 22)),
    h("div", { class: "inspector-card-titles" }, titleField, subtitleField),
    h("div", { class: "inspector-card-health" }, health),
  );

  const actions = h("div", { class: "inspector-actions" });
  if (!group && !api.isViewer) {
    actions.appendChild(btn("Check", "check-btn", async () => {
      const button = actions.querySelector(".check-btn");
      button.disabled = true;
      await checkHealth(n.id);
      button.disabled = el.classList.contains("is-dirty");
    }));
  }
  const operationPolicy = getOperationsState();
  const hasShellTarget = (meta.modes.includes("ssh") && !!n.spec?.host)
    || meta.modes.includes("kubectl");
  if (!group && api.transport === "tauri" && operationPolicy.customChecksEnabled
      && operationPolicy.localChecksEnabled && hasShellTarget) {
    const shell = btn("Shell", "", async () => {
      if (!window.confirm("Open a live interactive shell for this node? It is not read-only, has no Reticle timeout, and runs with your configured SSH or kubectl identity.")) return;
      if (!await flushPendingPersistence()) {
        bus.emit("terminal:error", { error: "Could not persist workspace changes; shell was not opened" });
        return;
      }
      bus.emit("terminal:open", { nodeId: n.id });
    });
    shell.classList.add("shell-btn");
    actions.appendChild(shell);
  }
  if (!api.isViewer) {
    saveDetails = btn("Save details", "save-btn", () => {
      bus.emit("inspector:draft", { id: draftId, dirty: false });
      el.classList.remove("is-dirty");
      saveDetails.disabled = true;
      discardDetails.disabled = true;
      updateNodeDetails(n.id, {
        title: draft.title,
        subtitle: draft.subtitle,
        kind: draft.kind,
      }, draft.spec);
      bus.emit("session:save-now", {});
    });
    saveDetails.disabled = true;
    actions.appendChild(saveDetails);
    discardDetails = btn("Discard", "", () => {
      bus.emit("inspector:draft", { id: draftId, dirty: false });
      el.classList.remove("is-dirty");
      bus.emit("selection:changed", {});
    });
    discardDetails.disabled = true;
    actions.appendChild(discardDetails);
    actions.appendChild(btn("Delete", "del-btn", () => {
      const hasOperations = nodeHasOperations(n.id);
      if (hasOperations && !window.confirm("This node has checks or named actions. Deleting it also removes those definitions and cannot be undone. Continue?")) return;
      if (hasOperations && getOperationsState().canManage) {
        removeEditableOperationsForNode(n.id);
      }
      removeNode(n.id);
      if (hasOperations) clearHistory();
    }));
  }

  const rows = [];
  rows.push(["kind", kindSelect(n, (value) => { draft.kind = value; changed(); })]);
  rows.push(kv("id", n.id));

  if (!group) {
    if (meta.modes.includes("ssh") || n.spec?.host) {
      rows.push(["host", editableField(n.spec?.host || "", (value) => { draft.spec.host = value; changed(); }, "Host", true)]);
      rows.push(["port", editableField(String(n.spec?.port ?? 22), (value) => { draft.spec.port = parseInt(value) || 22; changed(); }, "Port", true)]);
      rows.push(["user", editableField(n.spec?.user || "", (value) => { draft.spec.user = value; changed(); }, "User", true)]);
    }
    if (meta.modes.includes("kubectl") || n.spec?.kubeContext) {
      rows.push(["context", editableField(n.spec?.kubeContext || "", (value) => { draft.spec.kubeContext = value; changed(); }, "Context", true)]);
      rows.push(["namespace", editableField(n.spec?.namespace || "", (value) => { draft.spec.namespace = value; changed(); }, "Namespace", true)]);
      rows.push(["name", editableField(n.spec?.name || "", (value) => { draft.spec.name = value; changed(); }, "Name", true)]);
    }
  }

  const dlChildren = [];
  for (const [key, value] of rows) {
    dlChildren.push(h("dt", {}, key), h("dd", {}, value));
  }

  el.append(
    head,
    h("div", { class: "inspector-card-actions-bar" }, actions),
    h("dl", { class: "kv" }, ...dlChildren),
    addonsSection(n),
    notesSection(n),
  );
  if (!group) {
    el.append(checksSection(n), namedActionsSection(n));
  }
  return el;
}

function namedActionsSection(n) {
  const operations = getOperationsState();
  const nodeOps = operationsForNode(n.id);
  const wrap = h("div", { class: "insp-section" },
    h("div", { class: "insp-section-head" },
      h("span", { class: "insp-section-title" }, "Named actions")));
  if (operations.error) wrap.append(h("div", { class: "insp-ops-error" }, operations.error));
  if (operations.canManage && !operations.customChecksEnabled && api.transport !== "tauri") {
    wrap.append(h("div", { class: "insp-policy-note" }, "Shell actions are disabled by host policy."));
  }
  if (operations.canManage && operations.customChecksEnabled) {
    const add = btn("+ add", "add-btn", () => showActionChooser(wrap, n.id));
    wrap.firstChild.append(add);
  }
  if (!nodeOps.runtimeActions.length && !nodeOps.actions.length) {
    wrap.append(h("div", { class: "insp-section-empty" }, "No guarded actions configured."));
  }
  for (const action of nodeOps.runtimeActions) {
    const row = h("div", { class: "insp-item" });
    const output = h("div", { class: "insp-output" });
    const priorRun = actionRuns.get(action.id);
    const definition = nodeOps.actions.find((item) => item.id === action.id);
    const name = h("span", { class: "insp-item-name", title: action.target ? `${action.name} · Target: ${action.target}` : action.name }, action.name);
    const kind = h("span", { class: `insp-exec t-${action.kind === "shell.command" ? "local" : "ssh"}` }, actionLabel(action));
    const controls = [];
    if (operations.canManage) {
      const run = h("button", {
        class: "insp-icon-btn run-btn", type: "button",
        title: action.available ? "Run named action" : (action.unavailableReason || "Unavailable"),
        disabled: !action.available || priorRun?.running === true,
      }, "Run");
      run.addEventListener("click", async () => {
        const generation = actionRunGeneration;
        run.disabled = true;
        actionRuns.set(action.id, { running: true });
        bus.emit("action:running", { actionId: action.id, running: true });
        bus.emit("action:changed", {});
        const result = await runAction(n.id, action.id);
        bus.emit("action:running", { actionId: action.id, running: false });
        if (generation !== actionRunGeneration) return;
        actionRuns.set(action.id, result);
        bus.emit("action:changed", {});
      });
      controls.push(run);
      if (definition) {
        controls.push(btn("Edit", "", () => showActionForm(wrap, definition, true)));
        controls.push(btn("Remove", "del-btn", async () => {
          if (!window.confirm(`Remove named action “${definition.name || definition.id}”?`)) return;
          removeEditableAction(definition.id);
          await saveEditableOperations();
        }));
      }
    }
    row.classList.add("insp-operation-item");
    row.append(h("div", { class: "insp-item-row insp-operation-row" },
      name, kind),
    controls.length ? h("div", { class: "insp-operation-footer" },
      h("div", { class: "insp-action-controls" }, ...controls)) : null,
    output);
    renderRunOutput(output, priorRun, action.id);
    wrap.append(row);
  }
  const runtimeActionIds = new Set(nodeOps.runtimeActions.map((action) => action.id));
  if (operations.canManage) for (const action of nodeOps.actions.filter((item) => !runtimeActionIds.has(item.id))) {
    const edit = btn("Edit", "", () => showActionForm(wrap, action, true));
    const del = btn("Remove", "del-btn", async () => {
      if (!window.confirm(`Remove named action “${action.name || action.id}”?`)) return;
      removeEditableAction(action.id);
      await saveEditableOperations();
    });
    wrap.append(h("div", { class: "insp-item insp-definition insp-operation-item" },
      h("div", { class: "insp-item-row insp-operation-row" },
        h("span", { class: "insp-item-name", title: action.name || action.id }, action.name || action.id),
        h("span", { class: `insp-exec t-${action.kind === "shell.command" ? "local" : "ssh"}` }, actionLabel(action))),
      h("div", { class: "insp-operation-footer" },
        h("div", { class: "insp-action-controls" }, edit, del))));
  }
  return wrap;
}

function checksSection(n) {
  const operations = getOperationsState();
  const nodeOps = operationsForNode(n.id);
  const wrap = h("div", { class: "insp-section" },
    h("div", { class: "insp-section-head" }, h("span", { class: "insp-section-title" }, "Checks")));
  if (operations.canManage) {
    const add = btn("+ add", "add-btn", () => showCollectorChooser(wrap, n.id));
    wrap.firstChild.append(add);
  }
  if (!nodeOps.runtimeCollectors.length && !nodeOps.collectors.length) {
    wrap.append(h("div", { class: "insp-section-empty" }, "No checks configured."));
  }
  if (operations.canManage && !operations.customChecksEnabled && api.transport !== "tauri") {
    wrap.append(h("div", { class: "insp-policy-note" }, "Shell checks are disabled by host policy; fixed checks remain available."));
  }
  for (const status of nodeOps.runtimeCollectors) {
    const definition = nodeOps.collectors.find((item) => item.id === status.id);
    const controls = [];
    if (operations.canManage && definition) {
      controls.push(btn("Edit", "", () => showCollectorForm(wrap, definition, true)));
      controls.push(btn("Remove", "del-btn", async () => {
        await removeCollectorWithConfirmation(definition);
      }));
    }
    const evidenceMeta = [
      status.collectedAt ? `observed ${relativeAge(status.collectedAt)}` : "",
      Number.isFinite(status.durationMs) ? `${status.durationMs} ms` : "",
    ].filter(Boolean).join(" · ");
    wrap.append(h("div", { class: "insp-item insp-operation-item" },
      h("div", { class: "insp-item-row insp-operation-row" },
        h("span", { class: "insp-item-name", title: status.name || status.id }, status.name || status.id),
        h("span", { class: "health-pill", "data-state": status.state || "unknown" },
          h("span", { class: "dot" }), String(status.state || "unknown").toUpperCase())),
      status.detail ? h("div", { class: "insp-runtime-detail" }, status.detail) : "",
      evidenceMeta || controls.length ? h("div", { class: "insp-operation-footer" },
        evidenceMeta ? h("div", { class: "insp-runtime-meta" }, evidenceMeta) : null,
        controls.length ? h("div", { class: "insp-action-controls" }, ...controls) : null) : ""));
  }
  const runtimeCollectorIds = new Set(nodeOps.runtimeCollectors.map((collector) => collector.id));
  if (operations.canManage) for (const collector of nodeOps.collectors.filter((item) => !runtimeCollectorIds.has(item.id))) {
    const edit = btn("Edit", "", () => showCollectorForm(wrap, collector, true));
    const del = btn("Remove", "del-btn", async () => removeCollectorWithConfirmation(collector));
    wrap.append(h("div", { class: "insp-item insp-definition insp-operation-item" },
      h("div", { class: "insp-item-row insp-operation-row" },
        h("span", { class: "insp-item-name", title: collector.name || collector.id }, collector.name || collector.id),
        h("span", { class: `insp-exec t-${collector.kind}` }, collectorLabel(collector))),
      h("div", { class: "insp-operation-footer" },
        h("div", { class: "insp-action-controls" }, edit, del))));
  }
  return wrap;
}

async function removeCollectorWithConfirmation(collector) {
  const refs = collectorActionReferences(collector.id);
  const warning = refs.length
    ? `This check is required by ${refs.length} named action(s). Removing it will also remove those actions. Continue?`
    : `Remove check “${collector.name || collector.id}”?`;
  if (!window.confirm(warning)) return;
  for (const action of refs) removeEditableAction(action.id);
  removeEditableCollector(collector.id);
  await saveEditableOperations();
}

function showCollectorChooser(wrap, nodeId) {
  wrap.querySelector(".insp-operation-form")?.remove();
  const choices = h("div", { class: "insp-add-choices insp-operation-form" });
  bus.emit("inspector:draft", { id: "operation-form", dirty: true });
  const types = [["http", "HTTP"], ["host.uptime", "SSH uptime"], ["service.status", "SSH service"]];
  const operations = getOperationsState();
  if (operations.customChecksEnabled) types.push(["custom", "Secure shell"]);
  if (operations.customChecksEnabled && operations.localChecksEnabled) types.push(["local", "Local shell"]);
  for (const [type, label] of types) choices.append(btn(label, "", () => {
    choices.remove();
    showCollectorForm(wrap, defaultCollector(nodeId, type), false);
  }));
  choices.append(btn("Cancel", "", () => {
    choices.remove();
    bus.emit("inspector:draft", { id: "operation-form", dirty: false });
  }));
  wrap.append(choices);
}

function collectorLabel(collector) {
  if (collector.kind === "http") return "HTTP";
  if (collector.kind === "local") return "LOCAL";
  if (collector.probe === "host.uptime") return "UPTIME";
  if (collector.probe === "service.status") return "SERVICE";
  return "SSH";
}

function actionLabel(action) {
  return action.kind === "shell.command" ? "LOCAL" : "SSH";
}

function relativeAge(timestamp) {
  const milliseconds = Number(timestamp) < 1e12 ? Number(timestamp) * 1000 : Number(timestamp);
  const seconds = Math.max(0, Math.round((Date.now() - milliseconds) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function showCollectorForm(wrap, source, editing) {
  wrap.querySelector(".insp-operation-form")?.remove();
  const draft = structuredClone(source);
  const form = h("form", { class: "insp-operation-form" });
  bus.emit("inspector:draft", { id: "operation-form", dirty: true });
  form.append(formField("ID", draft.id, (v) => { draft.id = v; }, { disabled: editing }),
    formField("Name", draft.name, (v) => { draft.name = v; }));
  if (draft.kind === "http") {
    form.append(formField("URL", draft.url, (v) => { draft.url = v; }),
      formField("Status", draft.status, (v) => { draft.status = v; }, { placeholder: "2xx" }),
      formField("jq predicate", draft.jq, (v) => { draft.jq = v; }));
  } else if (draft.probe === "service.status") {
    form.append(formField("Service", draft.service, (v) => { draft.service = v; }, { placeholder: "nginx.service" }));
  } else if (["ssh.command", "shell.command"].includes(draft.probe)) {
    const local = draft.probe === "shell.command";
    form.append(formField("Command", draft.command, (v) => { draft.command = v; }, {
      multiline: local,
      placeholder: local ? "curl -fsS https://service/health | jq -e '.status == \"ok\"'" : "",
    }));
    form.append(h("div", { class: "insp-custom-warning" },
      h("strong", {}, local ? "Local shell" : "Secure shell"),
      h("div", {}, local
        ? "Runs on this Reticle host with its OS permissions and environment. Use a dedicated, least-privilege account."
        : "Reticle cannot guarantee this command is read-only. Use a restricted, least-privilege SSH principal.")));
  }
  form.append(formField("Timeout (seconds)", draft.timeoutSeconds, (v) => { draft.timeoutSeconds = Number(v); }, { type: "number", min: 1, max: 120 }),
    checkboxField("Enabled", draft.enabled !== false, (v) => { draft.enabled = v; }));
  if (["ssh.command", "shell.command"].includes(draft.probe)) {
    form.append(checkboxField("Publish bounded output to viewers", draft.publishOutput === true, (v) => { draft.publishOutput = v; }));
  }
  appendFormActions(form, async (error) => {
    const errors = validateCollector(draft);
    if (errors.length) { error.textContent = errors.join(". "); return; }
    setEditableCollector(draft);
    if (await saveEditableOperations()) {
      bus.emit("inspector:draft", { id: "operation-form", dirty: false });
      form.remove();
      bus.emit("operations:refresh", {});
    }
  });
  wrap.append(form);
}

function showActionChooser(wrap, nodeId) {
  wrap.querySelector(".insp-operation-form")?.remove();
  const choices = h("div", { class: "insp-add-choices insp-operation-form" });
  bus.emit("inspector:draft", { id: "operation-form", dirty: true });
  const types = [["ssh.command", "Secure shell"]];
  if (getOperationsState().localChecksEnabled) {
    types.push(["shell.command", "Local shell"]);
  }
  for (const [kind, label] of types) choices.append(btn(label, "", () => {
    choices.remove();
    showActionForm(wrap, defaultAction(nodeId, undefined, kind), false);
  }));
  choices.append(btn("Cancel", "", () => {
    choices.remove();
    bus.emit("inspector:draft", { id: "operation-form", dirty: false });
  }));
  wrap.append(choices);
}

function showActionForm(wrap, source, editing) {
  wrap.querySelector(".insp-operation-form")?.remove();
  const draft = structuredClone(source);
  const local = draft.kind === "shell.command";
  const form = h("form", { class: "insp-operation-form" });
  bus.emit("inspector:draft", { id: "operation-form", dirty: true });
  form.append(formField("ID", draft.id, (v) => { draft.id = v; }, { disabled: editing }),
    formField("Name", draft.name, (v) => { draft.name = v; }),
    formField("Command", draft.command, (v) => { draft.command = v; }, {
      multiline: true,
      placeholder: local ? "curl -fsS https://service/health | jq -e '.status == \"ok\"'" : "",
    }),
    formField("Requires signal", draft.requiresSignal, (v) => { draft.requiresSignal = v; }),
    selectField("Requires state", draft.requiresState, ["", "unknown", "ok", "warn", "err"], (v) => { draft.requiresState = v; }),
    checkboxField("Requires approval", draft.requiresApproval !== false, (v) => { draft.requiresApproval = v; }),
    formField("Timeout (seconds)", draft.timeoutSeconds, (v) => { draft.timeoutSeconds = Number(v); }, { type: "number", min: 1, max: 120 }));
  form.append(h("div", { class: "insp-custom-warning" },
    h("strong", {}, local ? "Local shell" : "Secure shell"),
    h("div", {}, local
      ? "Runs on this Reticle host with its OS permissions and environment."
      : "Runs on the selected node through its configured SSH identity.")));
  appendFormActions(form, async (error) => {
    const errors = validateAction(draft);
    if (errors.length) { error.textContent = errors.join(". "); return; }
    setEditableAction(draft);
    if (await saveEditableOperations()) {
      bus.emit("inspector:draft", { id: "operation-form", dirty: false });
      form.remove();
      bus.emit("operations:refresh", {});
    }
  });
  wrap.append(form);
}

function appendFormActions(form, save) {
  const error = h("div", { class: "insp-form-error", role: "alert" });
  const cancel = btn("Cancel", "", () => {
    form.remove();
    bus.emit("inspector:draft", { id: "operation-form", dirty: false });
  });
  const submit = h("button", { class: "insp-btn", type: "submit" }, "Save operations");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    await save(error);
    submit.disabled = false;
  });
  form.append(error, h("div", { class: "insp-form-actions" }, cancel, submit));
}

function formField(label, value, update, options = {}) {
  const { multiline = false, ...attributes } = options;
  const tag = multiline ? "textarea" : "input";
  const input = h(tag, {
    class: "inspector-input",
    type: options.type || "text",
    autocapitalize: "none",
    autocorrect: "off",
    autocomplete: "off",
    spellcheck: "false",
    ...attributes,
  });
  input.value = value ?? "";
  input.addEventListener("input", () => update(input.value));
  input.addEventListener("keydown", (event) => event.stopPropagation());
  return h("label", { class: "insp-form-field" }, h("span", {}, label), input);
}

function checkboxField(label, value, update) {
  const input = h("input", { type: "checkbox" });
  input.checked = value;
  input.addEventListener("change", () => update(input.checked));
  return h("label", { class: "insp-check-field" }, input, h("span", {}, label));
}

function selectField(label, value, values, update) {
  const select = h("select", { class: "inspector-input" }, ...values.map((item) => h("option", { value: item }, item || "None")));
  select.value = value ?? "";
  select.addEventListener("change", () => update(select.value));
  return h("label", { class: "insp-form-field" }, h("span", {}, label), select);
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
    spellcheck: "false",
  });
  ta.value = n.notes || "";
  ta.disabled = api.isViewer;
  ta.addEventListener("change", () => updateNodeMeta(n.id, { notes: ta.value }));
  ta.addEventListener("keydown", (e) => e.stopPropagation());
  wrap.append(ta);
  return wrap;
}

/** Kind picker — stays within the node/group family so a server doesn't
 *  accidentally become a VPC (the renderer handles the swap if it does). */
function kindSelect(n, onChange) {
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
  sel.disabled = api.isViewer;
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function renderRunOutput(el, res, actionId = null) {
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
  close.addEventListener("click", () => {
    if (actionId) actionRuns.delete(actionId);
    clear(el);
    el.style.display = "none";
  });
  el.append(
    h("div", { class: "insp-output-head" }, badge, h("span", { class: "insp-output-spacer" }), copy, close),
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
      chip.disabled = api.isViewer;
      return chip;
    }),
  );

  const actions = h("div", { class: "inspector-actions" });
  if (!api.isViewer) actions.appendChild(btn("Delete", "del-btn", () => removeEdge(e.id)));

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

/** Create a field that either stages on input or commits on Enter/blur. */
function editableField(value, onCommit, placeholder = "", stageOnInput = false) {
  const el = h("input", {
    class: "inspector-input",
    type: "text",
    value: String(value || ""),
    placeholder,
    autocapitalize: "none",
    autocorrect: "off",
    autocomplete: "off",
    spellcheck: "false",
  });
  el.disabled = api.isViewer;
  el.addEventListener(stageOnInput ? "input" : "change", () => {
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
