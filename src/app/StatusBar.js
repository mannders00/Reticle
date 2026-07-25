// app/StatusBar.js
// Bottom bar: brand, snap, scroll, counts, config path, dirty.
// Kept minimal so it never wraps or feels cramped.

import { h } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import {
  getState, isSnapToGrid, isNaturalScroll, getSelectedIds,
  toggleSnapToGrid, toggleNaturalScroll,
} from "../core/store.js";
import api from "../core/api.js";

export function mountStatusBar(root) {
  // Brand → reticle.live. Plain target=_blank in the browser; on the
  // desktop the webview must NOT navigate, so route through the opener
  // plugin (system browser) instead.
  const brand = h("a", {
    class: "sb-brand",
    href: "https://reticle.live",
    target: "_blank",
    rel: "noreferrer",
    title: "reticle.live",
    onClick: (e) => {
      if (api.hasTauri) {
        e.preventDefault();
        window.__TAURI__.core.invoke("plugin:opener|open_url", { url: "https://reticle.live" })
          .catch((err) => console.warn("[statusbar] opener failed:", err));
      }
    },
  }, "Reticle");
  // Real build info instead of a hardcoded version: desktop asks Tauri,
  // daemon reports its version in the hello frame, mock is the demo.
  api.whenReady().then(async () => {
    try {
      if (api.hasTauri) {
        const v = await window.__TAURI__.app.getVersion();
        brand.textContent = `Reticle v${v} · desktop`;
      } else if (api.transport === "ws") {
        brand.textContent = api.serverVersion
          ? `Reticle v${api.serverVersion} · daemon`
          : "Reticle · daemon";
      } else {
        brand.textContent = "Reticle · demo";
      }
    } catch {
      /* keep the plain brand */
    }
  });
  // Role badge — set once transport resolves (hello carries role). Both
  // roles get one on the daemon transport, so switching tokens gives
  // visible feedback in BOTH directions, not just into read-only.
  const roleBadge = h("span", { class: "sb-item sb-role", hidden: true });
  api.whenReady().then(() => {
    if (api.isViewer) {
      roleBadge.hidden = false;
      roleBadge.textContent = "◉ viewer · read-only";
      roleBadge.title = "You can pan, inspect, and export — editing needs an editor token";
    } else if (api.transport === "ws") {
      roleBadge.hidden = false;
      roleBadge.classList.add("is-editor");
      roleBadge.textContent = "✎ editor · live";
      roleBadge.title = "Shared daemon session — your edits persist for everyone";
    }
  });
  // Daemon connection dropped (restart, network): make it unmissable —
  // the page is stale from this moment and needs a refresh.
  bus.on("api:closed", () => {
    roleBadge.hidden = false;
    roleBadge.classList.remove("is-editor");
    roleBadge.classList.add("is-disconnected");
    roleBadge.textContent = "⚠ disconnected — refresh to reconnect";
    roleBadge.title = "The daemon connection closed; edits and health are frozen until you reload";
  });
  const snap = h("span", {
    class: "sb-item sb-snap sb-toggle",
    title: "Snap nodes to grid (g)",
    onClick: () => toggleSnapToGrid(),
  });
  const scroll = h("span", {
    class: "sb-item sb-scroll sb-toggle",
    title: "Trackpad scroll direction (n)",
    onClick: () => toggleNaturalScroll(),
  });
  const count = h("span", { class: "sb-item" });
  const path = h("span", { class: "sb-item sb-path" });
  const dirty = h("span", { class: "sb-item sb-dirty" });
  // Last time ANY health signal landed (scheduled sweep, cron result, or
  // the toolbar's global refresh) — always UTC so screenshots/teammates
  // in different zones read the same clock.
  const lastUpdate = h("span", {
    class: "sb-item sb-last-update",
    title: "Last health update (UTC) — ⟳ in the toolbar refreshes everything now",
  });
  let updateTimer = null;
  function renderLastUpdate() {
    // Coalesce bursts (a sweep ticks every node at once) into one write.
    if (updateTimer) return;
    updateTimer = setTimeout(() => {
      updateTimer = null;
      lastUpdate.textContent = `updated ${new Date().toISOString().slice(11, 19)} UTC`;
    }, 50);
  }
  bus.on("health:tick", renderLastUpdate);
  bus.on("cron:result", renderLastUpdate);
  bus.on("refresh:done", renderLastUpdate);

  function renderSnap() {
    const on = isSnapToGrid();
    snap.textContent = on ? "▦ snap" : "☐ snap";
    snap.classList.toggle("is-active", on);
  }
  function renderScroll() {
    const on = isNaturalScroll();
    scroll.textContent = on ? "↕ natural" : "↕ inverted";
    scroll.classList.toggle("is-active", on);
  }
  function renderCount() {
    const n = Object.keys(getState().topology.nodes).length;
    const e = Object.keys(getState().topology.edges).length;
    const s = getSelectedIds().length;
    count.textContent = `${n}n · ${e}e` + (s ? ` · ${s} sel` : "");
  }
  function renderDirty() {
    dirty.textContent = getState().session.dirty ? "● unsaved" : "";
  }
  function renderPath() {
    const p = getState().session.fileName;
    path.textContent = p ? "📁 " + shorten(p) : "";
    path.title = p || "";
  }
  function shorten(p) {
    if (p.length < 50) return p;
    const parts = p.split("/");
    return parts.length < 4 ? p : ".../" + parts.slice(-2).join("/");
  }

  renderSnap(); renderScroll(); renderCount(); renderDirty(); renderPath();

  bus.on("ui:snap", renderSnap);
  bus.on("ui:natural-scroll", renderScroll);
  bus.on("topology:changed", renderCount);
  bus.on("selection:changed", renderCount);
  bus.on("session:dirty", renderDirty);
  bus.on("session:loaded", () => { renderDirty(); renderPath(); });

  root.append(
    brand,
    snap, scroll, roleBadge,
    h("span", { class: "sb-spacer" }),
    count,
    h("span", { class: "sb-spacer" }),
    path, dirty, lastUpdate,
  );
}