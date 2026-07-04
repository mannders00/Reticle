// core/export/pdfWriter.js
// Minimal hand-rolled vector PDF writer — no dependencies, works in any
// webview (desktop, browser, future daemon mode). Emits PDF 1.4 with the
// standard base-14 fonts (Helvetica / Helvetica-Bold / Courier), so no
// font embedding is needed and the output is a few dozen KB of pure
// vector paths + text.
//
// Coordinate system: callers use top-left origin (like the canvas); the
// writer flips to PDF's bottom-left origin internally. All units are
// PostScript points (1pt = 1/72 inch).

const FONTS = {
  sans: { res: "F1", base: "Helvetica", widthFactor: 0.52 },
  sansBold: { res: "F2", base: "Helvetica-Bold", widthFactor: 0.556 },
  mono: { res: "F3", base: "Courier", widthFactor: 0.6 },
};

export class PdfWriter {
  constructor() {
    this.pages = [];
    this.cur = null;
  }

  addPage(w, h) {
    this.cur = { w, h, ops: [] };
    this.pages.push(this.cur);
  }

  get pageW() { return this.cur.w; }
  get pageH() { return this.cur.h; }

  _op(s) { this.cur.ops.push(s); }
  _y(y) { return this.cur.h - y; }

  setStroke(hex) {
    const [r, g, b] = hexRgb(hex);
    this._op(`${r} ${g} ${b} RG`);
  }
  setFill(hex) {
    const [r, g, b] = hexRgb(hex);
    this._op(`${r} ${g} ${b} rg`);
  }
  setLineWidth(w) { this._op(`${n(w)} w`); }
  /** dash: array of on/off lengths in pt, or null for solid. */
  setDash(dash) {
    this._op(dash && dash.length ? `[${dash.map(n).join(" ")}] 0 d` : "[] 0 d");
  }

  moveTo(x, y) { this._op(`${n(x)} ${n(this._y(y))} m`); }
  lineTo(x, y) { this._op(`${n(x)} ${n(this._y(y))} l`); }
  curveTo(c1x, c1y, c2x, c2y, x, y) {
    this._op(`${n(c1x)} ${n(this._y(c1y))} ${n(c2x)} ${n(this._y(c2y))} ${n(x)} ${n(this._y(y))} c`);
  }
  closePath() { this._op("h"); }
  stroke() { this._op("S"); }
  fill() { this._op("f"); }
  fillStroke() { this._op("B"); }

  rect(x, y, w, h) {
    this._op(`${n(x)} ${n(this._y(y + h))} ${n(w)} ${n(h)} re`);
  }

  roundedRect(x, y, w, h, r) {
    const k = 0.5523;
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.curveTo(x + w - r + r * k, y, x + w, y + r - r * k, x + w, y + r);
    this.lineTo(x + w, y + h - r);
    this.curveTo(x + w, y + h - r + r * k, x + w - r + r * k, y + h, x + w - r, y + h);
    this.lineTo(x + r, y + h);
    this.curveTo(x + r - r * k, y + h, x, y + h - r + r * k, x, y + h - r);
    this.lineTo(x, y + r);
    this.curveTo(x, y + r - r * k, x + r - r * k, y, x + r, y);
    this.closePath();
  }

  circle(cx, cy, r) {
    this.ellipse(cx, cy, r, r);
  }

  ellipse(cx, cy, rx, ry) {
    const kx = 0.5523 * rx;
    const ky = 0.5523 * ry;
    this.moveTo(cx + rx, cy);
    this.curveTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
    this.curveTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
    this.curveTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
    this.curveTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    this.closePath();
  }

  /** Round line caps/joins (icons look hand-tuned with them). */
  setRoundCaps(on) {
    this._op(on ? "1 J 1 j" : "0 J 0 j");
  }

  /** Draw text. y is the BASELINE in top-origin coords. */
  text(str, x, y, { size = 10, font = "sans", color = "#000000", align = "left" } = {}) {
    const f = FONTS[font] || FONTS.sans;
    const s = pdfString(str);
    let tx = x;
    if (align !== "left") {
      const w = this.textWidth(str, size, font);
      tx = align === "center" ? x - w / 2 : x - w;
    }
    const [r, g, b] = hexRgb(color);
    this._op(`BT ${r} ${g} ${b} rg /${f.res} ${n(size)} Tf ${n(tx)} ${n(this._y(y))} Td (${s}) Tj ET`);
  }

  /** Approximate rendered width of a string (base-14 metrics estimate). */
  textWidth(str, size, font = "sans") {
    const f = FONTS[font] || FONTS.sans;
    return sanitize(str).length * size * f.widthFactor;
  }

  /** Truncate a string (with ellipsis) to fit maxWidth pt. */
  fitText(str, maxWidth, size, font = "sans") {
    let s = sanitize(str);
    if (this.textWidth(s, size, font) <= maxWidth) return s;
    while (s.length > 1 && this.textWidth(s + "...", size, font) > maxWidth) s = s.slice(0, -1);
    return s + "...";
  }

  /** Assemble the document. Returns a Uint8Array. */
  build() {
    // Object layout: 1=Catalog, 2=Pages, 3..5=fonts, then per page i:
    // (6+2i)=Page, (7+2i)=Contents.
    const fontEntries = Object.values(FONTS);
    const firstPageObj = 3 + fontEntries.length;
    const kids = this.pages.map((_, i) => `${firstPageObj + 2 * i} 0 R`).join(" ");
    const fontDict = fontEntries.map((f, i) => `/${f.res} ${3 + i} 0 R`).join(" ");

    let out = "%PDF-1.4\n%âãÏÓ\n";
    const offsets = [];
    const addObj = (body) => {
      offsets.push(out.length);
      out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
    };

    addObj("<< /Type /Catalog /Pages 2 0 R >>");
    addObj(`<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`);
    for (const f of fontEntries) {
      addObj(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
    }
    for (const p of this.pages) {
      const contentNum = offsets.length + 2;
      addObj(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(p.w)} ${n(p.h)}] ` +
        `/Resources << /Font << ${fontDict} >> >> /Contents ${contentNum} 0 R >>`,
      );
      const stream = p.ops.join("\n");
      addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }

    const xrefAt = out.length;
    out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

    // latin1 string → bytes (1 char = 1 byte, offsets stay valid)
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}

/* ---- helpers ---- */

function n(v) {
  return Math.round(v * 100) / 100;
}

function hexRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => n(parseInt(v.slice(i, i + 2), 16) / 255));
}

/** Map to WinAnsi-safe characters; common non-latin symbols get ASCII stand-ins. */
function sanitize(str) {
  return String(str ?? "")
    .replace(/→/g, "->").replace(/←/g, "<-")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/–/g, "-").replace(/—/g, "--").replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function pdfString(str) {
  return sanitize(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
