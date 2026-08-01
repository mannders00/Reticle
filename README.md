<div align="center">

<img src="assets/icon/reticle-256.png" width="90" alt="Reticle" />

# Reticle

**The live operational graph your whole team can see.**

Reticle turns topology and fixed health checks into one human-first map of
production. The visual UI, JSON API, and read-only MCP are first-class lenses on
the same graph, so people and tools work from the same truth.

The free Desktop is standalone and local-only for individuals and homelabs. The
paid Team Daemon provides the shared, always-on graph described above.

Desktop requires no Reticle account or hosted service. No lock-in.

[**↓ Download free Desktop**](https://github.com/mannders00/reticle/releases/latest) · [**Live demo**](https://demo.reticle.live) · [**Discord**](https://discord.gg/x6hY9GYyph) · [**Team Daemon →**](https://reticle.live/team/)

MIT-licensed desktop app · macOS / Linux / Windows

<br/>

<img src="assets/demo-overview.png" alt="A live infrastructure map in Reticle: real health, real topology" width="100%" />

<br/><br/>

[<img src="web/assets/reticle-demo-poster.jpg" alt="Two-minute demo: draw the map, attach real hosts, watch live health, and export the PDF" width="100%" />](web/assets/reticle-demo.mp4)

**[▶ Watch the two-minute demo](web/assets/reticle-demo.mp4)** — draw the map → attach real hosts → checks go live → export the PDF

</div>

---

## One truth during an incident

Every box is connected to current evidence. When something goes red, operators
and tools can inspect the same topology and health truth instead of reconciling
a stale diagram, a dashboard, and terminal folklore.

- **Canonical graph**: normalized nodes, edges, signals, collectors, and named
  action descriptors, assembled in the shared Rust core
- **Narrow collectors**: static YAML topology, HTTP status/JSON assertions,
  and fixed read-only SSH probes for uptime or systemd service state
- **Guarded actions**: only named `service.restart` and `service.reload`
  actions, with validated targets, timeouts, preconditions, optional approval,
  and daemon audit logging. No caller-provided shell
- **Shared consumers**: the UI, `GET /api/graph`, and read-only MCP tools read
  the same snapshot
- **Local-only Desktop**: commit topology beside infrastructure code and review
  it in pull requests. Credentials stay in your existing SSH configuration

## Reduce the cost of ambiguity

The expensive part of incident response is rarely typing the command. It is
understanding what is happening, recovering the relevant change context, and
deciding what is safe. Reticle is designed to help teams improve:

- **Time to understand an incident**: orient around topology, dependencies,
  current evidence, and freshness instead of reconstructing the system aloud.
- **Time to safe next action**: connect evidence to bounded, preconfigured
  responses with explicit preconditions and approval.
- **Failed-deployment recovery time**: keep the affected service, dependencies,
  signals, and available response in one operating context.
- **Change-context latency**: make the reason and surrounding system state easier
  to recover when the original author is not present.
- **Operational handoff time**: give the next shift or escalation path the same
  live graph instead of a partial verbal summary.
- **Operational memory**: preserve context in topology, bounded history, audit
  records, and exported incident snapshots.

These are outcomes Reticle helps move by reducing incident ambiguity; they are
not fixed ROI promises.

| | Free Desktop | [Team Daemon](https://reticle.live/team/) |
|---|---|---|
| Best for | Individuals and homelabs | Teams sharing one operational view |
| Runtime | Standalone, local-only | Shared, always-on daemon with browser access |
| API and MCP | Loopback JSON API and read-only MCP | Authenticated JSON API and read-only MCP |
| History and audit | No retained history or audit log | Bounded in-memory history; configured JSONL audit log |
| Price | Free and MIT licensed | $199/month or $1,999/year per daemon |

## Hand the map to anyone

Export the whole canvas as a **vector PDF**: kind icons, health states,
edge styles, legend, wrapped notes. Attach it to the postmortem, drop it
in the customer deck, print it:

<div align="center">
<a href="assets/demo-pdf.pdf"><img src="assets/demo-pdf-preview.png" alt="Print-quality vector PDF export" width="88%" /></a>

<sub>That's a real export. <a href="assets/demo-pdf.pdf">Open the PDF</a>.</sub>
</div>

## Get it

**[Download the latest release](https://github.com/mannders00/reticle/releases/latest)**: .dmg (macOS, Apple Silicon + Intel), .AppImage/.deb/.rpm (Linux), .msi/.exe (Windows).

> macOS builds are unsigned for now: right-click → Open the first time.
> Named actions require a configured SSH target. Checks, graph inspection,
> and PDF export work without enabling an action.

Or build from source (Rust + [Bun](https://bun.sh)):

```sh
git clone https://github.com/mannders00/reticle
cd reticle
bun install
bun run tauri build   # or: bun run tauri dev
```

Try it with a sample: the app ships six visual topology templates (homelab to
enterprise) in the workspace switcher. The Reticle deployment sample includes
live public HTTP collectors; adapt the others to your own endpoints, or start from
[`topology.yaml.example`](topology.yaml.example).

## Query your desktop graph locally

The OSS desktop includes an opt-in, loopback-only JSON API and read-only MCP
server. It is disabled by default and never binds beyond `127.0.0.1`:

```sh
make desktop-api-dev
curl http://127.0.0.1:8786/api/graph
```

MCP is available at `POST http://127.0.0.1:8786/mcp` with
`reticle_get_graph` and `reticle_get_node`. There are no local or daemon MCP
action tools. Set `RETICLE_DESKTOP_HTTP_PORT` to choose another port.

## Share it live with your whole team

The desktop app is yours, free, forever. When the *team* needs the map,
there's the **[Reticle Team Daemon](https://reticle.live/team/)**, a single
binary that serves this exact app to every browser on your network:

- Nothing to install for teammates, just a browser and a link
- Always-on collection from one shared network vantage point
- Bounded signal history through JSON and read-only MCP
- **Read-only by default**: strict editor/viewer tokens, enforced server-side
- Credentials stay on one host; nobody distributes SSH keys
- Configured JSONL audit logging for named-action attempts
- Optional editor-authorized, read-only chat lens with request-scoped credentials

The live demo at **[demo.reticle.live](https://demo.reticle.live)** is the
daemon serving its own real infrastructure, read-only. Go poke it.

The [Team Daemon](https://reticle.live/team/) is **$199/month or $1,999/year
per daemon**. White-glove installation and operational mapping starts at
**$3,000 one-time**.

## Optional chat lens

The optional chat panel can use OpenAI or a loopback Ollama instance to answer
questions from the current graph. It is a read-only lens, not the product or a
source of truth. It receives only graph/node tools (plus bounded signal history
on the daemon) and cannot save topology, open a shell, or run a named action.
OpenAI keys are request-scoped, sent to the daemon when applicable and then to
OpenAI's official API, and are never persisted or logged. Ollama endpoints are
restricted to `localhost` or literal loopback IPs.

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | Install, first map, where things live |
| [Topology reference](docs/topology-reference.md) | Every field of the YAML: kinds, specs, checks, health, edges, add-ons |
| [Operational graph](docs/operational-graph.md) | Canonical schema, collectors, named actions, JSON API, and MCP |
| [Keyboard shortcuts](docs/shortcuts.md) | Canvas, editing, and operating keys |
| [The Team Daemon](https://reticle.live/team/) | Pricing, licensing, and team deployment |
| [Daemon operations](docs/daemon.md) | Flags, access model, audit log, deployment |
| [DAEMON.md](DAEMON.md) | Full architecture and wire protocol |
| [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) · [Discord](https://discord.gg/x6hY9GYyph) | |

## Repo layout

```
src/          the frontend (vanilla ESM + SVG, no framework, no build step)
core/         reticle-core: shared graph, collectors, named actions, config
src-tauri/    desktop shell and opt-in loopback read API (Tauri 2)
web/          the reticle.live site (static)
DAEMON.md     team-daemon design: sharing model, roles, wire protocol
```

## License

Everything in this repository is **[MIT](LICENSE)**. The
[Team Daemon](https://reticle.live/team/) is a separate commercial binary.
