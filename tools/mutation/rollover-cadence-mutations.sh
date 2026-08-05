#!/usr/bin/env bash
#
# Mutation harness for the no-loss guarantee (Task 6).
#
# `detectRollover` is the function that guarantees no filing is silently lost,
# so its tests are the ones most worth proving. This script breaks the
# implementation one way at a time, re-runs the suite, and asserts the break is
# caught — then restores the original. A SURVIVED line is a test gap.
#
# Usage:  bash tools/mutation/rollover-cadence-mutations.sh
# Exit:   0 if every mutation was caught, 1 otherwise.
#
# The implementation files are restored from backups on every exit path,
# including interrupts. Run it on a clean tree so a crash is easy to recover.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ROLL=$ROOT/libs/filings/src/logic/rollover.ts
CAD=$ROOT/libs/filings/src/logic/cadence.ts

BACKUP=$(mktemp -d)
cp "$ROLL" "$BACKUP/rollover.ts"
cp "$CAD" "$BACKUP/cadence.ts"

FAILURES=0

restore() {
  cp "$BACKUP/rollover.ts" "$ROLL"
  cp "$BACKUP/cadence.ts" "$CAD"
}
cleanup() {
  restore
  rm -rf "$BACKUP"
}
trap cleanup EXIT INT TERM

# check <label> <jest-pattern> [extra-jest-args...]
check() {
  local label="$1" pattern="$2"
  shift 2
  local out
  out=$(cd "$ROOT" && npx jest "$pattern" "$@" 2>&1)
  if echo "$out" | grep -qE "Tests:.*failed"; then
    echo "CAUGHT   | $label"
    echo "$out" | grep -E "^\s+●\s" | grep -v Console | sed 's/^/           /' \
      | sort -u | head -4
  else
    echo "SURVIVED | $label   <-- TEST GAP"
    FAILURES=$((FAILURES + 1))
  fi
  restore
}

echo "=== rollover: the overlap rule ==="

perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: oldestOnPage >= cursor/' "$ROLL"
check "overlap > becomes >= (oldest==cursor wrongly drains)" rollover

perl -0pi -e 's/descending\.filter\(\(id\) => id > cursor\)/descending.filter((id) => id >= cursor)/' "$ROLL"
check "new-id filter > becomes >= (re-emits the cursor record)" rollover

perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: oldestOnPage > cursor + 1/' "$ROLL"
check "page must resume at exactly cursor+1 (contiguity, cross-page form)" rollover

# The same wrong model, applied within the page instead of across the boundary.
perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: descending.some((id, i) => i > 0 \&\& descending[i - 1] - id > 1)/' "$ROLL"
check "contiguity used as the completeness signal (within-page form)" rollover

echo ""
echo "=== rollover: structure and cold start ==="

perl -0pi -e 's/const descending = \[\.\.\.pageSeqIds\]\.sort/const descending = (pageSeqIds as number[]).sort/' "$ROLL"
check "sort in place (mutates the caller page)" rollover

perl -0pi -e 's/return \{ newSeqIds: descending, holeDetected: true \};/return { newSeqIds: descending, holeDetected: false };/' "$ROLL"
check "cold start no longer drains" rollover

# Restores the guard ordering this task deliberately changed: empty-page check
# ahead of the cold-start check, which stops a cold start on an empty page from
# draining.
perl -0pi -e 's/  if \(cursor === null\) \{\n(.*?\n)*?  \}\n\n  if \(descending\.length === 0\) \{\n    return \{ newSeqIds: \[\], holeDetected: false \};\n  \}\n/  if (descending.length === 0) {\n    return { newSeqIds: [], holeDetected: false };\n  }\n\n  if (cursor === null) {\n    return { newSeqIds: descending, holeDetected: true };\n  }\n/' "$ROLL"
check "empty-page check ordered before cold-start check" rollover

echo ""
echo "=== cadence ==="

perl -0pi -e 's/istHour < WINDOW_CLOSE_HOUR_IST/istHour <= WINDOW_CLOSE_HOUR_IST/' "$CAD"
check "window close < becomes <= (open an extra hour)" cadence

perl -0pi -e 's/istHour >= WINDOW_OPEN_HOUR_IST/istHour > WINDOW_OPEN_HOUR_IST/' "$CAD"
check "window open >= becomes > (closed for the 07:00 hour)" cadence

perl -0pi -e 's/if \(newCount >= burstThreshold\)/if (newCount > burstThreshold)/' "$CAD"
check "burst >= becomes > (threshold-exact burst missed)" cadence

perl -0pi -e 's/const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/const IST_OFFSET_MS = 0;/' "$CAD"
check "IST offset dropped (window read in UTC)" cadence

perl -0pi -e 's/const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/const IST_OFFSET_MS = 5 * 60 * 60 * 1000;/' "$CAD"
check "IST offset rounded to 5h (loses the half hour)" cadence

perl -0pi -e 's/const istHour = new Date\(now\.getTime\(\) \+ IST_OFFSET_MS\)\.getUTCHours\(\);/const istHour = new Date(now.setTime(now.getTime() + IST_OFFSET_MS)).getUTCHours();/' "$CAD"
check "shift mutates the caller Date" cadence

echo ""
echo "=== independence check ==="
echo "The cursor+1 contiguity form must die to the enumerated sweep ALONE, not"
echo "only to the single hand-written 'newer by exactly one' test."
perl -0pi -e 's/holeDetected: oldestOnPage > cursor/holeDetected: oldestOnPage > cursor + 1/' "$ROLL"
check "cursor+1 form, sweep tests only" rollover \
  -t "invariants over a fixed, enumerated case space"

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "RESULT: all mutations caught, no test gaps."
else
  echo "RESULT: $FAILURES mutation(s) SURVIVED — see the gaps above."
fi

cd "$ROOT" && npx jest rollover cadence 2>&1 | grep -E "^(Tests|Test Suites):"
exit "$FAILURES"
