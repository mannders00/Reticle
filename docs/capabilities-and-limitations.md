# Reticle v1.2 Capabilities And Limitations

This sheet describes shipped v1.2 behavior. It is not a roadmap or service-level
commitment.

| Area | Current capability | Current limitation |
|---|---|---|
| Topology | Static YAML nodes, edges, notes, groups, and operational definitions | No infrastructure auto-discovery |
| Collection | HTTP status/JSON, `host.uptime`, `service.status`, and gated custom commands | Not a metrics, logs, or tracing store |
| Custom checks | Persisted remote SSH and Unix-only local Bash; UI defaults enabled and viewer-visible | Arbitrary commands; not guaranteed read-only |
| Desktop gate | One global privileged toggle for every custom check/action in the active workspace | Session-scoped; no centralized team policy |
| Team gate | Startup `--allow-custom-commands` plus editor management | Direct YAML writers are trusted operators |
| Actions | Persisted names, timeout, approval by default, optional fresh-signal precondition | No autonomous remediation loop |
| Action request | Team sends action ID, expected config revision, and approval decision | No caller-provided command text or arguments |
| Team shell | None | No browser terminal or ad-hoc command endpoint |
| API and MCP | Canonical graph through JSON and read-only MCP | No MCP action or mutation tools |
| Chat | Optional editor-only, read-only graph lens | Not a source of truth; no save, shell, or action tools |
| Identity | Shared Team viewer/editor bearer tokens | No SSO, individual identity, or per-user attribution |
| Audit | Optional JSONL for connection lifecycle, selected privileged requests/refusals, save failures, and action outcomes | Not enabled by default; customer manages access, rotation, retention, and monitoring |
| Observations | Bounded Team in-memory ring for short-term inspection | Resets on restart; not durable history |
| Scope | One topology per licensed Team daemon | No multi-topology tenancy in one daemon |
| Availability | Customer-operated single daemon process | No built-in clustering or high availability |
| Secrets | Uses host environment and OpenSSH configuration; chat keys are request-scoped | Topology must not contain secrets; Reticle is not a secrets manager |
| Execution limits | Definition validation, 1-120 second wait timeout, bounded captured output | Detached workloads may outlive Reticle's wait; enforce OS/server-side limits |
| Exports | Visual PDF export | Not an audit archive or durable incident record |

## Security Boundary

The real execution boundary is the daemon/Desktop OS identity, its environment,
filesystem and network access, and the remote SSH principal. Use restricted
wrappers or forced commands where practical. Viewer visibility of a custom
check's bounded result does not grant visibility of command text or permission to
run the check on demand.

See [Security Policy](../SECURITY.md), [Supported platforms](supported-platforms.md),
and [Production deployment](production-deployment.md).
