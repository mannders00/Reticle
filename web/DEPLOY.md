# Deploying the site (and a live demo) behind Caddy on EC2

The site is fully static (`index.html` + `styles.css`), so the easiest fit
for your setup is **Caddy's file_server — no systemd daemon needed at all**:

```sh
# from the repo
rsync -av web/ ec2:/var/www/reticle-site/
```

```caddyfile
# Caddyfile
reticle.example.com {
    root * /var/www/reticle-site
    file_server
    encode gzip
}
```

`caddy reload` and done. Caddy handles TLS; updates are just another rsync.

## Live demo daemon (the "coming soon" stub on the site)

When you're ready to hook up the live demo, run `reticle-daemon` as one of
your usual port-listening systemd units and reverse-proxy it — Caddy
proxies the WebSocket (`/ws`) transparently, nothing special needed:

```ini
# /etc/systemd/system/reticle-demo.service
[Unit]
Description=Reticle live demo daemon
After=network.target

[Service]
# Read-only by default: with no --edit-token (and no --open), every
# visitor is a viewer — no token needed in the demo URL at all.
ExecStart=/opt/reticle/reticle-daemon --port 8790 \
  --config /opt/reticle/demo-topology.yaml \
  --audit-log /var/log/reticle-demo-audit.jsonl
Restart=on-failure
User=reticle
DynamicUser=yes
StateDirectory=reticle
LogsDirectory=reticle-demo

[Install]
WantedBy=multi-user.target
```

```caddyfile
demo.reticle.example.com {
    reverse_proxy 127.0.0.1:8790
}
```

Then the site's "Live demo" card links to plain
`https://demo.reticle.example.com/` — no token in the URL. The daemon is
read-only by default: every visitor is a viewer (live health included)
and physically cannot change or run anything. If you want to edit the
demo topology remotely, add `--edit-token <secret>` and keep the secret
to yourself — everyone else stays a viewer. Never `--enable-terminal`
(or `--open`) on a public demo.
