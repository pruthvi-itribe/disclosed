#!/usr/bin/env bash
#
# Mutation harness for the cold-start alert gate (Task 8).
#
# This gate is the only thing standing between a process restart and ~700
# Telegram messages hitting the user's phone. Task 6 made cold start drain on
# EVERY process start, so the drain is routine and the gate is load-bearing.
# Its tests are therefore worth proving rather than trusting: this script
# breaks the implementation one way at a time, re-runs the suite, and asserts
# the break is caught — then restores the original.
#
# Usage:  bash tools/mutation/alert-window-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Three outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap. Conflating the
#            two would raise a false alarm about the alert-storm guard.
#
# Safety mirrors tools/mutation/rollover-cadence-mutations.sh — see that file
# for the full rationale. In short: refuses to run on a dirty tree, INT/TERM
# exit rather than return so the script cannot resume past cleanup, every
# restore is verified byte-for-byte, and a jest run killed by a signal is
# reported as ABORTED rather than misread as a surviving mutation.


# ==============================================================================
# WHY COLOUR IS TURNED OFF, AND WHAT IT WAS SILENTLY COSTING
# ==============================================================================
#
# jest writes `\e[1mTests:` — it emits ANSI escapes even when its output is a
# pipe rather than a terminal. Every harness in this directory decides a
# mutation was CAUGHT with `grep -qE "^Tests:"`, and that pattern cannot match a
# line beginning with an escape. So the CAUGHT branch was unreachable in all
# twelve of them, and every killed mutation was filed as CRASHED instead.
#
# NOT FAIL-OPEN — a real test gap still reports SURVIVED — but it destroyed the
# distinction these harnesses exist to draw, to the point that the task list
# carried a note explaining that CRASHED "really means caught". It does not have
# to mean that.
#
# `FORCE_COLOR=0` rather than `NO_COLOR=1`: measured 2026-08-14, jest honours
# the first and ignores the second.
export FORCE_COLOR=0

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
AW=$ROOT/libs/filings/src/logic/alert-window.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
if ! git -C "$ROOT" ls-files --error-unmatch "$AW" >/dev/null 2>&1; then
  echo "refusing to run: $AW is not tracked by git." >&2
  exit 1
fi
if ! git -C "$ROOT" diff --quiet -- "$AW" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$AW"; then
  echo "refusing to run: uncommitted changes in the file this script mutates." >&2
  echo "  commit or stash them first — this script edits it in place." >&2
  git -C "$ROOT" status --short -- "$AW" >&2
  exit 1
fi

# --- backup: an unchecked cp here would mean mutating with no way back -------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$AW" "$BACKUP/alert-window.ts" || {
  echo "refusing to run: could not back up alert-window.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0

restore_verified() {
  local ok=0
  cp "$BACKUP/alert-window.ts" "$AW" || ok=1
  cmp -s "$BACKUP/alert-window.ts" "$AW" || ok=1
  return $ok
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: source could NOT be restored. Backup kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  cp $BACKUP/alert-window.ts $AW" >&2
    echo "or: git -C $ROOT checkout -- $AW" >&2
    exit 1
  fi
}

trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring source."; exit 130' INT TERM

# check <label> [extra jest args...]
check() {
  local label="$1"
  shift
  local out

  if cmp -s "$AW" "$BACKUP/alert-window.ts"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest alert-window "$@" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring source and stopping."
    exit 130
  fi

  # A mutation that does not type-check proves nothing: ts-jest fails the suite
  # before a single test runs. Note which way that cuts, because it is the
  # opposite of the intuitive guess. jest prints:
  #
  #     Test Suites: 1 failed, 1 total
  #     Tests:       0 total
  #
  # The `Tests:` line carries no failure count, so the `Tests:.*failed` grep
  # below does NOT match and control falls through to the else branch — the
  # verdict printed would be SURVIVED. A non-compiling mutant therefore raises a
  # false TEST GAP, never a false kill. That is the safe direction, but it is
  # misleading noise: someone would go hunting for a missing assertion that was
  # never missing.
  #
  # This branch does not prevent a false kill. It converts that confusing false
  # SURVIVED into an accurate diagnostic. It is still counted as a failure,
  # because a mutation that never ran is a mutation that proved nothing.
  #
  # (The same latent issue is documented at
  # tools/mutation/filing-repository-mutations.sh:35-44 and ledgered on Task 6.
  # Back-porting this branch to the other two harnesses is worthwhile.)
  # HERE-STRINGS, NOT `echo "$out" | grep -q`. With `set -o pipefail` in force,
  # `grep -q` exits at its first match, `echo` then dies of SIGPIPE, and the
  # PIPELINE reports 141 even though the pattern matched — so a verdict that DID
  # match reads as unmatched and falls through to the wrong branch. Observed on
  # tools/mutation/poller-mutations.sh, where a fully caught mutation was scored
  # HARNESS ERROR. A here-string is not a pipeline, so there is nothing to break.
  if grep -qE "Test suite failed to run" <<<"$out"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    echo "           (without this branch the verdict would misread as SURVIVED)"
    FAILURES=$((FAILURES + 1))
    restore_verified || on_exit
    return
  fi

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

echo "=== isWithinAlertWindow: the window boundary ==="

perl -0pi -e 's/return age < windowMs;/return age <= windowMs;/' "$AW"
check "boundary < becomes <= (a filing exactly windowMs old alerts)"

perl -0pi -e 's/return age < windowMs;/return age < windowMs \+ 1;/' "$AW"
check "boundary widened by one ms"

perl -0pi -e 's/return age < windowMs;/return age < 600000;/' "$AW"
check "windowMs ignored for a hardcoded ten minutes"

# A plausible future "fix" for the NaN hazard that belongs in config validation,
# not here: it silently papers over a malformed ALERT_WINDOW_MS instead of
# failing loudly, and quietly overrides a deliberate zero.
perl -0pi -e 's/return age < windowMs;/return age < (windowMs || 600000);/' "$AW"
check "windowMs defaulted in-function (masks a malformed config)"

echo ""
echo "=== isWithinAlertWindow: clock skew must not suppress a fresh alert ==="

perl -0pi -e 's/return age < windowMs;/return age >= 0 \&\& age < windowMs;/' "$AW"
check "negative age treated as stale (NSE clock ahead suppresses the alert)"

perl -0pi -e 's/return age < windowMs;/return Math.abs(age) < windowMs;/' "$AW"
check "age folded through zero (a far-future timestamp goes silent)"

perl -0pi -e 's/const age = now\.getTime\(\) - new Date\(filing\.disseminatedAt\)\.getTime\(\);/const age = new Date(filing.disseminatedAt).getTime() - now.getTime();/' "$AW"
check "age sign flipped (stale and fresh swap places)"

echo ""
echo "=== isWithinAlertWindow: disseminatedAt is the only admissible clock ==="

perl -0pi -e 's/new Date\(filing\.disseminatedAt\)/new Date(filing.ingestedAt)/' "$AW"
check "reads ingestedAt (every drained filing looks fresh — the storm)"

perl -0pi -e 's/new Date\(filing\.disseminatedAt\)/new Date(filing.announcedAt)/' "$AW"
check "reads announcedAt (the company clock, not the exchange clock)"

perl -0pi -e 's/const age = now\.getTime\(\)/const age = Date.now()/' "$AW"
check "reads the real clock instead of the supplied now"

perl -0pi -e 's/new Date\(filing\.disseminatedAt\)\.getTime\(\)/filing.disseminatedAt.getTime()/' "$AW"
check "defensive Date wrap dropped (a stored ISO string throws)"

echo ""
echo "=== partitionForAlerting: routing, order and immutability ==="

perl -0pi -e 's/\? alertable : silent/? silent : alertable/' "$AW"
check "partition branches swapped (the backfill alerts, the fresh goes quiet)"

perl -0pi -e 's/return \{ alertable, silent \};/return { alertable: [], silent: [] };/' "$AW"
check "both sides returned empty (the drain is silently dropped)"

perl -0pi -e 's/return \{ alertable, silent \};/return { alertable, silent: [] };/' "$AW"
check "silent side dropped (records vanish instead of being persisted)"

perl -0pi -e 's/\)\.push\(\n      filing,\n    \);/).unshift(\n      filing,\n    );/' "$AW"
check "push becomes unshift (output order reversed)"

perl -0pi -e 's/\)\.push\(\n      filing,\n    \);/).push(\n      { ...filing },\n    );/' "$AW"
check "filings copied instead of passed by reference"

perl -0pi -e 's/  for \(const filing of filings\) \{/  (filings as Filing[]).sort((a, b) => a.seqId - b.seqId);\n  for (const filing of filings) {/' "$AW"
check "input array sorted in place (mutates the caller batch)"

echo ""
echo "=== independence check ==="
echo "The ingestedAt misread — the storm bug itself — must die to the"
echo "cold-start storm suite ALONE, not only to the hand-written unit tests."
perl -0pi -e 's/new Date\(filing\.disseminatedAt\)/new Date(filing.ingestedAt)/' "$AW"
check "ingestedAt misread, storm suite only" -t "the cold-start storm at scale"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught; no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest alert-window 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
