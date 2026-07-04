// core/api.js
// Transport abstraction. Every call to the backend goes through here.
// Exactly one transport is picked at boot (see DAEMON.md §4):
//   1. window.__TAURI__ present            → "tauri"  (desktop)
//   2. ws(s)://<host>/ws answers + accepts → "ws"     (reticle-daemon)
//   3. otherwise                           → "mock"   (static browser demo)
// The rest of the app only sees the same async method surface.

import { bus } from "./eventBus.js";

const tauri = window.__TAURI__ || null;
const hasTauri = !!tauri?.core?.invoke;
export { hasTauri };

let transport = hasTauri ? "tauri" : null; // resolved async below
let role = "editor";                        // ws mode may say "viewer"
let connId = null;                          // ws: our id, tags our own saves
let rev = 0;                                // ws: config revision we hold
let deniedReason = null;                    // set when a daemon REFUSED us
let socket = null;
let nextId = 0;
const pending = new Map();     // id → {resolve, reject}
const wsHandlers = new Map();  // event name → Set<handler>
// Events that arrive before anyone listens (the daemon seeds health/cron
// caches right after hello, while the app is still booting) are buffered
// and replayed to the first listener instead of being dropped.
const earlyEvents = [];
const EARLY_MAX = 200;

const transportReady = (async () => {
  if (hasTauri) return (transport = "tauri");
  try {
    socket = await connectWs();
    return (transport = "ws");
  } catch (err) {
    if (String(err?.message).includes("denied")) {
      // A daemon EXISTS and refused us (bad/stale/missing token).
      // Do NOT fall back to mock — showing the fake demo seed on a
      // refused connection reads as data loss. The boot path renders
      // an access gate instead (main.js).
      console.error("[api] daemon refused the connection:", err.message);
      deniedReason = String(err.message).replace(/^denied:\s*/, "").trim()
        || "invalid or missing token";
      return (transport = "denied");
    }
    return (transport = "mock"); // no daemon at all → browser demo
  }
})();

/** Token from ?token=… (persisted) or localStorage — see DAEMON.md §3. */
function wsToken() {
  try {
    const qp = new URL(location.href).searchParams.get("token");
    if (qp) localStorage.setItem("reticle-token", qp);
    return qp || localStorage.getItem("reticle-token") || "";
  } catch {
    return "";
  }
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const token = wsToken();
    let s;
    try {
      s = new WebSocket(`${proto}://${location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`);
    } catch (e) {
      return reject(e);
    }
    const fail = (e) => { clearTimeout(timer); try { s.close(); } catch {} reject(e); };
    const timer = setTimeout(() => fail(new Error("ws timeout")), 2500);
    s.onerror = () => fail(new Error("ws failed"));
    s.onmessage = (ev) => {
      // First frame is always the `hello` event carrying our role.
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg?.event !== "hello") return;
      clearTimeout(timer);
      if (msg.payload?.role === "denied") return fail(new Error("denied: " + (msg.payload.reason || "")));
      role = msg.payload?.role || "editor";
      connId = msg.payload?.connId ?? null;
      rev = msg.payload?.rev ?? 0;
      console.info(`[api] daemon transport up (role: ${role})`);
      wireWs(s);
      bus.emit("api:hello", msg.payload);
      resolve(s);
    };
  });
}

function wireWs(s) {
  s.onmessage = (ev) => {
    if (typeof ev.data !== "string") return; // binary = PTY frames (phase 2)
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "reply") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok === false) p.reject(new Error(msg.error || "daemon error"));
      else p.resolve(msg.result);
    } else if (msg.type === "event") {
      // Track the config revision from every broadcast so a later save
      // carries the freshest baseRev even if persistence skipped a reload.
      if (msg.event === "config-changed" && msg.payload?.rev) rev = msg.payload.rev;
      const handlers = wsHandlers.get(msg.event);
      if (handlers?.size) {
        for (const h of handlers) h({ payload: msg.payload });
      } else {
        earlyEvents.push({ event: msg.event, payload: msg.payload });
        if (earlyEvents.length > EARLY_MAX) earlyEvents.shift();
      }
    }
  };
  s.onclose = () => {
    for (const [, p] of pending) p.reject(new Error("daemon connection closed"));
    pending.clear();
    console.warn("[api] daemon connection closed — reload to reconnect");
    // Surface it — a daemon restart must not leave a silently-stale page.
    bus.emit("api:closed", {});
  };
}

async function invoke(cmd, args = {}) {
  const t = transport ?? (await transportReady);
  if (t === "tauri") return tauri.core.invoke(cmd, args);
  if (t === "ws") {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, cmd, args }));
    });
  }
  return mock(cmd, args);
}

async function listen(event, handler) {
  const t = transport ?? (await transportReady);
  if (t === "tauri") {
    if (!tauri?.event?.listen) return () => {};
    return tauri.event.listen(event, handler);
  }
  if (t === "ws") {
    if (!wsHandlers.has(event)) wsHandlers.set(event, new Set());
    wsHandlers.get(event).add(handler);
    // Replay anything this event name received before we had a listener.
    for (let i = 0; i < earlyEvents.length; i++) {
      if (earlyEvents[i].event === event) {
        handler({ payload: earlyEvents[i].payload });
        earlyEvents.splice(i--, 1);
      }
    }
    return () => wsHandlers.get(event)?.delete(handler);
  }
  return () => {};
}

export const api = {
  /** True when a real backend (tauri or daemon) is connected. */
  get ready() { return transport === "tauri" || transport === "ws"; },
  /** False for daemon viewers — persistence must not autosave. */
  get canWrite() { return this.ready && role !== "viewer"; },
  /** True ONLY for daemon viewers (read-only role). Mock mode is NOT a
   *  viewer — the browser demo edits locally, it just never persists. */
  get isViewer() { return transport === "ws" && role === "viewer"; },
  get transport() { return transport; },
  get role() { return role; },
  /** Why the daemon refused us (transport === "denied" only). */
  get deniedReason() { return deniedReason; },
  /** Await this to know which transport was picked. */
  whenReady() { return transportReady; },
  hasTauri,

  async ping() { return invoke("reticle_ping"); },

  /** Our ws connection id (null on tauri/mock) — used to recognize our
   *  own config-changed broadcasts and skip the self-reload. */
  get connId() { return connId; },

  /* ---- config IO ---- */
  async loadConfig() { return invoke("load_config"); },
  async saveConfig(config) {
    const t = transport ?? (await transportReady);
    if (t !== "ws") return invoke("save_config", { config });
    // Daemon: optimistic concurrency — send the rev we hold; a stale
    // save is refused and persistence reloads (see DAEMON.md phase 3).
    const result = await invoke("save_config", { config, baseRev: rev });
    if (result?.rev) rev = result.rev;
    return result;
  },
  async getConfigPath() { return invoke("get_config_path"); },
  async getCronStatus() { return invoke("get_cron_status"); },
  async removeCronResults(server) { return invoke("remove_cron_results", { server }); },

  /* ---- health + actions ---- */
  async healthCheck(host, port) { return invoke("health_check", { host, port }); },
  async httpCheck(url, status, jq) { return invoke("http_check", { url, status, jq }); },
  async runAction(host, port, user, script, interpreter) {
    return invoke("run_action", { host, port, user, script, interpreter });
  },
  async runLocal(script, interpreter) { return invoke("run_local", { script, interpreter }); },

  /* ---- terminal (SSH) ---- */
  async openShell(serverName, host, port, user, cols, rows) {
    return invoke("open_shell", { serverName, host, port, user, cols, rows });
  },
  async writeShell(serverName, data) { return invoke("write_shell", { serverName, data }); },
  async resizeShell(serverName, cols, rows) { return invoke("resize_shell", { serverName, cols, rows }); },
  async closeShell(serverName) { return invoke("close_shell", { serverName }); },

  /* ---- kubectl ---- */
  async openKubectlShell(sessionId, context, namespace, pod, container, cols, rows) {
    return invoke("open_kubectl_shell", { sessionId, context, namespace, pod, container, cols, rows });
  },
  async listPods(context, namespace, selector) { return invoke("list_pods", { context, namespace, selector }); },

  /* ---- workspaces ---- */
  async listWorkspaces() { return invoke("list_workspaces"); },
  async switchWorkspace(path) { return invoke("switch_workspace", { path }); },
  async deleteWorkspace(path) { return invoke("delete_workspace", { path }); },
  /** Copy a file (e.g. a bundled sample) to dest, returns dest path. */
  async importWorkspaceFile(srcPath, destPath) { return invoke("import_workspace_file", { srcPath, destPath }); },
  async pickWorkspaceFile() {
    try {
      const result = await tauri.core.invoke("plugin:dialog|open", {
        options: {
          title: "Open topology YAML",
          filters: [{ name: "YAML", extensions: ["yaml", "yml"] }],
          multiple: false,
          directory: false,
        },
      });
      return result || null;
    } catch (err) {
      console.error("[api] file picker failed:", err);
      return null;
    }
  },

  /* ---- export ---- */
  /** Open the native save dialog (Tauri only). Returns path or null. */
  async pickSavePath(defaultName, filters) {
    if (!hasTauri) return null;
    try {
      return await tauri.core.invoke("plugin:dialog|save", {
        options: { defaultPath: defaultName, filters },
      });
    } catch (err) {
      console.error("[api] save dialog failed:", err);
      return null;
    }
  },
  /** Write export bytes (number[]) to a path on disk. */
  async saveExportFile(path, bytes) { return invoke("save_export_file", { path, bytes }); },

  /* ---- events ---- */
  onCronResult(handler) { return listen("cron-result", (e) => handler(e.payload)); },
  /** Daemon-side TCP probe results (phase 3c, ws transport only). */
  onHealthResult(handler) { return listen("health-result", (e) => handler(e.payload)); },
  onConfigChanged(handler) { return listen("config-changed", (e) => handler(e?.payload ?? null)); },
  async listenShell(nodeId, handler) {
    return listen(`shell-output-${nodeId}`, (e) => handler(e.payload));
  },
};

export default api;

/* -------- minimal mock for browser testing (not for production) -------- */
const mockState = { workspace: "config" };
const sampleCache = {};

async function loadSampleData(name) {
  if (sampleCache[name]) return sampleCache[name];
  try {
    const res = await fetch(`/samples/${name}.yaml`);
    const text = await res.text();
    const { load } = await import("js-yaml");
    const data = load(text);
    sampleCache[name] = data;
    return data;
  } catch {
    return { nodes: {}, edges: {}, groups: [], layers: [] };
  }
}

async function mock(cmd, args) {
  switch (cmd) {
    case "reticle_ping": return "ok";
    case "load_config": {
      const name = mockState.workspace || "config";
      if (name === "config") return { nodes: {}, edges: {}, groups: [], layers: [] };
      return await loadSampleData(name);
    }
    case "save_config": return null;
    case "save_export_file": return null;
    case "get_config_path": return "(browser)";
    case "get_cron_status": return [];
    case "remove_cron_results": return null;
    case "health_check": return false;
    case "http_check": return { ok: false, status: null, detail: "preview" };
    case "run_action":
    case "run_local":
      return { success: true, exit_code: 0, stdout: "[mock] " + args.script, stderr: "" };
    case "list_pods": return ["pod-aaa", "pod-bbb", "pod-ccc"];
    case "import_workspace_file": return args.destPath || args.srcPath || null;
    case "list_workspaces": {
      // Mock (browser demo): samples only, all read-only templates.
      const samples = ["homelab-pi", "homelab-k8s", "enterprise-aws", "enterprise-gcp", "enterprise-onprem", "aws-mine"];
      const current = mockState.workspace || "config";
      return samples.map((name) => ({
        name, path: `(mock)/${name}.yaml`, sample: true, exists: true,
        active: name === current,
      }));
    }
    case "switch_workspace":
      mockState.workspace = args.path?.split("/")?.pop()?.replace(".yaml", "") || "config";
      return null;
    case "delete_workspace": return null;
    default: return null;
  }
}