#!/usr/bin/env bash

linux_scripts_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
AG2R_PROJECT_ROOT=$(cd -- "$linux_scripts_dir/../.." && pwd -P)
AG2R_ENV_PATH=${AG2R_ENV_PATH:-"$AG2R_PROJECT_ROOT/.env"}
AG2R_RUNTIME_DIR=${AG2R_RUNTIME_DIR:-"$AG2R_PROJECT_ROOT/.runtime"}
AG2R_LOGS_DIR=${AG2R_LOGS_DIR:-"$AG2R_PROJECT_ROOT/logs"}
AG2R_PROCESS_FILE="$AG2R_RUNTIME_DIR/server.process"
export AG2R_ENV_PATH

show_message() {
  local title=$1
  local text=$2
  local kind=${3:-info}

  if [[ ${AG2R_QUIET:-false} == true ]]; then
    printf '%s: %s\n' "$title" "$text"
    return
  fi

  if command -v zenity >/dev/null 2>&1; then
    zenity "--$kind" --title="$title" --text="$text" --width=520 2>/dev/null || true
    return
  fi

  if command -v kdialog >/dev/null 2>&1; then
    case "$kind" in
      error) kdialog --error "$text" --title "$title" ;;
      warning) kdialog --sorry "$text" --title "$title" ;;
      *) kdialog --msgbox "$text" --title "$title" ;;
    esac
    return
  fi

  if command -v notify-send >/dev/null 2>&1; then
    notify-send "$title" "$text" 2>/dev/null || true
  fi
  printf '%s: %s\n' "$title" "$text" >&2
}

fail() {
  show_message "AG2R Error" "$1" error
  exit "${2:-1}"
}

get_env_value() {
  local key=$1
  local default_value=${2:-}
  if [[ ! -f $AG2R_ENV_PATH ]]; then
    printf '%s' "$default_value"
    return
  fi

  local value
  value=$(awk -v wanted="$key" '
    index($0, wanted "=") == 1 { result = substr($0, length(wanted) + 2) }
    END { if (result != "") print result }
  ' "$AG2R_ENV_PATH")
  printf '%s' "${value:-$default_value}"
}

set_env_value() {
  local key=$1
  local value=$2
  local temp_file
  temp_file=$(mktemp "${AG2R_ENV_PATH}.tmp.XXXXXX")
  awk -v wanted="$key" -v replacement="$value" '
    BEGIN { updated = 0 }
    index($0, wanted "=") == 1 {
      print wanted "=" replacement
      updated = 1
      next
    }
    { print }
    END { if (!updated) print wanted "=" replacement }
  ' "$AG2R_ENV_PATH" > "$temp_file"
  chmod 600 "$temp_file"
  mv -f -- "$temp_file" "$AG2R_ENV_PATH"
}

new_passcode() {
  node -e "console.log(require('node:crypto').randomInt(10000000, 100000000))"
}

new_session_secret() {
  node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
}

ensure_env() {
  mkdir -p -- "$(dirname -- "$AG2R_ENV_PATH")"
  if [[ ! -f $AG2R_ENV_PATH ]]; then
    local passcode session_secret
    passcode=$(new_passcode)
    session_secret=$(new_session_secret)
    umask 077
    printf '%s\n' \
      'PORT=3000' \
      'CDP_HOST=127.0.0.1' \
      'CDP_PORT=9000' \
      'AUTH_ENABLED=true' \
      "APP_PASSWORD=$passcode" \
      "SESSION_SECRET=$session_secret" \
      'POLL_INTERVAL_MS=500' \
      'TUNNEL_ENABLED=false' \
      'HTTP_ONLY=false' > "$AG2R_ENV_PATH"
  fi

  if [[ -z $(get_env_value APP_PASSWORD '') ]]; then
    set_env_value APP_PASSWORD "$(new_passcode)"
  fi
  if [[ -z $(get_env_value SESSION_SECRET '') ]]; then
    set_env_value SESSION_SECRET "$(new_session_secret)"
  fi
  chmod 600 "$AG2R_ENV_PATH"
}

load_server_location() {
  AG2R_PORT=$(get_env_value PORT 3000)
  if [[ ! $AG2R_PORT =~ ^[0-9]+$ ]] || (( 10#$AG2R_PORT < 1 || 10#$AG2R_PORT > 65535 )); then
    fail 'PORT in .env must be a number between 1 and 65535.'
  fi
  AG2R_PORT=$((10#$AG2R_PORT))
  if [[ $(get_env_value HTTP_ONLY false) == true ]]; then
    AG2R_PROTOCOL=http
  else
    AG2R_PROTOCOL=https
  fi
  AG2R_LOCAL_URL="$AG2R_PROTOCOL://localhost:$AG2R_PORT"
}

test_health() {
  local url=$1
  curl -kfsS --connect-timeout 1 --max-time 2 "$url/health" 2>/dev/null | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

test_cdp() {
  local base_port port
  base_port=$(get_env_value CDP_PORT 9000)
  if [[ ! $base_port =~ ^[0-9]+$ ]] || (( 10#$base_port < 1 || 10#$base_port > 65532 )); then
    return 1
  fi
  base_port=$((10#$base_port))
  for ((port = base_port; port <= base_port + 3; port++)); do
    if curl -fsS --connect-timeout 1 --max-time 1 "http://127.0.0.1:$port/json/version" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

find_antigravity_bin() {
  local configured candidate
  configured=$(get_env_value ANTIGRAVITY_BIN '')
  if [[ -n $configured && -x $configured ]]; then
    printf '%s' "$configured"
    return 0
  fi

  if command -v antigravity >/dev/null 2>&1; then
    command -v antigravity
    return 0
  fi

  for candidate in \
    '/opt/Antigravity/antigravity' \
    '/opt/antigravity/antigravity' \
    '/usr/local/bin/antigravity' \
    '/usr/bin/antigravity' \
    "$HOME/.local/bin/antigravity"; do
    if [[ -x $candidate ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  if [[ -d $HOME/Applications ]]; then
    candidate=$(find "$HOME/Applications" -maxdepth 1 -type f -iname '*antigravity*.AppImage' -perm -u+x -print -quit 2>/dev/null || true)
    if [[ -n $candidate ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  fi
  return 1
}

antigravity_is_running() {
  pgrep -f '(^|/)[Aa]ntigravity([[:space:]]|$)|[Aa]ntigravity.*\.AppImage' >/dev/null 2>&1
}

server_process_is_valid() {
  [[ -f $AG2R_PROCESS_FILE ]] || return 1
  local saved_pid saved_ticks current_ticks process_cwd process_exe process_cmd
  IFS='|' read -r saved_pid saved_ticks < "$AG2R_PROCESS_FILE" || return 1
  [[ $saved_pid =~ ^[0-9]+$ && $saved_ticks =~ ^[0-9]+$ ]] || return 1
  [[ -d /proc/$saved_pid ]] || return 1
  current_ticks=$(awk '{ print $22 }' "/proc/$saved_pid/stat" 2>/dev/null || true)
  [[ $current_ticks == "$saved_ticks" ]] || return 1
  process_cwd=$(readlink -f "/proc/$saved_pid/cwd" 2>/dev/null || true)
  process_exe=$(readlink -f "/proc/$saved_pid/exe" 2>/dev/null || true)
  process_cmd=$(tr '\0' ' ' < "/proc/$saved_pid/cmdline" 2>/dev/null || true)
  [[ $process_cwd == "$AG2R_PROJECT_ROOT" ]] || return 1
  [[ ${process_exe##*/} == node ]] || return 1
  [[ $process_cmd == *'server.js'* ]] || return 1
  AG2R_SERVER_PID=$saved_pid
  AG2R_SERVER_TICKS=$saved_ticks
}

get_desktop_dir() {
  if [[ -n ${AG2R_DESKTOP_DIR:-} ]]; then
    printf '%s' "$AG2R_DESKTOP_DIR"
    return
  fi
  if command -v xdg-user-dir >/dev/null 2>&1; then
    local detected
    detected=$(xdg-user-dir DESKTOP 2>/dev/null || true)
    if [[ -n $detected && -d $detected ]]; then
      printf '%s' "$detected"
      return
    fi
  fi
  if [[ -d $HOME/Desktop ]]; then
    printf '%s' "$HOME/Desktop"
  fi
}

get_lan_addresses() {
  local addresses=''
  if command -v ip >/dev/null 2>&1; then
    addresses=$(ip -o -4 addr show scope global 2>/dev/null | awk '{ split($4, parts, "/"); if (parts[1] !~ /^169\.254\./) print parts[1] }' | sort -u)
  elif command -v hostname >/dev/null 2>&1; then
    addresses=$(hostname -I 2>/dev/null | tr ' ' '\n' | awk 'NF && $0 !~ /^169\.254\./' | sort -u)
  fi
  printf '%s' "$addresses"
}

open_url() {
  local url=$1
  if command -v xdg-open >/dev/null 2>&1; then
    nohup xdg-open "$url" >/dev/null 2>&1 &
  elif command -v gio >/dev/null 2>&1; then
    nohup gio open "$url" >/dev/null 2>&1 &
  fi
}
