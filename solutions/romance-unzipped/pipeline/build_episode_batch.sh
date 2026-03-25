#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_pipeline_shell_entrypoint.sh"

pipeline_exec_root_bin "${BASH_SOURCE[0]}" "$@"
