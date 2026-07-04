// canvas/Interaction.js
// Pointer + wheel handling for the canvas host. All gestures funnel
// through one Pointer Events stream (mouse / trackpad / touch unified),
// which gives us natural momentum and pinch-to-zoom support.

import { bus } from "../core/eventBus.js";
import { isNaturalScroll } from "../core/store.js";

const FRICTION = 0.92;
const STOP_V = 0.04;
const FLICK_DECAY_MS = 16;

export class Interaction {
  constructor(host, camera, world) {
    this.host = host;
    this.camera = camera;
    this.world = world;

    this.pointers = new Map();
    this.panning = false;
    this.lastPanX = 0;
    this.lastPanY = 0;
    this.moving = false;
    this.naturalScroll = isNaturalScroll(); // persisted across sessions

    this.pinchStartDist = 0;
    this.pinchStartZoom = 1;
    this.flickRaf = 0;

    bus.on("ui:natural-scroll", ({ on }) => { this.naturalScroll = on; });

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onWheel = this.onWheel.bind(this);

    // pointerdown on host so we only start panning from canvas-originated
    // events. pointermove/up on document so panning continues even when
    // the pointer leaves the host (and because WKWebView routes events
    // to document, not window, in some cases).
    host.addEventListener("pointerdown", this.onPointerDown);
    document.addEventListener("pointermove", this.onPointerMove, { passive: false });
    document.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("pointercancel", this.onPointerCancel);
    host.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("blur", this.onWindowBlur = this.onWindowBlur.bind(this));
  }

  isOnNode(target) {
    if (target?.classList?.contains("node-resize-handle") ||
        target?.classList?.contains("group-resize-handle")) return true;
    if (target?.closest?.(".node-wrapper")) return true;
    if (target?.closest?.(".group-wrapper")) return true;
    return false;
  }

  onPointerDown(e) {
    this.stopFlick();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      if (this.isOnNode(e.target)) return;
      this.panning = true;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;
      this.host.classList.add("is-panning");
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.movedDuringPan = false;
    } else if (this.pointers.size === 2) {
      this.panning = false;
      const [a, b] = [...this.pointers.values()];
      this.pinchStartDist = dist(a, b) || 1;
      this.pinchStartZoom = this.camera.zoom;
    }
  }

  onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size >= 2) {
      this.doPinch();
      return;
    }

    if (!this.panning) return;
    // Pointer deltas are visual px; camera pans in logical px (UI scale).
    const s = this.camera.uiScale();
    const dx = (e.clientX - this.lastPanX) / s;
    const dy = (e.clientY - this.lastPanY) / s;
    if (dx || dy) this.movedDuringPan = true;
    this.camera.panBy(dx, dy);
    this.lastPanX = e.clientX;
    this.lastPanY = e.clientY;
    this.vx = dx;
    this.vy = dy;
    this.lastMoveAt = performance.now();
    this.world.applyTransform();
  }

  doPinch() {
    const pts = [...this.pointers.values()];
    const d = dist(pts[0], pts[1]) || 1;
    const factor = d / this.pinchStartDist;
    const mid = this.camera.clientToHost(
      (pts[0].x + pts[1].x) / 2,
      (pts[0].y + pts[1].y) / 2,
    );
    this.camera.setZoom(this.pinchStartZoom * factor);
    this.world.applyTransform();
    const wp = this.camera.screenToWorld(mid.x, mid.y);
    this.camera.centerOn(wp.x, wp.y, mid);
    this.world.applyTransform();
  }

  onPointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStartDist = 0;
    if (this.pointers.size === 0) {
      this.host.classList.remove("is-panning");
      if (this.panning) {
        this.panning = false;
        // Momentum only when the release follows recent motion — holding
        // still then letting go must not fling (vx/vy would otherwise
        // retain the last move's stale velocity indefinitely).
        const fresh = performance.now() - (this.lastMoveAt ?? 0) < 90;
        if (fresh && (this.vx || this.vy) && Math.hypot(this.vx, this.vy) > 1.5)
          this.startFlick();
        else if (!this.movedDuringPan) {
          const p = this.camera.clientToHost(this.downX, this.downY);
          bus.emit("canvas:tap", { screenX: p.x, screenY: p.y });
        }
      }
    } else if (this.pointers.size === 1) {
      const [p] = [...this.pointers.values()];
      this.panning = true;
      this.lastPanX = p.x;
      this.lastPanY = p.y;
    }
  }

  onPointerCancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.panning = false;
      this.host.classList.remove("is-panning");
    }
  }

  onWindowBlur() {
    this.pointers.clear();
    this.panning = false;
    this.stopFlick();
  }

  onWheel(e) {
    if (e.ctrlKey) {
      // Trackpad pinch-to-zoom
      e.preventDefault();
      const p = this.camera.clientToHost(e.clientX, e.clientY);
      const factor = Math.pow(0.99, e.deltaY);
      this.camera.zoomAt(p.x, p.y, factor);
      this.world.applyTransform();
      this.stopFlick();
    } else {
      // Two-finger scroll → pan (deltas are visual px → logical)
      e.preventDefault();
      const s = this.camera.uiScale();
      const scrollMul = (this.naturalScroll ? 1 : -1) / s;
      this.camera.panBy(e.deltaX * scrollMul, e.deltaY * scrollMul);
      this.world.applyTransform();
      this.stopFlick();
    }
  }

  startFlick() {
    const step = () => {
      // Momentum continues in the SAME direction as the gesture — panBy's
      // sign convention matches the live-pan path above (a negated delta
      // here made flicks bounce backwards against the drag).
      this.camera.panBy(this.vx * FLICK_DECAY_MS * 0.06, this.vy * FLICK_DECAY_MS * 0.06);
      this.vx *= FRICTION;
      this.vy *= FRICTION;
      this.world.applyTransform();
      if (Math.abs(this.vx) > STOP_V || Math.abs(this.vy) > STOP_V)
        this.flickRaf = requestAnimationFrame(step);
      else this.stopFlick();
    };
    this.flickRaf = requestAnimationFrame(step);
  }
  stopFlick() {
    if (this.flickRaf) cancelAnimationFrame(this.flickRaf);
    this.flickRaf = 0;
    this.vx = 0;
    this.vy = 0;
  }

  hostRect() {
    return this.host.getBoundingClientRect();
  }
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}