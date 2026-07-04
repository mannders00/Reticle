// core/theme.js
// Base16 Default Dark + Light palettes sourced from the user's Ghostty
// config. The app's CSS variables and xterm.js's terminal colours both
// derive from these, so the canvas, panels, and shells all stay in sync
// with a single toggle.
//
// Base16 slots:
//   00 background    01 caret/selection-bg  02 —             03 comments
//   04 foreground    05 —                   06 —             07 bold/white
//   08 bright-black  09 red                 0A green         0B yellow
//   0C blue          0D magenta             0E cyan          0F bright-white
//   10 bright-red    11 bright-green        12 bright-yellow  13 bright-blue
//   14 bright-magenta 15 bright-cyan        16 orange (extra) 17 brown (extra)
//
// We map these to our app tokens:
//   --bg-0 ← slot 00 (background)
//   --bg-1 ← slot 18 (lighter bg shade)
//   --bg-2 ← slot 19 (even lighter)
//   --bg-3 ← slot 20
//   --text-1 ← slot 04 (foreground)
//   --text-2 ← slot 20
//   --text-3 ← slot 03 (comments)
//   --accent ← slot 0C (blue)
//   --ok ← slot 0A (green)
//   --warn ← slot 0B (yellow)
//   --err ← slot 09 (red)

const BASE16 = {
  dark: {
    // Neutral dark surfaces (no blue tint) + vibrant accents.
    // Base16 accents are too muted for a premium UI; we keep the base16
    // *light* values as-is but use our own vibrant set for dark.
    "00": "#111111", "01": "#1a1a1a", "02": "#1a1a1a", "03": "#555555",
    "04": "#e6e9f0", "05": "#e6e9f0", "06": "#e6e9f0", "07": "#e6e9f0",
    "08": "#555555", "09": "#e5484d", "0A": "#2ec27e", "0B": "#f5c144",
    "0C": "#5b8cff", "0D": "#a78bfa", "0E": "#2ec27e", "0F": "#f8f8f8",
    "10": "#e5484d", "11": "#2ec27e", "12": "#f5c144", "13": "#5b8cff",
    "14": "#a78bfa", "15": "#2ec27e", "16": "#f5a623", "17": "#a16946",
    "18": "#1a1a1a", "19": "#222222", "20": "#888888", "21": "#e6e9f0",
    selBg: "#264f78", selFg: "#111111",
  },
  light: {
    // From Ghostty default-light (AA-adjusted accents)
    "00": "#f8f8f8", "01": "#d8d8d8", "02": "#d8d8d8", "03": "#585858",
    "04": "#383838", "05": "#383838", "06": "#383838", "07": "#383838",
    "08": "#b8b8b8", "09": "#ab4642", "0A": "#66763b", "0B": "#9e620b",
    "0C": "#41788c", "0D": "#9c5d8d", "0E": "#3e7a72", "0F": "#181818",
    "10": "#ab4642", "11": "#66763b", "12": "#9e620b", "13": "#41788c",
    "14": "#9c5d8d", "15": "#3e7a72", "16": "#a56122", "17": "#a16946",
    "18": "#e8e8e8", "19": "#d8d8d8", "20": "#585858", "21": "#282828",
    selBg: "#d8d8d8", selFg: "#f8f8f8",
  },
};

/** Apply a theme to the document root + emit a bus event. */
export function applyTheme(mode) {
  const p = BASE16[mode] || BASE16.dark;
  const root = document.documentElement;
  root.setAttribute("data-theme", mode);
  root.dataset.themeMode = mode;

  // Map base16 → app tokens
  const map = {
    "--bg-0": p["00"],
    "--bg-1": p["18"],
    "--bg-2": p["19"],
    "--bg-3": mode === "dark" ? "#2a2a2a" : "#c8c8c8",
    "--bg-elev": mode === "dark" ? "#1e1e1e" : p["19"],
    "--stroke-1": mode === "dark" ? "#2a2a2a" : p["19"],
    "--stroke-2": mode === "dark" ? "#333333" : p["20"],
    "--stroke-strong": mode === "dark" ? "#444444" : p["03"],
    "--text-1": p["04"],
    "--text-2": mode === "dark" ? "#aab2c5" : p["20"],
    "--text-3": p["03"],
    "--text-faint": p["03"],
    "--accent": p["0C"],
    "--accent-soft": hexA(p["0C"], mode === "dark" ? 0.14 : 0.12),
    "--accent-strong": p["13"],
    "--ok": p["0A"],
    "--ok-soft": hexA(p["0A"], mode === "dark" ? 0.16 : 0.14),
    "--warn": p["0B"],
    "--warn-soft": hexA(p["0B"], mode === "dark" ? 0.16 : 0.14),
    "--err": p["09"],
    "--err-soft": hexA(p["09"], mode === "dark" ? 0.16 : 0.14),
    "--unknown": p["03"],
    "--unknown-soft": hexA(p["03"], 0.16),
    // Text that sits on coloured/accent backgrounds (group title plates,
    // health pills with coloured bg, etc.) — always the background colour
    // of the *opposite* theme for max contrast.
    "--fg-on-accent": mode === "dark" ? p["00"] : p["0F"],
    // Edge label halo — matches the canvas background
    "--canvas-bg": p["00"],
    // Group boundary tints
    "--group-fill": hexA(p["0C"], 0.04),
    "--group-stroke": hexA(p["0C"], 0.35),
  };
  for (const [k, v] of Object.entries(map)) root.style.setProperty(k, v);

  localStorage.setItem("reticle-theme", mode);
  bus.emit("theme:changed", { mode, palette: p });
  return p;
}

export function getTheme() {
  return localStorage.getItem("reticle-theme") || "dark";
}

export function toggleTheme() {
  const next = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
}

/** Get the xterm.js theme object for the current base16 mode. */
export function terminalTheme(mode = getTheme()) {
  const p = BASE16[mode] || BASE16.dark;
  return {
    background: p["00"],
    foreground: p["04"],
    cursor: p["04"],
    cursorAccent: p["00"],
    selectionBackground: p.selBg,
    black: p["00"],
    red: p["09"],
    green: p["0A"],
    yellow: p["0B"],
    blue: p["0C"],
    magenta: p["0D"],
    cyan: p["0E"],
    white: p["07"],
    brightBlack: p["08"],
    brightRed: p["10"],
    brightGreen: p["11"],
    brightYellow: p["12"],
    brightBlue: p["13"],
    brightMagenta: p["14"],
    brightCyan: p["15"],
    brightWhite: p["0F"],
  };
}

/** Add alpha to a hex colour. */
function hexA(hex, a) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// Late import to avoid circular dependency (bus → nothing → safe)
import { bus } from "./eventBus.js";