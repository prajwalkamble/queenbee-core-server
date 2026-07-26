#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# verify.sh — check every layer at once
#
#   bash verify.sh
#
# Run from the repo root on the laptop, with nginx RUNNING.
# Checks the repo, the deployed copy, the live server, and GitHub Pages,
# and names the one thing that is wrong instead of making you guess.
# ═══════════════════════════════════════════════════════════════════════
set -uo pipefail

HUB="https://queenbee-core-srv.emperor-adelie.ts.net/server/"
PAGES="https://prajwalkamble.github.io/queenbee-core-server/"
RAW="https://raw.githubusercontent.com/prajwalkamble/queenbee-core-server/main"
WEBROOT="/var/www/hub"

fail=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
note(){ printf '      → %s\n' "$1"; }
hdr() { printf '\n\033[1m%s\033[0m\n' "$1"; }

hdr "1. Repo files parse"
if node --check server/script.js 2>/dev/null; then ok "server/script.js"; else
  bad "server/script.js has a syntax error"; note "run: node --check server/script.js"; fi
if grep -rqn '^<<<<<<<\|^=======$\|^>>>>>>>' server/ docs/ 2>/dev/null; then
  bad "merge conflict markers found"
  grep -rn '^<<<<<<<\|^=======$\|^>>>>>>>' server/ docs/ | head -5 | sed 's/^/      /'
else ok "no conflict markers"; fi

hdr "2. Deployed copy matches the repo"
if [[ -d "$WEBROOT" ]]; then
  if diff -q server/script.js "$WEBROOT/script.js" >/dev/null 2>&1; then
    ok "$WEBROOT/script.js is current"
  else
    bad "$WEBROOT is STALE — pushing to GitHub does not deploy here"
    note "sudo rsync -a --delete server/ $WEBROOT/"
  fi
  node --check "$WEBROOT/script.js" 2>/dev/null && ok "deployed copy parses" \
    || bad "deployed copy has a syntax error"
else
  bad "$WEBROOT does not exist"; note "check: sudo nginx -T | grep -E 'alias|root'"
fi

hdr "3. Live server"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$HUB" 2>/dev/null || echo 000)"
[[ "$code" == "200" ]] && ok "hub returns 200" || { bad "hub returns $code"; note "is nginx running?"; }

if curl -sI --max-time 8 "$HUB" 2>/dev/null | grep -qi 'access-control-allow-origin'; then
  ok "CORS header present"
else
  bad "CORS header MISSING — the offline page cannot read the probe"
  note "add to the location /server/ block:"
  note '  add_header Access-Control-Allow-Origin "*" always;'
  note "then: sudo nginx -t && sudo systemctl reload nginx"
fi

hdr "4. GitHub Pages"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$PAGES" 2>/dev/null || echo 000)"
[[ "$code" == "200" ]] && ok "offline page returns 200" || bad "offline page returns $code"

if curl -s --max-time 8 "$RAW/docs/index.html" 2>/dev/null | grep -q 'mode: "no-cors"'; then
  bad "GitHub still has the OLD opaque probe in docs/index.html"
  note "commit and push the patched docs/ files"
else
  ok "docs/index.html on GitHub uses the CORS probe"
fi

hdr "Result"
if (( fail == 0 )); then
  cat <<'DONE'
  All layers agree. To test the failover:
    1. open the hub, hard-reload (Ctrl+Shift+R)
    2. leave the tab alone, foreground
    3. sudo systemctl stop nginx
    4. expect the pill at ~5s, the offline page by ~12s
    5. sudo systemctl start nginx  -> carried back within ~10s
DONE
else
  printf '  %d problem(s) above. Fix the FIRST one and re-run.\n' "$fail"
fi
