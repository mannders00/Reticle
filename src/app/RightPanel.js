// app/RightPanel.js
// Unified right sidebar: tabs for Inspector + terminal shells. The panel
// is resizable via a drag handle on its left edge, and terminal tabs can
// maximize to take the full canvas area.
//
// Modules don't render into the panel directly — they emit bus events:
//   "panel:show-inspector"  → switch to inspector tab
//   "terminal:open"         → open a terminal tab + switch to it
//   "terminal:close"        → close a terminal tab

import { h, clear } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { mountInspectorContent } from "./InspectorPanel.js";
import { createTerminalManager } from "./TerminalDock.js";

export function mountRightPanel(root) {
  const tabsEl = document.getElementById("panel-tabs");
  const bodyEl = document.getElementById("panel-body");
  const handle = document.getElementById("panel-resize-handle");
  const app = document.getElementById("app");

  const tabs = new Map(); // tabId → { id, label, el, closeable, activate }
  let activeTab = null;
  let fullscreen = false;

  // Fullscreen button — lives at the right end of the tab bar
  const fsBtn = h("button", {
    class: "panel-fullscreen-btn",
    title: "Toggle fullscreen",
    onClick: () => {
      fullscreen = !fullscreen;
      app.classList.toggle("is-panel-fullscreen", fullscreen);
      fsBtn.textContent = fullscreen ? "🗗" : "⛶";
      // Refit active terminal if any
      tabs.get(activeTab)?.activate?.();
    },
  }, "⛶");
  tabsEl.append(fsBtn);

  function showPanel() {
    root.hidden = false;
    app.classList.remove("is-panel-hidden");
  }
  function hidePanel() {
    root.hidden = true;
    app.classList.add("is-panel-hidden");
    if (fullscreen) {
      fullscreen = false;
      app.classList.remove("is-panel-fullscreen");
      fsBtn.textContent = "⛶";
    }
  }

  function switchTab(id) {
    activeTab = id;
    for (const [tid, t] of tabs) {
      t.tabBtn?.classList.toggle("is-active", tid === id);
      t.el.style.display = tid === id ? "" : "none";
    }
    showPanel();
    tabs.get(id)?.activate?.();
  }

  function addTab(id, label, el, opts = {}) {
    const existing = tabs.get(id);
    if (existing) {
      existing.label = label;
      existing.tabBtn.querySelector(".panel-tab-label").textContent = label;
      return existing;
    }
    // Insert tab before the fullscreen button
    const tabBtn = h("div", { class: "panel-tab", "data-tab": id },
      h("span", { class: "panel-tab-label" }, label));
    tabBtn.addEventListener("click", () => switchTab(id));
    if (opts.closeable) {
      const close = h("button", { class: "panel-tab-close", title: "Close" }, "×");
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onClose?.();
      });
      tabBtn.append(close);
    }
    // Insert before fullscreen button
    tabsEl.insertBefore(tabBtn, fsBtn);
    el.style.display = "none";
    bodyEl.append(el);
    tabs.set(id, { id, label, el, tabBtn, ...opts });
  }

  function removeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    t.tabBtn.remove();
    t.el.remove();
    tabs.delete(id);
    if (activeTab === id) {
      const next = tabs.keys().next().value;
      if (next) switchTab(next);
      else hidePanel();
    }
  }

  // ---- Inspector tab ----
  const inspectorEl = h("div", { class: "inspector-content" });
  addTab("inspector", "Inspector", inspectorEl, {});
  mountInspectorContent(inspectorEl);

  // Selection changes do NOT open the panel — the inspector only appears
  // when the user explicitly asks (toolbar Inspector button / a shell
  // opening). Its content still live-updates while visible, because
  // InspectorPanel subscribes to selection:changed itself.
  bus.on("panel:show-inspector", () => switchTab("inspector"));
  // The toolbar button is a plain open/close for the WHOLE panel: if any
  // tab is visible (inspector OR a terminal), close it; if hidden, reopen
  // on whatever tab was last active. It never steals the tab selection.
  bus.on("panel:toggle-inspector", () => {
    if (!root.hidden) hidePanel();
    else switchTab(activeTab && tabs.has(activeTab) ? activeTab : "inspector");
  });

  // ---- Terminal tabs ----
  const termMgr = createTerminalManager(bodyEl, addTab, removeTab, switchTab);

  bus.on("terminal:open", ({ nodeId }) => termMgr.openShell(nodeId));
  bus.on("terminal:close", ({ nodeId }) => termMgr.closeShell(nodeId));

  // ---- Resize handle ----
  // clientX / getBoundingClientRect are VISUAL px; --panel-w is logical
  // CSS px inside the UI-scaled #app. Divide by the scale or the panel
  // edge drifts away from the cursor proportionally to drag distance.
  const uiScale = () => parseFloat(localStorage.getItem("reticle-ui-scale")) || 1;
  let resizing = false, startX = 0, startW = 0;
  handle.addEventListener("pointerdown", (e) => {
    if (fullscreen) return;
    resizing = true;
    startX = e.clientX;
    startW = root.getBoundingClientRect().width / uiScale();
    app.classList.add("is-panel-resizing");
    e.preventDefault();
  });
  window.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const delta = (startX - e.clientX) / uiScale(); // drag left = wider
    const newW = Math.max(240, Math.min(600, startW + delta));
    app.style.setProperty("--panel-w", newW + "px");
    e.preventDefault();
  });
  window.addEventListener("pointerup", () => {
    if (!resizing) return;
    resizing = false;
    app.classList.remove("is-panel-resizing");
  });

  // Start hidden — opens only on explicit request (Inspector button,
  // opening a shell).
  hidePanel();

  return { showPanel, hidePanel, switchTab };
}