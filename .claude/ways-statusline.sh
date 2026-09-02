#!/usr/bin/env sh
# Managed by latte-ways. Appends the harness status to the user's own statusline.
# Usage: <script> [original statusline command]
input="$(cat)"
prefix=""
if [ -n "$1" ]; then prefix="$(printf '%s' "$input" | sh -c "$1" 2>/dev/null)"; fi
dir="$(printf '%s' "$input" | sed -n 's/.*"project_dir": *"\([^"]*\)".*/\1/p')"
[ -n "$dir" ] || dir="$(printf '%s' "$input" | sed -n 's/.*"cwd": *"\([^"]*\)".*/\1/p')"
[ -n "$dir" ] || dir="$PWD"
file="$dir/.ways/status.json"
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1; }
if [ ! -f "$file" ]; then out="ways: not installed"
elif grep -q '"active": *false' "$file"; then out="ways: idle"
else
  mode="$(field mode)"; id="$(field id)"; phase="$(field phase)"; profile="$(field profile)"
  out="ways: $mode:$id"
  [ -n "$phase" ] && out="$out @$phase"
  [ -n "$profile" ] && out="$out [$profile]"
  grep -q '"humanGate": *true' "$file" && out="$out HUMAN GATE"
fi
if [ -n "$prefix" ]; then printf '%s | %s' "$prefix" "$out"; else printf '%s' "$out"; fi
