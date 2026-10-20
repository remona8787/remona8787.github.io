#!/usr/bin/env bash
# Commits everything in <dir> to <branch> as github-actions[bot] and pushes it. Idempotent: no change, no commit.
# History stays bounded: when the branch already has more than <squash_over> commits (0 = never), the new commit is
# made without parents (a snapshot of the whole tree) and pushed with a lease on the old tip; if the branch is
# protected against that, it falls back to an ordinary push.
#   commit-push.sh <dir> <branch> <message> [squash_over]
set -euo pipefail
dir=$1 branch=$2 message=$3 squash_over=${4:-0}
cd "$dir"
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git add -A
if git diff --cached --quiet; then
  echo "commit-push: nothing to commit on $branch"
  exit 0
fi
git commit -q -m "$message"
old=$(git rev-parse -q --verify "refs/remotes/origin/$branch" || true)
if [ "$squash_over" -gt 0 ] && [ -n "$old" ]; then
  git fetch -q --depth="$((squash_over + 1))" origin "+refs/heads/$branch:refs/remotes/origin/$branch" || true
  if [ "$(git rev-parse "refs/remotes/origin/$branch")" = "$old" ]; then
    count=$(git rev-list --count "refs/remotes/origin/$branch")
    if [ "$count" -gt "$squash_over" ]; then
      snapshot=$(git commit-tree "HEAD^{tree}" -m "$message" -m "History compacted: the previous $count+ commits are replaced by this snapshot.")
      if git push -q --force-with-lease="refs/heads/$branch:$old" origin "$snapshot:refs/heads/$branch"; then
        git reset -q --hard "$snapshot"
        echo "commit-push: $branch compacted to $snapshot"
        exit 0
      fi
      echo "commit-push: compaction refused, pushing normally"
    fi
  fi
fi
for attempt in 1 2 3; do
  if git push -q origin "HEAD:refs/heads/$branch"; then
    echo "commit-push: pushed $(git rev-parse --short HEAD) to $branch"
    exit 0
  fi
  sleep $((attempt * 15))
done
echo "commit-push: push to $branch failed" >&2
exit 1
