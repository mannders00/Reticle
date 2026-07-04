// canvas/Camera.js
// Pure numeric model of the viewport over the infinite world. No DOM.
//
// Coordinates:
//   world  (wx, wy): the canvas's logical coordinates
//   screen (sx, sy): pixel coords inside the .canvas-host
//
// The transform we apply to <g.world> is:
//     translate(sx, sy) * scale(zoom) * translate(-camX, -camY)
// meaning camX/camY is the world point that sits at the host's top-left
// anchor. We round to 0.01px to keep string attributes short.
//
// All pan/zoom math is here; Interaction.js calls these methods in
// response to pointer/wheel events. World.js reads .transform().

import { clamp } from "../core/dom.js";

export class Camera {
  constructor({ x = 0, y = 0, zoom = 1, host } = {}) {
    this.x = x; // world coords at top-left of host
    this.y = y;
    this.zoom = zoom;
    this.host = host; // we read offsetWidth/Height from here
    this.minZoom = 0.1;
    this.maxZoom = 4;

    // momentum damping (used by Interaction inertia)
    this.vx = 0;
    this.vy = 0;
  }

  resize() {
    // Intentionally inert: we read latest size on demand from this.host.
  }

  /** World point that maps to a given screen point. */
  screenToWorld(sx, sy) {
    return {
      x: this.x + sx / this.zoom,
      y: this.y + sy / this.zoom,
    };
  }
  /** Screen pixel for a given world point. */
  worldToScreen(wx, wy) {
    return {
      x: (wx - this.x) * this.zoom,
      y: (wy - this.y) * this.zoom,
    };
  }

  /** Pan by a screen-space delta (pixels). */
  panBy(dxScreen, dyScreen) {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /** Center a world point at a given screen anchor. */
  centerOn(wx, wy, screenAnchor = null) {
    const { w, h } = this.size();
    const ax = screenAnchor?.x ?? w / 2;
    const ay = screenAnchor?.y ?? h / 2;
    this.x = wx - ax / this.zoom;
    this.y = wy - ay / this.zoom;
  }

  /** Zoom toward a screen anchor (keeps the world point under cursor still). */
  zoomAt(screenX, screenY, factor) {
    const prevZoom = this.zoom;
    const nextZoom = clamp(prevZoom * factor, this.minZoom, this.maxZoom);
    if (nextZoom === prevZoom) return nextZoom;

    // Keep the world point under `screenX/Y` anchored:
    //   world = cam + screen/zoom  (must be constant before/after)
    const wx = this.x + screenX / prevZoom;
    const wy = this.y + screenY / prevZoom;
    this.zoom = nextZoom;
    this.x = wx - screenX / nextZoom;
    this.y = wy - screenY / nextZoom;
    return nextZoom;
  }

  /** Set zoom exactly (no anchor). */
  setZoom(z) {
    this.zoom = clamp(z, this.minZoom, this.maxZoom);
  }

  /** Fit the given world bbox into the viewport with padding. */
  fitBounds(bbox, pad = 0.08) {
    const { w, h } = this.size();
    const bw = bbox.x2 - bbox.x1 || 1;
    const bh = bbox.y2 - bbox.y1 || 1;
    const availableW = w * (1 - pad * 2);
    const availableH = h * (1 - pad * 2);
    const z = clamp(
      Math.min(availableW / bw, availableH / bh),
      this.minZoom,
      this.maxZoom,
    );
    this.zoom = z;
    this.centerOn(bbox.x1 + bw / 2, bbox.y1 + bh / 2);
  }

  /** Current app-wide UI scale (⌘+/-). getBoundingClientRect and pointer
   *  clientX/Y are in VISUAL px; camera math runs in logical px, so every
   *  pointer→camera conversion must divide by this. */
  uiScale() {
    return parseFloat(localStorage.getItem("reticle-ui-scale")) || 1;
  }

  /** Pointer client coords → host-logical px (the space screenToWorld
   *  expects). The single sanctioned path from events to camera math. */
  clientToHost(clientX, clientY) {
    const r = this.host.getBoundingClientRect();
    const s = this.uiScale();
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  size() {
    const r = this.host.getBoundingClientRect();
    // Divide by UI scale — getBoundingClientRect returns the *scaled*
    // dimensions when #app has a CSS transform. We need the unscaled
    // (logical) dimensions for camera math.
    const scale = this.uiScale();
    return { w: (r.width || 1) / scale, h: (r.height || 1) / scale };
  }

  /** Serialized transform string for the <g.world> element. */
  transform() {
    const z = round(this.zoom, 5);
    const x = round(this.x, 2);
    const y = round(this.y, 2);
    return `scale(${z}) translate(${round(-x, 2)} ${round(-y, 2)})`;
  }
}

function round(n, p = 2) {
  const m = 10 ** p;
  return Math.round(n * m) / m;
}