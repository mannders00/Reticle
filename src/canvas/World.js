// canvas/World.js
// Single-layer architecture: one HTML container holds everything.
// SVG (for edges + grid) and HTML divs (for nodes + groups) are children
// of the same transformed container. This eliminates the dual-layer
// drift problem where SVG and HTML transforms diverge during pan/zoom.
//
// Structure:
//   .canvas-host
//     svg.world-svg              ← grid pattern (fixed, not transformed)
//     .world-layer               ← transformed by camera (CSS transform)
//       svg.edge-svg             ← edges (bezier paths, in world coords)
//       .node-wrapper × N        ← node cards (HTML divs)
//       .group-wrapper × M       ← group boundaries (HTML divs)

import { Camera } from "./Camera.js";
import { Grid } from "./Grid.js";
import { Renderer } from "./Renderer.js";
import { Interaction } from "./Interaction.js";
import { bus } from "../core/eventBus.js";
import { svg } from "../core/dom.js";
import { getSnapGrid } from "../core/store.js";

// Desktop (WKWebView) needs the zoom-at-rest strategy for crisp text;
// Chromium re-rasterizes transformed layers fine once will-change drops.
const WEBKIT_ZOOM_AT_REST = !!window.__TAURI__;

// Whether the engine multiplies an element's own transform translate by
// its `zoom` (the standardized behavior; Chromium does). Measured once at
// runtime instead of assumed — if the desktop WebKit differs, an assumed
// divisor would park the world layer at the wrong offset every settle.
let _zoomMultiplied = null;
function zoomMultipliesTranslate() {
  if (_zoomMultiplied !== null) return _zoomMultiplied;
  try {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:10px;height:10px;zoom:2;" +
      "transform:translate(100px,0);visibility:hidden;pointer-events:none;";
    document.body.appendChild(probe);
    const x = probe.getBoundingClientRect().left;
    probe.remove();
    _zoomMultiplied = x > 150; // 200 = multiplied, 100 = plain
  } catch {
    _zoomMultiplied = true;
  }
  return _zoomMultiplied;
}

export class World {
  constructor(host) {
    this.host = host;
    this.camera = new Camera({ zoom: 1, host });
    this.grid = new Grid(host);

    // Grid SVG — fixed, not transformed. Sits behind everything.
    this.gridSvg = svg("svg", { class: "grid-svg" });
    this.grid.mount(this.gridSvg);
    host.appendChild(this.gridSvg);

    // The single transformed layer — everything inside shares one
    // CSS transform, so nodes, edges, and groups never drift apart.
    this.worldLayer = document.createElement("div");
    this.worldLayer.className = "world-layer";
    host.appendChild(this.worldLayer);

    // SVG for edges — inside the world layer, in world coordinates.
    // The viewBox must mirror the CSS offset (left/top: -100000px), so
    // the SVG's internal origin lines up with world (0,0); without it
    // every path renders 100000px off-screen.
    this.edgeSvg = svg("svg", {
      class: "edge-svg",
      viewBox: "-100000 -100000 200000 200000",
    });
    this.worldLayer.appendChild(this.edgeSvg);

    // Renderer puts node/group divs and edge paths in here.
    this.renderer = new Renderer(this);
    this.interaction = new Interaction(host, this.camera, this);

    this.ro = new ResizeObserver(() => this.handleResize());
    this.ro.observe(host);
    this.handleResize();
    this.applyTransform();

    bus.on("camera:fit", (bbox) => this.fit(bbox));
    bus.on("camera:zoom-at", ({ x, y, factor }) => {
      this.camera.zoomAt(x, y, factor);
      this.applyTransform();
    });
  }

  handleResize() {
    // No viewBox on the grid svg — its user units are then its own CSS
    // pixels, i.e. the SAME logical space the world-layer transform uses.
    // (A viewBox derived from getBoundingClientRect breaks under UI scale:
    // the rect is visually scaled, so the grid pans at 1/uiScale of the
    // content's rate — the "not universally locked" bug.)
    this.applyTransform();
  }

  applyTransform() {
    const z = this.camera.zoom;
    // Single CSS transform for everything — nodes, edges, groups.
    // world point (wx, wy) → screen ((wx - cx) * z, (wy - cy) * z)
    // CSS: translate(-cx*z, -cy*z) scale(z) with origin 0,0
    const tx = -this.camera.x * z;
    const ty = -this.camera.y * z;
    this.worldLayer.style.zoom = ""; // interactive mode is pure transform
    this.worldLayer.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
    this.worldLayer.style.transformOrigin = "0 0";
    this.grid.update(this.camera, getSnapGrid());

    // Text sharpness: promote the layer (will-change) only while moving,
    // then settle — drop the promotion and snap the translation to whole
    // device pixels so glyphs land on the pixel grid.
    this.worldLayer.classList.add("is-interacting");
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this.worldLayer.classList.remove("is-interacting");
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.round(tx * dpr) / dpr;
      const sy = Math.round(ty * dpr) / dpr;
      if (WEBKIT_ZOOM_AT_REST) {
        // WKWebView composites any transformed layer and rescales its
        // cached raster → blurry glyphs no matter what. CSS `zoom` is a
        // LAYOUT-time scale, so text re-rasterizes at native resolution.
        // Only at rest (zoom relayouts are too heavy mid-gesture). NOTE:
        // the element's own transform lengths are multiplied by its zoom
        // (verified against the standardized behavior), so divide the
        // screen-pixel pan by z here.
        const div = zoomMultipliesTranslate() ? z : 1;
        this.worldLayer.style.zoom = String(z);
        this.worldLayer.style.transform = `translate(${sx / div}px, ${sy / div}px)`;
      } else {
        this.worldLayer.style.transform = `translate(${sx}px, ${sy}px) scale(${z})`;
      }
    }, 140);
  }

  fit(bbox) {
    this.camera.fitBounds(bbox);
    this.applyTransform();
  }

  setZoom(z) {
    this.camera.setZoom(z);
    this.applyTransform();
  }
}