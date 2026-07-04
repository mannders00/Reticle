// canvas/edges/EdgeView.js
// One instance per edge. Renders a cubic bézier whose endpoints snap to
// the *border* of the source/target boxes (rather than the centre) so the
// line doesn't pierce through the card. Adds an arrowhead for directed
// edges and a centred label with a stroke halo for legibility on any
// background. Re-routes whenever endpoint nodes move or resize.
//
// Update strategy: views subscribe to `node:moved` / `node:resized`
// themselves (cheap; just re-reads the store) so the Renderer doesn't have
// to track which edges touch which nodes.

import { svg } from "../../core/dom.js";
import { bus } from "../../core/eventBus.js";
import { getTopology, select } from "../../core/store.js";
import { EDGE_STYLES } from "./styles.js";

export class EdgeView {
  constructor(edge, layer) {
    this.id = edge.id;
    this.edge = edge;
    this.layer = layer;

    this.path = svg("path", { class: "edge", fill: "none", "data-id": edge.id, "data-kind": edge.kind });
    this.hit = svg("path", {
      class: "edge-hit",
      fill: "none",
      stroke: "transparent",
      "stroke-width": 14,
      "data-id": edge.id,
      "data-kind": edge.kind,
    });
    this.hit.style.cursor = "pointer";
    // Click selects the edge (Delete key then removes it); double-click
    // opens the inline label editor at the curve midpoint.
    this.hit.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      select([this.edge.id], e.shiftKey ? "toggle" : "replace");
    });
    this.hit.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      bus.emit("edge:label", { id: this.edge.id, x: this._mid?.x, y: this._mid?.y });
    });
    this.arrow = svg("path", { class: "edge-arrow", fill: "currentColor" });
    this.labelBg = svg("rect", { class: "edge-label-bg", rx: 4, ry: 4 });
    this.labelText = svg("text", { class: "edge-label", "text-anchor": "middle", "dominant-baseline": "middle" });

    layer.append(this.path, this.arrow, this.hit, this.labelBg, this.labelText);

    this._onMoved = ({ id }) => {
      if (id === this.edge.from || id === this.edge.to) this.reroute();
    };
    bus.on("node:moved", this._onMoved);
    bus.on("node:resized", this._onMoved);

    this.reroute();
  }

  setEdge(edge) {
    this.edge = edge;
    this.path.setAttribute("data-kind", edge.kind);
    this.hit.setAttribute("data-kind", edge.kind);
    this.reroute();
  }

  setSelected(on) {
    this.path.classList.toggle("is-selected", on);
  }

  /** Recompute endpoints + curve + label from current topology. */
  reroute() {
    const topo = getTopology();
    const a = topo.nodes[this.edge.from];
    const b = topo.nodes[this.edge.to];
    if (!a || !b) return;
    const style = EDGE_STYLES[this.edge.kind] || EDGE_STYLES.tcp;

    // Anchor endpoints on the border between the two box centres.
    const [ax, ay] = borderPoint(a, b);
    const [bx, by] = borderPoint(b, a);

    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    // Cubic control offset — flatSlinky curve; emphasise the dominant axis.
    const flat = 0.5;
    const cx1 = ax + dx * flat;
    const cy1 = ay;
    const cx2 = bx - dx * flat;
    const cy2 = by;

    const d = `M ${ax} ${ay} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${bx} ${by}`;
    this.path.setAttribute("d", d);
    this.hit.setAttribute("d", d);
    this.path.setAttribute("stroke", style.color);
    this.path.setAttribute("stroke-width", style.width);
    this.path.setAttribute("stroke-dasharray", style.dash || "");
    this.path.style.color = style.color;
    this.arrow.style.color = style.color;

    // Arrowhead at the "to" end (skip for peering / mgmt / undirected).
    if (style.arrow !== false) {
      // Direction at t=1 of the bezier is approximately (bx-cx2, by-cy2).
      const ang = Math.atan2(by - cy2, bx - cx2);
      const size = 8;
      const tipX = bx, tipY = by;
      const baseX = bx - size * Math.cos(ang);
      const baseY = by - size * Math.sin(ang);
      const leftX = bx - size * Math.cos(ang - 0.42);
      const leftY = by - size * Math.sin(ang - 0.42);
      const rightX = bx - size * Math.cos(ang + 0.42);
      const rightY = by - size * Math.sin(ang + 0.42);
      this.arrow.setAttribute("d",
        `M ${tipX} ${tipY} L ${leftX} ${leftY} L ${rightX} ${rightY} Z`);
      this.arrow.style.display = "";
    } else {
      this.arrow.style.display = "none";
    }

    // Double stroke for peering — render a parallel path by translating
    // the dash + drawing a second line. v1 keeps it simple: bump width.
    if (style.double) {
      this.path.setAttribute("stroke-width", style.width + 1.6);
    }

    // Curve midpoint (t=0.5) — label anchor + inline-editor position.
    const mx = (ax + 2 * cx1 + 2 * cx2 + bx) / 6;
    const my = (ay + 2 * cy1 + 2 * cy2 + by) / 6;
    this._mid = { x: mx, y: my };

    if (this.edge.label) {
      this.labelText.textContent = this.edge.label;
      this.labelText.setAttribute("x", mx);
      this.labelText.setAttribute("y", my);
      this.labelText.style.display = "";
      // Approximate the bg box: measure after placement
      requestAnimationFrame(() => {
        const box = this.labelText.getBBox();
        this.labelBg.setAttribute("x", box.x - 5);
        this.labelBg.setAttribute("y", box.y - 1);
        this.labelBg.setAttribute("width", box.width + 10);
        this.labelBg.setAttribute("height", box.height + 2);
        this.labelBg.style.display = "";
      });
      // Bring label to front
      this.layer.append(this.labelBg, this.labelText);
    } else {
      this.labelText.style.display = "none";
      this.labelBg.style.display = "none";
    }
  }

  destroy() {
    bus.off("node:moved", this._onMoved);
    bus.off("node:resized", this._onMoved);
    this.path.remove();
    this.hit.remove();
    this.arrow.remove();
    this.labelBg.remove();
    this.labelText.remove();
  }
}

/**
 * Find the point on `a`'s border that the line from a's centre toward b's
 * centre exits through. Used for both endpoints (call with a,b then b,a).
 * Returns [x, y] in world coords.
 */
function borderPoint(a, b) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = (b.x + b.w / 2) - cx;
  const dy = (b.y + b.h / 2) - cy;
  if (!dx && !dy) return [cx, cy];
  // Time to hit each border on x and y; pick the smaller.
  const hw = a.w / 2;
  const hh = a.h / 2;
  const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
  const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t];
}