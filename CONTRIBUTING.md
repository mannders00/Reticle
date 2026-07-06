# Contributing

Thanks for your interest in Reticle. Issues and pull requests are
welcome.

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
