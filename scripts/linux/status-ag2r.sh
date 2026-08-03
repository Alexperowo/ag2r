#!/usr/bin/env bash
set -Eeuo pipefail

for argument in "$@"; do
  case "$argument" in
    --quiet) export AG2R_QUIET=true ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

if [[ ! -f $AG2R_ENV_PATH ]]; then
  show_message 'AG2R Status' "AG2R has not been configured yet.\n\nUse 'Start AG2R' first." info
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail 'curl was not found.'
load_server_location
health_json=$(curl -kfsS --connect-timeout 1 --max-time 2 "$AG2R_LOCAL_URL/health" 2>/dev/null || true)
if [[ $health_json != *'"status"'* ]]; then
  show_message 'AG2R Status' "AG2R is not running.\n\nUse 'Start AG2R'." info
  exit 0
fi

if grep -q '"cdpConnected"[[:space:]]*:[[:space:]]*true' <<< "$health_json"; then
  cdp_state=connected
else
  cdp_state='not connected'
fi

phone_addresses=''
while IFS= read -r address; do
  [[ -n $address ]] || continue
  phone_addresses+="$AG2R_PROTOCOL://$address:$AG2R_PORT"$'\n'
done < <(get_lan_addresses)
phone_addresses=${phone_addresses%$'\n'}
[[ -n $phone_addresses ]] || phone_addresses='No local network address was found.'
passcode=$(get_env_value APP_PASSWORD '(temporary passcode is shown at startup)')

show_message 'AG2R Status' "Server: running\nAntigravity: $cdp_state\nPasscode: $passcode\n\nComputer:\n$AG2R_LOCAL_URL\n\nPhone (same Wi-Fi):\n$phone_addresses\n\nA browser warning about the local certificate is expected on first access." info
