#!/usr/bin/env bash

set -euo pipefail

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-upstream}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-master}"
BASE_BRANCH="${BASE_BRANCH:-master}"
INTEGRATION_BRANCH="${INTEGRATION_BRANCH:-instance/main}"

usage() {
  cat <<EOF
Usage: $(basename "$0")

Synchronize the long-lived Paperclip integration branch with upstream.

Environment overrides:
  UPSTREAM_REMOTE      default: upstream
  UPSTREAM_BRANCH      default: master
  BASE_BRANCH          default: master
  INTEGRATION_BRANCH   default: instance/main

This script:
  1. fetches upstream and origin
  2. fast-forwards \$BASE_BRANCH to \$UPSTREAM_REMOTE/\$UPSTREAM_BRANCH
  3. rebases \$INTEGRATION_BRANCH onto \$BASE_BRANCH

Requirements:
  - clean worktree
  - configured remotes
  - no local commits on \$BASE_BRANCH
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "error: run this script from inside a git repository" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: worktree is dirty; commit, stash, or discard changes first" >&2
  exit 1
fi

if ! git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1; then
  echo "error: missing remote '$UPSTREAM_REMOTE'" >&2
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "error: missing remote 'origin'" >&2
  exit 1
fi

echo "[git-sync] fetching remotes"
git fetch "$UPSTREAM_REMOTE" --prune
git fetch origin --prune

if ! git rev-parse --verify "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" >/dev/null 2>&1; then
  echo "error: missing ref '${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}'" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${BASE_BRANCH}"; then
  echo "[git-sync] updating ${BASE_BRANCH} from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
  git switch "$BASE_BRANCH" >/dev/null
  git merge --ff-only "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
else
  echo "[git-sync] creating ${BASE_BRANCH} from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"
  git switch -c "$BASE_BRANCH" "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" >/dev/null
fi

if git rev-list --left-only --count "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}...${BASE_BRANCH}" | grep -qv '^0$'; then
  echo "error: ${BASE_BRANCH} contains commits that are not in ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" >&2
  echo "error: realign ${BASE_BRANCH} manually before using this workflow" >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/heads/${INTEGRATION_BRANCH}"; then
  echo "[git-sync] rebasing ${INTEGRATION_BRANCH} onto ${BASE_BRANCH}"
  git switch "$INTEGRATION_BRANCH" >/dev/null
else
  echo "[git-sync] creating ${INTEGRATION_BRANCH} from ${BASE_BRANCH}"
  git switch -c "$INTEGRATION_BRANCH" "$BASE_BRANCH" >/dev/null
fi

git rebase "$BASE_BRANCH"

echo
echo "[git-sync] sync complete"
echo "next steps:"
echo "  git push origin ${INTEGRATION_BRANCH} --force-with-lease"
echo "  rebase active feature branches onto ${INTEGRATION_BRANCH}"
