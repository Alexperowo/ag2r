#!/usr/bin/env bash
set -Eeuo pipefail

test_dir=$(mktemp -d)
: > "$test_dir/.ag2r-launcher-test"
cleanup() {
  if [[ -f $test_dir/runtime/server.process ]]; then
    AG2R_ENV_PATH="$test_dir/test.env" \
    AG2R_RUNTIME_DIR="$test_dir/runtime" \
    AG2R_LOGS_DIR="$test_dir/logs" \
    AG2R_QUIET=true \
      bash "$project_root/scripts/linux/stop-ag2r.sh" --quiet >/dev/null 2>&1 || true
  fi
  if [[ -f $test_dir/.ag2r-launcher-test ]]; then
    rm -rf -- "$test_dir"
  fi
}
trap cleanup EXIT

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
for script in "$project_root/install-ag2r.sh" "$project_root/scripts/linux/"*.sh; do
  bash -n "$script"
done

mkdir -p -- "$test_dir/data" "$test_dir/desktop" "$test_dir/runtime" "$test_dir/logs"
AG2R_DATA_HOME="$test_dir/data" \
AG2R_DESKTOP_DIR="$test_dir/desktop" \
AG2R_RUNTIME_DIR="$test_dir/runtime" \
AG2R_LOGS_DIR="$test_dir/logs" \
AG2R_QUIET=true \
  bash "$project_root/install-ag2r.sh" --quiet --skip-dependencies >/dev/null

for name in start status stop; do
  desktop_file="$test_dir/data/applications/ag2r-$name.desktop"
  [[ -x $desktop_file ]]
  grep -Fq 'Terminal=false' "$desktop_file"
  [[ -x $test_dir/desktop/ag2r-$name.desktop ]]
done
[[ -f $test_dir/data/icons/hicolor/192x192/apps/ag2r.png ]]
grep -Fq 'Name[ru]=Запустить AG2R' "$test_dir/data/applications/ag2r-start.desktop"

cat > "$test_dir/test.env" <<'EOF'
PORT=39001
CDP_HOST=127.0.0.1
CDP_PORT=65000
AUTH_ENABLED=true
APP_PASSWORD=linux-integration-passcode
SESSION_SECRET=linux-integration-secret-with-at-least-32-characters
POLL_INTERVAL_MS=500
TUNNEL_ENABLED=false
HTTP_ONLY=true
EOF
chmod 600 "$test_dir/test.env"

launcher_env=(
  "AG2R_ENV_PATH=$test_dir/test.env"
  "AG2R_RUNTIME_DIR=$test_dir/runtime"
  "AG2R_LOGS_DIR=$test_dir/logs"
  'AG2R_QUIET=true'
)
env "${launcher_env[@]}" bash "$project_root/scripts/linux/start-ag2r.sh" --quiet --skip-antigravity --no-browser >/dev/null
curl -fsS 'http://127.0.0.1:39001/health' | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
env "${launcher_env[@]}" bash "$project_root/scripts/linux/status-ag2r.sh" --quiet >/dev/null
env "${launcher_env[@]}" bash "$project_root/scripts/linux/stop-ag2r.sh" --quiet >/dev/null

if curl -fsS --connect-timeout 1 --max-time 2 'http://127.0.0.1:39001/health' >/dev/null 2>&1; then
  printf 'AG2R server is still running after stop.\n' >&2
  exit 1
fi

printf 'Linux launcher checks passed.\n'
