#!/usr/bin/env bash
#
# Mutation harness for financial-results extraction: the modules that decide
# whether a number read out of a table may be published about a named listed
# company.
#
# WHAT MAKES THIS DIFFERENT FROM THE CLAIM HARNESS. A claim is a sentence, and
# one question settles it: is that sentence in the document? A results figure is
# a CELL, and a cell is meaningless without three facts that are not inside it:
#
#   1. WHICH STATEMENT the table belongs to. A results filing carries both a
#      consolidated and a standalone statement, and in the acceptance filing
#      they differ by 35% under identical row labels. Publishing one under the
#      other's name is a wrong number, not a rounding error, and every mutation
#      that loosens the basis check produces exactly that.
#   2. WHAT THE COLUMNS MEAN. A row reads `73,977.90 73,356.74 65,607.59
#      2,84,706.00` — this quarter, last quarter, the year-ago quarter, the
#      prior year. Printing the second as `(YOY)` turns +12.8% growth into
#      +0.8%, and the sentence is still verbatim.
#   3. WHAT SCALE the table is in. The cells are bare numbers; `₹ Million`
#      printed above them is the only thing that says what they are worth.
#
# And one that is not about the table at all:
#
#   4. WHICH ROW IT IS. A statement stacks `Profit before share of profit in
#      associate and tax`, `Profit before exceptional items and tax`, `Profit
#      before tax` and `Profit for the period` one under the other. All four are
#      verbatim in the document; only the last is a net profit.
#
# Every mutation below breaks one of those four, or breaks the refusal that
# reports it. Tally, so a report can quote it without recounting: 34 `check`
# calls, including 3 independence checks.
#
# Usage:  bash tools/mutation/results-extraction-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished — see
# tools/mutation/alert-service-mutations.sh for the full rationale, which this
# script mirrors: CAUGHT, CRASHED, SURVIVED (a real test gap) and NO-OP (the
# perl pattern matched nothing, i.e. harness staleness, NOT a test gap). A
# mutation that does not type-check is COMPILE and counts as a failure, because
# a mutation that never ran proved nothing.
#
# NO `&& false` AND NO `if (false)` ANYWHERE, and the reason is the one the
# claim harness records: a provably-false condition makes the block unreachable,
# TypeScript drops the flow narrowing, and the mutation fails to COMPILE rather
# than running — which proves nothing. Every mutation here is a value
# substitution, a predicate inversion or a return-site swap.
#
# NO FIXTURE IS SIZED FROM THE CONSTANT IT PINS. The specs assert every bound
# against a literal as well as against the measurement, which is what lets
# `BASIS_HEADING_REACH = 1e9` be caught rather than silently satisfied.
#
# Safety: refuses to run on a dirty tree, backs up every file it touches,
# verifies each restore byte-for-byte, and exits rather than returns on INT/TERM.
#
# NOT covered by mutation, and why:
#
#   - The CONTENTS of RESULTS_BEARING_CATEGORIES and SCALE_TOKENS. Mutating a
#     table entry mutates the specification rather than the code; the suites
#     assert the invariants instead (every scale word the pattern can match is a
#     key of the token table; every metric has a label rule).
#   - The prompt TEXT. It is a request, not a control: every rule it states is
#     also enforced by results-verify.ts, and those enforcements are mutated
#     here. What IS mutated is the reply parser, because that is code.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOGIC=$ROOT/libs/filings/src/logic
FILES=(
  "$LOGIC/results-tokens.ts"
  "$LOGIC/results-period.ts"
  "$LOGIC/results-basis.ts"
  "$LOGIC/results-unit.ts"
  "$LOGIC/results-metric.ts"
  "$LOGIC/results-eligibility.ts"
  "$LOGIC/results-verify.ts"
  "$LOGIC/results-line.ts"
  "$LOGIC/results-prompt.ts"
  "$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts"
)
SUITE='(libs/filings/src/logic/results-|apps/ingest/src/enrichment/enrichment.worker)'

# --- precondition: refuse to mutate a dirty tree -----------------------------
for f in "${FILES[@]}"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "refusing to run: $f is not tracked by git." >&2
    exit 1
  fi
  if ! git -C "$ROOT" diff --quiet -- "$f" ||
    ! git -C "$ROOT" diff --cached --quiet -- "$f"; then
    echo "refusing to run: uncommitted changes in a file this script mutates." >&2
    echo "  commit or stash them first — this script edits them in place." >&2
    git -C "$ROOT" status --short -- "$f" >&2
    exit 1
  fi
done

BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
for f in "${FILES[@]}"; do
  cp "$f" "$BACKUP/$(basename "$f")" || {
    echo "refusing to run: could not back up $f." >&2
    rm -rf "$BACKUP"
    exit 1
  }
done

FAILURES=0
NOOPS=0
CRASHES=0

restore_verified() {
  local f
  for f in "${FILES[@]}"; do
    cp "$BACKUP/$(basename "$f")" "$f" || return 1
    cmp -s "$BACKUP/$(basename "$f")" "$f" || return 1
  done
  return 0
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: sources could NOT be restored. Backup kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  git -C $ROOT checkout -- libs/filings/src apps/ingest/src/enrichment" >&2
    exit 1
  fi
}

trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring sources."; exit 130' INT TERM

dirty() {
  local f
  for f in "${FILES[@]}"; do
    cmp -s "$f" "$BACKUP/$(basename "$f")" || return 0
  done
  return 1
}

# check_in <suite-regex> <label>  run ONLY the named suite
check_in() {
  local suite="$1"
  local label="$2"
  local out

  if ! dirty; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest "$suite" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring sources and stopping."
    exit 130
  fi

  # ts-jest re-emits TypeScript's coloured diagnostics whether or not stdout is
  # a TTY, so the literal bytes between "error" and "TS####" are escape codes,
  # not a space. `.*` between them, never a literal space.
  if grep -qE "error.*TS[0-9]+" <<<"$out"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    FAILURES=$((FAILURES + 1))
    restore_verified || on_exit
    return
  fi

  # A non-zero exit with no `Tests:` line is also what a typo'd suite name or a
  # broken toolchain produces, so a CRASHED verdict requires positive evidence
  # that jest reached a suite at all. Anything else is a HARNESS ERROR.
  if ! grep -qE "^Tests:" <<<"$out"; then
    if [ "$rc" -eq 0 ]; then
      echo "SURVIVED | $label   <-- TEST GAP"
      FAILURES=$((FAILURES + 1))
    elif grep -qE "^(Test Suites:|PASS |FAIL )|node_modules/jest-(circus|runner)|Ran all test suites" <<<"$out"; then
      echo "CRASHED  | $label"
      echo "           runner died before reporting (exit $rc); the suite is red"
      CRASHES=$((CRASHES + 1))
    else
      echo "HARNESS ERROR | $label"
      echo "           jest never reached a suite (exit $rc). No verdict, and NOT"
      echo "           a kill — check the pattern, the config and the toolchain."
      FAILURES=$((FAILURES + 1))
    fi
    restore_verified || on_exit
    return
  fi

  if grep -qE "Tests:.*failed" <<<"$out"; then
    echo "CAUGHT   | $label"
    echo "$out" | grep -E "^\s+●\s" | grep -v Console | sed 's/^/           /' |
      sort -u | head -3
  else
    echo "SURVIVED | $label   <-- TEST GAP"
    FAILURES=$((FAILURES + 1))
  fi

  restore_verified || on_exit
}

check() { check_in "$SUITE" "$1"; }
T=$LOGIC/results-tokens.ts
D=$LOGIC/results-period.ts
B=$LOGIC/results-basis.ts
U=$LOGIC/results-unit.ts
M=$LOGIC/results-metric.ts
E=$LOGIC/results-eligibility.ts
V=$LOGIC/results-verify.ts
L=$LOGIC/results-line.ts
P=$LOGIC/results-prompt.ts
W=$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts

echo "=== 1. consolidated against standalone: the wrong-number error ==="

perl -0pi -e 's/  if \(basis\.basis !== proposed\.basis\) \{/  if (false as boolean) {/' "$V"
check "the document's heading is no longer required to agree with the extractor"

perl -0pi -e "s/  if \(reachable\.length === 0\) \{/  if (reachable.length === 0) {\n    return { outcome: 'ok', basis: 'consolidated', evidence: 'assumed' };\n  }\n  if (reachable.length === -1) {/" "$B"
check "a table with no statement heading in reach is assumed consolidated"

perl -0pi -e 's/export const BASIS_HEADING_REACH = 400;/export const BASIS_HEADING_REACH = 1_000_000;/' "$B"
check "basis reach unbounded (a note three thousand characters away governs)"

perl -0pi -e 's/export const BASIS_HEADING_REACH = 400;/export const BASIS_HEADING_REACH = 0;/' "$B"
check "basis reach closed to nothing (every table refuses)"

perl -0pi -e 's/      marker\.basis !== nearest\.basis &&/      marker.basis === nearest.basis \&\&/' "$B"
check "the both-statements test compares the wrong pair of headings"

perl -0pi -e 's/export const BASIS_AMBIGUITY_CHARS = 120;/export const BASIS_AMBIGUITY_CHARS = 1;/' "$B"
check "the both-statements window narrowed to one character"

perl -0pi -e 's/      marker\.offset <= headerOffset &&/      marker.offset >= headerOffset \&\&/' "$B"
check "the heading is read from BELOW the table (the next statement's title)"

perl -0pi -e "s/  word\.toLowerCase\(\) === 'standalone' \? 'standalone' : 'consolidated';/  'consolidated';/" "$B"
check "every heading reads as consolidated"

perl -0pi -e 's/    if \(!NEAR_RESULT\.test\(documentText\.slice\(from, to\)\)\) continue;//' "$B"
check "a note about consolidation policy counts as a statement heading"

echo ""
echo "=== 2. which column is the year-ago one ==="

perl -0pi -e 's/  if \(!isYearBefore\(currentDate, priorDate\)\) \{/  if (false as boolean) {/' "$V"
check "the previous QUARTER may now be published as the year-ago figure"

perl -0pi -e 's/  sameDay\(current, prior\) && current\.year - prior\.year === 1;/  true;/' "$T"
check "any two columns count as year-on-year"

perl -0pi -e 's/  left\.day === right\.day && left\.month === right\.month;/  left.month === right.month;/' "$T"
check "the day of the period end no longer has to match"

perl -0pi -e 's/    occurrences\(dates, currentDate\) > 1 \|\|\n    occurrences\(dates, priorDate\) > 1\n  \) \{/    false as boolean\n  ) {/' "$V"
check "a repeated column date no longer makes the column unknowable"

perl -0pi -e 's/    \(row\) => row\.currentIndex !== pair\.current \|\| row\.priorIndex !== pair\.prior,/    () => false,/' "$V"
check "two rows may be read across different pairs of columns"

perl -0pi -e 's/  if \(tokens\.length !== columnCount\) \{/  if (false as boolean) {/' "$V"
check "a row with the wrong number of cells is still placed in a column"

perl -0pi -e 's/  if \(hits\.length > 1\) return \{ outcome: .ambiguous. \};//' "$V"
check "a value appearing twice in a row takes the first column it fits"

perl -0pi -e 's/const NUMERIC_DATE = .*;/const NUMERIC_DATE = \/(\\d{2})[.](\\d{2})[.](\\d{4})\\b\/g;/' "$T"
check "run-together column dates stop being read (only the last survives)"

perl -0pi -e 's/  const masked = row\.replace\(ANY_DATE, \(match\) => . .\.repeat\(match\.length\)\);/  const masked = row;/' "$T"
check "a date inside a row counts as a cell and shifts every column"

echo ""
echo "=== 3. the scale the table is denominated in ==="

perl -0pi -e "s/  if \(inReach\.length === 0\) \{/  if (inReach.length === 0) {\n    return { outcome: 'ok', token: 'CR', evidence: 'assumed' };\n  }\n  if (inReach.length === -1) {/" "$U"
check "a table that declares no scale is assumed to be in crore"

perl -0pi -e "s/  if \(tokens\.length > 1\) \{/  if (false as boolean) {/" "$U"
check "two disagreeing scale declarations no longer refuse"

perl -0pi -e 's/export const SCALE_REACH = 400;/export const SCALE_REACH = 1_000_000;/' "$U"
check "scale reach unbounded (another table's units govern this one)"

perl -0pi -e 's/\(\?:₹\|Rs\\\.\?\|INR\|rupees\)\\s\*\(\?:in\\s\+\)\?/(?:)/' "$U"
check "the currency marker is no longer required (prose declares the scale)"

perl -0pi -e "s/  if \(!ROW_SCOPED_UNIT_METRICS\.has\(metric\)\) \{/  if (true as boolean) {/" "$V"
check "EPS inherits the table's scale (five rupees becomes five million)"

perl -0pi -e "s/  return ROW_CURRENCY\.test\(row\)\n    \? \{ outcome: 'ok', unit: '' \}\n    : \{ outcome: 'none' \};/  return { outcome: 'ok', unit: '' };/" "$V"
check "an EPS row that declares no unit is published anyway"

echo ""
echo "=== 4. which row it is ==="

perl -0pi -e 's/    return `the quoted row does not carry a \$\{metric\} label`;/    return null;/' "$M"
check "the row label is no longer checked (profit before tax becomes net profit)"

perl -0pi -e 's/  if \(rule\.excludes !== undefined && rule\.excludes\.test\(row\)\) \{/  if (false as boolean) {/' "$M"
check "the disqualifying pattern dropped (a rival row passes on one word)"

perl -0pi -e 's/  const rule = RULES\[metric\];/  if (row.length >= 0) return null;\n  const rule = RULES[metric];/' "$M"
check "the required label dropped (any row carries any metric)"

perl -0pi -e 's/  if \(qualifier !== undefined && !qualifier\.test\(row\)\) \{/  if (false as boolean) {/' "$M"
check "diluted EPS may be published as an unqualified EPS"

echo ""
echo "=== 5. the verbatim gate, the period, and the refusals ==="

perl -0pi -e 's/  const match = findVerbatimSpan\(documentText, figure\.span\);/  const match = { offset: 0, evidence: figure.span };/' "$V"
check "the quoted row is no longer matched against the document"

perl -0pi -e 's/  if \(match\.offset < columnsOffset \|\| below > RESULTS_TABLE_REACH\) \{/  if (false as boolean) {/' "$V"
check "a row anywhere in the document belongs to any table"

perl -0pi -e 's/export const RESULTS_TABLE_REACH = 8_000;/export const RESULTS_TABLE_REACH = 1_000_000;/' "$V"
check "table reach unbounded (a standalone row under a consolidated header)"

perl -0pi -e 's/  const end = QUARTER_ENDS\.find\(/  const end = [{ month: 6, day: 30, quarter: 1 as const, nextYear: true }].find(/' "$D"
check "only the June quarter is derivable (every other period refuses)"

perl -0pi -e 's/  const fiscalYearEnd = end\.nextYear \? date\.year \+ 1 : date\.year;/  const fiscalYearEnd = date.year;/' "$D"
check "the fiscal year is the calendar year (Q1 FY27 becomes Q1 FY26)"

perl -0pi -e 's/  if \(conflict !== null\) \{/  if (false as boolean) {/' "$V"
check "a quarter the document contradicts is published anyway"

perl -0pi -e 's/  if \(parsed\.length === 0\) return null;//' "$P"
check "a reply whose figures were all malformed becomes an empty table"

echo ""
echo "=== independence: each guard is load-bearing on its own ==="

perl -0pi -e 's/  if \(seen\.has\(row\.figure\.metric\)\) \{/  if (false as boolean) {/' "$V"
check "the same metric may be published twice on one line"

perl -0pi -e 's/    return \{ outcome: .ok., unit: tableScale \};/    return { outcome: "ok", unit: "" };/' "$V"
check "every monetary figure loses its scale on the wire"

perl -0pi -e 's/      resultsLine: results\.line,/      resultsLine: null,/' "$W"
check "the results line never reaches the database or the wire"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$CRASHES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "All mutations were caught, and every one applied."
  exit 0
fi
echo "FAILURES: $FAILURES   CRASHES: $CRASHES   NO-OPS: $NOOPS"
exit 1
