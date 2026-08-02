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
import { graphToTopology, serializeTopology } from "./operationalGraph.js";
import {
  captureOperationsPersistedCandidate, getOperationsState, loadEditableOperations,
  recordOperationsPersistedState, recordOperationsRevision, recordRuntimeOperations,
  waitForOperationsSave,
} from "./operations.js";

const AUTOSAVE_MS = 800;
let activePersistence = null;

export async function flushPendingPersistence() {
  return activePersistence ? activePersistence.flush() : true;
}

export class Persistence {
  constructor() {
    this.saving = false;
    this.saveRequested = false;
    this.savePromise = null;
    this.mutationGeneration = 0;
    this.openDrafts = new Set();
    this.reloading = false;
    this.reloadPending = false;
    this.lastSaveAt = 0;
    this.configPath = null;
    this.failed = false;
    activePersistence = this;

    // Debounced autosave — coalesces rapid edits (drag, resize, type).
    this.scheduleSave = debounce(() => this.save(), AUTOSAVE_MS);

    // Listen for dirty signals from the store. canWrite is false for
    // mock mode AND daemon viewers (read-only role) — their local edits
    // are never persisted.
    bus.on("session:dirty", ({ dirty }) => {
      if (dirty && api.canWrite) {
        this.mutationGeneration += 1;
        this.scheduleSave();
      }
    });
    bus.on("inspector:draft", ({ id = "inspector", dirty }) => {
      if (dirty === true) this.openDrafts.add(id);
      else this.openDrafts.delete(id);
    });
    bus.on("session:save-now", () => this.save());
  }

  /** Called on boot. Loads config from disk (or mock) into the store. */
  async load(revision = null) {
    try {
      const raw = await api.getOperationalGraph();
      recordRuntimeOperations(raw);
      const topo = migrate(raw);
      replaceTopology(topo);
      await loadEditableOperations();
      api.acceptRevision(getOperationsState().baseRevision ?? revision);
      this.configPath = await api.getConfigPath().catch(() => null);
      api.acceptWorkspacePath(this.configPath);
      if (this.configPath) setFileName(this.configPath);
      bus.emit("persistence:loaded", { path: this.configPath });
      this.failed = false;
      return true;
    } catch (err) {
      console.error("[persistence] load failed:", err);
      bus.emit("persistence:load-error", { error: String(err) });
      this.failed = true;
      return false;
    }
  }

  /** Serializes the store to the on-disk shape and saves. */
  save() {
    if (!api.canWrite || this.failed) return Promise.resolve(false);
    if (!getState().session.dirty && !this.saveRequested) {
      return this.savePromise ?? Promise.resolve(true);
    }
    this.saveRequested = true;
    if (this.reloading) {
      return Promise.resolve(false);
    }
    if (this.savePromise) return this.savePromise;
    this.saving = true;
    this.savePromise = (async () => {
      while (this.saveRequested) {
        this.saveRequested = false;
        const state = getState();
        const doc = serializeTopology(state.topology);
        const operationsCandidate = captureOperationsPersistedCandidate();
        const generation = this.mutationGeneration;
        try {
          const result = await api.saveConfig(doc);
          recordOperationsRevision(result?.rev);
          recordOperationsPersistedState(operationsCandidate);
          this.lastSaveAt = Date.now();
          if (generation === this.mutationGeneration) {
            state.session.dirty = false;
            bus.emit("session:dirty", { dirty: false });
          } else {
            this.saveRequested = true;
          }
        } catch (err) {
          this.saveRequested = false;
          if (String(err).includes("stale save")) {
            console.warn("[persistence] save refused as stale; local draft preserved:", String(err));
            bus.emit("config:conflict", { error: String(err) });
          } else {
            console.error("[persistence] save failed:", err);
            bus.emit("persistence:load-error", { error: String(err) });
          }
          return false;
        }
      }
      return true;
    })().finally(() => {
      this.saving = false;
      this.savePromise = null;
    });
    return this.savePromise;
  }

  async flush() {
    if (this.failed || this.reloading) return false;
    if (getState().session.dirty || this.saveRequested) return this.save();
    return this.savePromise ? this.savePromise : true;
  }

  async prepareWorkspaceSwitch() {
    const refuseOpenDraft = () => {
      bus.emit("config:conflict", {
        error: "Save or discard the open Inspector draft before switching workspaces.",
      });
    };
    if (this.openDrafts.size > 0) {
      refuseOpenDraft();
      return false;
    }
    if (!await waitForOperationsSave()) return false;
    if (!await this.flush()) return false;
    if (this.openDrafts.size > 0) {
      refuseOpenDraft();
      return false;
    }
    return true;
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
    if (this.saving || getOperationsState().saving || getState().session.dirty || this.openDrafts.size > 0) {
      bus.emit("config:conflict", {
        error: "Configuration changed elsewhere while local edits are pending. Reload or export your draft before continuing.",
      });
      return;
    }
    this.reloadPending = payload?.rev ?? true;
    if (this.reloading) return;
    this.reloading = true;
    try {
      while (this.reloadPending !== false) {
        const revision = this.reloadPending === true ? null : this.reloadPending;
        this.reloadPending = false;
        if (!await this.load(revision)) {
          bus.emit("persistence:fatal", { error: "Could not reload the operational graph after its configuration changed." });
          break;
        }
      }
    } finally {
      this.reloading = false;
      if (this.saveRequested) queueMicrotask(() => this.save());
    }
  }
}

/** Convert a raw config JSON (v0 or v1) into our store topology shape. */
function migrate(raw) {
  if (!raw) return { version: 1, nodes: {}, edges: {} };

  // v1: nodes and edges are already maps
  if (raw.nodes && typeof raw.nodes === "object") {
    return graphToTopology(raw);
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
