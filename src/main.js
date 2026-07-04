// main.js — Reticle bootstrap.
// Wires the layered architecture:
//   layers: Transport(api) → store → controllers (Toolbar/Inspector/StatusBar)
//           and the canvas (World + Camera + Grid + Interaction + Renderer
//                              + Palette + NodeView/GroupView)
//   events: EventBus is the only cross-module communication channel.
//
// The body of main.js stays *thin*: new modules register themselves via
// bus subscriptions rather than being imported here (unless they are
// top-level mounters).

import { World } from "./canvas/World.js";
import { Palette } from "./canvas/Palette.js";
import { NodeDrag } from "./canvas/NodeDrag.js";
import { ResizeDrag } from "./canvas/ResizeDrag.js";
import { Connection } from "./canvas/Connection.js";
import { Persistence } from "./core/persistence.js";
import { applyTheme, getTheme } from "./core/theme.js";
import { checkAll, initCronHealth } from "./core/ops.js";

// UI scale — zooms the entire app (not just the canvas) for accessibility.
// Persisted to localStorage.
function getUiScale() {
  return parseFloat(localStorage.getItem("reticle-ui-scale")) || 1;
}
function setUiScale(scale) {
  localStorage.setItem("reticle-ui-scale", String(scale));
  const app = document.getElementById("app");
  app.style.transform = `scale(${scale})`;
  app.style.transformOrigin = "0 0";
  app.style.width = `${100 / scale}%`;
  app.style.height = `${100 / scale}%`;
}

// Re-add seedDemo for browser testing
function seedDemo() {
  const a = addNode({ kind: "server", title: "web-01", subtitle: "10.0.1.4", x: 80, y: 80, spec: { host: "10.0.1.4", port: 22, user: "deploy" } });
  const b = addNode({ kind: "server", title: "web-02", subtitle: "10.0.1.5", x: 360, y: 80, spec: { host: "10.0.1.5", port: 22, user: "deploy" } });
  const c = addNode({ kind: "database", title: "db-primary", subtitle: "postgres", x: 200, y: 280, spec: { host: "10.0.2.3", port: 22, user: "postgres" } });
  const d = addNode({ kind: "load-balancer", title: "lb-01", subtitle: "443→80", x: 640, y: 80, spec: { host: "10.0.0.10", port: 22, user: "lb" } });
  addEdge({ from: a.id, to: c.id, kind: "tcp", label: "5432" });
  addEdge({ from: b.id, to: c.id, kind: "tcp", label: "5432" });
  addEdge({ from: d.id, to: a.id, kind: "https", label: "443" });
  addEdge({ from: d.id, to: b.id, kind: "https", label: "443" });
  select([]);
}
import { mountToolbar } from "./app/Toolbar.js";
import { mountStatusBar } from "./app/StatusBar.js";
import { mountAccessGate } from "./app/AccessGate.js";
import { mountRightPanel } from "./app/RightPanel.js";
import { bus } from "./core/eventBus.js";
import {
  addNode, addEdge, select, setPanels, setLastAppliedKind, getSelectedIds,
  getLastAppliedKind, removeNode, removeEdge, updateEdge,
  toggleSnapToGrid, isSnapToGrid, undo, redo, getState, toggleNaturalScroll,
  getTopology,
} from "./core/store.js";
import { kindMeta } from "./canvas/nodes/kinds.js";
import api from "./core/api.js";

window.addEventListener("DOMContentLoaded", async () => {
  // Apply saved theme + UI scale before anything renders.
  applyTheme(getTheme());
  setUiScale(getUiScale());

  const host = document.getElementById("canvas-host");
  const toolbar = document.getElementById("toolbar");
  const inspector = document.getElementById("inspector");
  const statusbar = document.getElementById("statusbar");
  const paletteHost = document.getElementById("palette");

  const world = new World(host);
  mountToolbar(toolbar, world);
  new Palette(paletteHost, world.camera);
  new NodeDrag(host, world.camera);
  new ResizeDrag(host, world.camera);
  new Connection(host, world.camera, world);

  mountRightPanel(document.getElementById("right-panel"));
  mountStatusBar(statusbar);

  // Backend readiness probe.
  try {
    const r = await api.ping();
    console.info("[reticle] backend ping:", r);
  } catch (err) {
    console.error("[reticle] backend ping failed:", err);
  }

  // A daemon exists but refused us (bad/stale/missing token): show the
  // access gate and stop — no mock fallback, no demo seed, no fake data.
  if (api.transport === "denied") {
    mountAccessGate(document.getElementById("app"), api.deniedReason);
    return;
  }

  // Read-only role (daemon viewer): the store refuses mutations and the
  // is-viewer class hides edit affordances (palette, ports, handles,
  // inspector editing) — pan/zoom/select/inspect/export stay live.
  if (api.isViewer) document.getElementById("app").classList.add("is-viewer");

  // Persistence: load config from disk, autosave on dirty,
  // reload on external edits.
  const persistence = new Persistence();
  await persistence.load();

  api.onConfigChanged((payload) => persistence.reloadFromDisk(payload));

  // Workspace switching — reload the canvas from the new YAML path
  bus.on("workspace:switched", async () => {
    await persistence.load();
  });

  // Health polling: check all nodes every 30s — EXCEPT on the daemon
  // transport, where the server sweeps once for everyone and broadcasts
  // health-result events (phase 3c). N clients probing independently
  // from N laptops was both wasteful and semantically wrong.
  if (api.transport !== "ws") {
    checkAll();
    setInterval(() => checkAll(), 30000);
  }

  // Cron results from the backend scheduler feed node health + the
  // inspector's last-run info — the map stays alive.
  initCronHealth();

  // Only in mock mode (no Tauri, no daemon), seed a demo so the canvas
  // isn't blank. Daemon mode shows the shared config, even when empty.
  if (api.transport === "mock" && Object.keys(getState().topology.nodes).length === 0) {
    seedDemo();
  }

  // Tiny transient toast — surfaces events that used to vanish silently
  // (⌘⏎ on a node that can't shell, a save refused as stale, …).
  let toastEl = null, toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "app-toast";
      document.getElementById("app").appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2600);
  }
  bus.on("terminal:error", ({ error }) => toast(error));
  bus.on("config:conflict", () => toast("Someone else saved first — reloaded their version"));

  // Palette drag-and-drop → spawn a node of that kind at the drop world
  // coords, select it, and make it the "double-click empty" default.
  bus.on("palette:drop", ({ kind, worldX, worldY }) => {
    const n = addNode({ kind, x: worldX, y: worldY });
    if (!n) return; // read-only role
    select([n.id]);
    setLastAppliedKind(kind);
  });

  bus.on("palette:click", ({ kind }) => {
    setLastAppliedKind(kind);
    // Spawn the node at the center of the visible canvas
    const host = document.getElementById("canvas-host");
    const r = host.getBoundingClientRect();
    const w = world.camera.screenToWorld(r.width / 2, r.height / 2);
    const meta = kindMeta(kind);
    const n = addNode({
      kind,
      x: w.x - (meta.size[0] / 2),
      y: w.y - (meta.size[1] / 2),
    });
    if (!n) return; // read-only role
    select([n.id]);
  });

  // Connection: click port → click target node → creates edge (no label).
  // Click the edge later to set the label.
  bus.on("edge:create", ({ from, to, kind }) => {
    addEdge({ from, to, kind: kind ?? "tcp", label: "" });
  });

  // Double-click an edge → inline label editor: an HTML input positioned
  // at the curve midpoint inside the world layer (so it pans/zooms with
  // the canvas). window.prompt is not available in Tauri's WKWebView.
  bus.on("edge:label", ({ id, x, y }) => {
    if (api.isViewer) return; // read-only role: no label editing
    const edge = getTopology().edges[id];
    if (!edge) return;
    if (x == null || y == null) {
      const a = getTopology().nodes[edge.from];
      if (!a) return;
      x = a.x + a.w / 2; y = a.y + a.h / 2;
    }
    const input = document.createElement("input");
    input.className = "edge-label-input";
    input.value = edge.label || "";
    input.placeholder = "tcp/5432";
    input.style.left = `${x}px`;
    input.style.top = `${y}px`;
    world.worldLayer.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      const val = input.value.trim();
      input.remove();
      if (save && val !== (edge.label || "")) updateEdge(id, { label: val });
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") commit(false);
    });
    input.addEventListener("blur", () => commit(true));
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
  });

  // Single tap on empty canvas clears selection.
  let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
  bus.on("canvas:tap", ({ screenX, screenY }) => {
    select([], "clear");
    const now = Date.now();
    if (now - lastTapAt < 350 &&
        Math.hypot(screenX - lastTapX, screenY - lastTapY) < 8) {
      // double-tap → spawn last-used kind at the tap coords
      const w = world.camera.screenToWorld(screenX, screenY);
      const kind = getLastAppliedKind();
      const n = addNode({ kind, x: w.x - 90, y: w.y - 60 });
      select([n.id]);
    }
    lastTapAt = now;
    lastTapX = screenX; lastTapY = screenY;
  });

  // Start hidden + closed — panels open on demand.
  setPanels({ inspector: false, terminal: false });

  window.addEventListener("blur", () => bus.emit("app:blur"));
  window.addEventListener("focus", () => bus.emit("app:focus"));

  // Keyboard: Delete removes the current selection.
  window.addEventListener("keydown", (e) => {
    // Ignore typing in inputs / contenteditable (the inspector's later
    // spec editor will be contenteditable; defer to it there).
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      const ids = getSelectedIds();
      if (!ids.length) return;
      e.preventDefault();
      const topo = getTopology();
      for (const id of ids) {
        if (topo.edges[id]) removeEdge(id);
        else removeNode(id);
      }
    } else if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey) {
      const on = toggleSnapToGrid();
      console.info("[reticle] snap-to-grid:", on ? "ON" : "OFF");
    } else if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey) {
      const on = toggleNaturalScroll();
      console.info("[reticle] natural scroll:", on ? "ON" : "OFF");
    } else if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      setUiScale(Math.min(2, Math.round((getUiScale() + 0.1) * 10) / 10));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "-") {
      e.preventDefault();
      setUiScale(Math.max(0.5, Math.round((getUiScale() - 0.1) * 10) / 10));
    } else if ((e.metaKey || e.ctrlKey) && e.key === "0") {
      e.preventDefault();
      setUiScale(1);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      const ids = getSelectedIds();
      if (ids.length === 1) bus.emit("terminal:open", { nodeId: ids[0] });
      else toast(ids.length === 0 ? "Select a node first, then ⌘⏎ opens its shell" : "Select exactly ONE node to open a shell");
    }
  });
});
