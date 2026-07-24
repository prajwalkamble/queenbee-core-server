#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════
#  deploy.example.sh — template for deploy.sh
#
#      cp deploy.example.sh deploy.sh     # deploy.sh is gitignored
#      chmod +x deploy.sh
#      # then replace the two placeholders below with real values
#
#  Static files need no build and no service restart: the web server
#  returns whatever is on disk, so the copy IS the deployment.
# ══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

HOST="user@your-server"        # ← ssh target
WEB="/path/to/webroot"         # ← directory the web server serves

# the hub
scp index.html styles.css script.js "$HOST:$WEB/"

# the status page doubles as the web server's error page
scp docs/index.html "$HOST:$WEB/offline.html"

# untracked contact config (only if you keep the form working on the server)
[ -f docs/config.js ] && scp docs/config.js "$HOST:$WEB/config.js"

echo "✔ deployed — hard-refresh (Ctrl+Shift+R) to bypass the cache"
