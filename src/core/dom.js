// core/dom.js
// Small DOM helpers used by all view modules. Keeps the canvas modules
// lean and free of repetitive createElement ceremony.

const NS = "http://www.w3.org/2000/svg";

/** Create an HTML element with attributes, props, and children. */
export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  applyHtml(el, attrs);
  appendChildren(el, children);
  return el;
}

/** Create an SVG element with attributes/props and children. */
export function svg(tag, attrs = null, ...children) {
  const el = document.createElementNS(NS, tag);
  applySvg(el, attrs);
  appendChildren(el, children);
  return el;
}

export const svgNS = NS;

function applyHtml(el, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class" || k === "className") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && !(k in el.__proto__)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
}

function applySvg(el, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.setAttribute("class", v);
    else if (k === "style") el.setAttribute("style", v);
    else el.setAttribute(k, v === true ? "" : v);
  }
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    if (typeof c === "string" || typeof c === "number")
      el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  }
}

/** Remove all child nodes. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** requestAnimationFrame batcher. Coalesces repeated requests per frame. */
export function rafBatch(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}

/** Trailing-edge debounce. Suitable for autosave, search, etc. */
export function debounce(fn, wait = 250, opts = {}) {
  let t = 0;
  const { leading = false } = opts;
  let applied = false;
  return (...args) => {
    if (leading && !t) {
      fn(...args);
      applied = true;
    }
    clearTimeout(t);
    t = setTimeout(() => {
      if (!leading || !applied) fn(...args);
      applied = false;
      t = 0;
    }, wait);
  };
}

/** Clamp helper. */
export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);