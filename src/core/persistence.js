// core/persistence.js
// Bridges the in-memory store and the on-disk YAML config.
//   - load on boot: api.loadConfig() → normalize → replaceTopology()
//   - autosave: debounced after each `session:dirty` event → api.saveConfig()
//   - external edits: listen for `config-changed` → reload (but skip if
//     we just saved, to avoid a reload loop)
//
// The conversion between our store shape ({nodes: map, edges: map}) and
// the on-disk shape ({nodes: map, edges: map, groups, layers}) is mostly
// 1:1 in v1. v0 files (servers: []) are migrated on load.

import { bus } from "./eventBus.js";
import {
  getState, replaceTopology, setFileName,
} from "./store.js";
import api from "./api.js";
import { debounce } from "./dom.js";

const AUTOSAVE_MS = 800;

export class Persistence {
  constructor() {
    this.saving = false;
    this.lastSaveAt = 0;
    this.configPath = null;

    // Debounced autosave — coalesces rapid edits (drag, resize, type).
    this.scheduleSave = debounce(() => this.save(), AUTOSAVE_MS);

    // Listen for dirty signals from the store. canWrite is false for
    // mock mode AND daemon viewers (read-only role) — their local edits
    // are never persisted.
    bus.on("session:dirty", ({ dirty }) => {
      if (dirty && api.canWrite) this.scheduleSave();
    });
  }

  /** Called on boot. Loads config from disk (or mock) into the store. */
  async load() {
    try {
      const raw = await api.loadConfig();
      const topo = migrate(raw);
      replaceTopology(topo);
      this.configPath = await api.getConfigPath().catch(() => null);
      if (this.configPath) setFileName(this.configPath);
      bus.emit("persistence:loaded", { path: this.configPath });
    } catch (err) {
      console.error("[persistence] load failed:", err);
      bus.emit("persistence:load-error", { error: String(err) });
    }
  }

  /** Serializes the store to the on-disk shape and saves. */
  async save() {
    if (!api.canWrite) return;
    const state = getState();
    const doc = serialize(state.topology);
    this.saving = true;
    try {
      await api.saveConfig(doc);
      this.lastSaveAt = Date.now();
      // Clear dirty flag since we just persisted.
      state.session.dirty = false;
      bus.emit("session:dirty", { dirty: false });
    } catch (err) {
      if (String(err).includes("stale save")) {
        // Someone else saved since we loaded (phase 3a optimistic
        // concurrency). Converge on their version; our conflicting edit
        // is dropped — rare on a small team, and the honest option.
        console.warn("[persistence] save refused as stale — reloading:", String(err));
        bus.emit("config:conflict", { error: String(err) });
        await this.load();
        return;
      }
      console.error("[persistence] save failed:", err);
    } finally {
      this.saving = false;
    }
  }

  /** Called when the backend emits `config-changed`.
   *  Daemon payloads carry { rev, origin }: origin === our connId means
   *  it's the broadcast of OUR OWN save — the store already holds that
   *  state, skip the pointless (and health-wiping) reload. Desktop
   *  payloads are null; there the watcher fires on our writes too, so
   *  keep the time-window heuristic. */
  async reloadFromDisk(payload = null) {
    if (payload && payload.origin != null && payload.origin === api.connId) return;
    if (!payload && Date.now() - this.lastSaveAt < 1500) return;
    await this.load();
  }
}

/** Convert a raw config JSON (v0 or v1) into our store topology shape. */
function migrate(raw) {
  if (!raw) return { version: 1, nodes: {}, edges: {} };

  // v1: nodes and edges are already maps
  if (raw.nodes && typeof raw.nodes === "object") {
    return {
      version: raw.version ?? 1,
      nodes: raw.nodes,
      edges: raw.edges ?? {},
    };
  }

  // v0: servers array → migrate to nodes map
  if (raw.servers && Array.isArray(raw.servers)) {
    const nodes = {};
    for (const s of raw.servers) {
      const id = s.name || `n_${Math.random().toString(36).slice(2, 8)}`;
      nodes[id] = {
        id,
        kind: "server",
        title: s.name || "server",
        subtitle: s.subtitle || "",
        x: s.x ?? 0,
        y: s.y ?? 0,
        w: s.w ?? 220,
        h: s.h ?? 120,
        parentId: s.group || null,
        spec: {
          host: s.host || "",
          port: s.port ?? 22,
          user: s.user || "",
        },
        health: { state: "unknown", lastCheck: null, detail: null },
        actions: s.actions || [],
        crons: s.crons || [],
      };
    }
    return { version: 1, nodes, edges: raw.edges ?? {} };
  }

  return { version: 1, nodes: {}, edges: {} };
}

/** Convert the store topology to the on-disk shape. */
function serialize(topology) {
  return {
    version: topology.version || 1,
    nodes: topology.nodes,
    edges: topology.edges,
    groups: [],
    layers: [],
  };
}