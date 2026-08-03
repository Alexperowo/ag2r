#!/usr/bin/env bash
set -Eeuo pipefail

launcher_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec bash "$launcher_dir/scripts/linux/install-ag2r.sh" "$@"
