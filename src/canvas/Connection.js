// canvas/Connection.js
// Connection flow supports both gestures:
//   - Drag: press a port → drag → release on a target node → edge created.
//   - Click-click: click a port (press+release in place) → rubber-band
//     follows the cursor → click a target node → edge created.
//   Escape or clicking empty canvas cancels.
//
// Target detection uses bounding-box hit testing in world coordinates,
// NOT document.elementFromPoint. This bypasses z-index/overlap issues
// where the inspector panel covers canvas nodes. Non-group nodes win over
// groups, and the smallest box wins among overlaps, so connecting to a
// node inside a VPC hits the node, not the VPC.
//
// The pointerdown listener is registered in the CAPTURE phase: when a
// session is live, the finishing click is swallowed before it reaches the
// target node's card, so it doesn't re-select the target or arm NodeDrag.

import { svg } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { getTopology } from "../core/store.js";
import { isGroupKind } from "./nodes/kinds.js";
import api from "../core/api.js";

const DRAG_THRESHOLD = 4; // px of pointer travel that turns a click into a drag

export class Connection {
  constructor(host, camera, world) {
    this.host = host;
    this.camera = camera;
    this.world = world;

    this.rubber = svg("path", {
      class: "rubber-band",
      fill: "none",
      stroke: "var(--accent)",
      "stroke-width": 2,
      "stroke-dasharray": "5 3",
      "pointer-events": "none",
    });
    this.rubber.style.display = "none";
    world.edgeSvg.appendChild(this.rubber);

    this.session = null;

    bus.on("connection:start", (p) => this.begin(p));
    // Capture phase: on the initiating port press the session doesn't
    // exist yet (begin() runs in the port's target-phase handler), so
    // this only intercepts *subsequent* presses while a session is live.
    document.addEventListener("pointerdown", (e) => this.onDown(e), true);
    document.addEventListener("pointermove", (e) => this.onMove(e));
    document.addEventListener("pointerup", (e) => this.onUp(e));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.session) this.cancel();
    });
  }

  begin({ fromId, side, clientX, clientY }) {
    if (api.isViewer) return; // read-only role: no edge creation
    const fromView = this.world.renderer.views.get(fromId);
    if (!fromView) return;
    const anchor = fromView.portAnchor
      ? fromView.portAnchor(side || "e")
      : { x: fromView.node.x + fromView.node.w / 2, y: fromView.node.y + fromView.node.h / 2 };
    this.session = {
      fromId,
      anchor,
      overId: null,
      downX: clientX,
      downY: clientY,
      dragged: false,   // pointer travelled past DRAG_THRESHOLD since the press
      armed: false,     // initiating press released without drag → click-click mode
    };
    this.host.classList.add("is-connecting");
    this.rubber.style.display = "";
    this.updateRubber(this.clientToWorld(clientX, clientY));
  }

  /** Find the best node under the given world point. Non-group nodes beat
   *  groups; among overlaps the smallest box wins (≈ visually topmost). */
  hitTest(wx, wy) {
    const topo = getTopology();
    let best = null, bestArea = Infinity;
    let bestGroup = null, bestGroupArea = Infinity;
    for (const [id, node] of Object.entries(topo.nodes)) {
      if (id === this.session?.fromId) continue;
      if (wx < node.x || wx > node.x + node.w ||
          wy < node.y || wy > node.y + node.h) continue;
      const area = node.w * node.h;
      if (isGroupKind(node.kind)) {
        if (area < bestGroupArea) { bestGroup = id; bestGroupArea = area; }
      } else if (area < bestArea) {
        best = id; bestArea = area;
      }
    }
    return best ?? bestGroup;
  }

  onMove(e) {
    if (!this.session) return;
    const s = this.session;
    if (!s.dragged &&
        Math.hypot(e.clientX - s.downX, e.clientY - s.downY) > DRAG_THRESHOLD) {
      s.dragged = true;
    }
    const w = this.clientToWorld(e.clientX, e.clientY);
    const overId = this.hitTest(w.x, w.y);
    if (overId !== s.overId) {
      if (s.overId) this.setDropTarget(s.overId, false);
      if (overId) this.setDropTarget(overId, true);
      s.overId = overId;
    }
    this.updateRubber(w, overId);
  }

  /** Release of the initiating press: a real drag completes the edge;
   *  a click in place arms click-click mode and keeps the session. */
  onUp(e) {
    const s = this.session;
    if (!s || s.armed) return;
    if (s.dragged) this.complete(e);
    else s.armed = true;
  }

  /** Any press while a session is live finishes (or cancels) it. Swallow
   *  the event so it never reaches node cards / NodeDrag / pan. */
  onDown(e) {
    if (!this.session || !this.session.armed) return;
    e.stopPropagation();
    e.preventDefault();
    this.complete(e);
  }

  complete(e) {
    const w = this.clientToWorld(e.clientX, e.clientY);
    const targetId = this.hitTest(w.x, w.y);
    if (targetId) {
      bus.emit("edge:create", {
        from: this.session.fromId,
        to: targetId,
        kind: "tcp",
      });
    }
    this.cancel();
  }

  cancel() {
    if (this.session?.overId) this.setDropTarget(this.session.overId, false);
    this.session = null;
    this.rubber.style.display = "none";
    this.host.classList.remove("is-connecting");
  }

  updateRubber(toWorld, targetId) {
    const from = this.session.anchor;
    let to = toWorld;
    if (targetId) {
      const topo = getTopology();
      const n = topo.nodes[targetId];
      if (n) to = borderPoint(n, from);
    }
    const d = `M ${from.x} ${from.y} C ${from.x + (to.x - from.x) * 0.5} ${from.y}, ${to.x - (to.x - from.x) * 0.5} ${to.y}, ${to.x} ${to.y}`;
    this.rubber.setAttribute("d", d);
  }

  setDropTarget(nodeId, on) {
    const v = this.world.renderer.views.get(nodeId);
    const el = v?.card || v?.el;
    if (el) el.classList.toggle("is-drop-target", on);
  }

  clientToWorld(clientX, clientY) {
    const p = this.camera.clientToHost(clientX, clientY);
    return this.camera.screenToWorld(p.x, p.y);
  }
}

function borderPoint(a, target) {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const tx = dx === 0 ? Infinity : (a.w / 2) / Math.abs(dx);
  const ty = dy === 0 ? Infinity : (a.h / 2) / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}
