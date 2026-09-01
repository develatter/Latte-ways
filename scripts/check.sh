#!/usr/bin/env bash
set -euo pipefail
if [[ -f dist/cli.js ]]; then exec node dist/cli.js check; fi
exec npx --no-install ways check
