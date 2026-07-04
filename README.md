# Reticle

**An infrastructure diagram you can operate.** Reticle is an infinite-canvas
editor for network & infra topology — servers, VMs, pods, databases, load
balancers, VPCs — where the diagram is also the operational surface: open a
real SSH shell from a node, run scripts on it, watch health glow on the
canvas, and export the whole thing as a print-quality vector PDF. Everything
persists to one human-editable, git-diffable YAML file. No accounts, no
cloud, no lock-in.

Two shells, one UI:

- **Desktop** (`src-tauri/`, Tauri) — local-first app; SSH/kubectl run as
  you, with your own keys and kubeconfig.
- **Daemon** (`daemon/`, ~3 MB single static binary, UI embedded) — serve
  the same canvas over HTTP to your whole team; credentials stay on the
  daemon host; token-based editor/viewer roles. See [DAEMON.md](DAEMON.md).

Product site: **https://reticle.live** — the desktop app is free and MIT;
the team daemon is the commercial product for orgs (per-daemon licensing,
unlimited editors & viewers).

---

## The map is alive — actions & crons

The core idea: a topology diagram shouldn't just *describe* your systems, it
should *watch* them and let you *act* on them. Every node carries two lists,
edited right in the inspector and stored in the same YAML as the diagram:

### Actions — run on demand

Named bash snippets executed over SSH when you press ▶. Output (exit code,
stdout/stderr) renders inline under the action. Think `df -h`,
`journalctl -u nginx -n 50`, `systemctl restart myapp` — your predefined
runbook, one click away, right on the node it belongs to.

### Crons — scheduled, they drive health

Scripts that run automatically on an interval (`30s` / `5m` / `1h`):

- **Desktop**: the scheduler runs while the app is open.
- **Daemon**: the scheduler runs **as long as the daemon runs** — 24/7,
  headless, with nobody watching. Results stream live to every connected
  browser the moment they open the page.

Cron results feed node health directly, combined with a cheap TCP
reachability probe (worst wins):

```
health(node) = err      if TCP probe fails OR any cron is failing
               ok       if the signals we have are green
               unknown  if there's no signal at all
```

So `systemctl is-active nginx` failing turns the node **red on the canvas**
even though port 22 still answers — and the inspector shows which cron
failed, its exit code, and when. When it recovers, the node goes green
again. Nobody has to be looking at a dashboard; the map itself is the
dashboard.

### It's all just YAML

```yaml
nodes:
  web-01:
    kind: server
    title: web-01
    spec: { host: 10.0.1.4, port: 22, user: deploy }
    actions:
      - { name: disk usage,  script: df -h }
      - { name: recent logs, script: journalctl -u nginx -n 50 }
    crons:
      - { name: nginx alive, interval: 30s, script: systemctl is-active nginx }
      - { name: disk watch,  interval: 5m,  script: "[ $(df / --output=pcent | tail -1 | tr -d ' %') -lt 90 ]" }
```

Edit it in the inspector or in vim — the file watcher live-updates the
canvas either way (and every connected browser, in daemon mode).

---

## Quick start

```sh
make desktop-dev     # desktop app, live frontend
make daemon          # single-binary daemon (UI embedded) → target/release/
make daemon-all      # cross-compile linux arm64/armv7/x64 + macOS → dist/
make deploy-pi PI=pi@host   # ship the arm64 binary to a Raspberry Pi
make serve           # static demo (no backend, mock data)
```

Daemon on a LAN box:

```sh
./reticle-daemon --config /etc/reticle/prod.yaml \
  --edit-token $(openssl rand -hex 16) \
  --view-token $(openssl rand -hex 16) \
  --enable-terminal
# editors: http://host:8788/?token=<edit-token>   (change, run, shell)
# viewers: http://host:8788/?token=<view-token>   (watch the live map)
```

## Repo layout

```
src/          the frontend (vanilla ESM + SVG, no framework, no build step)
core/         reticle-core — shared Rust domain modules (config, ssh,
              health, cron scheduler, pty terminal, file watcher)
src-tauri/    desktop shell (Tauri 2)
web/          the reticle.live marketing site (static)
DAEMON.md     team-daemon design: sharing model, roles, protocol, phases
              (the daemon binary itself is the commercial component)
```

---

## License

Everything in this repository is **MIT-licensed** (see [LICENSE](LICENSE)).

The **team daemon** (shared always-on server with token roles, daemon-side
health, audit log) is a separate commercial component distributed as a
binary — it is not in this repository. Get it at https://reticle.live.
