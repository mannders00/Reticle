# Security Policy

## Reporting

Report vulnerabilities privately to **matt@masoftware.net**. You will
get a reply within a few days. Please do not open public issues for
security reports.

## Model in brief

- **Desktop app**: free, standalone, and local-only, with no shared daemon. It
  sends no telemetry. HTTP collectors and SSH transport can reach configured
  endpoints; optional OpenAI keys are request-scoped and sent to OpenAI.
- **Topology file**: plain YAML that you own. It should contain
  hostnames, ports, and usernames, never secrets. Nothing in Reticle
  requires a secret to be written to it.
- **Operational graph**: graph responses omit legacy scripts, interpreters,
  and arbitrary command arguments. HTTP collectors can make outbound requests;
  treat topology authors as trusted and restrict daemon egress where needed.
- **Desktop loopback API**: disabled unless `RETICLE_DESKTOP_HTTP_PORT` is set
  and always bound to `127.0.0.1`. It has no write or action routes, emits no
  CORS permission, limits request bodies, and bounds concurrent collection.
  Loopback is not authentication: other processes running as the local user can
  read the graph and trigger configured probes while it is enabled.
- **Optional chat lens**: OpenAI keys and Ollama endpoints are request-scoped and
  are never persisted or logged. OpenAI receives the question and any graph
  data returned through read-only tools at its fixed official API endpoint.
  Ollama endpoints must be HTTP(S) loopback addresses, with redirects disabled.
  The agent has no action, shell, save, or MCP mutation tool.
- **SSH**: collectors use only fixed `host.uptime` and `service.status`
  probes. Named actions resolve server-side to `service.restart` or
  `service.reload`, validate service names, enforce timeouts and optional
  preconditions/approval, and never accept shell text from a caller. Use a
  restricted SSH principal or forced-command policy as defense in depth.
- **[Team Daemon](https://reticle.live/team/)**: read-only by default. Viewer
  access can read the graph and bounded signal history through JSON and
  read-only MCP but cannot save or execute. Named actions require the editor
  role and are audit logged when `--audit-log` is configured. Optional chat also
  requires the editor role; its audit entry contains only provider and model,
  never the prompt, response, API key, graph, or history.
  Authorization tokens are not transport security: query tokens require TLS.
- **Least privilege**: restrict topology authors, daemon egress, filesystem
  access, and SSH principals. Only fixed probes and server-owned named actions
  are supported. The [Team Daemon](https://reticle.live/team/), JSON API, MCP,
  and chat never provide arbitrary shell access.

## Scope notes

- The published tree contains the desktop app, the shared core, and the
  frontend. The daemon binary is distributed separately; its wire
  protocol and access model are documented in [DAEMON.md](DAEMON.md)
  and [docs/daemon.md](docs/daemon.md).
