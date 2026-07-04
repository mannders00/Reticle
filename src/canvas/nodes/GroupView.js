// canvas/nodes/GroupView.js
// Group-kind nodes (vpc / region / zone / subnet / lan / wan /
// security-group) render as HTML divs with dashed borders — same
// coordinate system as node cards. Resize handles are HTML divs.

import { iconHtml } from "./icons.js";
import { kindMeta } from "./kinds.js";
import { bus } from "../../core/eventBus.js";
import { getSelectedIds, select, updateNodeMeta } from "../../core/store.js";

const HANDLE_EDGES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export class GroupView {
  constructor(node, container) {
    this.id = node.id;
    this.node = node;
    this.container = container;

    this.el = document.createElement("div");
    this.el.className = "group-wrapper";
    this.el.dataset.id = node.id;
    this.el.dataset.kind = node.kind;
    this.el.draggable = false;
    this.el.addEventListener("dragstart", (e) => e.preventDefault());

    // Title bar
    this.titleBar = document.createElement("div");
    this.titleBar.className = "group-title-bar";
    this.el.appendChild(this.titleBar);

    // Resize handles
    this.handles = [];
    for (const edge of HANDLE_EDGES) {
      const h = document.createElement("div");
      h.className = "group-resize-handle";
      h.dataset.edge = edge;
      h.draggable = false;
      h.addEventListener("dragstart", (e) => e.preventDefault());
      h.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        bus.emit("resize:start", {
          id: this.id, edge,
          clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
        });
      });
      this.handles.push(h);
      this.el.appendChild(h);
    }

    container.appendChild(this.el);

    // Pointerdown on the group body → grab (for drag + selection)
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.classList.contains("group-resize-handle")) return;
      bus.emit("node:grab", {
        id: this.id, clientX: e.clientX, clientY: e.clientY,
        shiftKey: e.shiftKey, pointerId: e.pointerId,
      });
    });

    // Double-click title → rename
    this.titleBar.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const nameEl = this.titleBar.querySelector(".group-name");
      if (!nameEl) return;
      nameEl.contentEditable = "true";
      nameEl.focus();
      const range = document.createRange();
      range.selectNodeContents(nameEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      const commit = () => {
        nameEl.contentEditable = "false";
        const newName = nameEl.textContent.trim();
        if (newName && newName !== this.node.title) {
          updateNodeMeta(this.id, { title: newName });
        } else {
          nameEl.textContent = this.node.title;
        }
        nameEl.removeEventListener("blur", commit);
        nameEl.removeEventListener("keydown", onKey);
      };
      const onKey = (ke) => {
        if (ke.key === "Enter") { ke.preventDefault(); nameEl.blur(); }
        else if (ke.key === "Escape") { ke.preventDefault(); nameEl.textContent = this.node.title; nameEl.blur(); }
      };
      nameEl.addEventListener("blur", commit);
      nameEl.addEventListener("keydown", onKey);
    });

    this.update();
  }

  update() {
    const n = this.node;
    this.el.style.left = n.x + "px";
    this.el.style.top = n.y + "px";
    this.el.style.width = n.w + "px";
    this.el.style.height = n.h + "px";

    // Only rebuild title when content changes (not on every position
    // update or selection toggle — innerHTML rebuilds kill the pointer
    // stream in WKWebView).
    const sig = `${n.title}|${n.subtitle}`;
    if (sig !== this._lastSig) {
      this._lastSig = sig;
      this.titleBar.innerHTML = `
        <span class="group-icon">${iconHtml(n.kind, 16)}</span>
        <span class="group-name">${esc(n.title)}</span>
        ${n.subtitle ? `<span class="group-sub">${esc(n.subtitle)}</span>` : ""}
      `;
    }
  }

  setSelected(on) {
    this.el.classList.toggle("is-selected", on);
    for (const h of this.handles) h.style.display = on ? "" : "none";
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

  destroy() {
    this.el.remove();
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}