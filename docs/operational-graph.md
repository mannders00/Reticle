# Operational graph

Reticle is a human-first, live operational graph. During an incident, its job
is to make the system legible: what exists, how it connects, what is unhealthy,
when that was observed, and which tightly bounded actions are available.

Collectors produce the canonical graph. The canvas, JSON API, and MCP server
are first-class lenses on the same snapshot; none defines a separate truth.

## MVP schema

Every snapshot contains:

- `nodes`: normalized infrastructure entities with stable IDs and display data
- `edges`: directed relationships between nodes
- `signals`: timestamped observations associated with nodes
- `collectors`: collector state, detail, duration, and collection time
- `actions`: non-executable names, kinds, validated targets, and policy for
  server-resolved named actions
- `generatedAt`: when this snapshot was assembled

Executable scripts, interpreters, and arbitrary arguments are never included.
Legacy node-level `actions` and `crons` are intentionally omitted.

## Configuration

The first topology collector reads the local YAML file. The MVP supports HTTP
checks and two fixed, read-only SSH probes: `host.uptime` and
`service.status`. SSH uses the local OpenSSH configuration and non-interactive
authentication, but the remote account should still be restricted to the
minimum commands it needs.

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

actions:
  - id: restart-api
    nodeId: api
    name: Restart API
    kind: service.restart
    service: api.service
    requiresSignal: api-service
    requiresState: err
    requiresApproval: true
    timeoutSeconds: 20
```

Named actions currently support only `service.restart` and `service.reload`.
The server resolves those names to fixed `systemctl` invocations. Service names
are validated, timeouts are mandatory, optional signal preconditions are
checked against a fresh graph, approval can be required, and daemon attempts
are written to the configured audit log. API callers submit only an action ID
and approval decision.

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

There is deliberately no MCP action tool. Agents and humans can inspect the
same topology and signal truth, but action execution remains an explicit human
workflow.

## Optional chat lens

The optional in-app chat panel is a read-only lens, not the product or source of
truth. It supports OpenAI's official chat-completions endpoint and
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

This is a narrow foundation, not autonomous operations. Topology is static and
there is no infrastructure auto-discovery. Desktop checks run when its graph is
requested. The daemon collects immediately and every 30 seconds, keeps a
bounded in-memory observation history, and invalidates its cache after topology
changes. History resets when the daemon restarts. Reticle complements metrics
and tracing systems; it does not replace them.
