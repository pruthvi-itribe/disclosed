#!/usr/bin/env bash
#
# Mutation harness for the poller circuit breaker (Task 9).
#
# This class is the only thing that turns a BLIND poller into a loud one. If
# NSE's Akamai bot protection starts challenging us, every poll 403s and the
# pipeline goes silent — which is indistinguishable from a quiet market. Two
# guarantees are load-bearing and both are easy to break without noticing:
#
#   1. It signals AT ALL when the poller has gone blind.
#   2. It signals ONCE per outage, not on every failure. At a 2s cadence a
#      re-signalling breaker sends ~1800 messages an hour, the operator mutes
#      the channel, and a muted channel is the same as no alerting at all.
#
# So its tests are worth proving rather than trusting: this script breaks the
# implementation one way at a time, re-runs the suite, and asserts the break is
# caught — then restores the original.
#
# Usage:  bash tools/mutation/circuit-breaker-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Three outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap. Conflating the
#            two would raise a false alarm about the blind-poller alarm itself.
#
# Safety mirrors tools/mutation/alert-window-mutations.sh — see that file for
# the full rationale. In short: refuses to run on a dirty tree, INT/TERM exit
# rather than return so the script cannot resume past cleanup, every restore is
# verified byte-for-byte, a jest run killed by a signal is reported as ABORTED
# rather than misread as a surviving mutation, and a mutation that does not
# type-check is reported as COMPILE rather than misread as SURVIVED.
#
# NOT covered by mutation, and why: the "no time-based behaviour" suite guards
# against a half-open state or timer being ADDED later. There is no clock in the
# implementation to mutate, so those tests cannot be exercised by breaking
# existing code — they are a ratchet against future code. That is deliberate,
# not a gap in this harness.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CB=$ROOT/apps/ingest/src/poller/circuit-breaker.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
if ! git -C "$ROOT" ls-files --error-unmatch "$CB" >/dev/null 2>&1; then
  echo "refusing to run: $CB is not tracked by git." >&2
  exit 1
fi
if ! git -C "$ROOT" diff --quiet -- "$CB" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$CB"; then
  echo "refusing to run: uncommitted changes in the file this script mutates." >&2
  echo "  commit or stash them first — this script edits it in place." >&2
  git -C "$ROOT" status --short -- "$CB" >&2
  exit 1
fi

# --- backup: an unchecked cp here would mean mutating with no way back -------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$CB" "$BACKUP/circuit-breaker.ts" || {
  echo "refusing to run: could not back up circuit-breaker.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0

restore_verified() {
  local ok=0
  cp "$BACKUP/circuit-breaker.ts" "$CB" || ok=1
  cmp -s "$BACKUP/circuit-breaker.ts" "$CB" || ok=1
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
    echo "  cp $BACKUP/circuit-breaker.ts $CB" >&2
    echo "or: git -C $ROOT checkout -- $CB" >&2
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

  if cmp -s "$CB" "$BACKUP/circuit-breaker.ts"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest circuit-breaker "$@" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring source and stopping."
    exit 130
  fi

  # A mutation that does not type-check proves nothing: ts-jest fails the suite
  # before a single test runs, and jest then prints a `Tests:` line with no
  # failure count, so the grep below would fall through to SURVIVED. See
  # tools/mutation/alert-window-mutations.sh for the full explanation. Counted
  # as a failure, because a mutation that never ran proved nothing.
  # HERE-STRINGS, NOT `echo "$out" | grep -q`. With `set -o pipefail` in force,
  # `grep -q` exits at its first match, `echo` then dies of SIGPIPE, and the
  # PIPELINE reports 141 even though the pattern matched — so a verdict that DID
  # match reads as unmatched and falls through to the wrong branch. Observed on
  # tools/mutation/poller-mutations.sh, where a fully caught mutation was scored
  # HARNESS ERROR. A here-string is not a pipeline, so there is nothing to break.
  if grep -qE "Test suite failed to run" <<<"$out"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
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

echo "=== threshold validation: the guard that must not admit NaN ==="

perl -0pi -e 's/if \(!Number\.isInteger\(threshold\) \|\| threshold < 1\)/if (threshold < 1)/' "$CB"
check "bare lower bound (NaN, Infinity and 1.5 all accepted)"

perl -0pi -e 's/if \(!Number\.isInteger\(threshold\) \|\| threshold < 1\)/if (!Number.isInteger(threshold))/' "$CB"
check "integer check only (0 and -1 accepted)"

perl -0pi -e 's/if \(!Number\.isInteger\(threshold\) \|\| threshold < 1\)/if (!Number.isInteger(threshold) || threshold < 0)/' "$CB"
check "lower bound off by one (0 accepted, breaker never trips)"

perl -0pi -e 's/    if \(!Number\.isInteger\(threshold\) \|\| threshold < 1\) \{\n      throw new Error\('"'"'CircuitBreaker threshold must be an integer >= 1'"'"'\);\n    \}\n//' "$CB"
check "validation removed entirely"

perl -0pi -e 's/must be an integer >= 1/is invalid/' "$CB"
check "error message drops the integer requirement (operator cannot act on it)"

echo ""
echo "=== the transition edge: signal ONCE, and signal AT ALL ==="

perl -0pi -e 's/if \(this\.failures >= this\.threshold && !this\.degraded\)/if (this.failures >= this.threshold)/' "$CB"
check "edge dropped (re-signals every 2s — the alert storm)"

perl -0pi -e 's/      this\.degraded = true;\n      return true;/      this.degraded = true;\n      return false;/' "$CB"
check "never signals (the operator is never told they are blind)"

perl -0pi -e 's/      this\.degraded = true;\n      return true;/      return true;/' "$CB"
check "degraded flag never set (signals forever, isDegraded always false)"

perl -0pi -e 's/this\.failures >= this\.threshold/this.failures > this.threshold/' "$CB"
check "trips one failure late (>= becomes >)"

perl -0pi -e 's/this\.failures >= this\.threshold/this.failures >= this.threshold - 1/' "$CB"
check "trips one failure early (threshold off by one)"

echo ""
echo "=== recovery must fully re-arm the breaker ==="

perl -0pi -e 's/    this\.failures = 0;\n    this\.degraded = false;/    this.failures = 0;/' "$CB"
check "success does not clear degraded (silent through the SECOND outage)"

perl -0pi -e 's/    this\.failures = 0;\n    this\.degraded = false;/    this.degraded = false;/' "$CB"
check "success does not clear the counter (next single failure re-trips)"

perl -0pi -e 's/    this\.failures = 0;\n    this\.degraded = false;\n//' "$CB"
check "recordSuccess is a no-op (intermittent 403s eventually page)"

echo ""
echo "=== the counter is unbounded BY DECISION (see the class note) ==="

perl -0pi -e 's/    this\.failures \+= 1;/    if (!this.degraded) this.failures += 1;/' "$CB"
check "counter stops at the threshold (outage duration is lost)"

perl -0pi -e 's/    return this\.failures;/    return Math.min(this.failures, this.threshold);/' "$CB"
check "counter clamped at read (reports 3 whether dark 6s or 6h)"

perl -0pi -e 's/    return this\.failures;/    return this.degraded ? this.threshold : this.failures;/' "$CB"
check "counter reports the threshold once degraded"

perl -0pi -e 's/    this\.failures \+= 1;/    this.failures += 2;/' "$CB"
check "counter drifts (duration in polls is wrong)"

echo ""
echo "=== state readers ==="

perl -0pi -e 's/    return this\.degraded;/    return !this.degraded;/' "$CB"
check "isDegraded inverted"

echo ""
echo "=== independence checks ==="
echo "Each guarantee must die to the suite that OWNS it, not merely to the"
echo "six hand-written tests from the brief. Otherwise deleting a suite would"
echo "silently cost coverage that looks covered."

perl -0pi -e 's/if \(this\.failures >= this\.threshold && !this\.degraded\)/if (this.failures >= this.threshold)/' "$CB"
check "alert storm, once-per-outage suite only" -t "signals exactly once per outage"

perl -0pi -e 's/    this\.failures \+= 1;/    if (!this.degraded) this.failures += 1;/' "$CB"
check "bounded counter, unbounded suite only" -t "the failure counter is unbounded by decision"

perl -0pi -e 's/if \(!Number\.isInteger\(threshold\) \|\| threshold < 1\)/if (threshold < 1)/' "$CB"
check "bare guard admits NaN, validation suite only" -t "threshold validation"

perl -0pi -e 's/    this\.failures = 0;\n    this\.degraded = false;/    this.failures = 0;/' "$CB"
check "no re-arm, recovery suite only" -t "recovery re-arms the signal"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught; no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest circuit-breaker 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
