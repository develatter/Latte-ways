#!/usr/bin/env sh
# Managed by latte-ways. Prints the harness status for an agent statusline.
input="$(cat)"
dir="$(printf '%s' "$input" | sed -n 's/.*"project_dir": *"\([^"]*\)".*/\1/p')"
[ -n "$dir" ] || dir="$(printf '%s' "$input" | sed -n 's/.*"cwd": *"\([^"]*\)".*/\1/p')"
[ -n "$dir" ] || dir="$PWD"
file="$dir/.ways/status.json"
[ -f "$file" ] || { printf 'ways: not installed'; exit 0; }
field() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$file" | head -n 1; }
if grep -q '"active": *false' "$file"; then printf 'ways: idle'; exit 0; fi
mode="$(field mode)"; id="$(field id)"; phase="$(field phase)"; profile="$(field profile)"
out="ways: $mode:$id"
[ -n "$phase" ] && out="$out @$phase"
[ -n "$profile" ] && out="$out [$profile]"
grep -q '"humanGate": *true' "$file" && out="$out HUMAN GATE"
printf '%s' "$out"
