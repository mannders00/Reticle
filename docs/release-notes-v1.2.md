# Reticle v1.2 Release Notes

Reticle v1.2 makes persisted checks and named actions manageable in the visual
UI while preserving explicit execution boundaries. Review the
[migration guide](migration-v1.2.md) before upgrading Team Daemon.

## v1.2.1

- Inspector refreshes now preserve scroll position while the same graph item
  remains selected. Selecting a different item still starts its Inspector at
  the top.
- Product pages now include authentic Team viewer and vector PDF examples and
  remove obsolete imagery that could imply Team provides a browser shell.

There are no configuration, API, or data-format changes from v1.2.0.

## Highlights

- UI-created `ssh.command` and `shell.command` checks now default to
  `enabled: true` and `publishOutput: true`. The warning remains visible, but there is no
  per-check risk-acknowledgment field.
- Desktop has one global privileged-mode toggle in the bottom status bar. It
  gates all custom checks and named actions in the active workspace for the
  current session and closes operator shells when revoked.
- Team requires `--allow-custom-commands` at startup and editor authorization to
  manage custom definitions. Direct YAML writers remain trusted operators.
- Team named-action invocation is revision-bound. Requests carry the action ID,
  expected configuration revision (`baseRev`), and approval decision; stale
  approval is refused.
- Local `shell.command` checks and actions use non-interactive Bash and are
  available only on Unix hosts.
- Team exposes no interactive browser terminal or ad-hoc command endpoint. JSON,
  MCP, and chat remain read-only.
- Team audit logging records connection lifecycle, selected privileged requests
  and refusals, save failures, and named-action outcomes when `--audit-log` is
  configured. Command text, output, shell keystrokes, prompts, credentials, and
  graph data are omitted.

## Compatibility And Limits

- Fixed checks are `host.uptime`, `service.status`, and HTTP status/JSON checks.
- Short-term Team signal observations are bounded in memory and reset on restart.
  They are not durable history or a retention system.
- Shared editor/viewer bearer tokens remain the identity model. SSO, individual
  identities, and per-user audit attribution are not included.
- One Team daemon serves one topology. Multi-topology hosting is not included.
- Custom commands are arbitrary commands. Reticle's validation, output bounds,
  and wait timeout do not replace restricted SSH principals, a least-privileged
  service account, or OS/server-side workload limits.

## Documentation

- [v1.2 migration guide](migration-v1.2.md)
- [Capabilities and limitations](capabilities-and-limitations.md)
- [Supported platforms](supported-platforms.md)
- [Production deployment](production-deployment.md)

Pricing is unchanged: Team is $199/month or $1,999/year per running daemon;
white-glove installation and operational mapping starts at $3,000 one-time.
