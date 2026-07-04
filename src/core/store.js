// core/store.js
// Single source of truth for the whole app. Three slices:
//   - topology: persisted nodes/edges/positions (the doc)
//   - session:  runtime-only (selection, open shells, applyUiScale, theme)
//   - ui:       transient view state (busy flags, panel toggles)
//
// Node model (v1, taxonomy-aware):
//   Node = { id, kind, title, subtitle, x, y, w, h, parentId, spec, health,
//            actions?, crons? }
//   - parentId links to a group-kind node; moving the group also moves
//     its children.
//   - spec is opaque per-kind config (ssh host/port/user, kubeContext,
//     http url, etc.); only the matching module interprets it.
//
// Mutations all go through small action helpers and notify via the bus
// under `<domain>:<action>`. Renderer/panels subscribe; never import each
// other directly.

import { bus } from "./eventBus.js";
import { kindMeta, isGroupKind } from "../canvas/nodes/kinds.js";
import api from "./api.js";

/** Phase 3b: daemon viewers are read-only. The server enforces it; this
 *  store-level guard means NO UI path (drag, delete key, inspector field,
 *  some future feature) can even locally fork a viewer's document —
 *  their canvas is always exactly the shared truth. Selection, health,
 *  panels, and topology replacement (broadcast reloads) stay live. */
const readOnly = () => api.isViewer;

const initialTopology = () => ({
  version: 1,
  nodes: {},
  edges: {},
  groups: [], // ordering of group nodes for stable z-ordering
});

const initialState = () => ({
  topology: initialTopology(),
  session: {
    fileName: null,
    dirty: false,
    selected: new Set(),
    lastAppliedKind: "server", // double-click empty spawns this kind
  },
  ui: {
    busy: false,
    busyLabel: null,
    inspectorOpen: false,
    terminalOpen: false,
    lastHealthTick: null,
    snapToGrid: persistedBool("reticle-snap", true),          // nodes "click together" by default
    snapGrid: 20,
    naturalScroll: persistedBool("reticle-natural-scroll", true), // trackpad pan follows finger direction
  },
});

/** Read a persisted UI toggle; falls back when unset/unavailable. */
function persistedBool(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}
function persistBool(key, value) {
  try { localStorage.setItem(key, String(!!value)); } catch {}
}

let state = initialState();

/* ---- undo / redo ----
 * Snapshot the topology before each mutating action. We snapshot a deep
 * clone of {nodes, edges} (the persisted shape) — selection/ui/panels are
 * transient and not history-tracked.
 */
const history = { undo: [], redo: [], max: 100 };

function snapshot() {
  return {
    version: state.topology.version,
    nodes: JSON.parse(JSON.stringify(state.topology.nodes)),
    edges: JSON.parse(JSON.stringify(state.topology.edges)),
  };
}

function pushHistory() {
  history.undo.push(snapshot());
  if (history.undo.length > history.max) history.undo.shift();
  history.redo.length = 0;
}

export function undo() {
  if (readOnly()) return false;
  const prev = history.undo.pop();
  if (!prev) return false;
  history.redo.push(snapshot());
  state.topology = prev;
  state.session.selected.clear();
  bus.emit("topology:changed", { keys: ["nodes", "edges"] });
  bus.emit("selection:changed", { ids: [], mode: "clear" });
  markDirty();
  return true;
}

export function redo() {
  if (readOnly()) return false;
  const next = history.redo.pop();
  if (!next) return false;
  history.undo.push(snapshot());
  state.topology = next;
  state.session.selected.clear();
  bus.emit("topology:changed", { keys: ["nodes", "edges"] });
  bus.emit("selection:changed", { ids: [], mode: "clear" });
  markDirty();
  return true;
}

export const canUndo = () => history.undo.length > 0;
export const canRedo = () => history.redo.length > 0;
/** Push a history checkpoint before a multi-step mutation (e.g. drag). */
export { pushHistory };

/* ---- read ---- */
export const getState = () => state;
export const getTopology = () => state.topology;
export const getNode = (id) => state.topology.nodes[id] || null;
export const getEdge = (id) => state.topology.edges[id] || null;
export const getSelectedIds = () => [...state.session.selected];
export const getNodes = () => Object.values(state.topology.nodes);
export const getEdges = () => Object.values(state.topology.edges);
export const getChildren = (parentId) =>
  Object.values(state.topology.nodes).filter((n) => n.parentId === parentId);

/* ---- mutators: nodes ---- */
export function addNode(partial = {}) {
  if (readOnly()) return null;
  pushHistory();
  const id = partial.id ?? genId("n");
  const meta = kindMeta(partial.kind);
  // New nodes land ON the lattice when snap is enabled (palette drops,
  // double-click quick-add) — same firm grid the drag/resize snaps use.
  const snap = (v) =>
    state.ui.snapToGrid ? Math.round(v / state.ui.snapGrid) * state.ui.snapGrid : v;
  const node = {
    id,
    kind: partial.kind ?? "server",
    title: partial.title ?? meta.label,
    subtitle: partial.subtitle ?? "",
    x: snap(partial.x ?? 0),
    y: snap(partial.y ?? 0),
    w: partial.w ?? meta.size[0],
    h: partial.h ?? meta.size[1],
    parentId: partial.parentId ?? null,
    spec: partial.spec ?? defaultSpec(partial.kind ?? "server"),
    health: partial.health ?? { state: "unknown", lastCheck: null, detail: null },
    actions: partial.actions ?? starterActions(partial.kind ?? "server"),
    crons: partial.crons ?? [],
    notes: partial.notes ?? "",
    addons: partial.addons ?? [],
  };
  state.topology.nodes[id] = node;
  markDirty();
  bus.emit("node:added", { id });
  bus.emit("topology:changed", { keys: ["nodes"] });
  return node;
}

export function moveNode(id, x, y, opts = {}) {
  if (readOnly()) return;
  const n = state.topology.nodes[id];
  if (!n) return;
  // History is pushed by the caller (NodeDrag on drag:start, or
  // pushHistoryOnce before a programmatic move) — not on every frame.
  n.x = x;
  n.y = y;
  if (isGroupKind(n.kind)) {
    // propagate to children so group boundary and contents stay in sync
    for (const child of getChildren(id)) {
      child.x += opts.groupDx ?? 0;
      child.y += opts.groupDy ?? 0;
      bus.emit("node:moved", {
        id: child.id,
        x: child.x,
        y: child.y,
        w: child.w,
        h: child.h,
      });
    }
  }
  markDirty();
  bus.emit("node:moved", { id, x, y, w: n.w, h: n.h });
  bus.emit("topology:changed", { keys: ["nodes"] });
}

export function resizeNode(id, x, y, w, h) {
  if (readOnly()) return;
  const n = state.topology.nodes[id];
  if (!n) return;
  pushHistory();
  n.x = x; n.y = y; n.w = w; n.h = h;
  markDirty();
  bus.emit("node:resized", { id, x, y, w, h });
  bus.emit("topology:changed", { keys: ["nodes"] });
}

/**
 * Move a set of nodes by the same world delta. Group children that belong
 * to a moved group are *not* double-moved — `moveNode` already propagates
 * to its own children when called with the group delta.
 */
export function moveSelection(ids, dxWorld, dyWorld) {
  if (readOnly()) return;
  if (!dxWorld && !dyWorld) return;
  // Compute which ids are descendants of others in the set so we don't
  // double-apply. A node is a descendant of any moved group whose id also
  // appears in the set.
  const set = new Set(ids);
  const skip = new Set();
  for (const id of ids) {
    let cur = state.topology.nodes[id];
    while (cur) {
      if (cur.parentId && set.has(cur.parentId)) {
        skip.add(id);
        break;
      }
      cur = cur.parentId ? state.topology.nodes[cur.parentId] : null;
    }
  }
  for (const id of ids) {
    if (skip.has(id)) continue;
    const n = state.topology.nodes[id];
    if (!n) continue;
    moveNode(id, n.x + dxWorld, n.y + dyWorld, {
      groupDx: dxWorld,
      groupDy: dyWorld,
    });
  }
}

export function updateNodeMeta(id, patch) {
  if (readOnly()) return;
  const n = state.topology.nodes[id];
  if (!n) return;
  pushHistory();
  Object.assign(n, patch);
  markDirty();
  bus.emit("node:meta", { id });
  bus.emit("topology:changed", { keys: ["nodes"] });
}

export function setNodeSpec(id, spec) {
  if (readOnly()) return;
  const n = state.topology.nodes[id];
  if (!n) return;
  pushHistory();
  n.spec = { ...n.spec, ...spec };
  markDirty();
  bus.emit("node:meta", { id });
  bus.emit("topology:changed", { keys: ["nodes"] });
}

export function removeNode(id) {
  if (readOnly()) return;
  const n = state.topology.nodes[id];
  if (!n) return;
  pushHistory();
  // Orphan children (don't cascade-delete — that loses the user's work)
  for (const child of getChildren(id)) child.parentId = null;
  // Prune any edges that referenced this node; otherwise they dangle.
  const prunedEdges = [];
  for (const [eid, e] of Object.entries(state.topology.edges)) {
    if (e.from === id || e.to === id) {
      delete state.topology.edges[eid];
      prunedEdges.push(eid);
    }
  }
  delete state.topology.nodes[id];
  state.session.selected.delete(id);
  markDirty();
  bus.emit("node:removed", { id });
  for (const eid of prunedEdges) bus.emit("edge:removed", { id: eid });
  bus.emit("topology:changed", { keys: ["nodes", "edges"] });
}

export function setParent(childId, parentId) {
  if (readOnly()) return;
  const c = state.topology.nodes[childId];
  if (!c) return;
  if (parentId && !isGroupKind(state.topology.nodes[parentId]?.kind)) return;
  pushHistory();
  c.parentId = parentId;
  markDirty();
  bus.emit("node:meta", { id: childId });
  bus.emit("topology:changed", { keys: ["nodes"] });
}

export function setNodeHealth(id, health) {
  const n = state.topology.nodes[id];
  if (!n) return;
  n.health = health;
  state.ui.lastHealthTick = Date.now();
  bus.emit("health:tick", { id, health });
}

/* ---- mutators: edges ---- */
export function addEdge(partial = {}) {
  if (readOnly()) return null;
  pushHistory();
  const id = partial.id ?? genId("e");
  const edge = {
    id,
    kind: partial.kind ?? "tcp",
    label: partial.label ?? "",
    port: partial.port ?? null,
    from: partial.from,
    to: partial.to,
  };
  state.topology.edges[id] = edge;
  markDirty();
  bus.emit("edge:added", { id });
  bus.emit("topology:changed", { keys: ["edges"] });
  return edge;
}

export function updateEdge(id, patch) {
  if (readOnly()) return;
  const e = state.topology.edges[id];
  if (!e) return;
  pushHistory();
  Object.assign(e, patch);
  markDirty();
  bus.emit("edge:meta", { id });
  bus.emit("topology:changed", { keys: ["edges"] });
}

export function removeEdge(id) {
  if (readOnly()) return;
  if (!state.topology.edges[id]) return;
  pushHistory();
  delete state.topology.edges[id];
  state.session.selected.delete(id);
  markDirty();
  bus.emit("edge:removed", { id });
  bus.emit("topology:changed", { keys: ["edges"] });
}

/* ---- selection ---- */
export function select(ids, mode = "replace") {
  const set = state.session.selected;
  if (mode === "replace") {
    set.clear();
    for (const id of ids) set.add(id);
  } else if (mode === "toggle") {
    for (const id of ids) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
  } else if (mode === "add") {
    for (const id of ids) set.add(id);
  } else if (mode === "clear") {
    set.clear();
  }
  bus.emit("selection:changed", { ids: getSelectedIds(), mode });
}

/* ---- file/session ---- */
export function replaceTopology(topo) {
  state.topology = {
    version: topo?.version ?? 1,
    nodes: normalizeNodes(topo?.nodes ?? {}),
    edges: normalizeEdges(topo?.edges ?? {}),
  };
  state.session.dirty = false;
  bus.emit("selection:changed", { ids: getSelectedIds(), mode: "clear" });
  bus.emit("topology:changed", { keys: ["nodes", "edges"] });
  bus.emit("session:dirty", { dirty: false });
}

export function setFileName(name) {
  state.session.fileName = name;
  bus.emit("session:loaded", { fileName: name });
}

export function setLastAppliedKind(kind) {
  state.session.lastAppliedKind = kind;
}

export const getLastAppliedKind = () => state.session.lastAppliedKind;

/* ---- ui ---- */
export function setBusy(busy, label = null) {
  state.ui.busy = !!busy;
  state.ui.busyLabel = busy ? label : null;
  bus.emit("ui:busy", { busy: !!busy, label });
}
export function setPanels({ inspector, terminal } = {}) {
  if (inspector !== undefined) state.ui.inspectorOpen = !!inspector;
  if (terminal !== undefined) state.ui.terminalOpen = !!terminal;
  bus.emit("ui:panel", {
    inspector: state.ui.inspectorOpen,
    terminal: state.ui.terminalOpen,
  });
}
export function setSnapToGrid(on) {
  state.ui.snapToGrid = !!on;
  persistBool("reticle-snap", state.ui.snapToGrid);
  bus.emit("ui:snap", { on: state.ui.snapToGrid });
}
export const isSnapToGrid = () => state.ui.snapToGrid;
export const getSnapGrid = () => state.ui.snapGrid;
export function toggleSnapToGrid() {
  setSnapToGrid(!state.ui.snapToGrid);
  return state.ui.snapToGrid;
}
export const isNaturalScroll = () => state.ui.naturalScroll;
export function setNaturalScroll(on) {
  state.ui.naturalScroll = !!on;
  persistBool("reticle-natural-scroll", state.ui.naturalScroll);
  bus.emit("ui:natural-scroll", { on: state.ui.naturalScroll });
}
export function toggleNaturalScroll() {
  setNaturalScroll(!state.ui.naturalScroll);
  return state.ui.naturalScroll;
}

/* ---- internal ---- */
function markDirty() {
  if (!state.session.dirty) {
    state.session.dirty = true;
    bus.emit("session:dirty", { dirty: true });
  }
}
function genId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now()
    .toString(36)
    .slice(-3)}`;
}

/** Migrate v0 server-shape entries into the taxonomy model on load. */
function normalizeNodes(raw) {
  const out = {};
  for (const [id, n] of Object.entries(raw)) {
    out[id] = { ...n, id };
    if (!n.kind) out[id].kind = "server";
    if (n.w == null) out[id].w = kindMeta(out[id].kind).size[0];
    if (n.h == null) out[id].h = kindMeta(out[id].kind).size[1];
    if (n.spec == null) out[id].spec = defaultSpec(out[id].kind);
    if (n.actions == null) out[id].actions = starterActions(out[id].kind);
    if (n.crons == null) out[id].crons = [];
    if (n.health == null) out[id].health = { state: "unknown", lastCheck: null, detail: null };
    if (n.parentId == null) out[id].parentId = null;
    delete out[id].lat;
    delete out[id].lng;
  }
  return out;
}

function normalizeEdges(raw) {
  const out = {};
  for (const [id, e] of Object.entries(raw)) {
    out[id] = { ...e, id };
    if (!e.kind) out[id].kind = "tcp";
    if (e.label == null) out[id].label = "";
  }
  return out;
}

function defaultSpec(kind) {
  const meta = kindMeta(kind);
  if (!meta.modes.includes("ssh")) {
    if (meta.modes.includes("kubectl"))
      return { kubeContext: "", namespace: "", kind, name: "" };
    return {};
  }
  return { host: "", port: 22, user: "" };
}

function starterActions(kind) {
  const meta = kindMeta(kind);
  return (meta.actions || []).slice(0, 2).map((script, i) => ({
    name: script.split(" ")[0] + (i > 0 ? `_${i + 1}` : ""),
    script,
  }));
}