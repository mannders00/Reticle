// canvas/ResizeDrag.js
// Dragging a resize handle on a selected node. Computes new x/y/w/h based
// on which edge/corner is being dragged, enforces a minimum size, and
// snaps to the grid when enabled.

import { bus } from "../core/eventBus.js";
import {
  resizeNode, isSnapToGrid, getSnapGrid, pushHistory, getNode,
} from "../core/store.js";

const MIN_W = 80;
const MIN_H = 60;
const DRAG_THRESHOLD = 3;

export class ResizeDrag {
  constructor(host, camera) {
    this.host = host;
    this.camera = camera;
    this.session = null;

    bus.on("resize:start", (p) => this.begin(p));
    document.addEventListener("pointermove", (e) => this.onMove(e));
    document.addEventListener("pointerup", () => this.onUp());
  }

  begin({ id, edge, clientX, clientY, pointerId }) {
    const p = this.camera.clientToHost(clientX, clientY);
    const startWorld = this.camera.screenToWorld(p.x, p.y);
    // Read the node's current geometry from the store (works for both
    // NodeView foreignObjects and GroupView SVG groups).
    const n = getNode(id);
    if (!n) return;
    const node = { x: n.x, y: n.y, w: n.w, h: n.h };
    this.session = {
      id, edge, startWorld, node, pointerId, moved: false,
      appliedW: node.w, appliedH: node.h, appliedX: node.x, appliedY: node.y,
    };
  }

  onMove(e) {
    if (!this.session) return;
    const s = this.session;
    const p = this.camera.clientToHost(e.clientX, e.clientY);
    const w = this.camera.screenToWorld(p.x, p.y);

    if (!s.moved) {
      if (Math.hypot(w.x - s.startWorld.x, w.y - s.startWorld.y) < DRAG_THRESHOLD) return;
      s.moved = true;
      pushHistory(); // one checkpoint per resize gesture
    }

    let dx = w.x - s.startWorld.x;
    let dy = w.y - s.startWorld.y;
    const edge = s.edge;
    const n = s.node;

    // Compute new geometry based on which edge/corner is dragged
    let nx = n.x, ny = n.y, nw = n.w, nh = n.h;

    // Horizontal
    if (edge.includes("e")) {
      nw = n.w + dx;
    } else if (edge.includes("w")) {
      nw = n.w - dx;
      nx = n.x + dx;
    }
    // Vertical
    if (edge.includes("s")) {
      nh = n.h + dy;
    } else if (edge.includes("n")) {
      nh = n.h - dy;
      ny = n.y + dy;
    }

    // Enforce minimums — if we hit a min, clamp and adjust position
    if (nw < MIN_W) {
      if (edge.includes("w")) nx = n.x + (n.w - MIN_W);
      nw = MIN_W;
    }
    if (nh < MIN_H) {
      if (edge.includes("n")) ny = n.y + (n.h - MIN_H);
      nh = MIN_H;
    }

    // Snap to grid
    if (isSnapToGrid()) {
      const g = getSnapGrid();
      nx = Math.round(nx / g) * g;
      ny = Math.round(ny / g) * g;
      nw = Math.round(nw / g) * g;
      nh = Math.round(nh / g) * g;
    }

    // Only call resizeNode if something actually changed
    if (nx !== s.appliedX || ny !== s.appliedY || nw !== s.appliedW || nh !== s.appliedH) {
      resizeNode(s.id, nx, ny, Math.max(nw, MIN_W), Math.max(nh, MIN_H));
      s.appliedX = nx; s.appliedY = ny; s.appliedW = nw; s.appliedH = nh;
    }
    e.preventDefault();
  }

  onUp() {
    this.session = null;
  }
}