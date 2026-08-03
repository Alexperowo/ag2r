#!/usr/bin/env bash
set -Eeuo pipefail

skip_antigravity=false
no_browser=false
for argument in "$@"; do
  case "$argument" in
    --skip-antigravity) skip_antigravity=true ;;
    --no-browser) no_browser=true ;;
    --quiet) export AG2R_QUIET=true ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

command -v node >/dev/null 2>&1 || fail 'Node.js was not found. Install Node.js 22 or newer and try again.'
command -v curl >/dev/null 2>&1 || fail 'curl was not found. Install curl and try again.'
[[ -d $AG2R_PROJECT_ROOT/node_modules ]] || fail 'AG2R dependencies are not installed. Run the AG2R installer again.'

mkdir -p -- "$AG2R_RUNTIME_DIR" "$AG2R_LOGS_DIR"
ensure_env
load_server_location

if test_health "$AG2R_LOCAL_URL"; then
  [[ $no_browser == true ]] || open_url "$AG2R_LOCAL_URL"
  show_message 'AG2R' "AG2R is already running.\n\nAddress: $AG2R_LOCAL_URL" info
  exit 0
fi

if [[ -f $AG2R_PROCESS_FILE ]] && ! server_process_is_valid; then
  rm -f -- "$AG2R_PROCESS_FILE"
fi

if [[ $skip_antigravity != true ]] && ! test_cdp; then
  if antigravity_is_running; then
    show_message 'AG2R Needs Attention' "Antigravity is already open without remote control enabled.\n\nSave your work, close all Antigravity windows, and run 'Start AG2R' again." warning
    exit 2
  fi

  antigravity_bin=$(find_antigravity_bin || true)
  [[ -n $antigravity_bin ]] || fail 'Antigravity was not found. Install it or set ANTIGRAVITY_BIN in .env.'
  antigravity_log="$AG2R_LOGS_DIR/antigravity-$(date +%Y%m%d-%H%M%S).log"
  nohup "$antigravity_bin" --remote-debugging-address=127.0.0.1 --remote-debugging-port="$(get_env_value CDP_PORT 9000)" > "$antigravity_log" 2>&1 < /dev/null &
  for _attempt in {1..40}; do
    test_cdp && break
    sleep 0.5
  done
fi

stamp=$(date +%Y%m%d-%H%M%S)
stdout_log="$AG2R_LOGS_DIR/server-$stamp.out.log"
stderr_log="$AG2R_LOGS_DIR/server-$stamp.error.log"
original_dir=$(pwd -P)
cd -- "$AG2R_PROJECT_ROOT"
nohup node server.js > "$stdout_log" 2> "$stderr_log" < /dev/null &
server_pid=$!
cd -- "$original_dir"

server_ticks=$(awk '{ print $22 }' "/proc/$server_pid/stat" 2>/dev/null || true)
if [[ ! $server_ticks =~ ^[0-9]+$ ]]; then
  kill "$server_pid" 2>/dev/null || true
  fail 'AG2R process identity could not be recorded.'
fi
process_temp=$(mktemp "$AG2R_RUNTIME_DIR/server.process.tmp.XXXXXX")
printf '%s|%s\n' "$server_pid" "$server_ticks" > "$process_temp"
chmod 600 "$process_temp"
mv -f -- "$process_temp" "$AG2R_PROCESS_FILE"

started=false
for _attempt in {1..30}; do
  if test_health "$AG2R_LOCAL_URL"; then
    started=true
    break
  fi
  kill -0 "$server_pid" 2>/dev/null || break
  sleep 0.5
done

if [[ $started != true ]]; then
  if server_process_is_valid; then
    kill "$AG2R_SERVER_PID" 2>/dev/null || true
  fi
  rm -f -- "$AG2R_PROCESS_FILE"
  details=$(tail -n 10 "$stderr_log" 2>/dev/null || true)
  fail "AG2R did not start.\n\n$details"
fi

passcode=$(get_env_value APP_PASSWORD '')
if test_cdp; then
  cdp_state=connected
else
  cdp_state='not connected'
fi
show_message 'AG2R' "AG2R is running.\n\nAddress: $AG2R_LOCAL_URL\nAntigravity: $cdp_state\nPasscode: $passcode\n\nThe status application shows phone addresses." info
[[ $no_browser == true ]] || open_url "$AG2R_LOCAL_URL"
