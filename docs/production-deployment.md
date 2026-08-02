# Team Daemon Production Deployment

This runbook is a conservative Linux/systemd/Caddy baseline for one Team daemon
and one topology. Adapt paths and hardening to organizational policy. Team is
proprietary software and requires an active license. Never use `--open` in
production.

## 1. Verify The Release

Obtain the platform archive and `SHA256SUMS` through the licensed distribution
channel. Verify the archive before extraction; do not proceed if no trusted
checksum is available. For example, on Linux x86_64:

```sh
grep '  reticle-daemon-linux-x64.tar.gz$' SHA256SUMS | sha256sum -c -
tar xzf reticle-daemon-linux-x64.tar.gz
```

On macOS administrative workstations, use `shasum -a 256 FILE`. Compare the full
archive digest out of band with the value in `SHA256SUMS`.

## 2. Create A Dedicated Identity And Paths

The archive includes an installer that creates a non-login identity, installs the
binary and unit, and initializes protected configuration paths. Run it from the
extracted archive directory:

```sh
sudo ./install.sh
```

Place the topology at `/var/lib/reticle/topology.yaml`, owned by `reticle:reticle`
and mode `0640`. Treat write access as privileged because enabled custom commands
written directly to YAML can execute while daemon policy permits them.

## 3. Create And Protect Tokens

Generate distinct high-entropy view and edit tokens and store them only in the
service environment file and approved secret system.

```sh
openssl rand -hex 32
openssl rand -hex 32
sudo install -o root -g reticle -m 0640 /dev/null /etc/reticle/reticle.env
```

Set these lines in `/etc/reticle/reticle.env` without shell quotes:

```text
RETICLE_VIEW_TOKEN=<independent-view-token>
RETICLE_EDIT_TOKEN=<independent-edit-token>
```

Do not put tokens in the unit command line. Browser query-token links can enter
proxy logs; prefer header-bearing API/MCP clients and redact query strings.

## 4. Install The systemd Unit

The packaged unit omits `--allow-custom-commands`. Add it to both `ExecStartPre`
and `ExecStart` only when the reviewed topology needs custom checks or named
actions. Local commands require Unix and Bash.

```ini
[Unit]
Description=Reticle Team Daemon
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=reticle
Group=reticle
EnvironmentFile=/etc/reticle/reticle.env
Environment=HOME=/var/lib/reticle
StateDirectory=reticle
LogsDirectory=reticle
ConfigurationDirectory=reticle
ExecStartPre=/usr/local/bin/reticle-daemon --config /var/lib/reticle/topology.yaml --check-config
ExecStart=/usr/local/bin/reticle-daemon --bind 127.0.0.1 --port 8790 --config /var/lib/reticle/topology.yaml --audit-log /var/log/reticle/audit.jsonl
Restart=on-failure
RestartSec=5s
TimeoutStopSec=20
KillMode=control-group
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/var/lib/reticle /var/log/reticle
UMask=0027

[Install]
WantedBy=multi-user.target
```

The installer saves this as `/etc/systemd/system/reticle-daemon.service`. After
setting tokens and reviewing the topology, run:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now reticle-daemon.service
sudo systemctl status reticle-daemon.service
```

Further sandboxing is encouraged but must be tested against required SSH config,
known-hosts, binaries, network destinations, and local command wrappers.

## 5. Terminate TLS With Caddy

Keep the daemon loopback-only. Caddy handles WebSocket proxying automatically.

```caddyfile
map.example.com {
    reverse_proxy 127.0.0.1:8790
}
```

Validate and reload Caddy using the package's normal service procedure. Restrict
network access further with firewall, VPN, or identity-aware proxy controls as
required. This minimal site does not enable Caddy access logging. If access logs
are required, configure and test query-string redaction before allowing browser
query-token links. Reticle's shared bearer tokens do not provide transport
encryption.

## 6. Validate Access And Boundaries

```sh
curl --fail --header "Authorization: Bearer $RETICLE_VIEW_TOKEN" \
  https://map.example.com/api/graph
```

Confirm viewer and editor links separately. Verify that viewers cannot save,
refresh, chat, manage definitions, or invoke actions. Verify stale saves and stale
action revisions are refused. Confirm Team presents no browser terminal or ad-hoc
command path. Test each custom command under the `reticle` identity and restricted
SSH principal before production use.

## 7. Rotate Tokens

There is no live token-reload operation. Rotation requires replacing the secret
and restarting the daemon, which interrupts active connections.

1. Generate a new token and distribute it through the approved secret channel.
2. Replace only the corresponding value in `/etc/reticle/reticle.env`.
3. Run `sudo systemctl restart reticle-daemon.service`.
4. Verify the new token and verify that the old token is denied.
5. Revoke browser sessions and integrations using the old token as applicable.

Rotate immediately after suspected disclosure or personnel/access changes.

## 8. Rotate And Review Audit JSONL

Audit logging is opt-in and the daemon keeps the file open. After logrotate moves
the file, send SIGHUP so the daemon reopens the configured path without restarting.

```text
/var/log/reticle/audit.jsonl {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0600 reticle reticle
    su reticle reticle
    postrotate
        /bin/systemctl kill -s HUP reticle-daemon.service >/dev/null 2>&1 || true
    endscript
}
```

Audit records can include peer addresses, stable IDs, revisions, role and policy
decisions, provider/model names, and action errors. Protect them as
operational data. Reticle does not ship retention enforcement, forwarding, or
alerting; test forwarding to the organization's logging system separately.

## 9. Backup And Restore

Back up:

- `/var/lib/reticle/topology.yaml` and any approved adjacent configuration;
- `/etc/reticle/reticle.env` through the secret backup system, separately from
  general filesystem backups;
- the systemd unit and Caddy configuration;
- retained audit JSONL according to policy;
- the installed binary and trusted checksum needed for rollback.

Do not back up the in-memory observation ring; it is transient.

Restore into protected paths with the ownership and modes above. Restore tokens
through the secret system, verify the binary checksum, start the daemon, and test
viewer/editor boundaries before reopening network access. A restore does not
recreate transient observations.

## 10. Upgrade

1. Read release notes and migration guidance.
2. Back up topology, unit/proxy configuration, tokens, audit records, old binary,
   and checksum.
3. Verify the new binary checksum.
4. Preserve the prior binary under a versioned backup filename.
5. Stop the service, install the new binary at `/usr/local/bin/reticle-daemon`,
   and start the service.
6. Verify version, graph collection, roles, stale-revision behavior, actions, and
   audit writes.
7. Keep the prior binary until the rollback window closes.

## 11. Roll Back

Stop the service, restore the prior topology if the new version changed its
format, reinstall the checksum-verified prior binary at
`/usr/local/bin/reticle-daemon`, and start the service. Verify access and
collection. In-memory observations are lost across the restart. Record the
rollback and preserve relevant audit/system logs.

## 12. Uninstall

1. Export any required topology and audit records.
2. Run `sudo systemctl disable --now reticle-daemon.service`.
3. Remove `/etc/systemd/system/reticle-daemon.service` and run
   `sudo systemctl daemon-reload`.
4. Remove the Caddy site and reload Caddy.
5. Remove `/usr/local/bin/reticle-daemon` after preserving licensed artifacts
   required by policy.
6. Remove `/etc/reticle`, `/var/lib/reticle`, and `/var/log/reticle` only after
   backup/retention approval.
7. Revoke tokens, remove firewall/DNS entries, and delete the `reticle` user when
   no owned files or processes remain.

Uninstallation does not remove copies held in backups, logs, browser session
storage, or downstream systems; expire those under their own policies.
