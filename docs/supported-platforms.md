# Supported Platforms For v1.2

## Desktop Packages

| Platform | Architecture | Distributed package |
|---|---|---|
| macOS | Apple Silicon (`aarch64`) | `.dmg` |
| macOS | Intel (`x86_64`) | `.dmg` |
| Linux | `x86_64` | `.AppImage`, `.deb`, `.rpm` |
| Windows | `x86_64` | `.msi`, setup `.exe` |

macOS packages are currently unsigned. Linux requires the WebKitGTK/runtime
dependencies appropriate to the selected package. Other operating systems and
architectures are not represented by v1.2 release packages.

## Team Daemon

The documented v1.2 production path is a customer-operated Linux host using
systemd and a Caddy reverse proxy. The licensed artifact and architecture are
specified in the applicable order; do not assume an unlisted Team build is
available. Confirm the target distribution, architecture, libc/runtime needs,
and checksum before deployment.

## Execution Capability

| Capability | Platform condition |
|---|---|
| HTTP checks | Any packaged runtime with network reachability |
| Remote SSH checks/actions | Requires a compatible system `ssh` client and configured non-interactive authentication |
| Local `shell.command` checks/actions | Unix only; requires `bash` |
| Desktop interactive SSH/kubectl shell | Local Desktop operator only; requires the corresponding local tools/configuration |
| Team browser/ad-hoc shell | Not supported on any platform |

## Browsers And Clients

Use a currently maintained browser with WebSocket, session storage, and modern
JavaScript support. TLS termination and proxy compatibility are deployment
responsibilities. JSON and MCP clients should send bearer credentials in the
`Authorization` header rather than query strings.
