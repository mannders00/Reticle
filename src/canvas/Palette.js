// canvas/Palette.js
// Left-rail catalog of every node kind. Drag a tile onto the canvas to
// spawn that kind at the drop point. A top search field filters by label
// (handy once you know the catalog). Collapsible to icon-only mode.
//
// The palette doesn't import the store; it emits `palette:drop` events
// carrying `{ kind, worldX, worldY }` and `main.js` (or whichever module
// owns file/session creation) handles the addNode + selection niceties.
// This keeps the palette reusable for the future daemon-mode UI.

import { h, svg } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { iconSvg, iconHtml } from "./nodes/icons.js";
import { kindsByCategory, kindMeta } from "./nodes/kinds.js";

export class Palette {
  constructor(host, camera, options = {}) {
    this.host = host;
    this.camera = camera;
    this.collapsed = !!options.collapsed;
    this.filter = "";

    this.el = h("aside", { class: "palette" + (this.collapsed ? " is-collapsed" : "") });
    this.el.innerHTML = `
      <div class="palette-top">
        <button class="palette-collapse" title="Collapse palette">‹</button>
        <input class="palette-search" type="search" placeholder="Filter" />
      </div>
      <div class="palette-body"></div>
    `;
    host.append(this.el);

    this.body = this.el.querySelector(".palette-body");
    this.search = this.el.querySelector(".palette-search");
    this.render();

    this.search.addEventListener("input", () => {
      this.filter = this.search.value.trim().toLowerCase();
      this.render();
    });
    const expandBtn = h("button", {
      class: "palette-expand tool-btn",
      title: "Show node palette",
    }, "⊞");
    expandBtn.style.display = "none";
    // Insert into the toolbar's expand slot (inside toolbar-inner so it
    // gets the same flex layout as other toolbar buttons)
    const slot = document.getElementById("palette-expand-slot");
    if (slot) slot.appendChild(expandBtn);
    else document.querySelector(".toolbar")?.appendChild(expandBtn);

    const updateExpandVisibility = () => {
      expandBtn.style.display = this.collapsed ? "flex" : "none";
    };

    this.el.querySelector(".palette-collapse").addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.el.classList.toggle("is-collapsed", this.collapsed);
      host.classList.toggle("palette-collapsed", this.collapsed);
      updateExpandVisibility();
    });

    expandBtn.addEventListener("click", () => {
      this.collapsed = false;
      this.el.classList.remove("is-collapsed");
      host.classList.remove("palette-collapsed");
      updateExpandVisibility();
    });

    // Catch drops anywhere in the window so the user can drop onto the
    // canvas even if the pointer briefly drifts off the host element.
    document.body.addEventListener("dragover", (e) => e.preventDefault());
    document.body.addEventListener("drop", (e) => {
      const kind = e.dataTransfer?.getData("application/x-reticle-kind");
      if (!kind) return;
      e.preventDefault();
      const p = this.camera.clientToHost(e.clientX, e.clientY);
      const w = this.camera.screenToWorld(p.x, p.y);
      bus.emit("palette:drop", { kind, worldX: w.x, worldY: w.y });
    });
  }

  render() {
    const groups = kindsByCategory();
    this.body.replaceChildren();
    for (const g of groups) {
      const items = g.kinds.filter((k) =>
        !this.filter || k.label.toLowerCase().includes(this.filter),
      );
      if (!items.length) continue;
      const body = h("div", { class: "palette-cat-body" });
      for (const k of items) body.appendChild(this._tile(k));
      const head = h(
        "div",
        { class: "palette-cat-head", "data-cat": g.id },
        h("span", { class: "palette-cat-dot", style: `background:${g.color}` }),
        h("span", { class: "palette-cat-label" }, g.label),
      );
      this.body.append(head, body);
      head.addEventListener("click", () => {
        body.classList.toggle("is-hidden");
        head.classList.toggle("is-collapsed-h");
      });
    }

  }

  _tile(kind) {
    const meta = kindMeta(kind.id);
    const el = h(
      "div",
      {
        class: "palette-tile",
        draggable: "true",
        title: meta.label,
        "data-kind": kind.id,
      },
    );
    el.innerHTML = `${iconHtml(kind.id, 18)}<span class="palette-tile-label">${meta.label}</span>`;

    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-reticle-kind", kind.id);
      e.dataTransfer.effectAllowed = "copy";
      // Hide the OS drag image so the drop feels precise
      const img = document.createElement("div");
      img.style.opacity = 0;
      document.body.append(img);
      e.dataTransfer.setDragImage(img, 0, 0);
      setTimeout(() => img.remove(), 0);
    });
    el.addEventListener("click", () => bus.emit("palette:click", { kind: kind.id }));
    return el;
  }
}