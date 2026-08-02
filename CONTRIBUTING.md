# Contributing

Thanks for your interest in Reticle. Issues and pull requests are
welcome.

Reticle is a human-first live operational graph. The visual UI, JSON API, and
read-only MCP are first-class lenses on the same graph; optional chat remains a
read-only lens rather than a source of truth.

## How this repository works

This repository is a curated mirror of an internal monorepo. The
maintainer syncs it in snapshot commits, which is why the history reads
as `sync:` entries rather than granular commits. Pull requests are
reviewed here, applied upstream with credit, and appear in the next
sync. Practical effect for you: none, beyond slightly unusual history.

## Development setup

Requirements: Rust (stable), [Bun](https://bun.sh), and on Linux the
WebKitGTK dependencies listed in
`.github/workflows/desktop-release.yml`.

```sh
bun install
bun run tauri dev        # desktop app with live frontend
make serve               # frontend only, mock backend, http://localhost:8787
make check               # cargo check for every crate
```

## Repository layout

```
src/          frontend: vanilla ES modules + SVG, no framework, no build step
core/         reticle-core: shared Rust domain modules
src-tauri/    desktop shell (Tauri 2)
web/          the reticle.live site (static)
docs/         user documentation
DAEMON.md     daemon architecture and wire protocol
```

## Ground rules for changes

- The frontend stays framework-free and build-free. Modules communicate
  through the event bus (`src/core/eventBus.js`); panels and canvas
  never import each other directly.
- All backend access goes through `src/core/api.js`. The same UI runs
  under Tauri, under the daemon over WebSocket, and in a mock browser
  mode; changes must keep all three working.
- Desktop remains standalone and local-only. Shared, always-on access, team
  roles, and audit belong to Team Daemon.
- JSON API, MCP, and optional chat must project the canonical graph rather than
  create parallel state. MCP and chat remain read-only.
- Fixed HTTP checks and read-only SSH probes remain the default. UI-created custom
  remote SSH and Unix-only local Bash checks default to enabled and viewer-visible,
  use persisted definitions, validation, and bounded execution. Desktop has one
  global privileged toggle for the active workspace and no per-check acknowledgment;
  Team additionally requires daemon operator `--allow-custom-commands` and editor
  authorization to manage definitions.
- Custom checks are arbitrary commands and are not guaranteed read-only. Remote
  commands run without PTY or stdin; local commands inherit the Reticle process's
  OS permissions and environment. Restricted SSH principals and a dedicated,
  least-privileged Reticle OS account are the actual security boundaries.
- Viewers never see command text, manage definitions, or run custom checks.
  Command text is not audit logged, and custom checks are never viewer graph API,
  MCP, chat, or one-off ad-hoc tools.
- Named actions are persisted secure-shell or local-shell commands. They retain bounded
  execution, approval, preconditions, editor authorization, and command secrecy;
  no invocation request submits command text. Team invocation requests include
  the expected configuration revision.
- The repository root MIT license covers the Desktop, core, and frontend. The
  commercial `daemon/` directory is separately governed by `daemon/LICENSE`.
- Colors and styles are semantic. Node categories and edge kinds map to
  fixed styles that match the PDF export legend.
- Match the surrounding code style and comment density.

## Before you open a PR

1. `make check` passes.
2. The mock app works: `make serve`, then exercise your change at
   http://localhost:8787.
3. For visual changes, include a screenshot.
4. Keep PRs focused; small is fast to review.

## Questions

Open a discussion or issue, or ask in the
[Discord](https://discord.gg/x6hY9GYyph).
