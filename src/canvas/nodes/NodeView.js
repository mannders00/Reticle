// canvas/nodes/NodeView.js
// One instance per non-group node. Renders as an absolutely-positioned
// HTML div (NOT inside a foreignObject). The div lives in the World's
// node-overlay container and is positioned via CSS left/top/width/height
// in world coordinates. The overlay's CSS transform handles pan/zoom.
//
// This avoids the WKWebView foreignObject bug where pointer events from
// HTML inside <foreignObject> don't propagate and position updates via
// setAttribute don't visually move the content.

import { iconHtml } from "./icons.js";
import { kindMeta } from "./kinds.js";
import { bus } from "../../core/eventBus.js";
import { getSelectedIds, select, updateNodeMeta } from "../../core/store.js";
import { getCronResults } from "../../core/ops.js";
import api from "../../core/api.js";

export class NodeView {
  constructor(node, container) {
    this.id = node.id;
    this.node = node;

    // Plain HTML div — no foreignObject, no SVG boundary issues.
    this.el = document.createElement("div");
    this.el.className = "node-wrapper";
    this.el.dataset.id = node.id;
    this.card = document.createElement("div");
    this.card.className = "node-card";
    this.card.dataset.id = node.id;
    this.card.draggable = false;
    // Kill native HTML5 drag — WKWebView fires dragstart + synthetic
    // pointerup when cursor:grab is used, which kills our custom drag.
    this.card.addEventListener("dragstart", (e) => e.preventDefault());
    this.ports = this._buildPorts();
    this.resizeHandles = this._buildResizeHandles();
    this.el.append(this.card, this.ports, this.resizeHandles);
    container.append(this.el);

    // Listeners on the HTML card — always work in all webviews.
    this.card.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    this.card.addEventListener("dblclick", (e) => this._onDoubleClick(e));
    this.ports.addEventListener("pointerdown", (e) => this._onPortPointerDown(e));
    this.resizeHandles.addEventListener("pointerdown", (e) => this._onResizePointerDown(e));

    this.update();
  }

  update() {
    const n = this.node;
    this.el.style.left = n.x + "px";
    this.el.style.top = n.y + "px";
    this.el.style.width = n.w + "px";
    this.el.style.height = n.h + "px";

    // Only rebuild inner HTML when content actually changed, not on
    // every position update or selection toggle. Rebuilding innerHTML
    // during a drag or right after selection kills the pointer stream
    // in WKWebView (synthetic pointerup).
    const sig = `${n.kind}|${n.title}|${n.subtitle}|${n.notes ?? ""}|${n.health?.state}|${n.spec?.host}|${n.spec?.kubeContext}|${n.spec?.name}|${n.actions?.length ?? 0}|${checksSig(n)}|${(n.addons ?? []).map((a) => a.kind + a.label).join(",")}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this._refreshCard();
    }
    // Handle selection via class toggle — no DOM rebuild needed.
    const selected = getSelectedIds().includes(n.id);
    const wasSelected = this.card.classList.contains("is-selected");
    if (selected !== wasSelected) {
      this.card.classList.toggle("is-selected", selected);
      this.ports.classList.toggle("is-visible", selected);
      this.resizeHandles.classList.toggle("is-visible", selected);
    }
  }

  setHealth(health) {
    this.node.health = health;
    const pill = this.card.querySelector(".health-pill");
    if (pill) {
      const state = (health && health.state) || "unknown";
      pill.dataset.state = state;
      pill.querySelector(".label").textContent =
        state === "ok" ? "OK" :
        state === "warn" ? "WARN" :
        state === "err" ? "DOWN" : "—";
    }
  }

  setSelected(on) {
    this.card.classList.toggle("is-selected", on);
    this.ports.classList.toggle("is-visible", on);
    this.resizeHandles.classList.toggle("is-visible", on);
  }
  portAnchor(side) {
    const n = this.node;
    switch (side) {
      case "n": return { x: n.x + n.w / 2, y: n.y };
      case "e": return { x: n.x + n.w, y: n.y + n.h / 2 };
      case "s": return { x: n.x + n.w / 2, y: n.y + n.h };
      case "w": return { x: n.x, y: n.y + n.h / 2 };
    }
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }

  _onPortPointerDown(e) {
    const portEl = e.target.closest(".node-port");
    if (!portEl) return;
    bus.emit("connection:start", {
      fromId: this.id, side: portEl.dataset.side,
      clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
    });
  }

  _onResizePointerDown(e) {
    const handleEl = e.target.closest(".node-resize-handle");
    if (!handleEl) return;
    e.stopPropagation();
    bus.emit("resize:start", {
      id: this.id, edge: handleEl.dataset.edge,
      clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
    });
  }

  destroy() {
    this.el.remove();
  }

  _buildPorts() {
    const wrap = document.createElement("div");
    wrap.className = "node-ports";
    wrap.draggable = false;
    wrap.addEventListener("dragstart", (e) => e.preventDefault());
    for (const side of ["n", "e", "s", "w"]) {
      const p = document.createElement("div");
      p.className = "node-port";
      p.dataset.side = side;
      p.draggable = false;
      wrap.appendChild(p);
    }
    return wrap;
  }

  _buildResizeHandles() {
    const wrap = document.createElement("div");
    wrap.className = "node-resize-handles";
    wrap.draggable = false;
    wrap.addEventListener("dragstart", (e) => e.preventDefault());
    for (const edge of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      const h = document.createElement("div");
      h.className = "node-resize-handle";
      h.dataset.edge = edge;
      h.draggable = false;
      wrap.appendChild(h);
    }
    return wrap;
  }

  _refreshCard() {
    const n = this.node;
    const meta = kindMeta(n.kind);
    this.card.dataset.kind = n.kind;
    this.card.dataset.category = meta.category;

    // Notes are paragraph cards: a small header + the full wrapped text
    // (backed by n.notes, same field the inspector textarea edits). No
    // health pill, no meta chips — it's prose, not a machine.
    if (n.kind === "note") {
      this.card.innerHTML = `
        <div class="node-head note-head">
          <span class="node-icon">${iconHtml("note", 15)}</span>
          <div class="node-title">${esc(n.title)}</div>
        </div>
        <div class="note-body">${esc(n.notes ?? n.subtitle ?? "")}</div>`;
      return;
    }

    const health = n.health || { state: "unknown" };
    const hState = health.state || "unknown";
    const hLabel = hState === "ok" ? "OK" : hState === "warn" ? "WARN" : hState === "err" ? "DOWN" : "—";

    const def = meta.modes.includes("ssh") && n.spec?.host
      ? `${n.spec.user || "?"}@${n.spec.host}`
      : meta.modes.includes("kubectl") && n.spec?.name
        ? `${n.spec.kubeContext || "ctx"} / ${n.spec.namespace || "ns"} / ${n.spec.name}`
        : meta.label;

    this.card.innerHTML = `
      <div class="node-head">
        <span class="node-icon">${iconHtml(n.kind, 22)}</span>
        <div class="node-title-wrap">
          <div class="node-title">${esc(n.title)}</div>
          <div class="node-sub">${esc(n.subtitle || def)}</div>
        </div>
        <span class="health-pill" data-state="${hState}">
          <span class="dot"></span><span class="label">${hLabel}</span>
        </span>
      </div>
      ${this._renderChecks(n)}
      ${this._renderAddons(n)}
      ${this._renderMetaRow(n, meta)}
    `;
  }

  /** Attached resources (GPU, disk, IP…) — tiny icon chips. */
  _renderAddons(n) {
    const addons = n.addons ?? [];
    if (!addons.length) return "";
    const chips = addons.slice(0, 6).map((a) =>
      `<span class="addon-chip" title="${esc(a.label || a.kind)}">` +
      `${iconHtml(a.kind, 11)}${a.label ? `<span class="addon-label">${esc(a.label)}</span>` : ""}</span>`);
    if (addons.length > 6) chips.push(`<span class="addon-chip">+${addons.length - 6}</span>`);
    return `<div class="node-addons">${chips.join("")}</div>`;
  }

  /** Per-check status strip: one chip per cron, colored by last result.
   *  This is the card-level "alive" readout — you can see WHICH check is
   *  failing without opening the inspector. */
  _renderChecks(n) {
    const crons = n.crons ?? [];
    if (!crons.length) return "";
    const results = getCronResults(n.id);
    const MAX = 4;
    const chips = crons.slice(0, MAX).map((c) => {
      // Incomplete (still being filled in) — scheduler skips these, so any
      // lingering result predates the edit and shouldn't color the chip.
      const incomplete = (c.exec === "http" ? (c.url ?? "").trim() : (c.script ?? "").trim()) === "";
      const r = incomplete ? null : results?.get(c.name);
      const state = r ? (r.success ? "ok" : "err") : "unknown";
      const title = incomplete
        ? "incomplete — fill in the check to arm it"
        : r
          ? (r.success ? `ok · ${timeAgo(r.timestamp)}` : `exit ${r.exit_code ?? "?"} · ${timeAgo(r.timestamp)}`)
          : "not run yet";
      return `<span class="check-chip" data-state="${state}" title="${esc(c.name)} — ${esc(title)}">` +
        `<span class="dot"></span>${esc(c.name)}</span>`;
    });
    if (crons.length > MAX) {
      chips.push(`<span class="check-chip" data-state="more">+${crons.length - MAX}</span>`);
    }
    return `<div class="node-checks">${chips.join("")}</div>`;
  }

  _renderMetaRow(n, meta) {
    const bits = [];
    if (n.spec?.host) bits.push(`<span class="meta-bit">${esc(n.spec.host)}:${n.spec.port ?? 22}</span>`);
    if (n.spec?.kubeContext && n.spec?.name) bits.push(`<span class="meta-bit">${esc(n.spec.kubeContext)}/${esc(n.spec.name)}</span>`);
    const nActions = n.actions?.length ?? 0;
    if (nActions) bits.push(`<span class="meta-bit">▶ ${nActions}</span>`);
    if (!bits.length) return "";
    return `<div class="node-meta">${bits.join("")}</div>`;
  }

  _onPointerDown(e) {
    if (e.button !== 0 && e.button !== undefined) return;
    // Don't use setPointerCapture — in WKWebView it causes pointerup
    // to fire immediately. Instead, we emit the grab event and NodeDrag
    // listens on document for pointermove/pointerup which works reliably.
    bus.emit("node:grab", {
      id: this.id, clientX: e.clientX, clientY: e.clientY,
      shiftKey: e.shiftKey, pointerId: e.pointerId,
    });
  }

  /** Inline paragraph editing for note cards. Blur commits; Escape
   *  cancels; Enter inserts a newline (it's prose, not a form field). */
  _editNoteBody() {
    const body = this.card.querySelector(".note-body");
    if (!body || body.isContentEditable) return;
    const original = this.node.notes ?? this.node.subtitle ?? "";
    body.contentEditable = "plaintext-only";
    if (body.contentEditable !== "plaintext-only") body.contentEditable = "true";
    body.focus();
    // caret at the end of the text
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const commit = () => {
      body.contentEditable = "false";
      const text = body.innerText.replace(/\n$/, "");
      if (text !== original) updateNodeMeta(this.id, { notes: text });
      else body.textContent = original;
      body.removeEventListener("blur", commit);
      body.removeEventListener("keydown", onKey);
    };
    const onKey = (ke) => {
      // keep global shortcuts (Delete removes nodes!) away while typing
      ke.stopPropagation();
      if (ke.key === "Escape") {
        ke.preventDefault();
        body.textContent = original;
        body.blur();
      }
    };
    body.addEventListener("blur", commit);
    body.addEventListener("keydown", onKey);
  }

  _onDoubleClick(e) {
    e.stopPropagation();
    // Double-click on the title = inline rename; anywhere else on the
    // card = open the inspector — except notes, where the body is the
    // content and double-click edits the paragraph in place.
    // Viewers always get the inspector — never inline editors.
    if (api.isViewer) {
      select([this.id], "replace");
      bus.emit("panel:show-inspector", {});
      return;
    }
    if (!e.target.closest(".node-title")) {
      if (this.node.kind === "note") {
        this._editNoteBody();
        return;
      }
      select([this.id], "replace");
      bus.emit("panel:show-inspector", {});
      return;
    }
    const titleEl = this.card.querySelector(".node-title");
    if (!titleEl) return;
    titleEl.contentEditable = "true";
    titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const commit = () => {
      titleEl.contentEditable = "false";
      const newTitle = titleEl.textContent.trim();
      if (newTitle && newTitle !== this.node.title) {
        updateNodeMeta(this.id, { title: newTitle });
      } else {
        titleEl.textContent = this.node.title;
      }
      titleEl.removeEventListener("blur", commit);
      titleEl.removeEventListener("keydown", onKey);
    };
    const onKey = (ke) => {
      if (ke.key === "Enter") { ke.preventDefault(); titleEl.blur(); }
      else if (ke.key === "Escape") { ke.preventDefault(); titleEl.textContent = this.node.title; titleEl.blur(); }
    };
    titleEl.addEventListener("blur", commit);
    titleEl.addEventListener("keydown", onKey);
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

/** Content signature for the checks strip — names + latest results — so
 *  update() rebuilds the card when a cron result changes state. */
function checksSig(n) {
  const results = getCronResults(n.id);
  return (n.crons ?? [])
    .map((c) => {
      const r = results?.get(c.name);
      return `${c.name}:${r ? (r.success ? 1 : 0) : "-"}`;
    })
    .join(",");
}

function timeAgo(ts) {
  if (!ts) return "";
  const ms = Date.now() - (ts < 2e10 ? ts * 1000 : ts);
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}