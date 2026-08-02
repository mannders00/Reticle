# Getting Started

Reticle is a human-first live operational graph with a visual canvas. Static
topology and guarded collectors produce one graph consumed by the UI, JSON API,
and read-only MCP server as first-class lenses. The source remains a YAML file
you can keep in git.

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
- SSH actions require a configured SSH target. Graph inspection and PDF
  export remain useful without actions.
- Desktop is free, standalone, and local-only for individuals and homelabs. It
  does not include a shared daemon.

### Build from source

Requires Rust (stable) and [Bun](https://bun.sh):

```sh
git clone https://github.com/mannders00/reticle
cd reticle
bun install
bun run tauri dev     # development
bun run tauri build   # release bundle
```

To expose your desktop graph to local tools and agents during development, use
`make desktop-api-dev`. This opts into the loopback-only JSON and read-only MCP
server at `127.0.0.1:8786`; normal desktop startup leaves it disabled.

## First map

1. Open Reticle. The workspace switcher (top left) lists bundled
   samples, from a small homelab to a full AWS deployment. Opening a
   sample saves a copy wherever you choose, then edits that copy.
2. Or start empty: choose "New workspace", pick a location for the
   YAML file, and drag your first node in from the palette.
3. Give a node a real address: select it, open the Inspector, and set its
   `host`, `port`, and restricted probe `user`.
4. Add an HTTP or fixed SSH collector using the example in
   [Operational graph](operational-graph.md). The resulting signal colors the
   node from the same snapshot exposed to API and MCP consumers.
5. If fixed probes cannot express the diagnostic you need, choose **Enable
   privileged mode** in the bottom status bar. This is Desktop's one global
   privileged control: it gates every custom check and action in the active
   workspace, with no per-check acknowledgment. Trust lasts for the current
   Desktop session. Turn it off in the same place to revoke trust and close active
   shells. While on, you can add bounded remote/local shell checks, guarded named
   actions, or open a separately warned live operator shell.

## Where things live

- Your map is one YAML file, wherever you chose to put it. Reticle
  edits it in place, so it can live inside a git repository. Edit it in
  your editor and the canvas reloads live.
- Credentials are never stored. SSH probes and named actions use your existing
  OpenSSH configuration. Use a restricted remote account.
- Desktop privileged mode is session-scoped to the selected workspace. Opening
  YAML alone never executes its commands. The optional
  `RETICLE_ALLOW_CUSTOM_COMMANDS=1` override trusts every workspace in that process.
- Team custom remote SSH or local Bash checks require daemon `--allow-custom-commands` and editor
  authorization. They are arbitrary remote commands, not guaranteed read-only;
  new definitions default to enabled and viewer-visible, and should use a
  restricted SSH principal or forced-command policy.
- Local Bash checks and actions are available only on Unix hosts with Bash.

## Next steps

- [Topology file reference](topology-reference.md) covers every field.
- [Operational graph](operational-graph.md) covers collectors, signals,
  guarded actions, JSON, and MCP.
- [Keyboard shortcuts](shortcuts.md).
- The [Team Daemon](https://reticle.live/team/) serves the same graph to a team
  for $199/month or $1,999/year per daemon. White-glove installation and
  operational mapping starts at $3,000 one-time; see the
  [operations guide](daemon.md).

Stuck on something? Ask in the [Discord](https://discord.gg/x6hY9GYyph); it is small and friendly.
