#!/usr/bin/env sh
set -eu
if [ -f dist/cli.js ]; then
  node dist/cli.js check
  if [ -n "${WAYS_HISTORY_TO:-}" ]; then
    exec node dist/cli.js check --history "--to=$WAYS_HISTORY_TO"
  fi
  exec node dist/cli.js check --history
fi
npx --no-install ways check
if [ -n "${WAYS_HISTORY_TO:-}" ]; then
  exec npx --no-install ways check --history "--to=$WAYS_HISTORY_TO"
fi
exec npx --no-install ways check --history
