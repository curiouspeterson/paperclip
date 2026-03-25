#!/usr/bin/env bash
set -euo pipefail

pipeline_exec_root_bin() {
  local wrapper_path="$1"
  shift

  local wrapper_name
  local repo_root
  wrapper_name="$(basename "$wrapper_path")"
  repo_root="$(cd "$(dirname "$wrapper_path")/../../.." && pwd)"

  exec "$repo_root/bin/$wrapper_name" "$@"
}
