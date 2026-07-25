#!/usr/bin/env bash
# Run this ON THE LAPTOP (the machine that serves the hub).
#   bash diagnose.sh
#
# It answers one question: is the 404 coming from Tailscale or from nginx?
# Those have completely different fixes, and guessing wastes an afternoon.

echo "═══ 1. Is Tailscale serving, and on what path? ═══"
tailscale serve status  2>&1 || echo "  (serve status failed)"
echo
tailscale funnel status 2>&1 || echo "  (funnel status failed)"
echo
echo "  What to look for: a line mapping a path to a local port, e.g."
echo "    /server/ proxy http://127.0.0.1:80"
echo "  If nothing is mapped at /server/, Tailscale itself is issuing the 404"
echo "  and nginx never sees the request. 'tailscale funnel reset' wipes this."
echo

echo "═══ 2. Does nginx serve /server/ locally? ═══"
for url in http://127.0.0.1/server/ http://127.0.0.1:8080/server/ http://127.0.0.1/; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo '---')"
  printf '  %-32s %s\n' "$url" "$code"
done
echo
echo "  200 here + 404 over ts.net  -> Tailscale mapping is wrong (step 1)"
echo "  404 here                    -> nginx path/root is wrong (step 3)"
echo

echo "═══ 3. Where is nginx actually looking? ═══"
nginx -T 2>/dev/null | grep -nE '^\s*(root|server_name|listen|location)' | head -30
echo
echo "  Last few 404s, with the exact filesystem path nginx tried:"
tail -n 40 /var/log/nginx/error.log 2>/dev/null | grep -i 'No such file' | tail -5 || \
  echo "  (nothing in error.log — consistent with a Tailscale-level 404)"
echo

echo "═══ 4. Does /healthz exist yet? ═══"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1/healthz 2>/dev/null || echo '---')"
echo "  http://127.0.0.1/healthz -> $code"
echo "  Anything but 200 means every probe in the project reports 'server down',"
echo "  which is why the Pages page never forwards to the hub."
echo

echo "═══ 5. CORS header present on /healthz? ═══"
curl -s -I --max-time 3 http://127.0.0.1/healthz 2>/dev/null | grep -i 'access-control-allow-origin' \
  || echo "  MISSING — a page on github.io cannot read the status code without it."
echo

echo "═══ 6. Files on disk ═══"
for d in /var/www/html /var/www/queenbee /srv/www /usr/share/nginx/html; do
  [ -d "$d" ] && { echo "  $d:"; ls -la "$d" 2>/dev/null | head -8; echo; }
done
