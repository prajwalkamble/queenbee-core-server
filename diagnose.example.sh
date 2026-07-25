#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# diagnose.example.sh — server hub health check
#
#   cp diagnose.example.sh diagnose.sh
#   $EDITOR diagnose.sh          # fill in the CONFIG block below
#   bash diagnose.sh
#
# diagnose.sh is gitignored; this .example twin is what gets committed.
# Run it ON THE MACHINE THAT SERVES THE HUB.
#
# It answers the questions that matter when the public URL misbehaves, in
# the order that narrows things fastest:
#   1. Is Tailscale up and publishing?
#   2. Does nginx serve the hub locally?
#   3. Does the public URL reach it?
#   4. Is the offline fallback alive?
# A 404 from Tailscale and a 404 from nginx look identical in a browser and
# have completely different fixes. This tells them apart.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ─── CONFIG ────────────────────────────────────────────────────────────────
TAILNET_HOST="your-machine.your-tailnet.ts.net"        # tailscale status --json | grep DNSName
HUB_PATH="/server/"                                    # path the hub is served at
OFFLINE_PAGE="https://YOURNAME.github.io/YOUR-REPO/"   # GitHub Pages fallback
LOCAL_PORT="80"                                        # port nginx listens on
NGINX_ROOT="/var/www/html"                             # document root to inspect
# ───────────────────────────────────────────────────────────────────────────

HUB_URL="https://${TAILNET_HOST}${HUB_PATH}"
pass=0; fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
info() { printf '    %s\n' "$1"; }
head_() { printf '\n\033[1m═══ %s ═══\033[0m\n' "$1"; }

code_for() { curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-5}" "$1" 2>/dev/null || echo "000"; }

if [[ "$TAILNET_HOST" == your-machine.* ]]; then
  echo "Fill in the CONFIG block first — this is the .example copy." >&2
  exit 1
fi

head_ "1. Tailscale"
if ! command -v tailscale >/dev/null; then
  bad "tailscale not installed"
else
  if tailscale status >/dev/null 2>&1; then
    ok "tailscaled is running"
    info "$(tailscale status 2>/dev/null | head -1)"
  else
    bad "tailscale status failed — daemon down or logged out"
  fi

  echo
  info "serve config:"
  tailscale serve status 2>&1 | sed 's/^/      /' || info "(none)"
  info "funnel config:"
  tailscale funnel status 2>&1 | sed 's/^/      /' || info "(none)"
  echo
  if tailscale serve status 2>/dev/null | grep -q "${HUB_PATH%/}"; then
    ok "something is mapped at ${HUB_PATH}"
  else
    bad "nothing mapped at ${HUB_PATH}"
    info "Tailscale itself will 404 this path and nginx never sees the request."
    info "'tailscale funnel reset' wipes these mappings — that is the usual cause."
  fi
fi

head_ "2. nginx, locally"
if ! command -v curl >/dev/null; then
  bad "curl not installed — cannot test"
else
  for u in "http://127.0.0.1:${LOCAL_PORT}${HUB_PATH}" "http://127.0.0.1:${LOCAL_PORT}/"; do
    c="$(code_for "$u" 3)"
    case "$c" in
      200) ok "$u -> $c" ;;
      000) bad "$u -> no response (nginx down, or not on this port)" ;;
      *)   bad "$u -> $c" ;;
    esac
  done
fi

if command -v nginx >/dev/null; then
  echo
  info "roots and locations nginx knows about:"
  nginx -T 2>/dev/null | grep -E '^\s*(root|location|listen)' | sed 's/^/      /' | head -20
fi

head_ "3. The public URL"
c="$(code_for "$HUB_URL" 8)"
case "$c" in
  200) ok "$HUB_URL -> 200" ;;
  404) bad "$HUB_URL -> 404"
       info "Compare with section 2: if local is 200 and this is 404, the fault"
       info "is the Tailscale mapping, not nginx." ;;
  000) bad "$HUB_URL -> no response"
       info "Funnel off, machine unreachable, or DNS not resolving." ;;
  *)   bad "$HUB_URL -> $c" ;;
esac

head_ "4. Offline fallback"
c="$(code_for "$OFFLINE_PAGE" 8)"
if [[ "$c" == "200" ]]; then
  ok "$OFFLINE_PAGE -> 200"
else
  bad "$OFFLINE_PAGE -> $c"
  info "Every redirect target in the project points here. If this is 404,"
  info "check the repo name and that Pages is set to main /docs."
fi

head_ "5. Recent nginx 404s"
if [[ -r /var/log/nginx/error.log ]]; then
  m="$(grep -i 'No such file' /var/log/nginx/error.log 2>/dev/null | tail -3)"
  if [[ -n "$m" ]]; then
    info "nginx logged these missing paths — the fix is usually visible here:"
    echo "$m" | sed 's/^/      /'
  else
    info "no missing-file errors logged (consistent with a Tailscale-level 404)"
  fi
else
  info "error.log unreadable — try with sudo"
fi

head_ "6. Files on disk"
if [[ -d "$NGINX_ROOT" ]]; then
  ls -la "$NGINX_ROOT" 2>/dev/null | head -10 | sed 's/^/      /'
  [[ -f "${NGINX_ROOT%/}${HUB_PATH}index.html" ]] \
    && ok "${NGINX_ROOT%/}${HUB_PATH}index.html exists" \
    || bad "${NGINX_ROOT%/}${HUB_PATH}index.html missing"
else
  bad "$NGINX_ROOT does not exist — is NGINX_ROOT set correctly?"
fi

head_ "Summary"
printf '  %d passed, %d failed\n\n' "$pass" "$fail"
if (( fail == 0 )); then
  echo "  Everything the script can see is healthy."
else
  cat <<'HINT'
  Read the sections in order — the first failure usually explains the rest.
  Local 200 + public 404      -> Tailscale mapping (section 1)
  Local 404                   -> nginx root or location (sections 2, 5, 6)
  Public no-response          -> Funnel off or machine unreachable
  Offline page not 200        -> repo name or Pages source setting
HINT
fi
