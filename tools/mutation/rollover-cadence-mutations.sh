#!/usr/bin/env bash
#
# Mutation harness for the no-loss guarantee (Task 6, extended).
#
# Three pure modules carry that guarantee's timing logic and none of them can
# fail loudly:
#
#   * `detectRollover` decides whether the page rolled past us.
#   * `nextPollDelayMs` decides how often we look.
#   * `drain-schedule` decides when the day is reconciled anyway, and how many
#     IST days that reconciliation has to span. Both were missing entirely
#     until the whole-branch review: the rollover drain fires ONCE in 32 days
#     of recorded traffic, and a single-day drain cannot close a hole that
#     spans IST midnight.
#
# This script breaks the implementation one way at a time, re-runs the suite,
# and asserts the break is caught — then restores the original.
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
# NOT covered by mutation, and why:
#
#   - `IST_OFFSET_MS` itself. It moved to `libs/common` when five hand-written
#     copies were consolidated, and is mutated by
#     tools/mutation/common-mutations.sh — which runs it against the cadence and
#     drain-schedule suites specifically, so neither guarantee moved off a test.
#     The offset ARITHMETIC in each consumer is still mutated here.
#
#   - `drainRange`'s `Math.min(istDayStartMs(from), end)` clamp. Dropping it is
#     an EQUIVALENT mutant, verified rather than assumed: with an anchor stamped
#     ahead of the clock, `total` goes negative, `kept` follows it, the
#     `i >= 1` loop guard never runs, and `days.push(through)` still yields
#     exactly `[through]` — the same output, with `skippedDays` 0 either way.
#     The clamp is there so `total >= 1` is a stated invariant rather than an
#     emergent one; a test cannot distinguish it, and manufacturing one would
#     pin arithmetic nobody observes.
#
# Not run against a `git worktree` copy: a worktree has no node_modules, so
# jest/ts-jest would not resolve without symlinking it in, and the worktree
# would then need its own interrupt-safe cleanup. The clean-tree precondition
# plus verified restore covers the same risk without that complexity.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ROLL=$ROOT/libs/filings/src/logic/rollover.ts
CAD=$ROOT/libs/filings/src/logic/cadence.ts
DRAIN=$ROOT/libs/filings/src/logic/drain-schedule.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
for f in "$ROLL" "$CAD" "$DRAIN"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "refusing to run: $f is not tracked by git." >&2
    exit 1
  fi
done
if ! git -C "$ROOT" diff --quiet -- "$ROLL" "$CAD" "$DRAIN" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$ROLL" "$CAD" "$DRAIN"; then
  echo "refusing to run: uncommitted changes in the files this script mutates." >&2
  echo "  commit or stash them first — this script edits them in place." >&2
  git -C "$ROOT" status --short -- "$ROLL" "$CAD" "$DRAIN" >&2
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
cp "$DRAIN" "$BACKUP/drain-schedule.ts" || {
  echo "refusing to run: could not back up drain-schedule.ts." >&2
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
  cp "$BACKUP/drain-schedule.ts" "$DRAIN" || ok=1
  cmp -s "$BACKUP/rollover.ts" "$ROLL" || ok=1
  cmp -s "$BACKUP/cadence.ts" "$CAD" || ok=1
  cmp -s "$BACKUP/drain-schedule.ts" "$DRAIN" || ok=1
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
    echo "  cp $BACKUP/rollover.ts       $ROLL" >&2
    echo "  cp $BACKUP/cadence.ts        $CAD" >&2
    echo "  cp $BACKUP/drain-schedule.ts $DRAIN" >&2
    echo "or: git -C $ROOT checkout -- $ROLL $CAD $DRAIN" >&2
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
  *drain-schedule.ts) backup_for=$BACKUP/drain-schedule.ts ;;
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

  # HERE-STRINGS, NOT `echo "$out" | grep -q`. With `set -o pipefail` in force,
  # `grep -q` exits at its first match, `echo` then dies of SIGPIPE, and the
  # PIPELINE reports 141 even though the pattern matched — so a verdict that DID
  # match reads as unmatched and falls through to the wrong branch. Observed on
  # tools/mutation/poller-mutations.sh, where a fully caught mutation was scored
  # HARNESS ERROR. A here-string is not a pipeline, so there is nothing to break.
  if grep -qE "Tests:.*failed" <<<"$out"; then
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

perl -0pi -e 's/const istHour = new Date\(now\.getTime\(\) \+ IST_OFFSET_MS\)\.getUTCHours\(\);/const istHour = new Date(now.setTime(now.getTime() + IST_OFFSET_MS)).getUTCHours();/' "$CAD"
check "shift mutates the caller Date" "$CAD" cadence

echo ""
echo "=== the scheduled drains: reconciliation ran once per process ==="

perl -0pi -e 's/  if \(lastDrainAtMs === null\) return .periodic.;/  if (lastDrainAtMs === null) return null;/' "$DRAIN"
check "a null last-drain is not due (a restart waits out a full interval)" "$DRAIN" drain-schedule

perl -0pi -e "s/  return now\.getTime\(\) - lastDrainAtMs >= drainIntervalMs \? 'periodic' : null;/  return now.getTime() - lastDrainAtMs > drainIntervalMs ? 'periodic' : null;/" "$DRAIN"
check "interval >= becomes > (the exact-interval tick is skipped)" "$DRAIN" drain-schedule

perl -0pi -e "s/  if \(isAtOrAfterClosingMinute\(now\) && istDayKey\(now\) !== lastClosingDay\) \{\n    return 'closing';\n  \}\n\n//" "$DRAIN"
check "closing drain removed (the day is never reconciled at 23:30)" "$DRAIN" drain-schedule

perl -0pi -e 's/  if \(isAtOrAfterClosingMinute\(now\) && istDayKey\(now\) !== lastClosingDay\) \{/  if (isAtOrAfterClosingMinute(now)) {/' "$DRAIN"
check "closing drain not once per day (re-closes on every tick after 23:30)" "$DRAIN" drain-schedule

perl -0pi -e 's/export const CLOSING_DRAIN_MINUTE_IST = 30;/export const CLOSING_DRAIN_MINUTE_IST = 0;/' "$DRAIN"
check "closing minute moved to 23:00 (closes while the window is still open)" "$DRAIN" drain-schedule

perl -0pi -e 's/  istMinuteOfDay\(now\) >= CLOSING_DRAIN_MINUTE_OF_DAY;/  istMinuteOfDay(now) === CLOSING_DRAIN_MINUTE_OF_DAY;/' "$DRAIN"
check "closing test is equality (any tick straddling 23:30 misses it)" "$DRAIN" drain-schedule

echo ""
echo "=== the drain range: a hole can span IST midnight ==="

perl -0pi -e 's/  const start = from === null \? end : Math\.min\(istDayStartMs\(from\), end\);/  const start = end;/' "$DRAIN"
check "range collapsed to today (yesterday's tail is never fetched)" "$DRAIN" drain-schedule

perl -0pi -e 's/  const kept = Math\.min\(total, Math\.max\(maxDays, 1\)\);/  const kept = total;/' "$DRAIN"
check "bound removed (a month of downtime pulls a month in one poll)" "$DRAIN" drain-schedule

perl -0pi -e 's/  const kept = Math\.min\(total, Math\.max\(maxDays, 1\)\);/  const kept = Math.min(total, maxDays);/' "$DRAIN"
check "bound may reach zero (a drain that fetches nothing reports success)" "$DRAIN" drain-schedule

perl -0pi -e 's/  return \{ days, skippedDays: total - kept \};/  return { days, skippedDays: 0 };/' "$DRAIN"
check "dropped days never reported (an un-reconciled week looks complete)" "$DRAIN" drain-schedule

perl -0pi -e 's/  days\.push\(through\);/  days.push(new Date(end + MS_PER_DAY \/ 2));/' "$DRAIN"
check "final day is a stand-in, not the instant supplied" "$DRAIN" drain-schedule

perl -0pi -e 's/    days\.push\(new Date\(end - i \* MS_PER_DAY \+ MS_PER_DAY \/ 2\)\);/    days.push(new Date(end - i * MS_PER_DAY));/' "$DRAIN"
check "intermediate instants sit on the IST midnight boundary" "$DRAIN" drain-schedule

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

cd "$ROOT" && npx jest rollover cadence drain-schedule 2>&1 |
  grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
