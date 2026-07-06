# Getting Started

Reticle is an infinite-canvas diagram of your real infrastructure. Nodes
carry health checks, runbook actions, and live SSH terminals, and the
whole map persists to a single YAML file you can keep in git.

## Install

Download the latest release for your platform from
[Releases](https://github.com/mannders00/reticle/releases/latest):

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Reticle_x.y.z_aarch64.dmg` |
| macOS (Intel) | `Reticle_x.y.z_x64.dmg` |
| Linux (x86_64) | `.AppImage`, `.deb`, or `.rpm` |
| Windows (x86_64) | `.msi` or `-setup.exe` |

Notes:

- macOS builds are currently unsigned. The first time, right-click the
  app and choose Open, or run
  `xattr -dr com.apple.quarantine /Applications/Reticle.app`.
- On Windows, interactive SSH terminals are not supported yet. Actions,
  checks, health, and PDF export all work.

### Build from source

Requires Rust (stable) and [Bun](https://bun.sh):

```sh
git clone https://github.com/mannders00/reticle
cd reticle
bun install
bun run tauri dev     # development
bun run tauri build   # release bundle
```

## First map

1. Open Reticle. The workspace switcher (top left) lists bundled
   samples, from a small homelab to a full AWS deployment. Opening a
   sample saves a copy wherever you choose, then edits that copy.
2. Or start empty: choose "New workspace", pick a location for the
   YAML file, and drag your first node in from the palette.
3. Give a node a real address: select it, open the Inspector, set
   `host`, `port`, and `user`. Health turns green when the TCP port
   answers.
4. Press <kbd>Cmd/Ctrl</kbd>+<kbd>Enter</kbd> with the node selected.
   If your terminal can `ssh user@host`, so can Reticle: it uses your
   own SSH configuration and keys, nothing else.

## Where things live

- Your map is one YAML file, wherever you chose to put it. Reticle
  edits it in place, so it can live inside a git repository. Edit it in
  your editor and the canvas reloads live.
- Credentials are never stored. SSH and kubectl run as your user with
  your existing keys and kubeconfig.

## Next steps

- [Topology file reference](topology-reference.md) covers every field.
- [Keyboard shortcuts](shortcuts.md).
- [The team daemon](daemon.md) serves the same map to your whole team.

Stuck on something? Ask in the [Discord](https://discord.gg/x6hY9GYyph); it is small and friendly.
