#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "run this installer as root" >&2
  exit 1
fi

if ! id reticle >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/reticle --create-home --shell /usr/sbin/nologin reticle
fi
install -d -o reticle -g reticle -m 0750 /etc/reticle /var/lib/reticle /var/log/reticle
install -m 0755 reticle-daemon /usr/local/bin/reticle-daemon
install -m 0644 reticle-daemon.service /etc/systemd/system/reticle-daemon.service
if [ ! -e /etc/reticle/reticle.env ]; then
  install -o root -g reticle -m 0640 /dev/null /etc/reticle/reticle.env
fi
if [ ! -e /var/lib/reticle/topology.yaml ]; then
  printf 'version: 1\nnodes: {}\nedges: {}\ncollectors: []\nactions: []\n' \
    > /var/lib/reticle/topology.yaml
  chown reticle:reticle /var/lib/reticle/topology.yaml
  chmod 0640 /var/lib/reticle/topology.yaml
fi
systemctl daemon-reload
echo "Set independent random tokens in /etc/reticle/reticle.env, review"
echo "/var/lib/reticle/topology.yaml, then run:"
echo "  systemctl enable --now reticle-daemon"
