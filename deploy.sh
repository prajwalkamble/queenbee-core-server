#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
scp index.html styles.css script.js toothless@queenbee-core-srv:/var/www/hub/
echo "✔ deployed — hard-refresh the /server/ page"
