#!/usr/bin/env bash
set -euo pipefail
if [[ -f dist/cli.js ]]; then
  node dist/cli.js check
  exec node dist/cli.js check --history
fi
npx --no-install ways check
exec npx --no-install ways check --history
