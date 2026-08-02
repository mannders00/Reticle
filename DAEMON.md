# Reticle Daemon Architecture

[`reticle-daemon`](https://reticle.live/team/) is the paid shared runtime for
Reticle's canonical operational graph. One daemon serves one topology to
browsers, an authenticated JSON API, and read-only MCP. These are first-class
lenses on the same graph. It is not a remote shell service.

One licensed daemon serves one topology. Access is seat-unlimited through shared
editor/viewer bearer tokens; SSO, individual identities, and per-user audit
attribution are not included.

## Repository boundaries

```text
src/          one frontend used by desktop, daemon, and browser mock
core/         transport-neutral graph, collectors, named actions, config
src-tauri/    MIT desktop shell and opt-in loopback read API
daemon/       proprietary commercial runtime: HTTP, WebSocket, auth, audit
```

`reticle-core` depends on neither Tauri nor Axum. Both shells call the same
`graph::collect_yaml` function and serialize the same `OperationalGraph`.

## Operational model

The graph contains:

- normalized nodes and directed edges;
- timestamped signals associated with nodes;
- collector state, duration, and freshness;
- named-action descriptors containing policy, not shell text.

The initial inputs are deliberately narrow:

- static topology from local YAML;
- HTTP status and optional `jq` checks;
- fixed SSH probes: `host.uptime` and `service.status`;
- optional, gated remote `ssh.command` and Unix-only local `shell.command` checks;
- named secure-shell and local-shell command actions.

Raw configuration, custom command text, local scripts, interpreters, interactive
terminals, kubectl shells, and caller-provided one-off SSH commands are not
exposed through the viewer graph API, MCP, or optional chat. Deploy the
[Team Daemon](https://reticle.live/team/) with least-privilege network and SSH
access.

## Daemon collection

One background owner collects immediately at startup, every 30 seconds, and
after accepted saves or external YAML changes. API and MCP clients and viewers
read the resulting cache. An editor may request one generation-tracked refresh;
the background owner still performs and coalesces collection, so clients never
launch duplicate probe workers.

Collection publication is revision-aware:

1. Capture the current config revision.
2. Collect on a blocking worker.
3. Discard the result if the revision changed while collection ran.
4. Publish only a snapshot matching the current revision.

A stale cache is invalidated before `config-changed` is broadcast. Readers wait
for a current-revision snapshot rather than receiving old topology or signals.

## Transient signal observations

The daemon retains a bounded in-memory observation ring for short-term inspection.
This is an implementation convenience, not durable history or a commercial
retention feature:

- maximum 10,000 observations;
- unchanged observations are deduplicated;
- details larger than 4 KiB are replaced by truncation metadata;
- entries carry sequence, config revision, and collection time;
- history resets when the daemon restarts.

`GET /api/history` accepts `signalId`, `nodeId`, `since`, and `limit` filters.
`limit` defaults to 100 and is capped at 1,000. The daemon MCP server exposes
the same data through `reticle_get_signal_history`.

Durable history and configurable retention remain commercial roadmap items.

## HTTP surfaces

| Route | Access | Purpose |
|---|---|---|
| `GET /` | viewer | Embedded frontend |
| `GET /ws` | viewer/editor | UI RPC and config events |
| `GET /api/graph` | viewer | Current canonical graph |
| `GET /api/history` | viewer | Bounded signal history |
| `POST /mcp` | viewer | Read-only MCP tools |

MCP tools:

- `reticle_get_graph`
- `reticle_get_node`
- `reticle_get_signal_history` (daemon only)

There is deliberately no MCP action tool.

## WebSocket protocol

Requests and replies retain the existing transport abstraction:

```json
{ "id": 42, "cmd": "get_operational_graph", "args": {} }
{ "type": "reply", "id": 42, "ok": true, "result": { "schemaVersion": 1 } }
```

The first frame identifies role, connection, config revision, and daemon
version. Terminal capability is always false.

```json
{
  "type": "event",
  "event": "hello",
  "payload": {
    "role": "viewer",
    "terminal": false,
    "connId": 3,
    "rev": 7,
    "version": "1.2.1"
  }
}
```

Accepted saves and external edits broadcast:

```json
{
  "type": "event",
  "event": "config-changed",
  "payload": { "rev": 8, "origin": 3 }
}
```

`origin` is null for external edits. Saves carry `baseRev`; stale saves are
refused under a save lock and the client reloads.

## Authorization

The daemon is read-only by default.

| Flags | No token | Edit token | View token | Wrong token |
|---|---|---|---|---|
| none | viewer | | | denied |
| `--edit-token` only | viewer | editor | | denied |
| `--view-token` only | denied | | viewer | denied |
| both | denied | editor | viewer | denied |
| `--open` | editor | editor | editor | editor |

Viewers may inspect topology, signals, history, exports, JSON, and MCP. Editors
may additionally save topology and request configured named actions. Roles are
enforced in the daemon, not only hidden in the frontend.

Tokens in query strings are authorization credentials, not transport security.
Query-token deployments require TLS; deploy behind TLS outside a trusted local
network.

## Custom command checks

Fixed HTTP checks and the fixed, read-only `host.uptime` and `service.status`
SSH probes remain the default. Team permits persisted remote `ssh.command` and
Unix-only local `shell.command` collectors only when both control-plane gates are present:

1. The daemon operator starts it with `--allow-custom-commands`.
2. Definitions created through the UI/API require editor authorization. New
   custom checks default to enabled and publish bounded output to viewers.

Direct filesystem access to the YAML is an operator trust boundary, not a third
untrusted input path. An enabled custom check written directly to disk may run
while the daemon flag is active; restrict config-file writers accordingly.

Before execution, the daemon validates the definition and enforces its 1-120
second timeout. Remote commands run over SSH without a PTY or stdin. Local
commands run in non-interactive Bash on the daemon host with `pipefail`, making
commands such as `curl -fsS ... | jq -e ...` fail on either HTTP or predicate
failure. No custom check accepts a caller-supplied one-off command.
`publishOutput: false` keeps
stdout and stderr out of the graph; command text is always omitted from graph
responses and audit logs. Viewers cannot see command text, manage definitions,
or run custom checks. Custom checks are never API, MCP, or chat tools.

Custom definitions contain arbitrary commands and therefore cannot be guaranteed
read-only. Restricted SSH principals and the daemon's least-privileged OS
account, environment, filesystem, and network access are the actual security
boundaries, not Reticle's collector label or UI. Named actions use those same
execution boundaries and remain persisted definitions rather than ad-hoc requests.

## Named actions

Action callers submit only an action ID, expected configuration revision
(`baseRev` on the wire), and approval decision. The daemon loads
the persisted definition, enforces a 1-120 second timeout, checks optional
fresh-signal preconditions, requires approval by default, and executes either
over the node's SSH identity or through non-interactive Bash on the daemon host.

With `--audit-log`, the daemon appends JSONL for accepted and denied WebSocket
connections, disconnects, selected privileged requests and viewer refusals,
stale or invalid saves, and named-action outcomes. The initial
`run_named_action` record contains action ID, approval decision, and `baseRev`;
`named_action_result` contains an exit code or error string. Configuration-save
records summarize changed collector and action IDs without command text. Refresh,
chat provider/model, disabled legacy command routes, and cron-result removal are
also among the selected privileged requests. It does not log shell keystrokes,
command text, command output, prompts, credentials, or graph data.

## Desktop interoperability

The free MIT desktop is standalone and local-only, with no shared daemon. It can
expose its active workspace at a loopback-only read server:

```sh
RETICLE_DESKTOP_HTTP_PORT=8786 bun run tauri dev
```

It serves `GET /api/graph` and `POST /mcp` on `127.0.0.1`. It has no history,
authentication, mutation, or action endpoint. This keeps local interoperability
open while the daemon addresses the shared access and governance problem.

## Running the daemon

```sh
./reticle-daemon --config /etc/reticle/prod.yaml \
  --bind 0.0.0.0 \
  --edit-token "$(openssl rand -hex 16)" \
  --view-token "$(openssl rand -hex 16)" \
  --allow-custom-commands \
  --audit-log /var/log/reticle-audit.jsonl
```

Omit `--allow-custom-commands` for the fixed-probe default.
The listener defaults to `127.0.0.1`; non-loopback `--bind` requires a view
token. Tokens can be supplied through `RETICLE_EDIT_TOKEN` and
`RETICLE_VIEW_TOKEN` to keep them out of process arguments.

The release binary embeds the frontend. `--root ../src` serves frontend files
from disk during development. `make daemon-dev`, `make daemon`, and
`make daemon-all` cover the normal workflows.

## Pricing and roadmap

The current paid value is shared always-on collection, authenticated remote
access, roles, configured JSONL audit logging, and optional
paid installation. Planned capabilities are durable incident history and
retention policy, SSO/OIDC, multiple managed topologies, and deployment
lifecycle support. They are not claims about the current binary.

The [Team Daemon](https://reticle.live/team/) is $199/month or $1,999/year per
daemon. White-glove installation and operational mapping starts at $3,000
one-time.
