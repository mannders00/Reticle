// core/ops.js
// Bridges the store's node model and the Rust backend's SSH/kubectl
// command surface. Each method maps a node's `spec` to the right backend
// call, updates the store with results, and emits bus events so the UI
// can react (health pills change, action output streams, terminals open).
//
// In preview mode (no Tauri), calls are mocked so the UI is still
// explorable without a backend.

import { bus } from "./eventBus.js";
import { getState, setNodeHealth } from "./store.js";
import { kindMeta } from "../canvas/nodes/kinds.js";
import api from "./api.js";

/* ---- combined health model (worst wins) ----
 * Independent signals per node:
 *   - TCP probe (30s poller / explicit Check)
 *   - HTTP probe (status code + optional jq over the body)
 *   - cron results streamed from the backend scheduler
 * A node is err if any signal fails; ok when the signals we have are good;
 * unknown with no signal at all. This is what makes the map "alive": a
 * failing `systemctl is-active nginx` cron — or a 503 on /healthz — turns
 * the node red even though port 22 still answers.
 */
const tcpState = new Map();  // nodeId → boolean
const cronState = new Map(); // nodeId → Map<cronName, {success, timestamp, exit_code?}>

function combinedHealth(nodeId) {
  const tcp = tcpState.get(nodeId);
  // Only results for crons that STILL EXIST on the node count — deleting
  // (or renaming) a failing check must let the node recover instead of
  // being haunted by its last result. Incomplete crons (empty url/script —
  // still being filled in) don't count either: the scheduler skips them,
  // and an old failure from before they were emptied must not linger.
  const complete = (c) => (c.exec === "http" ? (c.url ?? "").trim() : (c.script ?? "").trim()) !== "";
  const names = new Set((getState().topology.nodes[nodeId]?.crons ?? []).filter(complete).map((c) => c.name));
  const crons = cronState.get(nodeId);
  const live = crons ? [...crons.entries()].filter(([name]) => names.has(name)) : [];
  const failing = live.filter(([, r]) => !r.success);
  if (failing.length) {
    return { state: "err", detail: `check '${failing[0][0]}' failing` };
  }
  if (tcp === false) return { state: "err", detail: "tcp unreachable" };
  if (tcp === true) return { state: "ok", detail: "tcp ok" };
  if (live.length) return { state: "ok", detail: "checks ok" };
  return { state: "unknown", detail: "no signal" };
}

function applyCombined(nodeId) {
  if (!getState().topology.nodes[nodeId]) return;
  setNodeHealth(nodeId, { ...combinedHealth(nodeId), lastCheck: Date.now() });
}

/** Latest scheduled-run result per cron for a node (name → result). */
export const getCronResults = (nodeId) => cronState.get(nodeId);

/**
 * Wire cron results from the backend scheduler into node health and the
 * bus (`cron:result`). Also seeds last-run info from get_cron_status so
 * a freshly opened client shows history the scheduler already has.
 */
export function initCronHealth() {
  api.onCronResult((p) => {
    const m = cronState.get(p.server) ?? new Map();
    m.set(p.cron, { success: p.success, timestamp: p.timestamp, exit_code: p.exit_code });
    cronState.set(p.server, m);
    applyCombined(p.server);
    bus.emit("cron:result", p);
  });
  // Daemon-side TCP probes (phase 3c): the server sweeps every node from
  // ITS network vantage and broadcasts — viewers get real health without
  // probing anything themselves.
  api.onHealthResult((p) => {
    tcpState.set(p.server, !!p.ok);
    // applyCombined → setNodeHealth already emits health:tick WITH the
    // health payload. Do NOT emit a second bare {id} tick here — the
    // Renderer destructures `health` from the event and would write
    // undefined straight onto the shared store node.
    applyCombined(p.server);
  });
  // Editing a node (e.g. deleting a failing cron) re-evaluates its health
  // immediately — but only for nodes we actually have signals for.
  bus.on("node:meta", ({ id }) => {
    if (cronState.has(id) || tcpState.has(id)) applyCombined(id);
  });
  // A reload (another editor saved, external vim edit) replaces the
  // topology and wipes per-node health — re-apply everything we know
  // instead of showing a sea of gray until the next probe/cron tick.
  bus.on("persistence:loaded", () => {
    for (const id of new Set([...cronState.keys(), ...tcpState.keys()])) {
      if (getState().topology.nodes[id]) applyCombined(id);
    }
  });
  refreshCronStatus();
}

export async function refreshCronStatus() {
  if (!api.ready) return;
  try {
    const status = await api.getCronStatus();
    for (const s of status) {
      if (s.last_run == null) continue;
      const m = cronState.get(s.server) ?? new Map();
      if (!m.has(s.name)) {
        m.set(s.name, { success: s.last_success, timestamp: s.last_run, exit_code: s.last_exit_code });
        cronState.set(s.server, m);
        applyCombined(s.server);
      }
    }
    bus.emit("cron:status", {});
  } catch {
    /* backend without scheduler info — fine */
  }
}

/**
 * Run a TCP health check against a node's spec.host:spec.port.
 * Updates the node's health state and emits `health:tick`.
 */
export async function checkHealth(nodeId) {
  const node = getState().topology.nodes[nodeId];
  if (!node) return;

  // Set checking state immediately
  setNodeHealth(nodeId, { state: "warn", lastCheck: Date.now(), detail: "checking" });

  try {
    if (!api.ready) {
      // Mock: simulate a delay then "unknown"
      await sleep(300);
      setNodeHealth(nodeId, { state: "unknown", lastCheck: Date.now(), detail: "preview" });
      return;
    }

    // The browser poller only does the cheap TCP probe for instant
    // feedback; ssh / local / http checks are crons run by the backend
    // scheduler and streamed back as cron-results (see initCronHealth).
    let probed = false;
    if (node.spec?.host && node.spec?.port) {
      tcpState.set(nodeId, await api.healthCheck(node.spec.host, node.spec.port));
      probed = true;
    }
    if (probed || cronState.get(nodeId)?.size) {
      applyCombined(nodeId);
    } else {
      setNodeHealth(nodeId, { state: "unknown", lastCheck: Date.now(), detail: "no endpoint" });
    }
  } catch (err) {
    setNodeHealth(nodeId, { state: "err", lastCheck: Date.now(), detail: String(err) });
  }
}

/**
 * Run all health checks for every node that has an SSH/TCP endpoint.
 * Called on a 30s interval by the HealthPoller.
 */
export async function checkAll() {
  const nodes = Object.values(getState().topology.nodes);
  const promises = nodes
    .filter((n) => n.spec?.host && n.spec?.port)
    .map((n) => checkHealth(n.id));
  await Promise.allSettled(promises);
}

/**
 * Run a named action (bash script) on a node via SSH.
 * Returns { success, exitCode, stdout, stderr }.
 */
export async function runAction(nodeId, actionName) {
  const node = getState().topology.nodes[nodeId];
  const action = node?.actions?.find((a) => a.name === actionName);
  if (!action) return null;
  return runItem(node, action);
}

/**
 * Run a cron immediately (ad-hoc, not on schedule).
 */
export async function runCronNow(nodeId, cronName) {
  const node = getState().topology.nodes[nodeId];
  const cron = node?.crons?.find((c) => c.name === cronName);
  if (!cron) return null;
  return runItem(node, cron);
}

/** Node-level default target (legacy spec.local / spec.exec). */
export function isLocalExec(node) {
  return node?.spec?.local === true || node?.spec?.exec === "local";
}

/** Effective execution type for an action/cron: the item's own `exec`
 *  wins; otherwise the node default (local when spec says so, ssh when a
 *  host exists, local as the last resort). */
export function effectiveExec(node, item) {
  if (item?.exec === "http" || item?.exec === "local" || item?.exec === "ssh") return item.exec;
  if (item?.url) return "http";
  if (isLocalExec(node)) return "local";
  return node?.spec?.host ? "ssh" : "local";
}

/**
 * Run one action/cron item — over SSH, locally on the daemon/desktop
 * host, or as an HTTP check — honoring the node's optional interpreter.
 * Returns { success, exitCode, stdout, stderr }.
 */
async function runItem(node, item) {
  if (!node) return null;
  const exec = effectiveExec(node, item);
  const interp = node.spec?.interpreter || undefined;

  if (!api.ready) {
    const where = exec === "http" ? (item.url || "url") : exec === "local" ? "this host" : (node.spec?.host || "host");
    const what = exec === "http" ? `GET ${item.url || "…"}` : `$ ${item.script}`;
    return { success: true, exitCode: 0, stdout: `[preview] Would run on ${where}:\n${what}\n(output simulated)`, stderr: "" };
  }

  try {
    if (exec === "http") {
      const r = await api.httpCheck(item.url || "", item.status ?? "", item.jq ?? "");
      return {
        success: !!r?.ok,
        exitCode: r?.ok ? 0 : 1,
        stdout: `GET ${item.url}\n${r?.detail ?? "?"}`,
        stderr: "",
      };
    }
    const result = exec === "local"
      ? await api.runLocal(item.script || "", interp)
      : await api.runAction(node.spec?.host, node.spec?.port ?? 22, node.spec?.user ?? "", item.script || "", interp);
    return { success: result.success, exitCode: result.exit_code, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    return { success: false, exitCode: -1, stdout: "", stderr: String(err) };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}