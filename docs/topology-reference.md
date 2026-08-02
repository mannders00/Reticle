# Topology File Reference

A Reticle topology is one YAML document. The desktop app edits the opened file
in place, and the daemon reads the file it was started with. Canvas saves update
the visual topology while preserving top-level operational configuration.

For graph snapshots, signal behavior, APIs, MCP, and runtime limits, see the
[Operational graph](operational-graph.md).

```yaml
version: 1

nodes:
  web-01:
    id: web-01
    kind: server
    title: web-01
    subtitle: "nginx · 10.0.1.4"
    x: 120
    y: 80
    w: 220
    h: 120
    parentId: prod-vpc
    spec: { host: 10.0.1.4, port: 22, user: reticle-probe }
    notes: "Public web entry point"
    addons:
      - { kind: ram, label: "64G" }

edges:
  e1:
    id: e1
    kind: tcp
    label: "5432"
    from: web-01
    to: db-primary

collectors:
  - id: web-http
    nodeId: web-01
    name: Web health endpoint
    kind: http
    url: https://web.example.com/healthz
    status: 2xx
    jq: '.status == "ok"'
    timeoutSeconds: 8
  - id: web-uptime
    nodeId: web-01
    name: Web host uptime
    kind: ssh
    probe: host.uptime
    timeoutSeconds: 10
  # WARNING: ssh.command is an arbitrary remote command, not a read-only probe.
  # Team also requires --allow-custom-commands and editor authorization. Restrict
  # the SSH principal or use a remote forced-command policy. The false values
  # below intentionally override the UI defaults of true.
  - id: web-release-check
    nodeId: web-01
    name: Verify deployed release
    kind: ssh
    probe: ssh.command
    command: /usr/local/libexec/reticle-check release
    enabled: false
    publishOutput: false
    timeoutSeconds: 10

actions:
  - id: diagnose-web
    nodeId: web-01
    name: Diagnose nginx
    kind: ssh.command
    command: curl -fsS http://127.0.0.1/health | jq -e '.status == "ok"'
    requiresSignal: web-http
    requiresState: err
    requiresApproval: true
    timeoutSeconds: 20

groups: []
layers: []
```

## Nodes

Nodes are keyed by stable ID. The persisted visual fields are:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable node ID. When present, it should match the map key. |
| `kind` | string | Card or boundary kind. Defaults to `server`. |
| `title` | string | Primary card text. Defaults to the node ID. |
| `subtitle` | string | Secondary card text. |
| `x`, `y` | number | Position in canvas world units. |
| `w`, `h` | number | Size in canvas world units. |
| `parentId` | string or null | Containing group node. Moving a group moves its children. |
| `spec` | object | Structured endpoint or Kubernetes identity metadata. |
| `notes` | string | Free text; a `note` node renders it as the card body. |
| `addons` | list | Visual resource facts shown as chips. |

Health displayed on cards is projected from current graph signals and is not a
persisted visual field.

### Node kinds

| Category | Kinds |
|---|---|
| Compute | `server`, `container`, `vm`, `app` (Application), `host` (group) |
| Data | `database`, `cache`, `queue`, `object-store` |
| Network | `load-balancer`, `switch`, `router`, `firewall`, `vpn`, `bastion`, `dns`, `cdn` |
| Kubernetes | `pod`, `daemonset`, `statefulset`, `deployment`, `cluster`, `knode`, `service`, `ingress`, `gateway` |
| Cloud groups | `vpc`, `region`, `zone`, `subnet`, `security-group` |
| Network groups | `lan`, `wan` |
| Misc | `generic`, `note`, `box` (group) |

Group kinds (`host`, `vpc`, `region`, `zone`, `subnet`, `security-group`,
`lan`, `wan`, and `box`) render as boundaries and contain nodes through
`parentId`.

### `spec`

SSH collectors and guarded named actions resolve their target from the
node's endpoint metadata:

```yaml
spec:
  host: 10.0.1.4
  port: 22                 # optional; defaults to 22
  user: reticle-probe
```

Use a least-privilege account and non-interactive authentication configured
through OpenSSH. Kubernetes identity metadata can remain on visual nodes:

```yaml
spec:
  kubeContext: prod
  namespace: web
  name: web
```

## Collectors

`collectors` is a top-level list. Each collector has a unique `id`, references
an existing `nodeId`, and produces a signal for that node. `name` is optional;
`timeoutSeconds` defaults to 10 and must be between 1 and 120.

### HTTP probe

An HTTP collector performs a fixed GET request. It accepts `url`, an optional
`status` expression, and an optional `jq` predicate over the response body.
An omitted status accepts 2xx responses. Status expressions can be exact
(`200`), a family (`2xx`), a range (`200-204`), or a comma-separated list.

```yaml
- id: api-http
  nodeId: api
  name: API health endpoint
  kind: http
  url: https://api.example.com/healthz
  status: 2xx
  jq: '.status == "ok"'
  timeoutSeconds: 8
```

### SSH probes

An SSH collector uses the referenced node's `spec.host`, `spec.port`, and
`spec.user`. Only two fixed probes are supported:

| Probe | Additional field | Observation |
|---|---|---|
| `host.uptime` | none | Runs the fixed uptime probe. |
| `service.status` | `service` | Checks whether the validated systemd unit is active. |

```yaml
- id: api-service
  nodeId: api
  name: API systemd unit
  kind: ssh
  probe: service.status
  service: api.service
  timeoutSeconds: 10
```

Collector success produces `ok`; failure produces `err`. Nodes without a
collector have no collector-derived health signal.

### Custom command checks (gated)

`ssh.command` and local `shell.command` are persisted custom collectors for cases
the fixed probes cannot cover. New definitions created through the UI/API default
to enabled and publish bounded output to viewers. On Team, the daemon operator
must also pass `--allow-custom-commands`.
Direct YAML writers are trusted operators; enabled definitions written to disk
may execute while that flag is active. Desktop additionally requires
one global privileged-mode toggle for all checks and actions in the active
workspace; there is no per-check acknowledgment. Trust is session-scoped to the
selected workspace. The process-wide
`RETICLE_ALLOW_CUSTOM_COMMANDS=1` override is available for managed environments.
Local Bash checks are available only when Reticle itself runs on a Unix host.

```yaml
# WARNING: This is an arbitrary remote command and is not guaranteed read-only.
# Restrict the SSH principal or enforce an allowed command on the remote host.
- id: api-release-check
  nodeId: api
  name: Verify deployed release
  kind: ssh
  probe: ssh.command
  command: /usr/local/libexec/reticle-check release
  enabled: false
  publishOutput: false
  timeoutSeconds: 10

# WARNING: This runs on the Reticle host with its OS account and environment.
- id: api-json-check
  nodeId: api
  name: Verify API JSON
  kind: local
  probe: shell.command
  command: |
    curl -fsS https://api.internal/healthz |
      jq -e '.status == "ok"'
  enabled: false
  publishOutput: false
  timeoutSeconds: 10
```

| Field | Type | Notes |
|---|---|---|
| `kind` | string | `ssh` executes remotely; `local` executes on the Reticle host. |
| `probe` | string | `ssh.command` for remote login-shell execution; `shell.command` for local Bash. |
| `command` | string | Required arbitrary command, up to 2048 bytes. Persisted in topology but omitted from graph responses and audit logs. |
| `enabled` | boolean | Defaults to `true` in the UI; use `false` to retain a definition without running it. |
| `publishOutput` | boolean | Defaults to `true` in the UI; use `false` to keep stdout/stderr out of published signal detail. |
| `timeoutSeconds` | number | Required bounded timeout from 1 through 120 seconds. |

The daemon validates the persisted definition before execution. `ssh.command`
runs on the node's SSH target without PTY or stdin. `shell.command` runs through
non-interactive Bash on the Reticle host with `pipefail`; this makes a pipeline
such as `curl -fsS URL | jq -e PREDICATE` fail for an HTTP, transport, or JSON
predicate error. One-off requests are not supported. Viewers cannot see command
text, manage definitions, or run custom checks. No custom check is exposed
through the viewer graph API, MCP, or chat. Restricted SSH principals and a
dedicated, least-privileged Reticle OS account are the actual security boundaries.

## Guarded Actions

`actions` is a top-level list of persisted named commands. `ssh.command` runs
through the referenced node's SSH endpoint; `shell.command` runs through
non-interactive Bash on the Reticle host. Team requires
`--allow-custom-commands` before either kind can run.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique action ID submitted by clients. |
| `nodeId` | string | Existing node that owns the action; also supplies the SSH endpoint for `ssh.command`. |
| `name` | string | Human-readable label. |
| `kind` | string | `ssh.command` or `shell.command`. |
| `command` | string | Required persisted command, up to 2048 bytes. Omitted from graph responses and audit logs. |
| `requiresSignal` | string | Optional collector signal precondition. |
| `requiresState` | string | Optional required state: `unknown`, `ok`, `warn`, or `err`. Requires `requiresSignal`. |
| `requiresApproval` | boolean | Defaults to `true`. |
| `timeoutSeconds` | number | Defaults to 20; must be between 1 and 120. |

When configured, signal preconditions are checked against a fresh graph before
the action runs. Team invocation requests contain only the action ID, expected
configuration revision, and approval decision, never command text. Approval
policy and daemon audit behavior are described in
[Operational graph](operational-graph.md).

The timeout bounds how long Reticle waits and collects output. A command that
deliberately detaches from its local process group or remote SSH session may
outlive that wait; production actions should use restricted wrappers, cgroups,
systemd scopes, containers, or equivalent server-side supervision when workload
termination must be guaranteed.

## Edges

Edges are keyed by stable ID and contain `id`, `kind`, optional `label`, and
`from`/`to` node IDs. An optional `port` value may carry additional display
metadata.

Edge kinds: `ethernet`, `tcp`, `udp`, `http`, `https`, `grpc`, `replication`,
`peering`, `tunnel`, `routes-to`, `mgmt`, `fanout`, `depends-on`, `custom`.

Each kind has a fixed visual style shared with the PDF export legend.

## Add-ons

Add-ons are visual facts attached to a node. They do not produce signals or
operations.

```yaml
addons:
  - { kind: gpu, label: "2x A100 80G" }
```

Kinds: `gpu`, `disk`, `ram`, `cpu`, `nic`, `ip`, `cert`, `ups`, `misc`.

`groups` and `layers` may remain at the document root for compatible visual
metadata. Current containment is represented by group-kind nodes and
`parentId`.
