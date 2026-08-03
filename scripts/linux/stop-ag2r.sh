#!/usr/bin/env bash
set -Eeuo pipefail

for argument in "$@"; do
  case "$argument" in
    --quiet) export AG2R_QUIET=true ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

if [[ ! -f $AG2R_PROCESS_FILE ]]; then
  show_message 'AG2R' 'AG2R is not running, or it was started manually.' info
  exit 0
fi

if ! server_process_is_valid; then
  IFS='|' read -r stale_pid _stale_ticks < "$AG2R_PROCESS_FILE" || true
  if [[ $stale_pid =~ ^[0-9]+$ && -d /proc/$stale_pid ]]; then
    fail 'The saved process information is stale. No process was stopped.'
  fi
  rm -f -- "$AG2R_PROCESS_FILE"
  show_message 'AG2R' 'AG2R is already stopped.' info
  exit 0
fi

kill -TERM "$AG2R_SERVER_PID"
for _attempt in {1..50}; do
  kill -0 "$AG2R_SERVER_PID" 2>/dev/null || break
  sleep 0.1
done

if kill -0 "$AG2R_SERVER_PID" 2>/dev/null; then
  if server_process_is_valid; then
    kill -KILL "$AG2R_SERVER_PID"
  else
    fail 'The AG2R process identity changed during shutdown.'
  fi
fi

rm -f -- "$AG2R_PROCESS_FILE"
show_message 'AG2R' 'AG2R has stopped. Antigravity was left open.' info
