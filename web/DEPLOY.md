# Deploying the Reticle website

The marketing site is fully static. Deploy the complete `web/` directory so
the `/team/` subroute, shared assets, and relative links remain intact:

```sh
rsync -av --delete web/ ec2:/var/www/reticle-site/
```

Serve the directory with clean index-file resolution. Caddy's `file_server`
serves both `/` from `index.html` and `/team/` from `team/index.html`:

```caddyfile
reticle.example.com {
    root * /var/www/reticle-site
    encode gzip
    file_server
}
```

Verify both canonical routes after each deployment:

```sh
curl --fail https://reticle.example.com/
curl --fail https://reticle.example.com/team/
```

## Live demo

The homepage embeds `https://demo.reticle.live/`. Keep a public demo strictly
read-only, place it behind TLS, and do not configure public edit credentials.
Run the daemon as a dedicated least-privileged OS identity with network access
only to its fixed probes. Use restricted SSH principals and expose only
persisted named actions; the viewer graph API, MCP, and chat must never provide
an interactive or ad-hoc shell.

If audit records are required, configure `--audit-log <path>` and manage the
resulting JSONL file with normal host permissions and rotation. Without that
flag, no JSONL audit file is written. Transient signal observations are bounded
in memory and reset whenever the daemon restarts; do not present them as durable
history or storage.

## Commercial deployment

Reticle Desktop is MIT-licensed. Reticle Team Daemon is commercial software;
an open-source Desktop release does not grant rights to deploy Team. Provision
Team only under an active subscription and keep commercial binaries and license
materials out of the public static site. Terminate TLS with Caddy or an approved
internal proxy, require authentication for non-public deployments, and follow
the organization's normal secret storage, access review, logging, and backup
policies.

Use the [production deployment runbook](../docs/production-deployment.md) for the
dedicated service account, systemd, Caddy, token and audit rotation, backup,
restore, upgrade, rollback, uninstall, and checksum procedures.
