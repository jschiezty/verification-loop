#!/bin/sh
# ILLUSTRATIVE Claude Code Stop hook: before the agent says it is done, ask
# whether the required checks have a passing record at the current commit.
# If not, block the stop once and tell the agent what is missing.
#
# This keeps the agent honest about evidence. It is not a gate: the agent can
# edit this file, and the human can stop the session. Gates live in CI.
#
# Register it in .claude/settings.json (see settings.example.json next to this
# file). Set REQUIRED_CHECKS to the names your checks are recorded under.

REQUIRED_CHECKS="${REQUIRED_CHECKS:-unit}"

input=$(cat)

# If a stop hook already sent the agent back once, let it stop; it should
# report what is still missing instead of looping.
case "$input" in
  *'"stop_hook_active":true'* | *'"stop_hook_active": true'*) exit 0 ;;
esac

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
[ -f bin/vloop.mjs ] || exit 0

# Only ask when there is local work to account for: uncommitted changes, or
# commits the upstream branch does not have yet. A session that only answered
# questions should be able to stop.
dirty=$(git status --porcelain -- . ':(exclude).verification')
ahead=$(git rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo unknown)
if [ -z "$dirty" ] && [ "$ahead" = "0" ]; then
  exit 0
fi

if report=$(node bin/vloop.mjs evidence check --require "$REQUIRED_CHECKS" 2>&1); then
  exit 0
fi

{
  echo "Before finishing: the required checks ($REQUIRED_CHECKS) do not all have a passing record at the current commit."
  echo "$report"
  echo "Commit your work, run each check with 'node bin/vloop.mjs evidence run --check <name> -- <command>', and report the results."
  echo "If a check cannot run here, say which and why in your handoff instead of claiming it passed."
} >&2
exit 2
