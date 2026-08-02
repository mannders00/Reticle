// app/AccessGate.js
// Full-screen gate shown when a daemon exists but REFUSED the connection
// (bad, stale, or missing token). Replaces the old behavior of silently
// falling back to the mock demo — which read as data loss.
//
// Entering a token navigates with ?token=… (the URL form wins and gets
// retained for the browser session by api.js, then removed from the URL.

import { h } from "../core/dom.js";

export function mountAccessGate(root, reason) {
  const connectionFailed = String(reason).startsWith("Could not");
  const input = h("input", {
    class: "gate-input",
    type: "password",
    "aria-label": "Reticle access token",
    placeholder: "access token",
    autocapitalize: "none",
    autocorrect: "off",
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
    try { return !!sessionStorage.getItem("reticle-token"); } catch { return false; }
  })();

  const gate = h("div", { class: "access-gate" },
    h("div", { class: "gate-card" },
      h("div", { class: "gate-mark" }),
      h("h1", {}, connectionFailed ? "Connection unavailable" : "Access required"),
      h("p", { class: "gate-reason" },
        connectionFailed ? reason : `The daemon refused this connection: ${reason || "invalid or missing token"}.`),
      connectionFailed
        ? h("p", { class: "gate-hint" }, "Reticle will not substitute demo data for an unavailable operational graph.")
        : stored
        ? h("p", { class: "gate-hint" },
            "A previously saved token was sent — it may be stale (the daemon's tokens can rotate). Enter the current one:")
        : h("p", { class: "gate-hint" },
            "This map needs a token. Paste the one you were given:"),
      connectionFailed
        ? h("button", { class: "gate-btn", type: "button", onClick: () => location.reload() }, "Retry")
        : h("div", { class: "gate-row" },
            input,
            h("button", { class: "gate-btn", type: "button", onClick: go }, "Connect"),
          ),
      !connectionFailed && stored
        ? h("button", {
            class: "gate-clear", type: "button",
            onClick: () => {
              try { sessionStorage.removeItem("reticle-token"); } catch {}
              const u = new URL(location.href);
              u.searchParams.delete("token");
              location.href = u.toString();
            },
          }, "forget saved token & retry")
        : null,
    ),
  );
  root.appendChild(gate);
  if (!connectionFailed) input.focus();
}
