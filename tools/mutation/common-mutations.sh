#!/usr/bin/env bash
#
# Mutation harness for libs/common — the two things everything else shares.
#
# This library exists because both of them had been written out by hand in
# several places and one copy was wrong. Consolidating them concentrates the
# blast radius: a single character here is now wrong in the adapter, the
# poller, the alert service, the formatter and the Telegram client at once. So
# the mutations below are run against the suites that actually depend on them,
# not only against this library's own tests.
#
#   1. THE ERROR DESCRIBERS. Every caller is a catch block, so nothing in
#      describe-error.ts may throw. `String()` is not total — a null-prototype
#      object raises "Cannot convert object to primitive value" — and the copy
#      that got this wrong lived in `nse.adapter.ts`, inside the catch whose job
#      is to stop ONE bad record discarding a 20-record page. Restoring it
#      reproduces the lost page by execution, not by argument.
#   2. THE IST OFFSET. Every timestamp this system reads, buckets or renders is
#      IST. A wrong offset never fails loudly: it shifts a filing onto the wrong
#      calendar day, moves the drain range, opens the filing window an hour
#      early, or renders every alert half an hour out — all of them plausible.
#
# Usage:  bash tools/mutation/common-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   CRASHED  the mutation killed the test runner before it reported anything, so
#            there is no `Tests:` line to read. The suite is red, so the
#            guarantee IS covered, but it is labelled apart from an assertion
#            failure — "no verdict" must never be silently rounded to either a
#            kill or a survivor.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap.
#
# Safety mirrors the other harnesses in this directory: it refuses to run on a
# dirty tree, INT/TERM exit rather than return so the script cannot resume past
# cleanup, every restore is verified byte-for-byte, a jest run killed by a
# signal is reported as ABORTED, and a mutation that does not type-check is
# reported as COMPILE rather than misread as SURVIVED.
#
# Tally, so a report can quote it without recounting: 11 mutations plus 6
# independence checks = 17 `check` calls.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ERR=$ROOT/libs/common/src/describe-error.ts
IST=$ROOT/libs/common/src/ist.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
for f in "$ERR" "$IST"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "refusing to run: $f is not tracked by git." >&2
    exit 1
  fi
done
if ! git -C "$ROOT" diff --quiet -- "$ERR" "$IST" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$ERR" "$IST"; then
  echo "refusing to run: uncommitted changes in the files this script mutates." >&2
  echo "  commit or stash them first — this script edits them in place." >&2
  git -C "$ROOT" status --short -- "$ERR" "$IST" >&2
  exit 1
fi

# --- backups: an unchecked cp here would mean mutating with no way back ------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$ERR" "$BACKUP/describe-error.ts" || {
  echo "refusing to run: could not back up describe-error.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}
cp "$IST" "$BACKUP/ist.ts" || {
  echo "refusing to run: could not back up ist.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0
CRASHES=0

# Every suite that depends on something in libs/common, as one jest path regex.
# Named explicitly rather than run as the whole suite: the repository spec boots
# an in-memory MongoDB, and paying that eleven times over would make this
# harness slow and its verdicts hostage to a download.
DEPENDENTS='libs/common|nse.adapter|nse-date|date-range|alert.service|poller.service|telegram.service|alert-formatter|cadence|drain-schedule'

restore_verified() {
  local ok=0
  cp "$BACKUP/describe-error.ts" "$ERR" || ok=1
  cp "$BACKUP/ist.ts" "$IST" || ok=1
  cmp -s "$BACKUP/describe-error.ts" "$ERR" || ok=1
  cmp -s "$BACKUP/ist.ts" "$IST" || ok=1
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
    echo "  cp $BACKUP/describe-error.ts $ERR" >&2
    echo "  cp $BACKUP/ist.ts            $IST" >&2
    echo "or: git -C $ROOT checkout -- libs/common" >&2
    exit 1
  fi
}

trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring sources."; exit 130' INT TERM

# check <label> <mutated-file> <jest-pattern> [extra jest args...]
check() {
  local label="$1" file="$2" pattern="$3"
  shift 3
  local backup_for out

  case "$file" in
  *describe-error.ts) backup_for=$BACKUP/describe-error.ts ;;
  *) backup_for=$BACKUP/ist.ts ;;
  esac

  if cmp -s "$file" "$backup_for"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest "$pattern" --forceExit "$@" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring sources and stopping."
    exit 130
  fi

  # A TYPE error, specifically. "Test suite failed to run" on its own is not
  # sufficient evidence: a jest worker that dies at runtime prints the same
  # banner, and one of the mutations below does exactly that while still
  # failing twelve assertions in the suites that survive. Requiring a `TS####`
  # diagnostic keeps a genuine kill from being reported as a harness defect.
  if echo "$out" | grep -qE "error TS[0-9]+"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    FAILURES=$((FAILURES + 1))
    restore_verified || on_exit
    return
  fi

  # No `Tests:` line means the runner never reached a verdict. Positive evidence
  # that jest got as far as a suite is required before that may be scored as a
  # kill; without it, it is a harness or environment failure and is counted.
  if ! echo "$out" | grep -qE "^Tests:"; then
    if [ "$rc" -eq 0 ]; then
      echo "SURVIVED | $label   <-- TEST GAP"
      FAILURES=$((FAILURES + 1))
    elif echo "$out" | grep -qE "^(Test Suites:|PASS |FAIL )"; then
      echo "CRASHED  | $label"
      echo "           runner died before reporting (exit $rc); the suite is red"
      CRASHES=$((CRASHES + 1))
    else
      echo "HARNESS ERROR | $label"
      echo "           jest never reached a suite (exit $rc); no verdict, not a kill"
      FAILURES=$((FAILURES + 1))
    fi
    restore_verified || on_exit
    return
  fi

  if echo "$out" | grep -qE "Tests:.*failed"; then
    echo "CAUGHT   | $label"
    echo "$out" | grep -E "^\s+●\s" | grep -v Console | sed 's/^/           /' |
      sort -u | head -3
  else
    echo "SURVIVED | $label   <-- TEST GAP"
    FAILURES=$((FAILURES + 1))
  fi

  restore_verified || on_exit
}

echo "=== the error describers: every caller is a catch block ==="

perl -0pi -e 's/  try \{\n    return String\(value\);\n  \} catch \{\n    return UNPRINTABLE;\n  \}/  return String(value);/' "$ERR"
check "safeText made partial (String() raises on a null-prototype object)" "$ERR" "$DEPENDENTS"

perl -0pi -e "s/export const UNPRINTABLE = '\\[unprintable\\]';/export const UNPRINTABLE = '';/" "$ERR"
check "unprintable marker emptied (the log line says nothing happened)" "$ERR" "$DEPENDENTS"

perl -0pi -e 's/  error instanceof Error \? `\$\{error\.name\}: \$\{error\.message\}` : safeText\(error\);/  (error as Error).message;/' "$ERR"
check "naive error description (throws on a null rejection, inside the catch)" "$ERR" "$DEPENDENTS"

perl -0pi -e 's/  error instanceof Error \? `\$\{error\.name\}: \$\{error\.message\}` : safeText\(error\);/  error instanceof Error ? error.message : safeText(error);/' "$ERR"
check "error class dropped (TypeError and Error read identically)" "$ERR" "$DEPENDENTS"

perl -0pi -e 's/    return JSON\.stringify\(value\) \?\? safeText\(value\);\n  \} catch \{\n    return safeText\(value\);\n  \}/    return JSON.stringify(value) ?? String(value);\n  } catch {\n    return String(value);\n  }/' "$ERR"
check "safeJson falls back to bare String (a null-prototype cycle throws)" "$ERR" "$DEPENDENTS"

perl -0pi -e 's/    return JSON\.stringify\(value\) \?\? safeText\(value\);/    return JSON.stringify(value) as string;/' "$ERR"
check "safeJson returns undefined as a string (the log line reads \"undefined\")" "$ERR" "$DEPENDENTS"

perl -0pi -e 's/  error instanceof Error \? error\.stack : undefined;/  (error as Error).stack;/' "$ERR"
check "stackOf unguarded (reading .stack off null throws from the catch)" "$ERR" "$DEPENDENTS"

echo ""
echo "=== the IST offset: wrong by half an hour, and never loudly ==="

perl -0pi -e 's/export const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/export const IST_OFFSET_MS = 5 * 60 * 60 * 1000;/' "$IST"
check "offset drops the half hour (alerts 30 minutes wrong, day boundary moves)" "$IST" "$DEPENDENTS"

perl -0pi -e 's/export const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/export const IST_OFFSET_MS = 0;/' "$IST"
check "offset removed entirely (everything read in UTC)" "$IST" "$DEPENDENTS"

perl -0pi -e "s/String\(value\)\.padStart\(2, '0'\);/String(value);/" "$IST"
check "zero padding dropped (09:03:03 renders as 9:3:3, 05-08 as 5-8)" "$IST" "$DEPENDENTS"

perl -0pi -e "s/String\(value\)\.padStart\(2, '0'\);/String(value).padStart(2, '0').slice(-2);/" "$IST"
check "padding truncates instead (a four-digit year becomes two)" "$IST" "$DEPENDENTS"

echo ""
echo "=== independence checks ==="
echo "A shared helper must die to EACH suite that depends on it, not merely to"
echo "the whole run. Otherwise consolidating four copies would quietly move"
echo "four separate guarantees onto one test."

perl -0pi -e 's/  try \{\n    return String\(value\);\n  \} catch \{\n    return UNPRINTABLE;\n  \}/  return String(value);/' "$ERR"
check "safeText partial, adapter suite only" "$ERR" nse.adapter

perl -0pi -e 's/  try \{\n    return String\(value\);\n  \} catch \{\n    return UNPRINTABLE;\n  \}/  return String(value);/' "$ERR"
check "safeText partial, alert-service suite only" "$ERR" alert.service

perl -0pi -e 's/  error instanceof Error \? `\$\{error\.name\}: \$\{error\.message\}` : safeText\(error\);/  (error as Error).message;/' "$ERR"
check "naive description, poller suite only" "$ERR" poller.service

perl -0pi -e 's/export const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/export const IST_OFFSET_MS = 5 * 60 * 60 * 1000;/' "$IST"
check "half-hour offset, notify IST-clock suite only" "$IST" alert-formatter -t "IST clock"

perl -0pi -e 's/export const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/export const IST_OFFSET_MS = 5 * 60 * 60 * 1000;/' "$IST"
check "half-hour offset, cadence suite only" "$IST" cadence

perl -0pi -e 's/export const IST_OFFSET_MS = 5\.5 \* 60 \* 60 \* 1000;/export const IST_OFFSET_MS = 5 * 60 * 60 * 1000;/' "$IST"
check "half-hour offset, drain-schedule suite only" "$IST" drain-schedule

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived or errored, $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest libs/common 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
