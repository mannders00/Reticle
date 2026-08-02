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
  custom command text, and arbitrary command arguments. HTTP collectors can
  make outbound requests; treat topology authors as trusted and restrict daemon
  egress where needed.
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
- **SSH defaults**: fixed `host.uptime` and `service.status` probes remain the
  default. Named actions are persisted secure-shell or local-shell commands with bounded
  execution, optional preconditions, approval by default, and editor-only
  invocation. Team callers submit only an action ID, expected configuration
  revision, and approval decision.
- **Custom command checks**: Team requires daemon operator
  `--allow-custom-commands`. Definitions managed through the UI/API also require
  editor authorization and default to enabled and viewer-visible. Direct YAML
  writers are trusted operators; an enabled definition written to disk may execute
  while the flag is active. Definitions are validated and bounded before execution.
  Desktop requires explicit, session-scoped trust for the selected workspace;
  one global privileged-mode toggle gates all checks and actions in the active
  workspace, with no per-check risk acknowledgment. `RETICLE_ALLOW_CUSTOM_COMMANDS=1`
  is an optional process-wide override.
  Remote `ssh.command` checks receive no PTY or stdin. Local `shell.command`
  checks are Unix-only and run through non-interactive Bash with the Reticle
  process's OS account, environment, network, and filesystem access. Both are arbitrary commands and
  cannot be guaranteed read-only. Restricted SSH principals and a dedicated,
  least-privileged Reticle OS account are the actual security boundaries.
  Configured timeouts bound Reticle's wait and output collection; detached local
  or remote workloads require OS- or server-side supervision for guaranteed termination.
- **[Team Daemon](https://reticle.live/team/)**: read-only by default. Viewer
  access can read the graph and bounded signal history through JSON and
  read-only MCP but cannot save or execute. Viewers cannot see custom command
  text, manage definitions, or run custom checks. Named actions require the editor
  role and are audit logged when `--audit-log` is configured. Optional chat also
  requires the editor role; its audit entry contains only provider and model,
  never the prompt, response, API key, graph, or history. Configuration-save
  audit records also omit custom-check command text.
  Audit records do include connection peer addresses, stable object IDs, policy
  decisions, revisions, and action error or exit-code outcomes as applicable.
  Authorization tokens are not transport security: browser query links require
  TLS and proxy-log redaction, are scrubbed from the visible URL, and persist
  only for the browser session. API/MCP clients should use bearer headers.
- **Desktop workspace trust**: opening YAML never enables persisted shell
  commands by itself. The owner uses one global privileged-mode control for all
  custom checks and actions in the active workspace, not a per-check
  acknowledgment. Trust lasts for the current app session and can be revoked from the bottom status
  bar, which also closes active operator shells. Alternatively, use the process-wide
  `RETICLE_ALLOW_CUSTOM_COMMANDS=1` override. Privileged mode can also open a
  separately warned interactive SSH/kubectl shell for the local operator. The
  Desktop loopback API/MCP and chat lens never initiate commands or shells.
- **Least privilege**: restrict topology authors, daemon egress, environment
  credentials, filesystem access, the Reticle OS account, and SSH principals.
  Custom checks are never MCP/chat tools or one-off
  ad-hoc requests. The [Team Daemon](https://reticle.live/team/) exposes no
  interactive or ad-hoc shell through the viewer graph API, MCP, or chat.

## Scope notes

- The published tree contains the desktop app, the shared core, and the
  frontend. The daemon binary is distributed separately; its wire
  protocol and access model are documented in [DAEMON.md](DAEMON.md)
  and [docs/daemon.md](docs/daemon.md).
