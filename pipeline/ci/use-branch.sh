#!/usr/bin/env bash
# Switches a checkout made by actions/checkout (any ref, credentials persisted) to <branch>, shallow.
# A branch that does not exist yet (the data branch before the first collect) becomes an empty orphan branch, so the
# directory never keeps the files of the ref it was checked out at.
#   use-branch.sh <dir> <branch>
# Prints "exists=true|false" (also to $GITHUB_OUTPUT on Actions).
set -euo pipefail
dir=$1 branch=$2
cd "$dir"
if git fetch -q --depth=1 origin "+refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null; then
  git checkout -q -B "$branch" "refs/remotes/origin/$branch"
  exists=true
else
  git checkout -q --orphan "$branch"
  git rm -rqf --cached . >/dev/null 2>&1 || true
  git clean -qfdx
  exists=false
fi
echo "exists=$exists"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "exists=$exists" >> "$GITHUB_OUTPUT"; fi
