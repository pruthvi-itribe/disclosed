#!/usr/bin/env bash
#
# Mutation harness for the persistence layer (Task 7).
#
# Two properties of FilingRepository are load-bearing for the whole system:
#
#   * insertNew returns ONLY the rows that did not already exist. That return
#     value gates alerting, so a wrong answer either re-alerts a day of filings
#     after a restart or drops an alert entirely.
#   * getMaxSeqId is the persisted cursor. A wrong answer re-alerts or silently
#     skips.
#
# This script breaks the implementation one way at a time, re-runs the suite,
# and asserts the break is caught — then restores the original.
#
# Usage:  bash tools/mutation/filing-repository-mutations.sh
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
#   * It refuses to run unless the target file is clean in git, so a failed
#     restore can always be recovered with `git checkout` and it can never
#     destroy uncommitted work.
#   * INT/TERM exit rather than return, so an interrupt cannot resume the script
#     part-way and leave a mutated tree behind while reporting success.
#   * Every restore is verified against the backup; the backup is deleted only
#     once the restore is confirmed byte-identical.
#
# Every mutant below must still COMPILE — but note which way that cuts. When a
# mutant does not type-check, ts-jest fails the suite before a single test runs
# and jest prints "Tests: 0 total" with no failure count, so the `Tests:.*failed`
# grep below does NOT match and the verdict printed is SURVIVED. A non-compiling
# mutant therefore raises a false TEST GAP, never a false kill. That is the safe
# direction, but it is still noise: before believing a SURVIVED verdict, check it
# is not simply a compile error.
#
# (That grep is shared with the rollover/cadence harness and the same latent
# issue is ledgered on Task 6. It is left identical here on purpose.)

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
REPO=$ROOT/libs/filings/src/persistence/filing.repository.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
if ! git -C "$ROOT" ls-files --error-unmatch "$REPO" >/dev/null 2>&1; then
  echo "refusing to run: $REPO is not tracked by git." >&2
  exit 1
fi
if ! git -C "$ROOT" diff --quiet -- "$REPO" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$REPO"; then
  echo "refusing to run: uncommitted changes in the file this script mutates." >&2
  echo "  commit or stash them first — this script edits it in place." >&2
  git -C "$ROOT" status --short -- "$REPO" >&2
  exit 1
fi

BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$REPO" "$BACKUP/filing.repository.ts" || {
  echo "refusing to run: could not back up filing.repository.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0

restore_verified() {
  local ok=0
  cp "$BACKUP/filing.repository.ts" "$REPO" || ok=1
  cmp -s "$BACKUP/filing.repository.ts" "$REPO" || ok=1
  return $ok
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: source could NOT be restored. Backup kept at:" >&2
    echo "  $BACKUP/filing.repository.ts" >&2
    echo "Recover with:" >&2
    echo "  cp $BACKUP/filing.repository.ts $REPO" >&2
    echo "or: git -C $ROOT checkout -- $REPO" >&2
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

  if cmp -s "$REPO" "$BACKUP/filing.repository.ts"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest filing.repository "$@" 2>&1)
  local rc=$?

  # A runner killed by a signal produced no verdict, so it must never be read
  # as one; without this guard a Ctrl-C prints a false "TEST GAP".
  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring source and stopping."
    exit 130
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

echo "=== getMaxSeqId: the persisted cursor ==="

perl -0pi -e 's/return top\?\.seqId \?\? null;/return top?.seqId || null;/' "$REPO"
check "?? becomes || (a stored seqId of 0 reads as no cursor)"

perl -0pi -e 's/\.sort\(\{ seqId: -1 \}\)/.sort({ seqId: 1 })/' "$REPO"
check "sort direction flipped (cursor parks at the oldest id)"

echo ""
echo "=== insertNew: which rows come back ==="

# The brief's original approach. Mongoose drops invalid documents BEFORE the
# write, so driver write-error indexes count positions in the filtered batch,
# not in the caller's array — this form can hand back a filing we already had.
perl -0pi -e 's/    return this\.matchInserted\(filings, insertedDocs\);/    const failedIndexes = new Set(\n      writeErrors\n        .map((we) => we.index ?? we.err?.index)\n        .filter((i): i is number => i !== undefined),\n    );\n    return filings.filter((_, index) => !failedIndexes.has(index));/' "$REPO"
check "match by write-error index instead of by seqId (the brief's form)"

perl -0pi -e 's/      remaining\.set\(filing\.seqId, left - 1\);\n//' "$REPO"
check "inserted seqIds not consumed (both copies of an internal duplicate returned)"

perl -0pi -e 's/    return inserted\.length === insertedDocs\.length \? inserted : null;/    return inserted;/' "$REPO"
check "unmatched written row tolerated (returns a short answer instead of throwing)"

perl -0pi -e 's/    return \[\.\.\.filings\];/    return filings as Filing[];/' "$REPO"
check "success path aliases the caller batch instead of copying it"

echo ""
echo "=== insertNew: failures must never read as 'nothing new' ==="

perl -0pi -e 's/\n        throwOnValidationError: true,//' "$REPO"
check "throwOnValidationError dropped (mongoose silently discards invalid filings)"

perl -0pi -e 's/    if \(insertedCount !== filings\.length\) \{/    if (insertedCount > filings.length) {/' "$REPO"
check "count backstop weakened to > (a short silent insert passes)"

perl -0pi -e 's/    if \(!allDuplicates\) return null;\n//' "$REPO"
check "non-duplicate write errors treated as duplicates"

perl -0pi -e 's/    if \(insertedDocs\.length \+ writeErrors\.length !== filings\.length\)\n      return null;\n//' "$REPO"
check "accounting check removed (a vanished filing passes unnoticed)"

perl -0pi -e 's/    if \(writeErrors\.length === 0\) return null;\n//' "$REPO"
check "bare duplicate error with no write errors treated as all-inserted"

perl -0pi -e 's/    if \(filings\.length === 0\) return \[\];\n\n//' "$REPO"
check "empty-batch short circuit removed (the database is touched for nothing)"

perl -0pi -e 's/\(we\.err\?\.code \?\? we\.code\) === DUPLICATE_KEY/(we.err?.code ?? we.code ?? (error as { code?: number }).code) === DUPLICATE_KEY/' "$REPO"
check "row error code inferred from the batch-level code"

echo ""
echo "=== assertIndexes: the precondition behind the whole alert gate ==="

perl -0pi -e 's/    if \(hasUniqueSeqId\) return;/    if (true) return;/' "$REPO"
check "index guard neutered (a missing unique index passes startup)"

perl -0pi -e 's/        index\.unique === true &&\n//' "$REPO"
check "uniqueness not required (a plain seqId index accepted)"

perl -0pi -e 's/        Object\.keys\(index\.key\)\.length === 1 &&\n//' "$REPO"
check "single-field check dropped (a compound unique index accepted)"

perl -0pi -e 's/      if \(\(error as \{ code\?: number \}\)\.code === NAMESPACE_NOT_FOUND\) return \[\];\n      throw error;/      throw error;/' "$REPO"
check "missing collection surfaces the raw driver error, not the consequence"

echo ""
echo "=== independence check ==="
echo "The dangerous real-database shape — a duplicate and an invalid row in one"
echo "batch — must die to its own test against real Mongo, not only to the"
echo "hand-built stub errors. Without the accounting check that batch returns a"
echo "clean-looking answer while a filing has silently vanished."
perl -0pi -e 's/    if \(insertedDocs\.length \+ writeErrors\.length !== filings\.length\)\n      return null;\n//' "$REPO"
check "accounting check removed, mixed duplicate+invalid test only" \
  -t "rethrows when a duplicate and an invalid row share a batch"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught; no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest filing.repository 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
