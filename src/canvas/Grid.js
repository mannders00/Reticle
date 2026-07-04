// canvas/Grid.js
// Dotted background that IS the snap lattice: dots sit exactly on world
// multiples of the store's snap grid, tracking camera pan and zoom, so
// what you see is precisely what nodes snap to. At low zoom the spacing
// steps up by powers of two (still a subset of the lattice) to keep dot
// density sane.

import { svg } from "../core/dom.js";

export class Grid {
  constructor(host) {
    this.host = host;
    this.defs = svg("defs", { class: "grid-defs" });
    this.pattern = svg("pattern", {
      id: "reticle-grid",
      patternUnits: "userSpaceOnUse",
      width: 20,
      height: 20,
    });
    // Dot lives at the tile centre (never clipped by the tile edge); the
    // pattern origin is offset half a tile in update() so dots land on
    // whole lattice points.
    this.dot = svg("circle", { cx: 10, cy: 10, r: 1, fill: "rgba(140,155,180,0.18)" });
    this.pattern.append(this.dot);
    this.defs.append(this.pattern);

    this.cover = svg("rect", {
      class: "grid-layer",
      x: 0,
      y: 0,
      width: "100%",
      height: "100%",
      fill: "url(#reticle-grid)",
      "pointer-events": "none",
    });
  }

  /** Append pattern defs + cover rect into the given <svg> root. */
  mount(rootSvg) {
    rootSvg.append(this.defs, this.cover);
  }

  /** Anchor the pattern to the camera so every dot is a world point at a
   *  multiple of snapGrid. Called from World.applyTransform(). */
  update(camera, snapGrid = 20) {
    const z = camera.zoom;
    let G = snapGrid;
    while (G * z < 12) G *= 2; // sparser subset when zoomed far out
    const tile = G * z;

    // World (0,0) sits at screen (-cam.x * z, -cam.y * z); shift the tile
    // origin so tile centres (where the dot is) land on that lattice.
    const ox = mod(-camera.x * z - tile / 2, tile);
    const oy = mod(-camera.y * z - tile / 2, tile);

    this.pattern.setAttribute("width", round(tile));
    this.pattern.setAttribute("height", round(tile));
    this.pattern.setAttribute("x", round(ox));
    this.pattern.setAttribute("y", round(oy));
    this.dot.setAttribute("cx", round(tile / 2));
    this.dot.setAttribute("cy", round(tile / 2));
    this.dot.setAttribute("r", Math.min(1.3, Math.max(0.7, z)));
  }
}

function mod(a, n) {
  return ((a % n) + n) % n;
}

function round(n, p = 4) {
  const m = 10 ** p;
  return Math.round(n * m) / m;
}
