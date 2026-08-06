#!/usr/bin/env bash
#
# Mutation harness for the monetary-amount extractor: the four modules that
# decide whether a filing's PDF yields a number an alert may publish about a
# named listed company.
#
# This is the only component in the project whose failures are ACTIVELY harmful
# rather than merely silent. Everywhere else, a broken guard means the bot says
# less. Here it means the bot says something false — "order worth Rs 7.15 lakh"
# for a Rs 71.5 crore acquisition, or Rs 6,300 crore for a Rs 1,063 crore order
# win — with a company's name attached. A suite that passes while such a
# mutation survives is not covering the thing that matters:
#
#   1. THE PARSER'S GUARDS. Widening the parser to read unit-less Indian
#      grouping is what lifted recall, and every guard added alongside it exists
#      to stop that widening reading something that is not money: the one-lakh
#      floor (face values, premiums, issue prices), the grouping check (a real
#      filing prints `Rs. 30,00,000,00`, which reads as 30 crore only by
#      accident), the bounded whitespace (a marker binding across a blank line
#      to an unrelated cell), and the refusal to treat `Rupees` as a marker
#      (`(Rupees Three Crores Fifty-Six Lakhs…)` restates Rs 3,56,91,142.50 and
#      would be read as Rs 3 crore). Each one is invisible until it is wrong.
#   2. THE ANCHORS. A figure is only read from a position that declares what it
#      means. Loosen the window, the reach, or the phrase list and the extractor
#      quietly becomes "largest number nearby", which the corpus proves returns
#      a market-size statistic, a share capital and an order book total.
#   3. THE HAZARD DETECTORS. A declared scale and a published value band both
#      mean the figure is unreadable rather than absent. Disable either and the
#      extractor emits with full confidence.
#   4. THE DECISION ORDER AND THE TIE-BREAKS. Ambiguity first, scale before
#      agreement, disagreement refuses, the labelled row wins over the covering
#      letter, and the marker-less fallback stays off while a marked figure
#      exists. Every one of these is a place where a plausible "improvement"
#      turns a refusal into a wrong number.
#
# So this script breaks the implementation one way at a time, re-runs the
# extractor's suites, and asserts the break is caught — then restores.
#
# Usage:  bash tools/mutation/amount-extractor-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished — see
# tools/mutation/alert-service-mutations.sh for the full rationale, which this
# script mirrors: CAUGHT (the suite went red), CRASHED (the runner died before
# reporting, which is still red but is labelled apart from an assertion
# failure), SURVIVED (a real test gap) and NO-OP (the perl pattern matched
# nothing, i.e. harness staleness after a refactor, NOT a test gap). A mutation
# that does not type-check is COMPILE and counts as a failure, because a
# mutation that never ran proved nothing.
#
# Safety: refuses to run on a dirty tree, backs up every file it touches,
# verifies each restore byte-for-byte, and exits rather than returns on INT/TERM
# so it cannot resume past cleanup.
#
# NOT covered by mutation, and why:
#
#   - `verbatim-mismatch`. It is an internal-consistency assertion: no document
#     can provoke it, because it only fires if the module's own offset
#     arithmetic is wrong. `isTraceableEvidence` is mutated instead, and is
#     tested directly with a deliberately corrupted provenance.
#   - The ground-truth fixture itself. A mutation of the LABELS would be a
#     mutation of the measurement, not of the code, and would always "pass" by
#     construction. amount-corpus.spec.ts guards it the other way, by asserting
#     every label still quotes text present in the document it describes.
#   - `category`, which is carried through the input and deliberately unused.
#     There is no behaviour to break.
#
# Tally, so a report can quote it without recounting: 32 mutations across four
# groups, plus 6 independence checks = 38 `check` calls.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOGIC=$ROOT/libs/filings/src/logic
FILES=(
  "$LOGIC/rupee-parse.ts"
  "$LOGIC/amount-anchors.ts"
  "$LOGIC/amount-hazards.ts"
  "$LOGIC/amount-extraction.ts"
)
SUITE='libs/filings/src/logic/(amount-|rupee-parse|regex-matches|ambiguity)'

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
    echo "  git -C $ROOT checkout -- libs/filings/src/logic" >&2
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

# check <label>                  run the extractor's whole suite
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

P=$LOGIC/rupee-parse.ts
A=$LOGIC/amount-anchors.ts
H=$LOGIC/amount-hazards.ts
X=$LOGIC/amount-extraction.ts

echo "=== the parser's guards: what stops a widened parser reading non-money ==="

perl -0pi -e 's/export const MIN_UNITLESS_RUPEES = 100_000;/export const MIN_UNITLESS_RUPEES = 1;/' "$P"
check "one-lakh floor removed (face values and issue prices become amounts)"

perl -0pi -e 's/if \(!figure\.includes\(.,.\) \|\| value < MIN_UNITLESS_RUPEES\) continue;\n      matches\.push\(\{ rupees: value, text: whole, start, carriesUnit: false \}\);/matches.push({ rupees: value, text: whole, start, carriesUnit: false });/' "$P"
check "unit-less figures accepted unconditionally (Rs. 10 is an amount)"

perl -0pi -e 's/if \(\n      !INDIAN_GROUPING\.test\(integerPart\) &&\n      !INTERNATIONAL_GROUPING\.test\(integerPart\)\n    \) \{\n      return null;\n    \}//' "$P"
check "grouping check removed (Rs. 30,00,000,00 read as 30 crore by luck)"

perl -0pi -e 's{const INDIAN_GROUPING = /.*/;}{const INDIAN_GROUPING = /^[0-9,]+\$/;}' "$P"
check "Indian grouping accepts any digits and commas"

perl -0pi -e "s/const GAP = '\[\^\\\\\\\\S\\\\\\\\n\]\*\\\\\\\\n\?\[\^\\\\\\\\S\\\\\\\\n\]\*';/const GAP = '\\\\\\\\s*';/" "$P"
check "whitespace unbounded (a marker binds across blank lines)"

perl -0pi -e "s/const CURRENCY_MARKER = '\(\?:\\\\\\\\brs\|/const CURRENCY_MARKER = '(?:\\\\\\\\brupees|\\\\\\\\brs|/" "$P"
check "'rupees' preferred as a marker over 'rs' (changes which text is quoted)"

perl -0pi -e "s/const CURRENCY_MARKER = '\(\?:\\\\\\\\brs\|/const CURRENCY_MARKER = '(?:rs|/" "$P"
check "leading word boundary dropped (shareholde|rs| 5 crore)"

perl -0pi -e 's/  if \(second === undefined\) return head;\n\n  const tail = MULTIPLIERS\[singular\(second\)\];\n  if \(tail === undefined\) return null;\n  return LAKH_UNITS\.has\(singular\(first\)\) && CRORE_UNITS\.has\(singular\(second\)\)\n    \? head \* tail\n    : null;/  return head;/' "$P"
check "compound units ignored (Rs 2 lakh crore reported as Rs 2 lakh)"

perl -0pi -e 's/return Number\.isFinite\(value\) \? value : null;/return value;/' "$P"
check "overflow unguarded (a 400-digit figure becomes Infinity)"

perl -0pi -e "s/const BARE_PATTERN = new RegExp\(\`\\\$\{FIGURE\}\\\$\{GAP\}\(\\\\\\\\\\/\[-–—\]\)\`, 'g'\);/const BARE_PATTERN = new RegExp(\`(\\\$\{FIGURE\})()\`, 'g');/" "$P"
check "marker-less scan drops the /- terminator (share counts become amounts)"

perl -0pi -e 's/    if \(FOREIGN_CURRENCY\.test\(text\.slice\(Math\.max\(0, start - 12\), start\)\)\) \{\n      continue;\n    \}//' "$P"
check "foreign-currency guard removed (USD 70,000,000 read as rupees)"

perl -0pi -e 's/      matches\.push\(\{ rupees: value, text: whole, start, carriesUnit: false \}\);/      matches.push({ rupees: value, text: whole, start, carriesUnit: true });/' "$P"
check "unit-less figures claim to carry a unit (defeats the scale guard)"

echo ""
echo "=== the anchors: what stops this becoming 'largest number nearby' ==="

perl -0pi -e 's/export const LABEL_WINDOW_CHARS = 260;/export const LABEL_WINDOW_CHARS = 4000;/' "$A"
check "label window widened (the rows after the answer contribute figures)"

perl -0pi -e 's/export const LABEL_WINDOW_CHARS = 260;/export const LABEL_WINDOW_CHARS = 10;/' "$A"
check "label window narrowed below the answer"

perl -0pi -e 's/const ORDER_SIZE_LABEL =\n  .*;/const ORDER_SIZE_LABEL = \/size[\\s\\S]*?order\/gi;/' "$A"
check "order label loosened to 'size ... order'"

perl -0pi -e 's/\/\(\?:broad\\s\*\)\?\(\?:commercial/\/broad\\s*(?:commercial/' "$A"
check "'broad' made mandatory in the order label"

perl -0pi -e 's/\(\?:commercial\\s\*\)\?//' "$A"
check "'commercial' variant of the label no longer recognised"

perl -0pi -e 's/export const HEADLINE_SCAN_CHARS = 4_000;/export const HEADLINE_SCAN_CHARS = 400_000;/' "$A"
check "covering-letter window covers the whole document"

perl -0pi -e 's/export const PHRASE_REACH_CHARS = 60;/export const PHRASE_REACH_CHARS = 4_000;/' "$A"
check "phrase reach widened (any phrase names any figure on the page)"

perl -0pi -e "s/  'orders\?\\\\\\\\s\+worth',/  'orders?\\\\\\\\s+worth',\n  'order',/" "$A"
check "bare 'order' added as an event phrase (YTD order intake leaks in)"

perl -0pi -e 's/  return windows\.sort\(\(a, b\) => a\.start - b\.start\);/  return windows;/' "$A"
check "label windows not ordered (the acquisition row outranks an earlier order row)"

perl -0pi -e 's/  ends\.push\(match\.index \+ match\[0\]\.length\);/  ends.push(match.index);/' "$A"
check "phrase end measured from its start (reach effectively shortened)"

perl -0pi -e 's/start >= end && start - end <= PHRASE_REACH_CHARS/Math.abs(start - end) <= PHRASE_REACH_CHARS/' "$A"
check "a figure BEFORE the phrase counts as anchored"

echo ""
echo "=== the hazard detectors: unreadable is not the same as absent ==="

perl -0pi -e 's/  return found;\n\}/  return [];\n}/' "$H"
check "scale-header detection disabled entirely"

perl -0pi -e 's/  \/\/ `Rs\. in thousands`.*?\n  \),\n//s' "$H"
check "the 'Rs. in thousands' form dropped from the detector"

perl -0pi -e 's/  VALUE_BAND_PATTERNS\.some\(\(pattern\) => pattern\.test\(text\)\);/  text.length < 0;/' "$H"
check "value-band detection disabled (a band reported as a point value)"

echo ""
echo "=== the decision: order, tie-breaks and which position wins ==="

perl -0pi -e 's/  if \(hasAmbiguityKeyword\(documentText\) \|\| hasAmbiguityKeyword\(summary\)\) \{/  if (false) {/' "$X"
check "ambiguity gate removed (a Letter of Intent published as a win)"

perl -0pi -e 's/hasAmbiguityKeyword\(documentText\) \|\| hasAmbiguityKeyword\(summary\)/hasAmbiguityKeyword(summary)/' "$X"
check "ambiguity checked in the summary only, not the PDF text"

perl -0pi -e 's/  if \(scaleHeaders\.length > 0 && candidates\.some\(\(c\) => !c\.carriesUnit\)\) \{/  if (scaleHeaders.length > 0 \&\& candidates.every((c) => !c.carriesUnit) \&\& false) {/' "$X"
check "scale guard neutered (the thousands table read at face value)"

perl -0pi -e 's/  if \(values\.length > 1\) \{/  if (values.length > 99) {/' "$X"
check "disagreement tolerated (two tranches collapse to whichever came first)"

perl -0pi -e 's/  const chosen = candidates\[0\];/  const chosen = candidates[candidates.length - 1];/' "$X"
check "the last anchored position quoted instead of the first"

perl -0pi -e 's/  const found = marked\.length > 0 \? marked : scanBareAmounts\(window\.text\);/  const found = [...marked, ...scanBareAmounts(window.text)];/' "$X"
check "marker-less fallback always on (a share count rivals the price)"

perl -0pi -e 's/    labelWindows\.length > 0\n      \? labelWindows\.flatMap\(candidatesInWindow\)\n      : coveringLetterCandidates\(documentText\);/    [\n      ...labelWindows.flatMap(candidatesInWindow),\n      ...coveringLetterCandidates(documentText),\n    ];/' "$X"
check "labelled row no longer wins over the covering letter"

perl -0pi -e 's/  return scanRupeeAmounts\(text\)\n    \.filter\(\(match\) => isPhraseAnchored\(phraseEnds, match\.start\)\)/  return scanRupeeAmounts(text)/' "$X"
check "covering-letter figures accepted without a phrase naming them"

perl -0pi -e 's/  if \(documentText\.slice\(offset, offset \+ evidence\.length\) !== evidence\) \{\n    return false;\n  \}//' "$X"
check "provenance offset never verified"

perl -0pi -e 's/  return reread\.includes\(rupees\);/  return true;/' "$X"
check "evidence never re-parsed (provenance can name a different figure)"

echo ""
echo "=== independence checks ==="
echo "A guarantee must die to the suite that OWNS it, not merely to the corpus"
echo "measurement — otherwise deleting the fixture would silently cost coverage"
echo "that looks covered. And the corpus must earn its place by catching"
echo "regressions the hand-written cases were never written to imagine."

HAND='libs/filings/src/logic/(amount-anchors|amount-extraction|amount-hazards|rupee-parse|regex-matches|ambiguity)'
CORPUS='libs/filings/src/logic/amount-corpus'

perl -0pi -e 's/export const MIN_UNITLESS_RUPEES = 100_000;/export const MIN_UNITLESS_RUPEES = 1;/' "$P"
check_in "$HAND" "one-lakh floor, hand-written suites only (no corpus)"

perl -0pi -e 's/  if \(hasAmbiguityKeyword\(documentText\) \|\| hasAmbiguityKeyword\(summary\)\) \{/  if (false) {/' "$X"
check_in "$HAND" "ambiguity gate, hand-written suites only (no corpus)"

perl -0pi -e 's/  return found;\n\}/  return [];\n}/' "$H"
check_in 'libs/filings/src/logic/amount-hazards' "scale detection disabled, hazards suite only"

perl -0pi -e 's/  if \(scaleHeaders\.length > 0 && candidates\.some\(\(c\) => !c\.carriesUnit\)\) \{/  if (false) {/' "$X"
check_in "$CORPUS" "scale guard neutered, corpus measurement only"

perl -0pi -e 's/export const PHRASE_REACH_CHARS = 60;/export const PHRASE_REACH_CHARS = 4_000;/' "$A"
check_in "$CORPUS" "phrase reach widened, corpus measurement only"

perl -0pi -e 's/  if \(values\.length > 1\) \{/  if (values.length > 99) {/' "$X"
check_in "$CORPUS" "disagreement tolerated, corpus measurement only"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
