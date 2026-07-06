# The Team Daemon

`reticle-daemon` is a single static binary (about 4 MB, UI embedded)
that serves the full Reticle app to every browser on your network and
runs all checks around the clock. It is the commercial counterpart to
the MIT desktop app; see [reticle.live](https://reticle.live) for
licensing. This page documents how it operates, because the protocol
and security model are part of the open design
(see [DAEMON.md](../DAEMON.md) for the full architecture).

## Running

```sh
reticle-daemon --config /etc/reticle/prod.yaml \
  --edit-token $(openssl rand -hex 16) \
  --audit-log /var/log/reticle-audit.jsonl
```

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `8788` | HTTP and WebSocket port. |
| `--config` | `~/.reticle/config.yaml` | The one topology this daemon serves. Created if missing. |
| `--edit-token` | unset | Token that grants the editor role. |
| `--view-token` | unset | Token that gates viewing. |
| `--open` | off | Everyone edits. For development on a trusted machine only. |
| `--enable-terminal` | off | Allow interactive shells (editors only). |
| `--audit-log` | unset | Append a JSONL audit entry per privileged action. |
| `--root` | embedded UI | Serve the frontend from a directory instead (development). |

## Access model: read-only by default

Without an edit token, nobody can change anything or execute anything,
ever. Roles are enforced in the daemon, not in the UI.

| Flags | No token | Edit token | View token | Wrong token |
|---|---|---|---|---|
| none | viewer | | | denied |
| `--edit-token` only | viewer | editor | | denied |
| `--view-token` only | denied | | viewer | denied |
| both | denied | editor | viewer | denied |
| `--open` | editor | editor | editor | editor |

- Editors change the map, run actions, and open terminals (when
  enabled). Viewers pan, inspect, watch live health, and export PDF.
- A public read-only map is the zero-flag default. Editing stays
  private to whoever holds the edit token.
- Wrong tokens are always denied rather than downgraded, so a mistyped
  edit token cannot masquerade as a working session.

Tokens travel as `?token=...` in the shared link and are remembered by
the browser. Put TLS in front before crossing anything less trusted
than an office LAN.

## What teammates need

A browser and a link. SSH keys and kubeconfig live on the daemon host
only; commands run with that host's credentials. Nothing to install,
nothing to offboard.

## Multi-editor behavior

Every accepted save broadcasts to all connected browsers. Concurrent
edits use optimistic concurrency: a save based on a stale revision is
refused and that client reloads. External edits to the YAML (for
example from a deploy pipeline or vim) broadcast the same way.

## Health at the server

The daemon probes every node with a `spec.host` on a 30 second sweep
from its own network vantage point and broadcasts results, so every
viewer sees live health without any local tooling. Scheduled checks run
on the daemon 24/7, whether or not anyone is watching.

## Audit log

With `--audit-log <path>`, the daemon appends one JSON line per
privileged event: connections (with peer address, role, and denials),
saves, one-shot commands, and terminal session opens. Refused attempts
are recorded with `"allowed": false`. Keystrokes inside terminals are
never logged. Without the flag, no file is written and nothing is
collected.

```json
{"ts":1783129739,"conn":1,"role":"editor","cmd":"save_config","allowed":true,"detail":{"baseRev":1}}
{"ts":1783129741,"conn":2,"role":"viewer","cmd":"run_local","allowed":false,"detail":{"script":"..."}}
```

## Deployment sketch

One binary, one systemd unit, a reverse proxy for TLS:

```ini
[Service]
ExecStart=/opt/reticle/reticle-daemon --port 8790 \
  --config /opt/reticle/topology.yaml \
  --edit-token CHANGE_ME \
  --audit-log /var/log/reticle/audit.jsonl
Restart=on-failure
DynamicUser=yes
```

```caddyfile
map.example.com {
    reverse_proxy 127.0.0.1:8790
}
```

Never use `--open` or `--enable-terminal` on anything public.
