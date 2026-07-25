#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# queenbee-core-srv — front node installer
#
# Run ON THE ALWAYS-ON BOX, after `sudo tailscale up` has succeeded.
#   sudo ./install.sh 100.126.54.0
# where the argument is the LAPTOP's tailnet IP (`tailscale ip -4` there).
#
# Idempotent: safe to re-run after editing the config.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LAPTOP_IP="${1:-}"
CONF_SRC="$(dirname "$0")/nginx/queenbee-front.conf"
CONF_DST="/etc/nginx/sites-available/queenbee-front.conf"

if [[ -z "$LAPTOP_IP" ]]; then
  echo "usage: sudo $0 <laptop-tailnet-ip>    e.g. sudo $0 100.126.54.0" >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "run me with sudo" >&2
  exit 1
fi

if ! [[ "$LAPTOP_IP" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "that doesn't look like a tailnet IP (expected 100.x.y.z): $LAPTOP_IP" >&2
  exit 1
fi

echo "→ installing nginx"
apt-get update -qq
apt-get install -y -qq nginx

echo "→ writing $CONF_DST (laptop = $LAPTOP_IP)"
sed "s/100\.126\.54\.0/$LAPTOP_IP/" "$CONF_SRC" > "$CONF_DST"
ln -sf "$CONF_DST" /etc/nginx/sites-enabled/queenbee-front.conf
rm -f /etc/nginx/sites-enabled/default

echo "→ testing config"
nginx -t

echo "→ reloading nginx"
systemctl enable --now nginx
systemctl reload nginx

echo "→ local smoke test"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/server/ || true)"
echo "   GET /server/ -> $code   (200 = laptop up, 302 = falling back to Pages)"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz || true)"
echo "   GET /healthz -> $code   (200 = laptop up, 503 = laptop down)"

cat <<'NEXT'

Next, and only after the machine rename is done in the admin console:

    sudo tailscale funnel --bg 8080
    tailscale funnel status

Expected:
    https://queenbee-core-srv.emperor-adelie.ts.net (Funnel on)
    |-- / proxy http://127.0.0.1:8080

NEXT
