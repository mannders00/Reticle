# [Team Daemon](https://reticle.live/team/)

[`reticle-daemon`](https://reticle.live/team/) is a single static binary with an
embedded UI that serves one canonical operational graph to every browser
on your network, the JSON API, and read-only MCP. It is the commercial
counterpart to the free, standalone, local-only MIT desktop app; see the
[Team page](https://reticle.live/team/) for licensing. This page documents how
it operates, because the protocol and security model are part of the open design
(see [DAEMON.md](../DAEMON.md) for the full architecture).

Team Daemon is designed to reduce operational ambiguity: time spent forming a
shared incident model, finding a safe next action, recovering failed-deployment
and change context, and handing the incident to another responder. These are
outcomes it helps improve; no fixed recovery-time or ROI figures are claimed.

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

- Editors change static topology and request configured named actions. Viewers
  pan, inspect, read the JSON graph or MCP tools, and export PDF.
- A public read-only map is the zero-flag default. Editing stays
  private to whoever holds the edit token.
- Wrong tokens are always denied rather than downgraded, so a mistyped
  edit token cannot masquerade as a working session.

Tokens travel as `?token=...` in the shared link and are remembered by
the browser. Query tokens require TLS; put TLS in front of the daemon.

## What teammates need

A browser and a link. Restricted SSH credentials for probes and named actions
live on the daemon host only. Nothing to install on teammate machines.

## Multi-editor behavior

Every accepted save broadcasts to all connected browsers. Concurrent
edits use optimistic concurrency: a save based on a stale revision is
refused and that client reloads. External edits to the YAML (for
example from a deploy pipeline or vim) broadcast the same way.

## Graph, JSON, and MCP

`GET /api/graph` returns the canonical graph. `POST /mcp` exposes only
read-only graph tools; MCP cannot execute actions. A single background owner
collects immediately, every 30 seconds, and after accepted or external topology
changes. API and browser clients read that cache instead of launching duplicate
probes.

`GET /api/history` returns newest-first signal observations and accepts
`signalId`, `nodeId`, `since`, and `limit` filters. History is bounded to 10,000
observations with 4 KiB details and currently resets on daemon restart. MCP adds
`reticle_get_signal_history` over the same data. See
[Operational graph](operational-graph.md).

The visual UI, authenticated JSON API, and read-only MCP are first-class lenses
on this same graph. History is bounded, in memory, and resets on restart.

## Optional chat lens

Optional chat is a read-only lens, not the product or source of truth. It is
editor-only because a model may receive operational graph data.
It exposes only graph, node, and bounded history inspection tools and cannot run
actions or change topology. OpenAI API keys are carried with one browser request
to the daemon and then to OpenAI's fixed official endpoint; use TLS between the
browser and daemon. Keys are not persisted or logged. Ollama endpoints must be
loopback addresses on the daemon host. Chat audit entries contain provider and
model only, never prompts, answers, credentials, graph data, or history.

The daemon, JSON API, MCP, and chat expose no arbitrary shell. Collectors are
fixed probes and actions are server-owned named actions. Run the daemon and its
SSH principal with least privilege.

## Audit log

With `--audit-log <path>`, the daemon appends one JSON line per
privileged event: connections, saves, and named-action attempts. Refused
attempts are recorded with `"allowed": false`. Without the flag, no file is
written.

```json
{"ts":1783129739,"conn":1,"role":"editor","cmd":"save_config","allowed":true,"detail":{"baseRev":1}}
{"ts":1783129741,"conn":2,"role":"viewer","cmd":"run_named_action","allowed":false,"detail":{"actionId":"restart-api","approved":false}}
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

Never use `--open` on anything public.

Deployment questions are welcome in the [Discord](https://discord.gg/x6hY9GYyph).

## Pricing and roadmap

The current paid offering includes shared always-on collection, authenticated
remote graph access, roles, configured JSONL audit logging, bounded history,
and optional paid setup. Planned controls include durable incident history and
retention policy, SSO/OIDC, and multiple managed topologies. These are roadmap
items, not claims about the current binary. JSON, MCP, the graph schema, and
local data ownership remain available in the OSS desktop.

The [Team Daemon](https://reticle.live/team/) is $199/month or $1,999/year per
daemon. White-glove installation and operational mapping starts at $3,000
one-time.
