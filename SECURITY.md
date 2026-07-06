# Security Policy

## Reporting

Report vulnerabilities privately to **matt@masoftware.net**. You will
get a reply within a few days. Please do not open public issues for
security reports.

## Model in brief

- **Desktop app**: runs entirely on your machine. SSH and kubectl
  execute as your user with your existing keys and kubeconfig. Reticle
  stores no credentials, sends no telemetry, and talks to nothing but
  the hosts you configure.
- **Topology file**: plain YAML that you own. It should contain
  hostnames, ports, and usernames, never secrets. Nothing in Reticle
  requires a secret to be written to it.
- **Team daemon**: read-only by default. Editor and viewer roles are
  enforced server-side; a viewer connection cannot write or execute
  regardless of client behavior. Interactive terminals require both the
  editor role and an explicit `--enable-terminal` flag. Authorization
  tokens are not transport security: run the daemon behind TLS.

## Scope notes

- The published tree contains the desktop app, the shared core, and the
  frontend. The daemon binary is distributed separately; its wire
  protocol and access model are documented in [DAEMON.md](DAEMON.md)
  and [docs/daemon.md](docs/daemon.md).
