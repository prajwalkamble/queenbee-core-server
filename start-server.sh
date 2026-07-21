#!/usr/bin/env bash
# ══════════════════════════════════════════════════
#  server-up.sh — start & verify queenbee-core-srv
#  (merged: services + containers + tailscale + HTTP)
#  Usage: ./server-up.sh   (or alias: up)
# ══════════════════════════════════════════════════

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; N='\033[0m'
ok()   { echo -e "  ${G}✔${N} $1"; }
fix()  { echo -e "  ${Y}➜${N} $1"; }
bad()  { echo -e "  ${R}✘${N} $1"; }

echo "══════════════════════════════════════"
echo "  queenbee-core-srv · startup check"
echo "══════════════════════════════════════"

# ---------- 1. Core services ----------
echo "[1/4] System services"
for svc in ssh docker nginx tailscaled; do
  if systemctl is-active --quiet "$svc"; then
    ok "$svc running"
  else
    fix "$svc down — starting..."
    sudo systemctl start "$svc"
    sleep 1
    systemctl is-active --quiet "$svc" \
      && ok "$svc started" \
      || bad "$svc FAILED — run: journalctl -u $svc -n 20"
  fi
done

# ---------- 2. Docker containers ----------
echo "[2/4] Docker containers"
CONTAINERS=("portfolio")          # add future containers to this list
for c in "${CONTAINERS[@]}"; do
  state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null)
  if [ "$state" = "running" ]; then
    ok "$c running"
  elif [ -z "$state" ]; then
    bad "$c does not exist — needs: docker run ... (see deploy notes)"
  else
    fix "$c is '$state' — starting..."
    docker start "$c" >/dev/null
    sleep 2
    [ "$(docker inspect -f '{{.State.Status}}' "$c")" = "running" ] \
      && ok "$c started" \
      || bad "$c crashed — run: docker logs $c"
  fi
done

# ---------- 3. Tailscale connectivity ----------
echo "[3/4] Tailscale"
if tailscale status >/dev/null 2>&1; then
  TS_IP=$(tailscale ip -4 2>/dev/null)
  ok "connected — tailnet IP: $TS_IP"
else
  fix "not connected — bringing up..."
  sudo tailscale up && ok "tailscale up" || bad "tailscale FAILED — may need re-auth: sudo tailscale up"
fi

# ---------- 4. End-to-end HTTP checks ----------
echo "[4/4] HTTP health"
sleep 1
all_ok=1
check() {  # check <label> <url> [extra hint on failure]
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$2")
  if [ "$code" = "200" ]; then
    ok "$1 → 200"
  else
    bad "$1 → ${code:-no response}${3:+ $3}"
    all_ok=0
  fi
}
check "portfolio :3000 " "http://localhost:3000"
check "site root :80   " "http://localhost" "(502 = container down)"
check "hub  /server/   " "http://localhost/server/"

echo "══════════════════════════════════════"
if [ "$all_ok" = "1" ]; then
  echo -e "  ${G}ALL SYSTEMS GO${N} — portfolio & hub are being served."
else
  echo -e "  ${R}ATTENTION NEEDED${N} — see ✘ items above."
fi
echo "══════════════════════════════════════"
