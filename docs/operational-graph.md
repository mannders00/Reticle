# Operational graph

Reticle starts with an intentionally authored infrastructure diagram. The YAML
defines the systems, relationships, notes, checks, and known actions that belong
in the operating model. Current observations connect that model to real systems.

The shared core assembles the configured topology and current observations into
one graph snapshot. The canvas is the primary interface; JSON and read-only MCP
provide machine-readable views of the same data.

## Snapshot schema

Every snapshot contains:

- `nodes`: normalized infrastructure entities with stable IDs and display data
- `edges`: directed relationships between nodes
- `signals`: timestamped observations associated with nodes
- `collectors`: collector state, detail, duration, and collection time
- `actions`: non-executable names, kinds, validated targets, and policy for
  server-resolved named actions
- `generatedAt`: when this snapshot was assembled

Executable scripts, interpreters, custom command text, and arbitrary
arguments are never included in graph snapshots. Legacy node-level `actions`
and `crons` are intentionally omitted.

## Configuration

The first topology collector reads the local YAML file. Reticle supports HTTP
checks and two fixed, read-only SSH probes: `host.uptime` and
`service.status`. SSH uses the local OpenSSH configuration and non-interactive
authentication, but the remote account should still be restricted to the
minimum commands it needs.

Reticle can additionally permit persisted remote `ssh.command` and local
`shell.command` checks. New UI definitions default to enabled and viewer-visible;
Desktop uses one global privileged toggle for the active workspace, with no
per-check acknowledgment, while Team requires the daemon
operator's `--allow-custom-commands` flag and editor authorization. This
privileged mode can turn precise shell diagnostics into repeatable graph signals,
but the commands are arbitrary and cannot be guaranteed read-only. Restricted
SSH principals and a dedicated, least-privileged Reticle OS account are the
actual security boundaries.

```yaml
version: 1

nodes:
  api:
    kind: service
    title: API
    x: 80
    y: 80
    spec: { host: api.internal, port: 22, user: reticle-probe }

edges: {}

collectors:
  - id: api-http
    nodeId: api
    name: API health endpoint
    kind: http
    url: https://api.internal/healthz
    status: 2xx
    jq: '.status == "ok"'
    timeoutSeconds: 8
  - id: api-service
    nodeId: api
    name: API systemd unit
    kind: ssh
    probe: service.status
    service: api.service
    timeoutSeconds: 10
  # WARNING: arbitrary remote command; restrict the SSH principal.
  - id: api-release-check
    nodeId: api
    name: Verify deployed release
    kind: ssh
    probe: ssh.command
    command: /usr/local/libexec/reticle-check release
    enabled: false
    publishOutput: false
    timeoutSeconds: 10
  # WARNING: runs on the Reticle host with its OS permissions and environment.
  - id: api-json-check
    nodeId: api
    name: Verify API response
    kind: local
    probe: shell.command
    command: curl -fsS https://api.internal/healthz | jq -e '.status == "ok"'
    enabled: false
    publishOutput: false
    timeoutSeconds: 10

actions:
  - id: diagnose-api
    nodeId: api
    name: Diagnose API
    kind: ssh.command
    command: curl -fsS http://127.0.0.1:8080/healthz | jq -e '.status == "ok"'
    requiresSignal: api-service
    requiresState: err
    requiresApproval: true
    timeoutSeconds: 20
```

Named actions support persisted `ssh.command` and local `shell.command`
definitions. Timeouts are mandatory, optional signal preconditions are checked
against a fresh graph, approval is required by default, and daemon attempts are
written to the configured audit log. Team callers submit only an action ID,
expected configuration revision, and approval decision; command text remains in
persisted configuration.

Before a custom check executes, Team validates its persisted definition and
bounds its timeout. Remote SSH commands receive no PTY or stdin. Local commands
run through non-interactive Bash with `pipefail`, so `curl -fsS ... | jq -e ...`
reports failure when either side fails. Viewers cannot see command text, manage
definitions, or run checks; command text is omitted from graph responses and
audit logs. Custom checks are never viewer-graph API, MCP, chat, or one-off
ad-hoc tools.

## API

Desktop and WebSocket clients call `get_operational_graph`. The OSS desktop can
also expose the same snapshot over an opt-in loopback server:

```sh
RETICLE_DESKTOP_HTTP_PORT=8786 bun run tauri dev
curl http://127.0.0.1:8786/api/graph
```

The listener is disabled when the environment variable is absent, always binds
`127.0.0.1`, limits request bodies and concurrent collections, follows desktop
workspace switches, and has no mutation or action route.

The paid [Team Daemon](https://reticle.live/team/) serves the shared snapshot at
`GET /api/graph`:

```sh
curl 'https://reticle.example/api/graph?token=VIEW_TOKEN'
```

Authentication follows the daemon role rules. Both viewer and editor roles may
read the graph. Only editors may request a named action.

## MCP

Desktop and daemon expose Streamable HTTP-style JSON-RPC at `POST /mcp`. Both
are read-only and advertise:

- `reticle_get_graph`
- `reticle_get_node` with an `id` argument

The daemon additionally provides `reticle_get_signal_history`. The desktop
does not retain history because its lifecycle belongs to one local session.

There is deliberately no MCP action tool. MCP can inspect topology and signals,
but action execution remains an explicit human workflow. Custom command checks
are never MCP tools.

## Optional chat lens

The optional in-app chat panel reads the current graph and cannot change it. It
supports OpenAI's official chat-completions endpoint and
Ollama on `localhost` or a literal loopback IP. Its only tools are
`reticle_get_graph`, `reticle_get_node`, and, on the daemon,
`reticle_get_signal_history`. It has no action, command, shell, save, or MCP
mutation tool. Requests have bounded time and tool rounds, and HTTP redirects
are disabled.

Provider credentials and endpoints are request-scoped and never written to
configuration or logs. With OpenAI, the provider receives the question and any
graph data returned by a tool call. Ollama requests remain on the machine
running Reticle: the desktop host for the desktop app and the daemon host for
the [Team Daemon](https://reticle.live/team/). Optional daemon chat requires the
editor role; audit records contain only provider and model, not prompts,
answers, credentials, graph data, or signal history. It provides no arbitrary
shell access.

## Current limits

Reticle does not automatically enumerate the environment or import every runtime
resource, and it is not an autonomous remediation system. Desktop checks run when its graph is
requested. The daemon collects immediately and every 30 seconds, keeps a
bounded transient in-memory observation ring, and invalidates its cache after
topology changes. Observations reset when the daemon restarts and are not durable
history. Reticle complements metrics
and tracing systems; it does not replace them.
