// app/AccessGate.js
// Full-screen gate shown when a daemon exists but REFUSED the connection
// (bad, stale, or missing token). Replaces the old behavior of silently
// falling back to the mock demo — which read as data loss.
//
// Entering a token navigates with ?token=… (the URL form wins and gets
// persisted to localStorage by api.js, same as a shared link).

import { h } from "../core/dom.js";

export function mountAccessGate(root, reason) {
  const input = h("input", {
    class: "gate-input",
    type: "password",
    placeholder: "access token",
    autocomplete: "off",
    spellcheck: "false",
  });
  const go = () => {
    const v = input.value.trim();
    if (!v) return;
    const u = new URL(location.href);
    u.searchParams.set("token", v);
    location.href = u.toString(); // full reload → clean transport handshake
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });

  const stored = (() => {
    try { return !!localStorage.getItem("reticle-token"); } catch { return false; }
  })();

  const gate = h("div", { class: "access-gate" },
    h("div", { class: "gate-card" },
      h("div", { class: "gate-mark" }),
      h("h1", {}, "Access required"),
      h("p", { class: "gate-reason" },
        `The daemon refused this connection: ${reason || "invalid or missing token"}.`),
      stored
        ? h("p", { class: "gate-hint" },
            "A previously saved token was sent — it may be stale (the daemon's tokens can rotate). Enter the current one:")
        : h("p", { class: "gate-hint" },
            "This map needs a token. Paste the one you were given:"),
      h("div", { class: "gate-row" },
        input,
        h("button", { class: "gate-btn", type: "button", onClick: go }, "Connect"),
      ),
      stored
        ? h("button", {
            class: "gate-clear", type: "button",
            onClick: () => {
              try { localStorage.removeItem("reticle-token"); } catch {}
              const u = new URL(location.href);
              u.searchParams.delete("token");
              location.href = u.toString();
            },
          }, "forget saved token & retry")
        : null,
    ),
  );
  root.appendChild(gate);
  input.focus();
}
