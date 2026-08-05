#!/usr/bin/env bash
#
# Mutation harness for the no-loss guarantee (Task 6).
#
# `detectRollover` is the function that guarantees no filing is silently lost,
# so its tests are the ones most worth proving. This script breaks the
# implementation one way at a time, re-runs the suite, and asserts the break is
# caught — then restores the original.
#
# Usage:  bash tools/mutation/rollover-cadence-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Three outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap. Conflating the
#            two would raise a false alarm about the system's central property.
#
# Safety, in order of importance — this script edits tracked source in place:
#   * It refuses to run unless the two target files are clean in git, so a
#     failed restore can always be recovered with `git checkout` and it can
#     never destroy uncommitted work. This also stops `nest start --watch` from
#     compiling mutated source into a running dev server.
#   * INT/TERM exit rather than return. A bash trap handler that returns lets
#     the script RESUME at the next statement, which would re-apply mutations
#     after cleanup had already run — leaving a mutated tree behind while still
#     reporting success.
#   * Every restore is verified by comparison against the backup. The backup is
#     deleted only once the restore is confirmed byte-identical; if it is not,
#     the backup is kept and its path printed.
#
# Not run against a `git worktree` copy: a worktree has no node_modules, so
# jest/ts-jest would not resolve without symlinking it in, and the worktree
# would then need its own interrupt-safe cleanup. The clean-tree precondition
# plus verified restore covers the same risk without that complexity.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ROLL=$ROOT/libs/filings/src/logic/rollover.ts
CAD=$ROOT/libs/filings/src/logic/cadence.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
for f in "$ROLL" "$CAD"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "refusing to run: $f is not tracked by git." >&2
    exit 1
  fi
done
if ! git -C "$ROOT" diff --quiet -- "$ROLL" "$CAD" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$ROLL" "$CAD"; then
  echo "refusing to run: uncommitted changes in the files this script mutates." >&2
  echo "  commit or stash them first — this script edits them in place." >&2
  git -C "$ROOT" status --short -- "$ROLL" "$CAD" >&2
  exit 1
fi

# --- backups: an unchecked cp here would mean mutating with no way back ------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$ROLL" "$BACKUP/rollover.ts" || {
  echo "refusing to run: could not back up rollover.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}
cp "$CAD" "$BACKUP/cadence.ts" || {
  echo "refusing to run: could not back up cadence.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0

# Restore both files and prove it worked. Non-zero if either file does not end
# up byte-identical to its backup.
restore_verified() {
  local ok=0
  cp "$BACKUP/rollover.ts" "$ROLL" || ok=1
  cp "$BACKUP/cadence.ts" "$CAD" || ok=1
  cmp -s "$BACKUP/rollover.ts" "$ROLL" || ok=1
  cmp -s "$BACKUP/cadence.ts" "$CAD" || ok=1
  return $ok
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: sources could NOT be restored. Backups kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  cp $BACKUP/rollover.ts $ROLL" >&2
    echo "  cp $BACKUP/cadence.ts  $CAD" >&2
    echo "or: git -C $ROOT checkout -- $ROLL $CAD" >&2
    exit 1
  fi
}

# `exit` inside the INT/TERM handler is what stops the script resuming at the
# next statement; the EXIT trap then does the restore. Nothing is deleted on
# this path until that restore has been verified.
trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring sources."; exit 130' INT TERM

# check <label> <mutated-file> <jest-pattern> [extra jest args...]
check() {
  local label="$1" file="$2" pattern="$3"
  shift 3
  local backup_for out

  case "$file" in
  *rollover.ts) backup_for=$BACKUP/rollover.ts ;;
  *) backup_for=$BACKUP/cadence.ts ;;
  esac

  # Did the mutation actually apply? An unchanged file means the perl pattern
  # no longer matches the source, not that the tests missed anything.
  if cmp -s "$file" "$backup_for"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest "$pattern" "$@" 2>&1)
  local rc=$?

  # A test runner killed by a signal produced no verdict, so it must never be
  # read as one. Node installs its own SIGINT handler, so a Ctrl-C can kill
  # jest even in contexts where the surrounding shell ignores the signal and
  # survives (a non-interactive background launch inherits SIGINT ignored, and
  # a signal ignored on entry cannot be trapped). Without this guard that case
  # prints "SURVIVED <-- TEST GAP" — a false alarm about the no-loss guarantee
  # caused purely by the interrupt.
  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring sources and stopping."
    exit 130
  fi

  if echo "$out" | grep -qE "Tests:.*failed"; then
    echo "CAUGHT   | $label"
    echo "$out" | grep -E "^\s+●\s" | grep -v Console | sed 's/^/           /' |
      sort -u | head -4
  else
    echo "SURVIVED | $label   <-- TEST GAP"
    FAILURES=$((FAILURES + 1))
  fi

  restore_verified || on_exit
}

echo "=== rollover: the overlap rule ==="

perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: oldestOnPage >= cursor/' "$ROLL"
check "overlap > becomes >= (oldest==cursor wrongly drains)" "$ROLL" rollover

perl -0pi -e 's/descending\.filter\(\(id\) => id > cursor\)/descending.filter((id) => id >= cursor)/' "$ROLL"
check "new-id filter > becomes >= (re-emits the cursor record)" "$ROLL" rollover

perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: oldestOnPage > cursor + 1/' "$ROLL"
check "page must resume at exactly cursor+1 (contiguity, cross-page form)" "$ROLL" rollover

# The same wrong model, applied within the page instead of across the boundary.
perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: descending.some((id, i) => i > 0 \&\& descending[i - 1] - id > 1)/' "$ROLL"
check "contiguity used as the completeness signal (within-page form)" "$ROLL" rollover

echo ""
echo "=== rollover: structure and cold start ==="

perl -0pi -e 's/const descending = \[\.\.\.pageSeqIds\]\.sort/const descending = (pageSeqIds as number[]).sort/' "$ROLL"
check "sort in place (mutates the caller page)" "$ROLL" rollover

perl -0pi -e 's/return \{ newSeqIds: descending, holeDetected: true \};/return { newSeqIds: descending, holeDetected: false };/' "$ROLL"
check "cold start no longer drains" "$ROLL" rollover

# Restores the guard ordering this task deliberately changed: empty-page check
# ahead of the cold-start check, which stops a cold start on an empty page from
# draining.
perl -0pi -e 's/  if \(cursor === null\) \{\n(.*?\n)*?  \}\n\n  if \(descending\.length === 0\) \{\n    return \{ newSeqIds: \[\], holeDetected: false \};\n  \}\n/  if (descending.length === 0) {\n    return { newSeqIds: [], holeDetected: false };\n  }\n\n  if (cursor === null) {\n    return { newSeqIds: descending, holeDetected: true };\n  }\n/' "$ROLL"
check "empty-page check ordered before cold-start check" "$ROLL" rollover

echo ""
echo "=== cadence ==="

perl -0pi -e 's/istHour < WINDOW_CLOSE_HOUR_IST/istHour <= WINDOW_CLOSE_HOUR_IST/' "$CAD"
check "window close < becomes <= (open an extra hour)" "$CAD" cadence

perl -0pi -e 's/istHour >= WINDOW_OPEN_HOUR_IST/istHour > WINDOW_OPEN_HOUR_IST/' "$CAD"
check "window open >= becomes > (closed for the 07:00 hour)" "$CAD" cadence

perl -0pi -e 's/if \(newCount >= burstThreshold\)/if (newCount > burstThreshold)/' "$CAD"
check "burst >= becomes > (threshold-exact burst missed)" "$CAD" cadence

perl -0pi -e 's/const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/const IST_OFFSET_MS = 0;/' "$CAD"
check "IST offset dropped (window read in UTC)" "$CAD" cadence

perl -0pi -e 's/const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/const IST_OFFSET_MS = 5 * 60 * 60 * 1000;/' "$CAD"
check "IST offset rounded to 5h (loses the half hour)" "$CAD" cadence

perl -0pi -e 's/const istHour = new Date\(now\.getTime\(\) \+ IST_OFFSET_MS\)\.getUTCHours\(\);/const istHour = new Date(now.setTime(now.getTime() + IST_OFFSET_MS)).getUTCHours();/' "$CAD"
check "shift mutates the caller Date" "$CAD" cadence

echo ""
echo "=== independence check ==="
echo "The cursor+1 contiguity form must die to the enumerated sweep ALONE, not"
echo "only to the hand-written single-page tests."
perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: oldestOnPage > cursor + 1/' "$ROLL"
check "cursor+1 form, sweep tests only" "$ROLL" rollover \
  -t "invariants over a fixed, enumerated case space"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught; no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest rollover cadence 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
