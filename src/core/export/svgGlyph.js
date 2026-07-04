// core/export/svgGlyph.js
// Renders the SVG subset used by canvas/nodes/icons.js into PdfWriter
// path operators, so exported PDFs carry the same kind icons as the
// canvas (a database looks like a database on paper too).
//
// Supported: <rect> (rx), <circle>, <ellipse>, <path d> with
// M L H V C Q T A Z (upper/lower), <text>, currentColor stroke/fill,
// stroke-width, opacity (approximated by blending toward the card
// background — PDF alpha would need ExtGState machinery we don't want).

const EL_RE = /<(rect|circle|ellipse|path)\b([^>]*?)\/>|<text\b([^>]*?)>([^<]*)<\/text>/g;
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g;

/**
 * Draw one icon glyph (24×24 viewBox markup) into the page.
 * @param pdf   PdfWriter
 * @param markup inner-SVG string from icons.js
 * @param x,y   top-left of the icon box (page pts, top-origin)
 * @param size  icon box edge in pts
 * @param color hex for currentColor
 * @param bg    hex the icon sits on (for opacity blending)
 */
export function drawGlyph(pdf, markup, x, y, size, color, bg = "#ffffff") {
  const s = size / 24;
  const tx = (v) => x + v * s;
  const ty = (v) => y + v * s;

  pdf.setRoundCaps(true);
  EL_RE.lastIndex = 0;
  let m;
  while ((m = EL_RE.exec(markup))) {
    const tag = m[1] || "text";
    const attrs = parseAttrs(tag === "text" ? m[3] : m[2]);
    const content = m[4];

    const opacity = attrs.opacity != null ? parseFloat(attrs.opacity) : 1;
    const col = opacity < 1 ? blend(color, bg, opacity) : color;
    const hasStroke = attrs.stroke === "currentColor";
    const hasFill = attrs.fill === "currentColor";
    const lw = Math.max(0.35, (parseFloat(attrs["stroke-width"]) || 1) * s);

    const paint = () => {
      if (hasFill) pdf.setFill(col);
      if (hasStroke) { pdf.setStroke(col); pdf.setLineWidth(lw); pdf.setDash(null); }
      if (hasFill && hasStroke) pdf.fillStroke();
      else if (hasFill) pdf.fill();
      else if (hasStroke) pdf.stroke();
    };

    if (tag === "rect") {
      const rx = parseFloat(attrs.rx) || 0;
      const [rx0, ry0, rw, rh] = ["x", "y", "width", "height"].map((k) => parseFloat(attrs[k]) || 0);
      if (rx > 0) pdf.roundedRect(tx(rx0), ty(ry0), rw * s, rh * s, rx * s);
      else pdf.rect(tx(rx0), ty(ry0), rw * s, rh * s);
      paint();
    } else if (tag === "circle") {
      pdf.circle(tx(parseFloat(attrs.cx) || 0), ty(parseFloat(attrs.cy) || 0), (parseFloat(attrs.r) || 0) * s);
      paint();
    } else if (tag === "ellipse") {
      pdf.ellipse(
        tx(parseFloat(attrs.cx) || 0), ty(parseFloat(attrs.cy) || 0),
        (parseFloat(attrs.rx) || 0) * s, (parseFloat(attrs.ry) || 0) * s,
      );
      paint();
    } else if (tag === "path") {
      if (emitPath(pdf, attrs.d || "", tx, ty, s)) paint();
    } else if (tag === "text") {
      const fs = (parseFloat(attrs["font-size"]) || 6) * s;
      pdf.text(String(content).trim(), tx(parseFloat(attrs.x) || 0), ty(parseFloat(attrs.y) || 0), {
        size: fs,
        font: "sansBold",
        color: col,
        align: attrs["text-anchor"] === "middle" ? "center" : "left",
      });
    }
  }
  pdf.setRoundCaps(false);
}

function parseAttrs(str) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let a;
  while ((a = ATTR_RE.exec(str))) out[a[1]] = a[2];
  return out;
}

function blend(hex, bgHex, alpha) {
  const c = rgb(hex), b = rgb(bgHex);
  return (
    "#" + [0, 1, 2]
      .map((i) => Math.round(c[i] * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0"))
      .join("")
  );
}
function rgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

/** Emit an SVG path `d` into pdf ops. Returns false when d was empty. */
function emitPath(pdf, d, tx, ty, s) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+/g);
  if (!toks?.length) return false;

  let i = 0;
  const num = () => parseFloat(toks[i++]);
  let cmd = "";
  let cx = 0, cy = 0;       // current point (icon coords)
  let sx = 0, sy = 0;       // subpath start
  let qx = null, qy = null; // last quadratic control (for T)
  let started = false;

  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let keepQ = false;

    switch (C) {
      case "M": {
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        pdf.moveTo(tx(x), ty(y));
        cx = x; cy = y; sx = x; sy = y; started = true;
        cmd = rel ? "l" : "L"; // subsequent pairs are implicit lineto
        break;
      }
      case "L": {
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        pdf.lineTo(tx(x), ty(y));
        cx = x; cy = y;
        break;
      }
      case "H": {
        const x = num() + (rel ? cx : 0);
        pdf.lineTo(tx(x), ty(cy));
        cx = x;
        break;
      }
      case "V": {
        const y = num() + (rel ? cy : 0);
        pdf.lineTo(tx(cx), ty(y));
        cy = y;
        break;
      }
      case "C": {
        const x1 = num() + (rel ? cx : 0), y1 = num() + (rel ? cy : 0);
        const x2 = num() + (rel ? cx : 0), y2 = num() + (rel ? cy : 0);
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        pdf.curveTo(tx(x1), ty(y1), tx(x2), ty(y2), tx(x), ty(y));
        cx = x; cy = y;
        break;
      }
      case "Q":
      case "T": {
        let x1, y1;
        if (C === "Q") {
          x1 = num() + (rel ? cx : 0); y1 = num() + (rel ? cy : 0);
        } else {
          // reflect previous quadratic control
          x1 = qx != null ? 2 * cx - qx : cx;
          y1 = qy != null ? 2 * cy - qy : cy;
        }
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        // quadratic → cubic
        const c1x = cx + (2 / 3) * (x1 - cx), c1y = cy + (2 / 3) * (y1 - cy);
        const c2x = x + (2 / 3) * (x1 - x), c2y = y + (2 / 3) * (y1 - y);
        pdf.curveTo(tx(c1x), ty(c1y), tx(c2x), ty(c2y), tx(x), ty(y));
        qx = x1; qy = y1; keepQ = true;
        cx = x; cy = y;
        break;
      }
      case "A": {
        const rx = num(), ry = num(), phi = num(), fa = num(), fs = num();
        const x = num() + (rel ? cx : 0), y = num() + (rel ? cy : 0);
        for (const seg of arcToCubics(cx, cy, rx, ry, phi, fa, fs, x, y)) {
          pdf.curveTo(tx(seg[0]), ty(seg[1]), tx(seg[2]), ty(seg[3]), tx(seg[4]), ty(seg[5]));
        }
        cx = x; cy = y;
        break;
      }
      case "Z": {
        pdf.closePath();
        cx = sx; cy = sy;
        break;
      }
      default:
        return started; // unknown command — stop parsing safely
    }
    if (!keepQ) { qx = null; qy = null; }
  }
  return started;
}

/** SVG endpoint arc → cubic segments (spec appendix F.6.5). */
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]]; // degenerate: line
  const phi = (phiDeg * Math.PI) / 180;
  const cosp = Math.cos(phi), sinp = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosp * dx + sinp * dy;
  const y1p = -sinp * dx + cosp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const k = Math.sqrt(lam); rx *= k; ry *= k; }
  const sign = fa !== fs ? 1 : -1;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const numr = Math.max(0, rx * rx * ry * ry - den);
  const co = sign * Math.sqrt(numr / den);
  const cxp = (co * rx * y1p) / ry;
  const cyp = (-co * ry * x1p) / rx;
  const cx0 = cosp * cxp - sinp * cyp + (x1 + x2) / 2;
  const cy0 = sinp * cxp + cosp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;

  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const delta = dt / segs;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  let th = t1;
  let px = x1, py = y1;
  for (let k = 0; k < segs; k++) {
    const th2 = th + delta;
    const cos1 = Math.cos(th), sin1 = Math.sin(th);
    const cos2 = Math.cos(th2), sin2 = Math.sin(th2);
    const pt = (c, s_) => [
      cosp * rx * c - sinp * ry * s_ + cx0,
      sinp * rx * c + cosp * ry * s_ + cy0,
    ];
    const [ex, ey] = pt(cos2, sin2);
    const [d1x, d1y] = [-rx * sin1, ry * cos1];
    const [d2x, d2y] = [-rx * sin2, ry * cos2];
    const rot = (vx, vy) => [cosp * vx - sinp * vy, sinp * vx + cosp * vy];
    const [t1x, t1y] = rot(d1x, d1y);
    const [t2x, t2y] = rot(d2x, d2y);
    out.push([px + alpha * t1x, py + alpha * t1y, ex - alpha * t2x, ey - alpha * t2y, ex, ey]);
    px = ex; py = ey;
    th = th2;
  }
  return out;
}
