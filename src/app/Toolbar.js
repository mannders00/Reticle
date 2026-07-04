// app/Toolbar.js
// Top bar: app name + brand dot, file ops, zoom %, panel toggles.
// For module 1 it's mostly chrome — actual commands (load/save/fit/export)
// get wired in later modules. We do wire zoom display + fit here so the
// canvas feels alive immediately.

import { h, clamp } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { getState } from "../core/store.js";
import { toggleTheme, getTheme } from "../core/theme.js";
import { exportPdf } from "../core/export/exportPdf.js";
import api from "../core/api.js";

export function mountToolbar(root, world) {
  const zoomLabel = h("span", { class: "zoom-label" }, "100%");
  let cameraListener = false;
  function syncZoom() {
    if (!cameraListener) {
      cameraListener = true;
      bus.on("topology:changed", syncZoom);
    }
    zoomLabel.textContent = Math.round(world.camera.zoom * 100) + "%";
  }
  syncZoom();

  const el = h(
    "div",
    { class: "toolbar-inner" },
    h("span", { id: "palette-expand-slot" }),
    brand(),
    workspaceSwitcher(),
    h("div", { class: "spacer" }),
    toolButton("Fit", () => {
      const nodes = Object.values(getState().topology.nodes);
      if (!nodes.length) {
        world.camera.setZoom(1);
        world.camera.x = 0;
        world.camera.y = 0;
        world.applyTransform();
        return;
      }
      world.fit({
        x1: Math.min(...nodes.map((n) => n.x)),
        y1: Math.min(...nodes.map((n) => n.y)),
        x2: Math.max(...nodes.map((n) => n.x + n.w)),
        y2: Math.max(...nodes.map((n) => n.y + n.h)),
      });
    }, "tb-keep"),
    toolButton("−", () => {
      const { w, h } = world.camera.size();
      world.camera.zoomAt(w / 2, h / 2, 0.85);
      world.applyTransform();
      syncZoom();
    }),
    h("div", { class: "zoom-cluster" }, zoomLabel),
    toolButton("+", () => {
      const { w, h } = world.camera.size();
      world.camera.zoomAt(w / 2, h / 2, 1.18);
      world.applyTransform();
      syncZoom();
    }),
    h("div", { class: "spacer" }),
    themeToggle(),
    toolButton("PDF", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const ok = await exportPdf();
        if (!ok) console.info("[reticle] export skipped: empty canvas");
      } finally {
        btn.disabled = false;
      }
    }),
    // Toggles the WHOLE right panel open/closed — whatever tab is active
    // (inspector or a terminal) stays put; this button never switches tabs.
    toolButton("Inspector", () => bus.emit("panel:toggle-inspector"), "tb-keep"),
    overflowMenu(world, syncZoom),
  );
  // Keep zoom % in sync whenever the camera changes (pan/zoom events).
  // We piggyback on topology:changed as a rough heartbeat for module 1;
  // a dedicated camera:changed event lands in module 2.
  const worldApply = world.applyTransform.bind(world);
  world.applyTransform = (...args) => {
    worldApply(...args);
    syncZoom();
  };

  clear(root);
  root.appendChild(el);
  return el;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function toolButton(label, onClick, extra = "") {
  return h("button", { class: "tool-btn" + (extra ? " " + extra : ""), type: "button", onClick }, label);
}

function brand() {
  return h("div", { class: "brand" });
}

/** Narrow-screen overflow ("⋯"): holds the controls CSS hides on phones —
 *  zoom −/＋, PDF export, theme toggle. Fit + Inspector stay in the bar
 *  (the two things you reach for while reading a map one-handed; pinch
 *  and scroll still zoom the canvas directly). */
function overflowMenu(world, syncZoom) {
  const wrap = h("div", { class: "tb-overflow" });
  const btn = h("button", {
    class: "tool-btn tb-more-btn",
    type: "button",
    title: "More",
    "aria-label": "More",
    onClick: (e) => {
      e.stopPropagation();
      wrap.classList.toggle("is-open");
    },
  }, "⋯");
  const zoomBy = (f) => {
    const { w, h: hh } = world.camera.size();
    world.camera.zoomAt(w / 2, hh / 2, f);
    world.applyTransform();
    syncZoom();
  };
  const item = (label, onClick) =>
    h("button", {
      class: "tb-menu-item",
      type: "button",
      onClick: (e) => { onClick(e); wrap.classList.remove("is-open"); },
    }, label);
  const menu = h("div", { class: "tb-menu" },
    item("Zoom in ＋", () => zoomBy(1.18)),
    item("Zoom out −", () => zoomBy(0.85)),
    item("Export PDF", async () => {
      const ok = await exportPdf();
      if (!ok) console.info("[reticle] export skipped: empty canvas");
    }),
    item("Toggle theme", () => toggleTheme()), // applyTheme emits theme:changed
  );
  wrap.append(btn, menu);
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove("is-open");
  });
  return wrap;
}

const YAML_FILTER = [{ name: "YAML", extensions: ["yaml", "yml"] }];
const baseName = (p) => String(p).split("/").pop().replace(/\.ya?ml$/i, "");
/** Compact parent-dir hint: ".../repo/infra". */
function prettyDir(p) {
  const parts = String(p).split("/");
  parts.pop(); // filename
  if (parts.length <= 2) return parts.join("/") || "/";
  return ".../" + parts.slice(-2).join("/");
}

function workspaceSwitcher() {
  const wrap = h("div", { class: "workspace-switcher" });
  const btn = h("button", {
    class: "ws-btn",
    type: "button",
    title: "Switch workspace",
    onClick: (e) => {
      e.stopPropagation();
      // Daemon mode serves ONE fixed config — no switching (DAEMON.md §2).
      if (api.transport === "ws") return;
      wrap.classList.toggle("is-open");
      if (wrap.classList.contains("is-open")) refresh();
    },
  }, "config ▾");
  // In daemon mode the button is a plain label showing the shared config.
  bus.on("session:loaded", ({ fileName }) => {
    if (api.transport !== "ws" || !fileName) return;
    const base = String(fileName).split("/").pop().replace(/\.ya?ml$/i, "");
    btn.textContent = base;
    btn.title = `Shared config: ${fileName} (fixed by the daemon)`;
  });
  const dropdown = h("div", { class: "ws-dropdown" });
  wrap.append(btn, dropdown);

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) wrap.classList.remove("is-open");
  });

  async function openInPlace(path, name) {
    wrap.classList.remove("is-open");
    await api.switchWorkspace(path);
    btn.textContent = name + " ▾";
    bus.emit("workspace:switched", { path, name });
  }

  async function refresh() {
    dropdown.replaceChildren();
    try {
      const workspaces = await api.listWorkspaces();
      const recents = workspaces.filter((w) => !w.sample);
      const samples = workspaces.filter((w) => w.sample);

      // ---- recents ----
      if (recents.length) dropdown.appendChild(h("div", { class: "ws-group-label" }, "Recent"));
      for (const ws of recents) {
        const item = h("div", {
          class: "ws-item" + (ws.active ? " is-active" : "") + (ws.exists === false ? " is-missing" : ""),
          title: ws.path,
          onClick: async () => {
            if (ws.exists === false) return; // can't open a vanished file
            if (ws.active) { wrap.classList.remove("is-open"); return; }
            await openInPlace(ws.path, ws.name);
          },
        },
          h("span", { class: "ws-name" }, ws.name),
          h("span", { class: "ws-path" }, prettyDir(ws.path)),
        );
        if (ws.exists === false) item.append(h("span", { class: "ws-missing-tag" }, "missing"));
        // Remove-from-recents (never touches the file itself)
        if (!ws.active) {
          const del = h("button", {
            class: "ws-delete",
            title: "Remove from recents (keeps the file)",
            onClick: async (e) => {
              e.stopPropagation();
              await api.deleteWorkspace(ws.path);
              item.remove();
            },
          }, "×");
          item.append(del);
        } else {
          item.append(h("span", { class: "ws-check" }, "✓"));
        }
        dropdown.appendChild(item);
      }

      // ---- samples (read-only templates; open = save a copy) ----
      if (samples.length) dropdown.appendChild(h("div", { class: "ws-group-label" }, "Samples"));
      for (const ws of samples) {
        dropdown.appendChild(h("div", {
          class: "ws-item ws-sample",
          title: api.hasTauri ? "Save a copy and open it" : "Preview this sample",
          onClick: async () => {
            wrap.classList.remove("is-open");
            if (!api.hasTauri) {
              // Browser demo: no native dialog — just preview the sample.
              await openInPlace(ws.path, ws.name);
              return;
            }
            // Desktop: samples are read-only templates. Save a copy, then
            // open that copy in place so edits never touch the bundled file.
            const dest = await api.pickSavePath(`${ws.name}.yaml`, YAML_FILTER);
            if (!dest) return;
            const finalPath = await api.importWorkspaceFile(ws.path, dest);
            await openInPlace(finalPath, baseName(finalPath));
          },
        },
          h("span", { class: "ws-name" }, ws.name),
          h("span", { class: "ws-path" }, "sample"),
        ));
      }

      // ---- actions (native dialogs → Tauri only) ----
      if (!api.hasTauri) return;
      dropdown.appendChild(h("div", { class: "ws-divider" }));
      dropdown.appendChild(h("div", {
        class: "ws-item ws-action",
        onClick: async () => {
          wrap.classList.remove("is-open");
          const path = await api.pickWorkspaceFile();
          if (!path) return;
          await openInPlace(path, baseName(path)); // edits IN PLACE — no copy
        },
      }, h("span", { class: "ws-name" }, "Open file…")));
      dropdown.appendChild(h("div", {
        class: "ws-item ws-action",
        onClick: async () => {
          wrap.classList.remove("is-open");
          const path = await api.pickSavePath("topology.yaml", YAML_FILTER);
          if (!path) return;
          await openInPlace(path, baseName(path)); // created empty by switch
        },
      }, h("span", { class: "ws-name" }, "New workspace…")));
    } catch (err) {
      dropdown.appendChild(h("div", { class: "ws-empty" }, "Error: " + String(err)));
    }
  }

  // Track active workspace name
  bus.on("workspace:switched", ({ name }) => {
    btn.textContent = name + " ▾";
  });

  // Load the active workspace name on boot
  refresh().then(() => {
    const active = dropdown.querySelector(".ws-item.is-active .ws-name");
    if (active) btn.textContent = active.textContent + " ▾";
  });

  return wrap;
}

function themeToggle() {
  const btn = h("button", {
    class: "tool-btn theme-toggle",
    type: "button",
    title: "Toggle theme (dark/light)",
    onClick: () => {
      const mode = toggleTheme();
      btn.textContent = mode === "dark" ? "☾" : "☀";
    },
  }, getTheme() === "dark" ? "☾" : "☀");
  // Update icon when theme changes externally
  bus.on("theme:changed", ({ mode }) => {
    btn.textContent = mode === "dark" ? "☾" : "☀";
  });
  return btn;
}