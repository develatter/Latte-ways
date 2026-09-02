#!/usr/bin/env sh
# Managed by latte-ways. Blocks agent-issued git commits when no harness work is active.
input="$(cat)"
if ! printf '%s' "$input" | grep -Eq '"command": *".*git[^"&|;]*[[:space:]]commit([[:space:]]|\\|"|$)'; then exit 0; fi
dir="$(printf '%s' "$input" | sed -n 's/.*"cwd": *"\([^"]*\)".*/\1/p')"
[ -n "$dir" ] || dir="$PWD"
root="$(cd "$dir" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null)" || exit 0
file="$root/.ways/status.json"
[ -f "$file" ] || exit 0
if grep -q '"active": *false' "$file"; then
  echo "ways: no active work; open one with /ways-quick, /ways-plan or /ways-sdd before committing" >&2
  exit 2
fi
exit 0
