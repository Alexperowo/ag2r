#!/usr/bin/env bash
set -Eeuo pipefail

skip_dependencies=false
for argument in "$@"; do
  case "$argument" in
    --quiet) export AG2R_QUIET=true ;;
    --skip-dependencies) skip_dependencies=true ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

[[ $(uname -s) == Linux ]] || fail 'This installer supports Linux only.'
command -v node >/dev/null 2>&1 || fail 'Node.js was not found. Install Node.js 22 or newer, then run this installer again.'
command -v npm >/dev/null 2>&1 || fail 'npm was not found. Install Node.js 22 or newer, then run this installer again.'

node_version=$(node -p 'process.versions.node')
if ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 11) ? 0 : 1)"; then
  fail "Node.js 22.11 or newer is required. Installed version: $node_version"
fi

mkdir -p -- "$AG2R_RUNTIME_DIR" "$AG2R_LOGS_DIR"
if server_process_is_valid; then
  fail "AG2R is running. Use 'Stop AG2R', then run the installer again."
fi

if [[ $skip_dependencies != true ]]; then
  package_lock="$AG2R_PROJECT_ROOT/package-lock.json"
  [[ -f $package_lock ]] || fail 'package-lock.json was not found.'
  dependency_stamp="$AG2R_RUNTIME_DIR/dependencies.sha256"
  expected_hash=$(node -e "const fs=require('node:fs');const crypto=require('node:crypto');process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$package_lock")
  installed_hash=''
  [[ -f $dependency_stamp ]] && installed_hash=$(<"$dependency_stamp")

  if [[ $installed_hash != "$expected_hash" || ! -f $AG2R_PROJECT_ROOT/node_modules/express/package.json ]]; then
    show_message 'AG2R Setup' 'Dependencies will now be installed. This can take several minutes.' info
    install_log="$AG2R_LOGS_DIR/install-$(date +%Y%m%d-%H%M%S).log"
    if ! (cd -- "$AG2R_PROJECT_ROOT" && npm ci --no-audit --no-fund) > "$install_log" 2>&1; then
      details=$(tail -n 12 "$install_log" 2>/dev/null || true)
      fail "Dependency installation failed.\n\n$details"
    fi
    printf '%s' "$expected_hash" > "$dependency_stamp"
    chmod 600 "$dependency_stamp"
  fi
fi

data_home=${AG2R_DATA_HOME:-${XDG_DATA_HOME:-"$HOME/.local/share"}}
applications_dir="$data_home/applications"
icon_dir="$data_home/icons/hicolor/192x192/apps"
mkdir -p -- "$applications_dir" "$icon_dir"
install -m 0644 "$AG2R_PROJECT_ROOT/public/ag2r-icon-192.png" "$icon_dir/ag2r.png"

escape_desktop_value() {
  local escaped=$1
  escaped=${escaped//\\/\\\\}
  escaped=${escaped//\"/\\\"}
  escaped=${escaped//%/%%}
  printf '%s' "$escaped"
}

write_desktop_file() {
  local destination=$1
  local name=$2
  local russian_name=$3
  local comment=$4
  local russian_comment=$5
  local script_name=$6
  local escaped_script
  escaped_script=$(escape_desktop_value "$AG2R_PROJECT_ROOT/scripts/linux/$script_name")
  local temp_file
  temp_file=$(mktemp "${destination}.tmp.XXXXXX")
  printf '%s\n' \
    '[Desktop Entry]' \
    'Type=Application' \
    "Name=$name" \
    "Name[ru]=$russian_name" \
    "Comment=$comment" \
    "Comment[ru]=$russian_comment" \
    "Exec=bash \"$escaped_script\"" \
    'Icon=ag2r' \
    'Terminal=false' \
    'Categories=Development;Utility;' \
    'StartupNotify=true' > "$temp_file"
  chmod 0755 "$temp_file"
  mv -f -- "$temp_file" "$destination"
}

write_desktop_file "$applications_dir/ag2r-start.desktop" 'Start AG2R' 'Запустить AG2R' 'Start Antigravity remote access' 'Запустить удалённый интерфейс Antigravity' 'start-ag2r.sh'
write_desktop_file "$applications_dir/ag2r-status.desktop" 'AG2R Status' 'Состояние AG2R' 'Show connection details and passcode' 'Показать адреса подключения и пароль' 'status-ag2r.sh'
write_desktop_file "$applications_dir/ag2r-stop.desktop" 'Stop AG2R' 'Остановить AG2R' 'Stop the local AG2R server' 'Остановить локальный сервер AG2R' 'stop-ag2r.sh'

desktop_dir=$(get_desktop_dir)
if [[ -n $desktop_dir ]]; then
  mkdir -p -- "$desktop_dir"
  for desktop_file in "$applications_dir"/ag2r-{start,status,stop}.desktop; do
    desktop_copy="$desktop_dir/$(basename -- "$desktop_file")"
    install -m 0755 "$desktop_file" "$desktop_copy"
    if command -v gio >/dev/null 2>&1; then
      gio set "$desktop_copy" metadata::trusted true >/dev/null 2>&1 || true
    fi
  done
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_dir" >/dev/null 2>&1 || true
fi

show_message 'AG2R Setup' "AG2R applications were installed.\n\nUse 'Start AG2R' from the application menu." info
