// canvas/NodeDrag.js
// Figma-style drag for nodes. Activates via a bus event (`node:grab`)
// emitted by NodeView/GroupView on pointerdown. This bypasses the
// WKWebView bug where pointer events from HTML inside <foreignObject>
// don't bubble through the SVG boundary to the host div.
//
// Dragging the only selected node moves just it. Dragging a node that
// is part of a larger selection moves the whole selection. Group children
// move with their group via the store's moveNode() propagation.

import { bus } from "../core/eventBus.js";
import api from "../core/api.js";
import {
  getSelectedIds,
  select,
  moveSelection,
  isSnapToGrid,
  getSnapGrid,
  getTopology,
  pushHistory,
} from "../core/store.js";

const DRAG_THRESHOLD = 4;

export class NodeDrag {
  constructor(host, camera) {
    this.host = host;
    this.camera = camera;
    this.dragging = null;

    // Listen on the bus — NodeView/GroupView emit this on pointerdown
    // directly from their own DOM elements (inside foreignObject or
    // on the SVG <g>), so we don't depend on event bubbling.
    bus.on("node:grab", (p) => this.onGrab(p));

    // Listen on document, not window — WKWebView routes pointermove
    // to document even when window doesn't receive it.
    document.addEventListener("pointermove", this.onMove.bind(this), { passive: false });
    document.addEventListener("pointerup", this.onUp.bind(this));
    document.addEventListener("pointercancel", this.onUp.bind(this));
  }

  onGrab({ id, clientX, clientY, shiftKey, pointerId }) {
    const sel = new Set(getSelectedIds());
    let ids;
    if (sel.has(id)) {
      if (shiftKey) {
        // Shift-click on an already-selected node removes it from the
        // selection instead of starting a drag.
        select([id], "toggle");
        return;
      }
      ids = [...sel];
    } else {
      if (shiftKey) {
        select([id], "toggle");
        ids = [...new Set([...sel, id])];
      } else {
        select([id], "replace");
        ids = [id];
      }
    }

    // Viewers select and inspect; they never drag (store would refuse
    // the move anyway — bailing here avoids ghost drag cursors/state).
    if (api.isViewer) return;

    const p = this.camera.clientToHost(clientX, clientY);
    const w = this.camera.screenToWorld(p.x, p.y);
    this.dragging = {
      id,
      ids,
      startPointer: w,
      startWorld: w,
      moved: false,
      pointerId,
      appliedDx: 0,
      appliedDy: 0,
    };
  }

  onMove(e) {
    if (!this.dragging) return;
    const p = this.camera.clientToHost(e.clientX, e.clientY);
    const w = this.camera.screenToWorld(p.x, p.y);
    if (!this.dragging.moved) {
      if (Math.hypot(w.x - this.dragging.startPointer.x, w.y - this.dragging.startPointer.y) < DRAG_THRESHOLD) return;
      this.dragging.moved = true;
      pushHistory();
      // Record start positions of all dragged nodes
      this.dragging.startNodes = {};
      const topo = getTopology();
      for (const id of this.dragging.ids) {
        const n = topo.nodes[id];
        if (n) this.dragging.startNodes[id] = { x: n.x, y: n.y };
      }
      bus.emit("nodedrag:start", { ids: this.dragging.ids });
    }

    let totalDx = w.x - this.dragging.startPointer.x;
    let totalDy = w.y - this.dragging.startPointer.y;

    if (isSnapToGrid()) {
      // Snap the grabbed node's POSITION to the lattice (not the delta) —
      // otherwise a node that starts at x=87 stays off-grid forever and
      // entities never line up with each other or with the dots. The rest
      // of the selection keeps its relative offsets.
      const g = getSnapGrid();
      const anchor = this.dragging.startNodes[this.dragging.id];
      if (anchor) {
        totalDx = Math.round((anchor.x + totalDx) / g) * g - anchor.x;
        totalDy = Math.round((anchor.y + totalDy) / g) * g - anchor.y;
      } else {
        totalDx = Math.round(totalDx / g) * g;
        totalDy = Math.round(totalDy / g) * g;
      }
    }

    const deltaFromLast = {
      x: totalDx - this.dragging.appliedDx,
      y: totalDy - this.dragging.appliedDy,
    };
    if (deltaFromLast.x || deltaFromLast.y) {
      moveSelection(this.dragging.ids, deltaFromLast.x, deltaFromLast.y);
      this.dragging.appliedDx = totalDx;
      this.dragging.appliedDy = totalDy;
    }
    bus.emit("nodedrag:move", { ids: this.dragging.ids });
    e.preventDefault();
  }

  onUp(e) {
    if (!this.dragging) return;
    const d = this.dragging;
    this.dragging = null;
    if (d.moved) bus.emit("nodedrag:end", { ids: d.ids });
  }
}