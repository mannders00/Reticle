# Reticle Daemon: Design & Build Plan

> `reticle-daemon` is a headless Rust binary that serves the exact same
> frontend (`src/`) over HTTP to any browser on the LAN, and exposes the
> same backend command surface over a WebSocket. **One daemon = one
> topology**: the YAML is fixed at launch, every connected user shares
> it, and there is no workspace picker in daemon mode. Access is
> role-based: editors change the diagram and run things; viewers watch.
> This file tracks the daemon's concrete
> phases, protocol, and decisions.

Everything lives in this repo:

```
reticle/
├── src/          ← the ONE frontend, embedded by desktop / served by daemon
├── core/         ← reticle-core: shared domain modules (config, ssh,
│                    health, cron, watcher; no tauri, no axum)
├── src-tauri/    ← desktop shell (Tauri IPC + terminal pty)
├── daemon/       ← headless LAN shell (axum HTTP + WebSocket;
│                    commercial, not present in the public mirror)
└── DAEMON.md     ← you are here
```

---

## 1. Thesis (why this is cheap)

The frontend already talks to the backend exclusively through
`src/core/api.js`, and modules communicate only via the event bus. The
store, canvas, panels, and export pipeline do not know which transport
they're on. So daemon mode is: (a) a second transport inside `api.js`,
and (b) a second Rust binary that dispatches the same `{cmd, args}`
requests to the same domain logic. Nothing else changes.

```
Desktop:   UI ──tauri.invoke──▶ #[tauri::command] thunks ──▶ domain modules
Daemon:    UI ──WebSocket────▶ axum /ws dispatcher ───────▶ domain modules
                                                            (same code, phase 1)
```

## 2. The sharing model

- **One config per daemon.** `reticle-daemon --config /etc/reticle/prod.yaml`
  serves exactly that topology. No `list_workspaces` / `switch_workspace`
  over the wire; the frontend hides the workspace switcher when it's on
  the WS transport. Run two daemons (two ports) if you want two diagrams.
- **Everyone sees the same live document.** Any accepted save broadcasts
  `config-changed`; every connected browser reloads. Same for external
  edits (`vim` on the YAML) via the file watcher.
- **Credentials live on the daemon host, never in the browser.** SSH and
  kubectl run as the daemon's user with the daemon host's `~/.ssh` /
  `KUBECONFIG`. Team members need a browser and a token: no keys, no
  kubeconfig, nothing installed.

## 3. Access control

Two capability levels, enforced **server-side in the dispatcher** (the
UI also adapts, but the daemon is the authority):

| capability            | viewer | editor |
|-----------------------|--------|--------|
| load config, watch changes, health/cron results | ✓ | ✓ |
| save config (move/add/edit/delete)              | ✗ | ✓ |
| run actions (`run_action`)                      | ✗ | ✓ |
| interactive shells / kubectl (phase 2)          | ✗ | ✓ |

Mechanics are **read-only by default**: without an explicit `--edit-token`
(or `--open`) nobody can write or execute, ever. The matrix:

| flags                  | no token   | edit token | view token | wrong token |
|------------------------|------------|------------|------------|-------------|
| *(none)*               | **viewer** | —          | —          | denied      |
| `--edit-token` only    | **viewer** | editor     | —          | denied      |
| `--view-token` only    | denied     | —          | viewer     | denied      |
| both tokens            | denied     | editor     | viewer     | denied      |
| `--open`               | editor     | editor     | editor     | editor      |

- `--edit-token` only is the public-demo shape: anyone can look, only
  you can touch. `--view-token` gates *viewing* (private maps).
  `--open` is the explicit dev/trusted-LAN opt-in (what
  `make daemon-dev` uses). Wrong tokens are always denied, never
  silently downgraded; a typo'd edit token must not masquerade as a
  working viewer session.
- The browser passes its token on the WS handshake
  (`/ws?token=…`); the token is remembered in `localStorage`
  (seeded from a `?token=…` page URL, so you can hand teammates a link).
- Token → role at connect time; the socket carries its role for life.
- The client learns its role from the `hello` event; viewers get the
  full phase-3b UI lockout and `api.canWrite === false`.
- This is authorization, not transport security. Put TLS in front (see
  §7 / phase 4) before crossing anything less trusted than an office LAN.

## 4. Transport protocol

One WebSocket at `GET /ws`. Three frame types:

**Request** (client → daemon, text):
```json
{ "id": 42, "cmd": "load_config", "args": {} }
```

**Reply** (daemon → client, text):
```json
{ "type": "reply", "id": 42, "ok": true,  "result": { ... } }
{ "type": "reply", "id": 42, "ok": false, "error": "message" }
```

**Event** (daemon → client, text; `hello` goes to the new socket, the
rest broadcast to all):
```json
{ "type": "event", "event": "hello",          "payload": { "role": "editor", "configPath": "…", "terminal": true, "connId": 3, "rev": 7 } }
{ "type": "event", "event": "config-changed", "payload": { "rev": 8, "origin": 3 } }
{ "type": "event", "event": "health-result",  "payload": { "server": "web-1", "ok": true } }
```

Phase 3 additions:
- `connId` identifies the socket; `config-changed.origin` carries the
  saver's connId (null for external file edits), so the saving client
  skips reloading its own change.
- `rev` is the config revision. `save_config` sends `baseRev` (the rev
  the client loaded) and gets `{ "rev": <new> }` back; a mismatched
  baseRev is refused (`stale save: …`) and the client reloads:
  optimistic concurrency, no CRDT. Desktop ignores all of this (single
  user, no baseRev sent).
- `health-result` streams the daemon-side TCP probe sweep (30s); new
  connections get the cached results right after `hello`. Clients on
  the ws transport do NOT self-probe.

`cmd` names and `args`/`result` shapes are IDENTICAL to the Tauri
commands in `src-tauri/src/commands.rs`; that is the contract that keeps
the frontend transport-agnostic. Adding a command means adding it to both
dispatchers (until phase 1 unifies them). Workspace commands are the one
deliberate exception: the daemon rejects them (`fixed config`).

**Terminal output** (phase 2) rides the same event mechanism: the pty
reader emits `shell-output-<sessionId>` events, but through a
**per-connection** sink: terminal bytes go only to the socket that
opened the shell, never the broadcast channel. Input/resize/close are
ordinary JSON commands (`write_shell`, `resize_shell`, `close_shell`).
Binary frames were considered and deliberately dropped for now: JSON
string frames match the desktop event payloads exactly (zero frontend
changes) and terminal traffic is human-scale; revisit only if profiling
ever says otherwise.

### Transport resolution in `api.js`

At boot, `api.js` picks exactly one transport:

1. `window.__TAURI__` present → **tauri** (desktop, unchanged)
2. else try `ws(s)://<location.host>/ws` with a short timeout → **ws**
3. else → **mock** (static browser testing via `reticle-serve.sh`)

`api.ready` is true for tauri + ws; `api.canWrite` is additionally false
for ws-viewers (persistence checks it before autosaving).

## 5. Phases

### Phase 0: skeleton ✅ DONE
Proved the transport + sharing + roles end-to-end:
- axum server: static `src/` with `index.html` fallback + `/ws`
- Token → role handshake, `hello` event, per-command authorization
- Commands implemented natively (small, duplicated on purpose):
  `reticle_ping`, `load_config`, `save_config` (editor),
  `get_config_path`, `health_check` (TCP probe),
  `run_action` (editor; system `ssh`, BatchMode),
  `get_cron_status` (stub `[]`), `remove_cron_results` (editor, no-op)
- Terminal/kubectl commands return a clear "phase 2" error; workspace
  commands return "fixed config"
- Config watcher: mtime poll (2s) → broadcasts `config-changed`, so an
  external `vim` edit (or a save by any editor) live-updates every
  open browser
- CLI: `reticle-daemon [--port 8788] [--config ~/.reticle/config.yaml]
  [--root src] [--edit-token X] [--view-token Y]`

### Phase 1: shared core crate ✅ DONE
Extracted `config / ssh / health / cron / watcher` (and later `terminal`)
from `src-tauri/src/` into `core/` (`reticle-core`); both binaries depend
on it. Domain modules emit events through `events::EventSink` (a plain
callback) instead of a Tauri `AppHandle`; the desktop wraps `app.emit`,
the daemon wraps its WebSocket broadcast. Cargo workspace at repo root
(one lockfile, `/target`). The phase-0 duplicate implementations in
`daemon/` are gone. The cron scheduler now runs daemon-side, so the daemon
collects data while nobody is watching, and `cron-result` events stream
to every connected browser (viewers included). `terminal.rs` stays in
src-tauri until phase 2.

### Phase 2: terminal over WebSocket ✅ DONE (editors only, opt-in)
The pty layer moved to `core/terminal.rs` (EventSink instead of
AppHandle; `list_pods` lives there too). Each daemon connection owns a
private ShellMap + sink: shells are per-user, their output is never
broadcast, and disconnecting kills every shell the connection opened
(`kill_all`). Because output events reuse the desktop's
`shell-output-<id>` names and payload shape, `TerminalDock`/xterm needed
zero changes. A shell on the daemon host runs with the daemon's
credentials, so the whole family (`open_shell`, `open_kubectl_shell`,
`list_pods`, …) requires BOTH the editor role and `--enable-terminal`.

### Phase 3: multi-user polish ✅ DONE
- **Save versioning**: monotonic `rev`, `baseRev` on save, stale writes
  refused server-side under a save lock; the refused client reloads and
  converges. The saving client's own broadcast is origin-tagged so it
  skips the pointless self-reload; the daemon's watcher swallows the
  mtime echo of its own writes (external `vim` edits still broadcast to
  everyone, origin null).
- **Viewer UI lockout**: enforced at three layers. The store refuses
  topology mutations for viewers (no UI path can even locally fork the
  document), interaction handlers bail before drags/connections start,
  and CSS hides the affordances (palette, ports, resize handles,
  inspector add/run/delete/Shell/Edit buttons). Statusbar shows
  "viewer · read-only". Pan/zoom/select/inspect/PDF stay live.
- **Daemon-side health probing**: 30s TCP sweep from the daemon's
  vantage, broadcast as `health-result`; results cached and seeded to
  new connections right after hello. Browser-side polling is disabled
  on the ws transport; viewers see real health with zero local tooling.
  (Client health survives topology reloads; signals re-apply.)

### Phase 4: hardening (audit log ✅, rest open)
- ✅ **Audit log**: `--audit-log <path>` appends JSONL: connects (peer
  addr, role, denials), saves (baseRev), `run_action`/`run_local`
  (script), shell/kubectl session opens. Refused viewer attempts are
  logged with `allowed:false`, and those are the interesting entries.
  Keystrokes (`write_shell`) are deliberately NOT logged: they can
  carry typed secrets.
- Open: reverse proxy (TLS) docs in web/DEPLOY.md, token rotation,
  per-user identities / SSO.

## 6. Decisions

- **One config per daemon, no remote workspace switching.** Sharing
  semantics stay trivial to reason about; multi-diagram = multi-daemon.
- **Roles are per-token, enforced in the dispatcher.** The UI adapting is
  UX; the daemon rejecting is security. Viewers physically cannot write
  or execute anything regardless of client behaviour.
- **Duplicate-then-unify.** Phase 0 deliberately reimplements ~150 lines
  of command logic rather than touching the desktop build. The crate
  split (phase 1) happens only after the skeleton proves the protocol.
- **mtime polling over `notify`.** One dependency fewer; 2s latency is
  fine for config reload. Revisit if it ever matters.
- **JSON text frames for everything except PTY bytes.** Payloads are
  small (topologies are KBs); binary is only worth it for terminals.
- **Root Cargo workspace (landed with phase 1).** `core/`, `src-tauri/`,
  `daemon/` share one lockfile and `/target`; `cargo check` passes for
  all three. Phase 0 had kept `daemon/` standalone to protect the
  desktop build while the protocol was unproven.
- **Browser-download export.** PDF export is pure frontend, so daemon
  users (viewers included) get it for free.

## 7. Running it

The frontend is **embedded in the binary** (include_dir), so a release
build is one self-contained ~3 MB file. `make daemon-all` cross-compiles
the matrix (linux arm64/armv7/x64 static-musl via cargo-zigbuild, macOS
arm64/x64) into `dist/`; `make deploy-pi PI=user@host` ships the arm64
one. See the Makefile for all targets.

```sh
./reticle-daemon --config /etc/reticle/prod.yaml \
  --edit-token $(openssl rand -hex 16) \
  --view-token $(openssl rand -hex 16) \
  --enable-terminal \
  --audit-log /var/log/reticle-audit.jsonl
# editors:  http://<host>:8788/?token=<edit-token>
# viewers:  http://<host>:8788/?token=<view-token>
```

Dev loop: `make daemon-dev` serves `src/` from disk via `--root` so
frontend edits don't need a rebuild (a missing config file is created
automatically). The daemon is Unix-only for now (pty layer).

## 8. Open questions

- ~~Viewer drags~~: resolved by phase 3b, the store refuses viewer
  mutations outright; there is nothing to snap back anymore.
- ~~Health probing origin~~: resolved by phase 3c, daemon-side sweep,
  broadcast + cache-seeded on connect.
- Token in the URL query is visible in server logs / browser history;
  fine for LAN v1, revisit alongside TLS in phase 4.
- Conflict UX: a refused stale save currently drops the loser's edit
  with a console warning + `config:conflict` bus event; nobody renders
  that event as a toast yet.
