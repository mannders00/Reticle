# [Team Daemon](https://reticle.live/team/)

[`reticle-daemon`](https://reticle.live/team/) turns the same intentionally
defined infrastructure diagram used by Desktop into an always-on team resource.
One customer-hosted binary runs collection continuously and serves authorized
browsers from a trusted network vantage point. Authenticated JSON and read-only
MCP expose the current graph to integrations.

It is the commercial counterpart to the free, standalone, local-only MIT
Desktop app. This page documents operations, protocol, and security. See the
[Team page](https://reticle.live/team/) for licensing and
[DAEMON.md](../DAEMON.md) for the full architecture.

One licensed daemon serves one topology. Access is seat-unlimited through shared
editor/viewer bearer tokens; SSO, individual identities, and per-user audit
attribution are not included.

Team Daemon is designed to reduce operational ambiguity: time spent forming a
shared incident model, finding a safe next action, recovering failed-deployment
and change context, and handing the incident to another responder. These are
outcomes it helps improve; no fixed recovery-time or ROI figures are claimed.

## Running

```sh
reticle-daemon --config /etc/reticle/prod.yaml \
  --bind 0.0.0.0 \
  --edit-token $(openssl rand -hex 16) \
  --view-token $(openssl rand -hex 16) \
  --allow-custom-commands \
  --audit-log /var/log/reticle-audit.jsonl
```

| Flag | Default | Meaning |
|---|---|---|
| `--bind` | `127.0.0.1` | Listener IP. Non-loopback binding requires a view token. |
| `--port` | `8788` | HTTP and WebSocket port. |
| `--config` | `~/.reticle/config.yaml` | The one topology this daemon serves. Created if missing. |
| `--edit-token` | unset | Token that grants the editor role. |
| `--view-token` | unset | Token that gates viewing. |
| `--open` | off | Everyone edits. Loopback development only; incompatible with custom commands. |
| `--audit-log` | unset | Append JSONL for connection lifecycle and selected privileged requests, refusals, failures, and outcomes. |
| `--allow-custom-commands` | off | Permit persisted `ssh.command` and Unix-only `shell.command` checks and named actions; UI/API management also requires an editor. |
| `--root` | embedded UI | Serve the frontend from a directory instead (development). |

## Access model: read-only by default

Without editor authorization, nobody can change configuration or request an
execution. Roles are enforced in the daemon, not in the UI.

| Flags | No token | Edit token | View token | Wrong token |
|---|---|---|---|---|
| none | viewer | | | denied |
| `--edit-token` only | viewer | editor | | denied |
| `--view-token` only | denied | | viewer | denied |
| both | denied | editor | viewer | denied |
| `--open` | editor | editor | editor | editor |

- Editors change static topology and request configured named actions. Viewers
  pan, inspect, read the JSON graph or MCP tools, and export PDF.
- The zero-flag default is loopback-only and read-only. Non-loopback binding
  requires a view token; editing stays private to the edit token.
- Wrong tokens are always denied rather than downgraded, so a mistyped
  edit token cannot masquerade as a working session.

Browser links may carry `?token=...` once. Reticle moves the token into
session storage and immediately removes it from the visible URL. Query tokens
still require TLS and proxy-log redaction. JSON API and MCP clients should use
`Authorization: Bearer <token>`. Prefer `RETICLE_EDIT_TOKEN` and
`RETICLE_VIEW_TOKEN` environment variables over command-line token flags.

## What teammates need

A browser and a link. Restricted SSH credentials for probes and named actions
live on the daemon host only. Nothing to install on teammate machines.

## Multi-editor behavior

Every accepted save broadcasts to all connected browsers. Concurrent
edits use optimistic concurrency: a save based on a stale revision is
refused and the local draft is preserved for reconciliation. External edits to the YAML (for
example from a deploy pipeline or vim) broadcast the same way.

## Graph, JSON, and MCP

`GET /api/graph` returns the current graph snapshot. `POST /mcp` exposes only
read-only graph tools; MCP cannot execute actions. A single background owner
collects immediately, every 30 seconds, and after accepted or external topology
changes. API and browser clients read that cache instead of launching duplicate
probes.

`GET /api/history` returns newest-first transient signal observations and accepts
`signalId`, `nodeId`, `since`, and `limit` filters. History is bounded to 10,000
observations with 4 KiB details and currently resets on daemon restart. MCP adds
`reticle_get_signal_history` over the same data. See
[Operational graph](operational-graph.md).

The observation ring is bounded, held only in memory, resets
on restart, and must not be treated as durable history or a retention system.

## Optional chat lens

Optional chat reads the current graph and cannot change topology or run actions.
It is editor-only because a model may receive graph data.
It exposes only graph, node, and bounded history inspection tools and cannot run
actions or change topology. OpenAI API keys are carried with one browser request
to the daemon and then to OpenAI's fixed official endpoint; use TLS between the
browser and daemon. Keys are not persisted or logged. Ollama endpoints must be
loopback addresses on the daemon host. Chat audit entries contain provider and
model only, never prompts, answers, credentials, graph data, or history.

The viewer graph API, MCP, and chat expose no interactive or ad-hoc shell.
Named actions are persisted secure-shell or local-shell commands. Invocation requests
contain only an action ID, expected configuration revision, and approval decision.
Run the daemon and its SSH
principal with least privilege.

## Gated custom command checks

Fixed HTTP checks and fixed, read-only SSH probes remain the default. To permit
an `ssh.command` or local `shell.command` definition, the daemon operator must pass
`--allow-custom-commands`. UI/API changes require an editor; new custom checks
default to enabled and publish bounded output to viewers. There is no per-check
risk-acknowledgment field. The daemon validates
each definition and bounds its timeout before execution. Direct YAML writers are
trusted operators, so restrict configuration-file access.

Remote commands have no PTY or stdin. On Unix hosts, local commands run through
non-interactive Bash on the daemon host with its OS permissions and `pipefail`; for example,
`curl -fsS URL | jq -e PREDICATE` fails on HTTP, transport, or predicate errors.
Custom checks are never viewer graph API, MCP, or chat tools and cannot arrive as one-off
ad-hoc requests. Viewers cannot see command text, manage definitions, or run
checks. Audit records omit command text.

Custom checks are arbitrary commands, not inherently read-only probes. Use
restricted SSH principals and run the daemon under a dedicated, least-privileged
OS account with tightly scoped environment credentials and filesystem access. See the
[topology reference](topology-reference.md) for syntax.

## Audit log

With `--audit-log <path>`, the daemon appends JSONL for accepted and denied
WebSocket connections, disconnects, selected privileged requests and viewer
refusals, stale or invalid saves, and named-action outcomes. Without the flag,
no JSONL file is written. A single action can produce a request record and a
result record; this is not one line per user gesture.

Selected request records cover topology and operations saves, refresh, named
actions, chat provider/model, disabled legacy command/shell routes, and cron-result
removal. Save records include revisions and operations change summaries. Named
action requests include action ID, approval decision, and `baseRev`; outcomes
include exit code or an error string. Records do not include command text,
command output, shell keystrokes, chat prompt/answer, credentials, or graph data.

```json
{"ts":1783129739,"conn":1,"role":"editor","cmd":"run_named_action","allowed":true,"detail":{"actionId":"diagnose-api","approved":true,"baseRev":4}}
{"ts":1783129741,"conn":1,"role":"editor","cmd":"named_action_result","allowed":true,"detail":{"actionId":"diagnose-api","exitCode":0}}
```

## Production deployment

Use a dedicated service account, loopback binding behind TLS, protected token
files, audit rotation, and tested backup/restore. Never use `--open` on anything
public. The complete copy-ready procedure, including upgrades, rollback,
uninstall, and checksum verification, is in
[Production deployment](production-deployment.md).

Deployment questions are welcome in the [Discord](https://discord.gg/x6hY9GYyph).

## Pricing and roadmap

The current paid offering includes shared always-on collection, authenticated
remote graph access, roles, configured JSONL audit logging, and optional paid
setup. Planned controls include durable incident history and
retention policy, SSO/OIDC, and multiple managed topologies. These are roadmap
items, not claims about the current binary. JSON, MCP, the graph schema, and
local data ownership remain available in the OSS desktop.

The [Team Daemon](https://reticle.live/team/) is $199/month or $1,999/year per
daemon. White-glove installation and operational mapping starts at $3,000
one-time.
