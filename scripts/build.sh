#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 X.Y.Z" >&2
  exit 2
fi

release_version=$1
script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_root=$(cd -- "$script_directory/.." && pwd)
bundle_directory="$project_root/src-tauri/target/release/bundle/appimage"
temporary_config=$(mktemp "${TMPDIR:-/tmp}/hypermd-tauri-XXXXXXXX.json")

cleanup() {
  rm -f -- "$temporary_config"
}
trap cleanup EXIT

printf '{"version":"%s"}\n' "$release_version" > "$temporary_config"

cd -- "$project_root"

if [[ ! -d node_modules ]]; then
  npm ci
fi

npm run tauri -- build --bundles appimage --ci --config "$temporary_config"

mapfile -d '' appimages < <(
  find "$bundle_directory" -maxdepth 1 -type f -name '*.AppImage' -print0
)

if [[ ${#appimages[@]} -ne 1 ]]; then
  echo "Expected exactly one AppImage from this build, but found ${#appimages[@]}." >&2
  exit 1
fi

realpath -- "${appimages[0]}"
