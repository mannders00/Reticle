// core/export/exportPdf.js
// Topology → print-quality vector PDF (A4 landscape). Pure frontend: the
// same code runs in desktop (Tauri), browser mode, and future daemon mode;
// only file delivery differs (save dialog vs <a download>).
//
// Page anatomy (PRODUCT.md §8): header with doc title, the diagram scaled
// to fit the content box, an auto-built legend keyed off the edge kinds +
// node categories present, and a footer with timestamp + attribution.
// Renders on white with a print palette — the on-screen dark theme is a
// viewing choice, not part of the document.

import { PdfWriter } from "./pdfWriter.js";
import { drawGlyph } from "./svgGlyph.js";
import { getTopology, getState } from "../store.js";
import { kindMeta, isGroupKind, ADDONS } from "../../canvas/nodes/kinds.js";
import { glyph } from "../../canvas/nodes/icons.js";
import { EDGE_STYLES, EDGE_LABELS } from "../../canvas/edges/styles.js";
import api, { hasTauri } from "../api.js";

const PAGE = { w: 842, h: 595 }; // A4 landscape, pt
const MARGIN = 36;
const HEADER_H = 34;
const FOOTER_H = 26;

const INK = {
  title: "#111522",
  text: "#1a1e27",
  sub: "#5d6675",
  faint: "#9aa2b1",
  border: "#c9cede",
  hairline: "#dfe3ea",
  cardFill: "#fdfdfe",
};

const CAT_COLORS = {
  compute: "#5b8cff",
  data: "#a78bfa",
  network: "#1faa6c",
  composite: "#3aa0ff",
  "cloud-group": "#e0930f",
  "network-group": "#5f8ae8",
  misc: "#8a93a6",
};

const GROUP_COLORS = {
  vpc: "#5f8ae8", region: "#e0930f", zone: "#e0930f", subnet: "#5f8ae8",
  "security-group": "#d64045", lan: "#1faa6c", wan: "#5f8ae8", box: "#8a93a6",
};

const HEALTH_COLORS = { ok: "#1faa6c", warn: "#dfa412", err: "#d64045", unknown: "#9aa2b1" };

// A few edge colors are tuned for the dark canvas; remap the ones that
// would wash out on paper.
const EDGE_PRINT_COLORS = { "#aab2c5": "#7a8394", "#4a5366": "#6b7589" };

export async function exportPdf() {
  const topo = getTopology();
  const nodes = Object.values(topo.nodes);
  const edges = Object.values(topo.edges);
  if (!nodes.length) return false;

  // fileName may be a full path (desktop) or a placeholder like
  // "(browser)"; reduce to a clean basename or fall back to "topology".
  const raw = (getState().session.fileName || "").split("/").pop() || "";
  const base = raw.replace(/\.ya?ml$/i, "");
  const title = base && !/^\(.*\)$/.test(base) ? base : "topology";
  const pdf = new PdfWriter();
  pdf.addPage(PAGE.w, PAGE.h);

  /* ---- legend measurements (drawn last, but reserves space) ---- */
  const edgeKinds = [...new Set(edges.map((e) => e.kind))];
  const categories = [...new Set(nodes.filter((nd) => !isGroupKind(nd.kind)).map((nd) => kindMeta(nd.kind).category))];
  const legendH = edgeKinds.length + categories.length ? 26 : 0;

  /* ---- world → page transform ---- */
  const PAD = 24;
  const bx1 = Math.min(...nodes.map((nd) => nd.x)) - PAD;
  const by1 = Math.min(...nodes.map((nd) => nd.y)) - PAD;
  const bx2 = Math.max(...nodes.map((nd) => nd.x + nd.w)) + PAD;
  const by2 = Math.max(...nodes.map((nd) => nd.y + nd.h)) + PAD;
  const box = {
    x: MARGIN,
    y: MARGIN + HEADER_H,
    w: PAGE.w - MARGIN * 2,
    h: PAGE.h - MARGIN * 2 - HEADER_H - FOOTER_H - legendH,
  };
  const s = Math.min(box.w / (bx2 - bx1), box.h / (by2 - by1), 1.1);
  const ox = box.x + (box.w - (bx2 - bx1) * s) / 2 - bx1 * s;
  const oy = box.y + (box.h - (by2 - by1) * s) / 2 - by1 * s;
  const X = (wx) => ox + wx * s;
  const Y = (wy) => oy + wy * s;

  /* ---- header ---- */
  pdf.text(pdf.fitText(title, box.w - 120, 14, "sansBold"), MARGIN, MARGIN + 6, {
    size: 14, font: "sansBold", color: INK.title,
  });
  pdf.text("RETICLE", PAGE.w - MARGIN, MARGIN + 6, {
    size: 9, font: "mono", color: INK.faint, align: "right",
  });
  pdf.setStroke(INK.hairline);
  pdf.setLineWidth(0.75);
  pdf.setDash(null);
  pdf.moveTo(MARGIN, MARGIN + 16);
  pdf.lineTo(PAGE.w - MARGIN, MARGIN + 16);
  pdf.stroke();

  /* ---- groups (largest first, so nesting reads correctly) ---- */
  const groups = nodes.filter((nd) => isGroupKind(nd.kind)).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const g of groups) {
    const color = GROUP_COLORS[g.kind] || "#5f8ae8";
    const x = X(g.x), y = Y(g.y), w = g.w * s, h = g.h * s;
    pdf.setFill(tint(color, 0.94));
    pdf.roundedRect(x, y, w, h, 8 * s);
    pdf.fill();
    pdf.setStroke(color);
    pdf.setLineWidth(Math.max(0.7, 1 * s));
    pdf.setDash([4 * s, 3 * s]);
    pdf.roundedRect(x, y, w, h, 8 * s);
    pdf.stroke();
    pdf.setDash(null);
    // title strip
    const th = Math.max(9, 16 * s);
    pdf.setFill(tint(color, 0.75));
    pdf.roundedRect(x, y, w, th, 8 * s);
    pdf.fill();
    const tSize = Math.max(5.5, 8 * s);
    const tCol = shade(color, 0.45);
    const gIcon = Math.min(th - 4 * s, 10 * s);
    drawGlyph(pdf, glyph(g.kind), x + 6 * s, y + (th - gIcon) / 2, gIcon, tCol, tint(color, 0.75));
    pdf.text(
      pdf.fitText(`${(g.title || g.kind).toUpperCase()}${g.subtitle ? "  ·  " + g.subtitle : ""}`, w - 26 * s, tSize, "sansBold"),
      x + (6 + 12) * s, y + th / 2 + tSize * 0.36,
      { size: tSize, font: "sansBold", color: tCol },
    );
  }

  /* ---- edges ---- */
  const mids = new Map();
  for (const e of edges) {
    const a = topo.nodes[e.from], b = topo.nodes[e.to];
    if (!a || !b) continue;
    const style = EDGE_STYLES[e.kind] || EDGE_STYLES.tcp;
    const color = EDGE_PRINT_COLORS[style.color] || style.color;
    const [ax, ay] = borderPoint(a, b);
    const [bx, by] = borderPoint(b, a);
    const cx1 = ax + (bx - ax) * 0.5, cy1 = ay;
    const cx2 = bx - (bx - ax) * 0.5, cy2 = by;

    pdf.setStroke(color);
    pdf.setLineWidth(Math.max(0.6, (style.double ? style.width + 1.6 : style.width) * s));
    pdf.setDash(style.dash ? style.dash.split(" ").map((d) => Math.max(0.5, d * s)) : null);
    pdf.moveTo(X(ax), Y(ay));
    pdf.curveTo(X(cx1), Y(cy1), X(cx2), Y(cy2), X(bx), Y(by));
    pdf.stroke();
    pdf.setDash(null);

    if (style.arrow !== false) {
      // Page-space arrowhead: X/Y are uniform scale + offset, so the
      // world-space angle carries straight over.
      const ang = Math.atan2(by - cy2, bx - cx2);
      const size = Math.max(4, 8 * s);
      const pbx = X(bx), pby = Y(by);
      pdf.setFill(color);
      pdf.moveTo(pbx, pby);
      pdf.lineTo(pbx - size * Math.cos(ang - 0.42), pby - size * Math.sin(ang - 0.42));
      pdf.lineTo(pbx - size * Math.cos(ang + 0.42), pby - size * Math.sin(ang + 0.42));
      pdf.closePath();
      pdf.fill();
    }
    if (e.label) {
      mids.set(e.id, {
        x: X((ax + 2 * cx1 + 2 * cx2 + bx) / 6),
        y: Y((ay + 2 * cy1 + 2 * cy2 + by) / 6),
        label: e.label,
      });
    }
  }

  /* ---- node cards ---- */
  for (const nd of nodes) {
    if (isGroupKind(nd.kind)) continue;

    // Notes: a warm paragraph card — header + wrapped prose, no health.
    if (nd.kind === "note") {
      const x = X(nd.x), y = Y(nd.y), w = nd.w * s, h = nd.h * s;
      pdf.setFill("#fdf6e4");
      pdf.setStroke("#e3cf9b");
      pdf.setLineWidth(Math.max(0.6, 1 * s));
      pdf.setDash(null);
      pdf.roundedRect(x, y, w, h, 5 * s);
      pdf.fillStroke();
      pdf.setFill("#dfa412");
      pdf.rect(x, y + 5 * s, 2.6 * s, h - 10 * s);
      pdf.fill();
      const titleSize = Math.max(5.5, 9 * s);
      drawGlyph(pdf, glyph("note"), x + 8 * s, y + 8 * s, 11 * s, "#b8860b", "#fdf6e4");
      pdf.text(pdf.fitText(nd.title || "note", w - 40 * s, titleSize, "sansBold"),
        x + 23 * s, y + 16 * s, { size: titleSize, font: "sansBold", color: "#6b5a1e" });
      const bodySize = Math.max(5, 7.5 * s);
      const lineH = bodySize * 1.5;
      const maxLines = Math.max(0, Math.floor((h - 30 * s) / lineH));
      const lines = wrapText(pdf, nd.notes ?? nd.subtitle ?? "", w - 20 * s, bodySize, "sans").slice(0, maxLines);
      lines.forEach((line, i) => {
        pdf.text(line, x + 10 * s, y + 28 * s + (i + 1) * lineH - lineH * 0.3,
          { size: bodySize, font: "sans", color: "#4d4429" });
      });
      continue;
    }

    const meta = kindMeta(nd.kind);
    const cat = CAT_COLORS[meta.category] || CAT_COLORS.misc;
    const x = X(nd.x), y = Y(nd.y), w = nd.w * s, h = nd.h * s;
    const r = 5 * s;

    pdf.setFill(INK.cardFill);
    pdf.setStroke(INK.border);
    pdf.setLineWidth(Math.max(0.6, 1 * s));
    pdf.setDash(null);
    pdf.roundedRect(x, y, w, h, r);
    pdf.fillStroke();
    // category accent stripe
    pdf.setFill(cat);
    pdf.rect(x, y + r, 2.6 * s, h - 2 * r);
    pdf.fill();

    // kind icon — same glyph as the canvas, in the category color
    const iconSize = 14 * s;
    drawGlyph(pdf, glyph(nd.kind), x + 8 * s, y + 8 * s, iconSize, cat, INK.cardFill);

    const titleSize = Math.max(5.5, 9.5 * s);
    const subSize = Math.max(4.5, 7.5 * s);
    const tx = x + 27 * s;
    pdf.text(pdf.fitText(nd.title || meta.label, w - 44 * s, titleSize, "sansBold"),
      tx, y + 14 * s, { size: titleSize, font: "sansBold", color: INK.text });
    const sub = nd.subtitle || (nd.spec?.host ? `${nd.spec.user || "?"}@${nd.spec.host}` : meta.label);
    pdf.text(pdf.fitText(sub, w - 44 * s, subSize, "sans"),
      tx, y + 24 * s, { size: subSize, font: "sans", color: INK.sub });

    // health dot, top-right
    const state = nd.health?.state || "unknown";
    pdf.setFill(HEALTH_COLORS[state] || HEALTH_COLORS.unknown);
    pdf.circle(x + w - 9 * s, y + 11 * s, 3 * s);
    pdf.fill();

    // bottom meta line (host:port / kube ref)
    const metaBit = nd.spec?.host
      ? `${nd.spec.host}:${nd.spec.port ?? 22}`
      : nd.spec?.kubeContext && nd.spec?.name
        ? `${nd.spec.kubeContext}/${nd.spec.name}`
        : null;
    const metaSize = Math.max(4, 6.5 * s);
    const metaFit = metaBit && h > 40 * s
      ? pdf.fitText(metaBit, w - 18 * s, metaSize, "mono")
      : null;
    if (metaFit) {
      pdf.text(metaFit, tx, y + h - 8 * s, { size: metaSize, font: "mono", color: INK.faint });
    }

    // attached resources — icon + label chips, bottom-right (mirrors the
    // canvas). Chips that don't fit collapse into a "+N" overflow marker.
    const addons = nd.addons ?? [];
    if (addons.length && h > 40 * s) {
      const aSize = 8 * s;
      const tSize = Math.max(4, 6 * s);
      const gap = 2 * s;   // icon ↔ label
      const pad = 6 * s;   // chip ↔ chip
      const rightEdge = x + w - 8 * s;
      const leftLimit = metaFit
        ? tx + pdf.textWidth(metaFit, metaSize, "mono") + 8 * s
        : x + 10 * s;
      const chips = addons.map((a) => {
        const label = a.label || ADDONS[a.kind]?.label || a.kind;
        return { kind: a.kind, label, w: aSize + gap + pdf.textWidth(label, tSize, "sans") };
      });
      // Greedy fit, reserving room for the overflow marker when needed.
      const overW = (n) => (n > 0 ? pdf.textWidth(`+${n}`, tSize, "sans") + pad : 0);
      let shown = chips.length;
      const rowW = (k) =>
        chips.slice(0, k).reduce((acc, c, i) => acc + c.w + (i ? pad : 0), 0) + overW(chips.length - k);
      while (shown > 1 && rowW(shown) > rightEdge - leftLimit) shown--;
      const iconY = y + h - 6 * s - aSize;
      const textY = iconY + aSize / 2 + tSize * 0.36;
      let cx = Math.max(leftLimit, rightEdge - rowW(shown));
      for (const c of chips.slice(0, shown)) {
        drawGlyph(pdf, glyph(c.kind), cx, iconY, aSize, INK.sub, INK.cardFill);
        // +0.1 slack: cx derives from rightEdge-rowW, so float rounding can
        // land a hair under the measured width and spuriously ellipsize.
        pdf.text(pdf.fitText(c.label, rightEdge - cx - aSize - gap + 0.1, tSize, "sans"),
          cx + aSize + gap, textY, { size: tSize, font: "sans", color: INK.sub });
        cx += c.w + pad;
      }
      if (shown < chips.length) {
        pdf.text(`+${chips.length - shown}`, cx, textY, { size: tSize, font: "sans", color: INK.faint });
      }
    }
  }

  /* ---- edge labels (above everything) ---- */
  for (const { x, y, label } of mids.values()) {
    const size = Math.max(4.5, 7 * s);
    const w = pdf.textWidth(label, size, "mono") + 8 * s;
    const h = size + 5 * s;
    pdf.setFill("#ffffff");
    pdf.setStroke(INK.border);
    pdf.setLineWidth(0.5);
    pdf.setDash(null);
    pdf.roundedRect(x - w / 2, y - h / 2, w, h, 2.5 * s);
    pdf.fillStroke();
    pdf.text(label, x, y + size * 0.36, { size, font: "mono", color: INK.sub, align: "center" });
  }

  /* ---- legend ---- */
  if (legendH) {
    const ly = PAGE.h - MARGIN - FOOTER_H - 10;
    let lx = MARGIN;
    pdf.text("LEGEND", lx, ly, { size: 7, font: "sansBold", color: INK.faint });
    lx += 48;
    for (const kind of edgeKinds) {
      const style = EDGE_STYLES[kind] || EDGE_STYLES.tcp;
      pdf.setStroke(EDGE_PRINT_COLORS[style.color] || style.color);
      pdf.setLineWidth(Math.min(style.width, 2));
      pdf.setDash(style.dash ? style.dash.split(" ").map(Number) : null);
      pdf.moveTo(lx, ly - 2.5);
      pdf.lineTo(lx + 22, ly - 2.5);
      pdf.stroke();
      pdf.setDash(null);
      const name = EDGE_LABELS[kind] || kind;
      pdf.text(name, lx + 27, ly, { size: 7, font: "sans", color: INK.sub });
      lx += 27 + pdf.textWidth(name, 7, "sans") + 16;
    }
    for (const cat of categories) {
      pdf.setFill(CAT_COLORS[cat] || CAT_COLORS.misc);
      pdf.roundedRect(lx, ly - 6, 6, 6, 1.5);
      pdf.fill();
      pdf.text(cat, lx + 10, ly, { size: 7, font: "sans", color: INK.sub });
      lx += 10 + pdf.textWidth(cat, 7, "sans") + 16;
    }
  }

  /* ---- footer ---- */
  pdf.setStroke(INK.hairline);
  pdf.setLineWidth(0.75);
  pdf.setDash(null);
  pdf.moveTo(MARGIN, PAGE.h - MARGIN - 12);
  pdf.lineTo(PAGE.w - MARGIN, PAGE.h - MARGIN - 12);
  pdf.stroke();
  pdf.text(timestamp(), MARGIN, PAGE.h - MARGIN, { size: 7.5, font: "sans", color: INK.faint });
  pdf.text("Generated by Reticle", PAGE.w - MARGIN, PAGE.h - MARGIN, {
    size: 7.5, font: "sans", color: INK.faint, align: "right",
  });

  await deliver(pdf.build(), `${title}.pdf`);
  return true;
}

/* ---- delivery: Tauri save dialog vs browser download ---- */
async function deliver(bytes, filename) {
  if (hasTauri) {
    const path = await api.pickSavePath(filename, [{ name: "PDF", extensions: ["pdf"] }]);
    if (!path) return;
    await api.saveExportFile(path, Array.from(bytes));
  } else {
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/* ---- helpers ---- */

// Same border-exit math as EdgeView, so the PDF matches the canvas.
function borderPoint(a, b) {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  const dx = (b.x + b.w / 2) - cx, dy = (b.y + b.h / 2) - cy;
  if (!dx && !dy) return [cx, cy];
  const t = Math.min(
    dx === 0 ? Infinity : (a.w / 2) / Math.abs(dx),
    dy === 0 ? Infinity : (a.h / 2) / Math.abs(dy),
  );
  return [cx + dx * t, cy + dy * t];
}

/** Mix a color toward white (f=0 → color, f=1 → white). */
function tint(hex, f) {
  const [r, g, b] = rgb(hex);
  return toHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
/** Mix a color toward black. */
function shade(hex, f) {
  const [r, g, b] = rgb(hex);
  return toHex(r * (1 - f), g * (1 - f), b * (1 - f));
}
function rgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function toHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
/** Greedy word-wrap using the writer's width metrics. Honors newlines. */
function wrapText(pdf, text, maxWidth, size, font) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (pdf.textWidth(candidate, size, font) <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

function timestamp() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
