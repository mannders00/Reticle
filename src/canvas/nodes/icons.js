// canvas/nodes/icons.js
// Inline SVG glyphs for every node kind. All glyphs target a 24×24 viewBox
// and use `currentColor` for stroke/fill so they inherit the card's text
// colour and adapt to selection / status changes.
//
// Style guide: 1.5px stroke, rounded joins, no fill unless the shape is a
// distinct solid (cylinder top, k8s Logo). Hand-tuned for legibility at
// 18px (sidebar list) and ~28px (card).

export const ICONS = {
  // ----- compute -----------------------------------------------------------
  server:
    `<rect x="3" y="4" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <rect x="3" y="11" width="18" height="5" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <rect x="3" y="18" width="18" height="2" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <circle cx="6" cy="6.5" r="0.6" fill="currentColor"/>
     <circle cx="6" cy="13.5" r="0.6" fill="currentColor"/>`,

  vm:
    `<rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M4 9 H20" stroke="currentColor" stroke-width="1.2"/>
     <text x="12" y="16.5" font-size="6" font-weight="700" text-anchor="middle" fill="currentColor" font-family="ui-sans-serif">VM</text>`,

  app:
    `<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M4 8.5 H20" stroke="currentColor" stroke-width="1.2"/>
     <circle cx="6.6" cy="6.3" r="0.7" fill="currentColor"/>
     <circle cx="9" cy="6.3" r="0.7" fill="currentColor"/>
     <path d="M10 12 L14 14.6 L10 17.2 Z" fill="currentColor"/>`,

  host:
    `<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="3 2.4"/>
     <rect x="6.5" y="8" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/>
     <rect x="13" y="11" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3" fill="none"/>`,

  pod:
    `<path d="M12 3 L20 7.5 L20 16.5 L12 21 L4 16.5 L4 7.5 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5" fill="none"/>`,

  container:
    `<rect x="4" y="8" width="16" height="9" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M7 8 V17 M10 8 V17 M13 8 V17 M16 8 V17" stroke="currentColor" stroke-width="1" opacity="0.5"/>
     <path d="M2 12 Q3 8 6 11 T11 10 T16 11 T22 9" stroke="currentColor" stroke-width="1.4" fill="none" opacity="0.7"/>`,

  daemonset:
    `<path d="M12 3 L19 7 L19 12 L12 16 L5 12 L5 7 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M12 8 L19 12 L19 17 L12 21 L5 17 L5 12 Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round" opacity="0.65"/>`,

  statefulset:
    `<path d="M12 3 L19 7 L19 12 L12 16 L5 12 L5 7 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <circle cx="8" cy="9" r="1.4" fill="currentColor"/>
     <circle cx="12" cy="11" r="1.4" fill="currentColor"/>
     <circle cx="16" cy="13" r="1.4" fill="currentColor"/>`,

  deployment:
    `<path d="M12 3 L19 7 L19 12 L12 16 L5 12 L5 7 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <text x="12" y="13.5" font-size="5.5" font-weight="700" text-anchor="middle" fill="currentColor">N×</text>`,

  cluster:
    `<path d="M12 3 L19 7.5 V16.5 L12 21 L5 16.5 V7.5 Z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
     <path d="M12 7 L16 9.5 V14.5 L12 17 L8 14.5 V9.5 Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round" opacity="0.65"/>`,

  knode:
    `<circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22 M5 5 L8 8 M16 16 L19 19 M19 5 L16 8 M8 16 L5 19" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,

  // ----- data -------------------------------------------------------------
  database:
    `<ellipse cx="12" cy="6" rx="7" ry="2.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M5 6 V12 C5 13.4 8.1 14.5 12 14.5 C15.9 14.5 19 13.4 19 12 V6" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M5 12 V18 C5 19.4 8.1 20.5 12 20.5 C15.9 20.5 19 19.4 19 18 V12" stroke="currentColor" stroke-width="1.5" fill="none"/>`,

  cache:
    `<ellipse cx="12" cy="6" rx="6" ry="2.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M6 6 V13 H10 V18 H18 V6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M13 9 L11 13 H15 L13 17" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>`,

  queue:
    `<rect x="3" y="6" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/>
     <rect x="9" y="6" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.4" fill="none" opacity="0.8"/>
     <rect x="15" y="6" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.4" fill="none" opacity="0.6"/>
     <path d="M3 13 H21 M3 17 H21 M3 21 H21" stroke="currentColor" stroke-width="1" opacity="0.4" stroke-dasharray="2 2"/>`,

  "object-store":
    `<path d="M4 6 H20 V9 H4 Z M4 9 H20 V13 H4 Z M4 13 H20 V18 H4 Z" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>
     <circle cx="7" cy="7.5" r="0.6" fill="currentColor"/>
     <circle cx="7" cy="11" r="0.6" fill="currentColor"/>
     <circle cx="7" cy="15.5" r="0.6" fill="currentColor"/>`,

  // ----- network ----------------------------------------------------------
  "load-balancer":
    `<rect x="3" y="3" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M7 9 V12 M12 9 V14 M17 9 V12" stroke="currentColor" stroke-width="1.4"/>
     <circle cx="7" cy="17" r="3" stroke="currentColor" stroke-width="1.4" fill="none"/>
     <circle cx="12" cy="20" r="2" stroke="currentColor" stroke-width="1.4" fill="none"/>
     <circle cx="17" cy="17" r="3" stroke="currentColor" stroke-width="1.4" fill="none"/>
     <path d="M7 14 V14 M12 16 V16 M17 14 V14" stroke="currentColor" stroke-width="1.4"/>`,

  switch:
    `<rect x="3" y="9" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M6 15 V19 M10 15 V19 M14 15 V19 M18 15 V19" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
     <path d="M6 9 V5 M10 9 V5 M14 9 V5 M18 9 V5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/>`,

  router:
    `<rect x="3" y="9" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M12 5 L18 9 M12 5 L6 9 M12 5 V9" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>
     <path d="M3 12 L7 12 L10 9 M21 12 L17 12 L14 9" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.5"/>`,

  firewall:
    `<path d="M3 4 L12 3 L21 4 V12 C21 17 12 21 12 21 C12 21 3 17 3 12 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M7 11 H17 M7 8 H17 M7 14 H17" stroke="currentColor" stroke-width="1" opacity="0.55"/>`,

  vpn:
    `<rect x="5" y="9" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M8 9 V7 A4 4 0 0 1 16 7 V9" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <circle cx="12" cy="13.5" r="1.6" fill="currentColor"/>`,

  bastion:
    `<path d="M12 3 L20 6 V12 C20 17 12 21 12 21 C12 21 4 17 4 12 V6 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M9 12 L11 14 L15 10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  dns:
    `<path d="M3 6 L12 3 L21 6 L12 9 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M3 6 V14 L12 17 L21 14 V6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <text x="12" y="14" font-size="5" font-weight="700" text-anchor="middle" fill="currentColor">DNS</text>`,

  cdn:
    `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <ellipse cx="12" cy="12" rx="4" ry="9" stroke="currentColor" stroke-width="1.2" fill="none"/>
     <path d="M3 12 H21 M5 6 H19 M5 18 H19" stroke="currentColor" stroke-width="1.1" opacity="0.6"/>`,

  // ----- cloud groups ------------------------------------------------------
  lan:
    `<rect x="3" y="6" width="18" height="12" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="3 2"/>
     <circle cx="8" cy="12" r="1.5" fill="currentColor" opacity="0.7"/>
     <circle cx="16" cy="12" r="1.5" fill="currentColor" opacity="0.7"/>`,

  wan:
    `<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="3 2"/>
     <circle cx="7" cy="7" r="1.4" fill="currentColor" opacity="0.7"/>
     <circle cx="17" cy="9" r="1.4" fill="currentColor" opacity="0.7"/>
     <circle cx="10" cy="17" r="1.4" fill="currentColor" opacity="0.7"/>`,

  vpc:
    `<path d="M6 4 C6 4 7 3 8 3 H16 C17 3 18 4 18 4 C20 4 20 6 20 6 V18 C20 19 18 20 18 20 H6 C5 20 4 19 4 18 V6 C4 6 4 4 6 4 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="4 2" stroke-linejoin="round"/>`,

  region:
    `<rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="6 2"/>
     <text x="12" y="13" font-size="5" font-weight="700" text-anchor="middle" fill="currentColor">REG</text>`,

  zone:
    `<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-dasharray="4 2"/>
     <text x="12" y="13.5" font-size="5.5" font-weight="700" text-anchor="middle" fill="currentColor">ZONE</text>`,

  subnet:
    `<rect x="3" y="6" width="18" height="11" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-dasharray="3 2"/>
     <text x="12" y="13" font-size="4.5" font-weight="700" text-anchor="middle" fill="currentColor">SUBNET</text>`,

  "security-group":
    `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.4" fill="none" stroke-dasharray="3 2"/>
     <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.7"/>`,

  // ----- composite --------------------------------------------------------
  service:
    `<rect x="3" y="9" width="18" height="7" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M10 6 L12 4 L14 6 M12 4 V12" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>
     <path d="M18 12 H22 M0 12 H4" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`,

  ingress:
    `<rect x="3" y="6" width="5" height="12" rx="1" stroke="currentColor" stroke-width="1.4" fill="none"/>
     <path d="M8 9 H21 M8 12 H21 M8 15 H21" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
     <path d="M16 9 L19 12 L16 15" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linejoin="round"/>`,

  gateway:
    `<path d="M3 21 H21 M4 21 V11 L12 4 L20 11 V21" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M10 21 V14 H14 V21" stroke="currentColor" stroke-width="1.3" fill="none"/>`,

  // ----- misc -------------------------------------------------------------
  generic:
    `<rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <circle cx="8" cy="9" r="0.7" fill="currentColor"/>
     <circle cx="12" cy="9" r="0.7" fill="currentColor"/>
     <circle cx="16" cy="9" r="0.7" fill="currentColor"/>
     <path d="M7 15 H17" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>`,

  note:
    `<path d="M4 4 H16 L20 8 V20 H4 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <path d="M16 4 V8 H20" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>
     <path d="M7 12 H17 M7 15 H14" stroke="currentColor" stroke-width="1" opacity="0.7"/>`,

  box:
    `<rect x="4" y="4" width="16" height="16" rx="2.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-dasharray="3.5 2.5"/>`,

  // ----- add-ons (attachable resources) ------------------------------------
  gpu:
    `<rect x="3" y="7" width="18" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <circle cx="9" cy="12" r="2.6" stroke="currentColor" stroke-width="1.3" fill="none"/>
     <path d="M9 9.4 V12 L10.8 13.4" stroke="currentColor" stroke-width="1.1" fill="none"/>
     <path d="M14.5 10 H18 M14.5 12 H18 M14.5 14 H17" stroke="currentColor" stroke-width="1.1" opacity="0.7"/>
     <path d="M6 17 V19 M10 17 V19 M14 17 V19" stroke="currentColor" stroke-width="1.2"/>`,

  disk:
    `<rect x="3" y="6" width="18" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <circle cx="10" cy="12" r="3.2" stroke="currentColor" stroke-width="1.3" fill="none"/>
     <circle cx="10" cy="12" r="0.8" fill="currentColor"/>
     <path d="M17.5 9 V10.5 M17.5 13.5 V15" stroke="currentColor" stroke-width="1.3" opacity="0.7"/>`,

  ram:
    `<rect x="3" y="8" width="18" height="8" rx="1" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M6.5 10 V14 M10 10 V14 M13.5 10 V14 M17 10 V14" stroke="currentColor" stroke-width="1.2" opacity="0.75"/>
     <path d="M5 16 V18 M9 16 V18 M13 16 V18 M17 16 V18" stroke="currentColor" stroke-width="1.1" opacity="0.55"/>`,

  cpu:
    `<rect x="7" y="7" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <rect x="10" y="10" width="4" height="4" rx="0.5" stroke="currentColor" stroke-width="1.1" fill="none"/>
     <path d="M9.5 4 V7 M14.5 4 V7 M9.5 17 V20 M14.5 17 V20 M4 9.5 H7 M4 14.5 H7 M17 9.5 H20 M17 14.5 H20" stroke="currentColor" stroke-width="1.2"/>`,

  nic:
    `<rect x="4" y="8" width="16" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <path d="M9 8 V5.5 H15 V8" stroke="currentColor" stroke-width="1.3" fill="none"/>
     <path d="M7.5 14 V16 M10.5 14 V16 M13.5 14 V16 M16.5 14 V16" stroke="currentColor" stroke-width="1.2" opacity="0.75"/>`,

  ip:
    `<rect x="3" y="7" width="18" height="10" rx="2" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <text x="12" y="14.6" font-size="6.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="ui-sans-serif">IP</text>`,

  cert:
    `<circle cx="12" cy="9.5" r="4.2" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <circle cx="12" cy="9.5" r="1.4" stroke="currentColor" stroke-width="1.1" fill="none"/>
     <path d="M9.8 13 L8.5 19.5 L12 17.5 L15.5 19.5 L14.2 13" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>`,

  ups:
    `<rect x="3" y="8" width="15" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
     <rect x="19" y="10.5" width="2" height="3" rx="0.5" fill="currentColor"/>
     <path d="M11 9.5 L8.5 12.3 H10.7 L9.8 14.6 L12.6 11.6 H10.4 Z" fill="currentColor"/>`,

  misc:
    `<path d="M5 5 H12.5 L19.5 12 L12 19.5 L5 12.5 Z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
     <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/>`,
};

/** Return the inner SVG markup for an icon. */
export function glyph(id) {
  return ICONS[id] || ICONS.generic;
}

/** Build a 24×24 inline SVG element ready to embed. */
export function iconSvg(id, size = 18) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "inline-flex";
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="kind-icon">${glyph(id)}</svg>`;
  const svgEl = wrapper.firstChild;
  return svgEl;
}

/** Return an HTML string for embedding an icon (used in innerHTML contexts
 *  where the caller handles SVG-in-HTML parsing). Prefer iconSvg() for
 *  direct DOM insertion. */
export function iconHtml(id, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" class="kind-icon">${glyph(id)}</svg>`;
}