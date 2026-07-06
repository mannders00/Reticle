# Topology File Reference

A Reticle map is one YAML document. The desktop app edits the file you
opened, in place; the daemon serves the file it was started with. The
file watcher reloads the canvas when the file changes on disk, so
editing it in a text editor works alongside the app.

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
    parentId: prod-vpc          # optional: containing group node
    spec: { host: 10.0.1.4, port: 22, user: deploy }
    notes: "Immutable AMI. Fix the image, not the box."
    addons:
      - { kind: ram, label: "64G" }
    actions:
      - { name: app logs, script: "journalctl -u app -n 80 --no-pager" }
    crons:
      - { name: app alive, interval: 30s, script: "systemctl is-active app" }
edges:
  e1:
    id: e1
    kind: tcp
    label: "5432"
    from: web-01
    to: db-primary
groups: []
layers: []
```

## Nodes

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Matches the map key. |
| `kind` | string | One of the kinds below. Default `server`. |
| `title`, `subtitle` | string | Card text. |
| `x`, `y`, `w`, `h` | number | Position and size in world units. |
| `parentId` | string or null | A group node id. Moving the group moves its children. |
| `spec` | object | Connection details, see below. |
| `notes` | string | Free text. Note-kind nodes render it as the card body. |
| `addons` | list | Attached resources, see below. |
| `actions` | list | On-demand scripts. |
| `crons` | list | Scheduled checks that drive health. |

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

Group kinds (`host`, `vpc`, `region`, `zone`, `subnet`,
`security-group`, `lan`, `wan`, `box`) render as boundaries and contain
other nodes via `parentId`.

### `spec`

For SSH-capable kinds:

```yaml
spec:
  host: 10.0.1.4        # TCP health probes this host:port
  port: 22
  user: deploy
  interpreter: bash      # optional, see Interpreters
  local: true            # optional: node default execution is local
```

For Kubernetes kinds:

```yaml
spec:
  kubeContext: prod      # optional, defaults to current context
  namespace: web         # optional
  name: web-abc123       # pod or object name
```

Kinds with nothing to connect to (dns, cdn, managed cloud services) can
omit `spec` entirely. Their actions and checks then run locally, which
is usually what you want: `dig`, `curl`, `aws`, `gcloud`.

## Actions and checks

Both lists share one shape. Checks add `interval` and run on a
schedule; their results drive node health.

```yaml
actions:
  - { name: disk, script: "df -h /" }                          # node default
  - { name: whoami here, exec: local, script: "whoami" }       # force local
crons:
  - { name: app alive, interval: 30s, script: "systemctl is-active app" }
  - { name: edge up, interval: 60s, exec: http,
      url: "https://app.example.com/healthz", status: "2xx", jq: '.db == "up"' }
```

### Execution resolution

Each item resolves to one of three executors:

1. `exec: ssh | local | http` on the item always wins.
2. An item with a `url` is treated as `http`.
3. Otherwise the node decides: `spec.local: true` runs locally, a
   `spec.host` runs over SSH, and no host at all runs locally.

`ssh` uses the system `ssh` in batch mode with your keys. `local` runs
on the machine that executes checks: your desktop, or the daemon host
in team mode. `http` uses the system `curl`.

### HTTP checks

| Field | Meaning |
|---|---|
| `url` | Required. The endpoint to request. |
| `status` | Accepted status codes: empty (2xx and 3xx pass), `200`, `2xx`, `200-204`, or a comma list like `200,204`. |
| `jq` | Optional `jq` expression evaluated against the body with `jq -e`; truthy passes. |

### Intervals

`30s`, `5m`, `1h`, or a bare number of seconds.

### Interpreters

`spec.interpreter` selects how scripts are fed to the target:
`bash` (default), `sh`, `zsh`, `powershell`, `pwsh`, `cmd`, `python3`,
`node`, or any command that reads a script with `-s`.

### Incomplete items

A check with an empty `script` (or an http check with an empty `url`)
is considered still being written. The scheduler skips it and it never
affects health.

## Health

Node health is worst-wins across two signals:

1. The TCP probe against `spec.host:port`, when present.
2. The latest result of each scheduled check.

Any failing check turns the node red and names the failing check on the
card. Removing or renaming a failing check clears its effect
immediately.

## Edges

| Field | Notes |
|---|---|
| `kind` | Visual and semantic style, one of the kinds below. |
| `label` | Optional text shown at the midpoint. |
| `from`, `to` | Node ids. |

Edge kinds: `ethernet`, `tcp`, `udp`, `http`, `https`, `grpc`,
`replication`, `peering`, `tunnel`, `routes-to`, `mgmt`, `fanout`,
`depends-on`, `custom`.

Colors are not configurable by design. Each kind has a fixed style, the
same style appears in the PDF export legend, so color always means
something.

## Add-ons

Facts attached to a node, shown as chips on the card and in the PDF.
They have no execution or health behavior.

```yaml
addons:
  - { kind: gpu, label: "2x A100 80G" }
```

Kinds: `gpu`, `disk`, `ram`, `cpu`, `nic`, `ip`, `cert`, `ups`, `misc`.
