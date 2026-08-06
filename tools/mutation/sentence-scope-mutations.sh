#!/usr/bin/env bash
#
# Mutation harness for the SENTENCE-SCOPED conditional check: the sentence
# locator, the two-scope split of the ambiguity patterns, and the decision in
# the amount extractor that uses them.
#
# WHY THIS RULE NEEDS ITS OWN HARNESS. The check it replaced was document-wide,
# and a document-wide check is safe by construction: it refuses whenever the
# words appear anywhere, so no test can catch it being too weak because it never
# is. Narrowing it to the sentence traded that guarantee for a measured one —
# live, the old rule refused 585 filings and only 3 of them had a figure worth
# reading — and every guarantee that replaced it lives in code that a plausible
# "simplification" would delete:
#
#   1. THE SENTENCE BOUNDARIES. `Rs.` is followed by a space in almost every
#      Indian filing. Split on it and "emerged as L1 bidder for a project of
#      Rs. 500 crore" becomes a clause that no longer says L1, the check passes,
#      and the extractor publishes a conditional figure about a named listed
#      company. The same is true of a single `\n`, which a PDF text layer puts
#      in the middle of sentences by the thousand.
#   2. THE HARD BOUND. Without it a "sentence" in a Schedule III table is the
#      whole filing — measured, the punctuation-delimited span around a figure
#      reaches 4,487 characters — and the change silently reverts to the
#      document-wide rule it was meant to replace.
#   3. THE SPLIT ITSELF. Rumour framing must stay document-scoped and
#      conditional framing must not. Move either half and the pipeline either
#      publishes a rumour as fact or refuses every filing again.
#   4. THE DECISION. Drop the conditioned candidates, refuse only when ALL of
#      them are conditioned, and carry the SURVIVORS into the checks below.
#      Every one of those is a place where the obvious edit turns a refusal into
#      a wrong number, or a good figure into a refusal.
#
# So this script breaks the implementation one way at a time, re-runs the
# suites, and asserts the break is caught — then restores.
#
# Usage:  bash tools/mutation/sentence-scope-mutations.sh
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
# `&& false` IS NOT USED AS A MUTATION OPERATOR HERE, and the omission is
# deliberate: appended to a narrowed TypeScript condition it changes what the
# compiler knows about the variables inside the block, so the mutation either
# fails to compile or silently becomes a different mutation from the one the
# label claims. Guards are neutered by replacing the whole condition with
# `false`, or by replacing the value the condition reads.
#
# Safety: refuses to run on a dirty tree, backs up every file it touches,
# verifies each restore byte-for-byte, and exits rather than returns on INT/TERM
# so it cannot resume past cleanup.
#
# NOT covered by mutation, and why:
#
#   - The ABBREVIATION LIST entry by entry. Deleting `rs` is mutated because it
#     is the one the corpus proves load-bearing; deleting `sept` would be an
#     equivalent mutation on this corpus and a test written to kill it would be
#     fitted to the harness rather than to a guarantee.
#   - The exact value of `SENTENCE_REACH_CHARS`. Measured end to end at 200,
#     300, 400, 600, 800 and 1,200 over 585 live documents, the verdict was
#     identical every time, so no test can distinguish them and one written to
#     try would be pinning an arbitrary number. What IS mutated is the bound
#     EXISTING at all, in both directions — unbounded and far too small — since
#     those are the two ways the rule stops being a rule about sentences.
#   - `MAX_SENTENCE_QUOTE_CHARS`'s exact value, for the same reason. That the
#     detail is bounded and newline-free is mutated; that the bound is 160 is a
#     constant pinned by an assertion, not a behaviour.
#
# Tally, so a report can quote it without recounting: 24 mutations across four
# groups, plus 3 independence checks = 27 `check` calls.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOGIC=$ROOT/libs/filings/src/logic
FILES=(
  "$LOGIC/sentence-scope.ts"
  "$LOGIC/ambiguity.ts"
  "$LOGIC/amount-extraction.ts"
)
SUITE='libs/filings/src/logic/(sentence-scope|ambiguity|amount-|claim-verify)'

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

# check <label>                   run the whole sentence-scope suite set
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

S=$LOGIC/sentence-scope.ts
B=$LOGIC/ambiguity.ts
X=$LOGIC/amount-extraction.ts

echo "=== what ends a sentence: the splits that hide a conditioning clause ==="

perl -0pi -e "s{const PARAGRAPH_BREAK = /\\\\n\[\^\\\\S\\\\n\]\*\\\\n\\\\s\*/g;}{const PARAGRAPH_BREAK = /\\\\n\\\\s*/g;}" "$S"
check "a single newline ends a sentence (a line wrap splits the clause)"

perl -0pi -e "s{const PARAGRAPH_BREAK = /\\\\n\[\^\\\\S\\\\n\]\*\\\\n\\\\s\*/g;}{const PARAGRAPH_BREAK = /(?!)/g;}" "$S"
check "a blank line no longer ends a sentence (paragraphs merge)"

perl -0pi -e 's/^  .rs.,\n//m' "$S"
check "'Rs' dropped from the abbreviations (Rs. 500 crore splits at the stop)"

perl -0pi -e 's/const ABBREVIATIONS: ReadonlySet<string> = new Set\(\[[\s\S]*?\n\]\);/const ABBREVIATIONS: ReadonlySet<string> = new Set([]);/' "$S"
check "the abbreviation list emptied entirely"

perl -0pi -e 's/  if \(token\.length === 0\) return false;/  if (token.length === 0) return true;/' "$S"
check "a stray OCR full stop ends a sentence"

perl -0pi -e 's/  if \(SINGLE_LETTER\.test\(token\)\) return false;//' "$S"
check "an initial ends a sentence (A. K. Sharma splits twice)"

perl -0pi -e 's/  return next === undefined \|\| !LOWERCASE\.test\(next\);/  return true;/' "$S"
check "a lower-case next word still starts a sentence"

perl -0pi -e 's/  if \(ALL_DIGITS\.test\(token\)\) return true;/  if (ALL_DIGITS.test(token)) return false;/' "$S"
check "a numbered clause marker no longer ends a sentence"

perl -0pi -e "s{  if \\(window\\[markIndex\\] !== '\\.'\\) return true;}{  if (window[markIndex] !== '.') return false;}" "$S"
check "'?' and '!' no longer end a sentence"

perl -0pi -e "s{const TERMINATOR = /\(\[\.\?!\]\)\(\[\"'’”\)\\\\\]\]\*\)\(\\\\s\+\)/g;}{const TERMINATOR = /([.?!])([\"'’”)\\\\]]*)()/g;}" "$S"
check "a terminator no longer needs whitespace after it (78.24 splits)"

echo ""
echo "=== the bound: without it a table row's sentence is the whole filing ==="

perl -0pi -e 's/export const SENTENCE_REACH_CHARS = 800;/export const SENTENCE_REACH_CHARS = 100_000_000;/' "$S"
check "the bound removed (the sentence becomes the document)"

perl -0pi -e 's/export const SENTENCE_REACH_CHARS = 800;/export const SENTENCE_REACH_CHARS = 10;/' "$S"
check "the bound cut below a real clause"

perl -0pi -e 's/  const floor = Math\.max\(0, anchor - reach\);/  const floor = 0;/' "$S"
check "the bound applied forwards only (a phrase any distance behind counts)"

perl -0pi -e 's/  const ceiling = Math\.min\(text\.length, anchor \+ reach \+ 1\);/  const ceiling = text.length;/' "$S"
check "the bound applied backwards only (a phrase any distance ahead counts)"

perl -0pi -e 's/  const anchor = Math\.min\(Math\.max\(offset, 0\), text\.length - 1\);/  const anchor = offset;/' "$S"
check "the offset no longer clamped into the text"

perl -0pi -e 's/    if \(boundary\.next <= local\) start = boundary\.next;/    if (boundary.at <= local) start = boundary.at;/' "$S"
check "the sentence starts at the terminator rather than after it"

perl -0pi -e 's/    if \(boundary\.at > local\) \{\n      end = boundary\.at;\n      break;\n    \}/    if (boundary.at > local) end = boundary.at;/' "$S"
check "the sentence runs to the LAST boundary in reach, not the first"

echo ""
echo "=== the split: which scope each half of the old list belongs to ==="

perl -0pi -e 's/export const RUMOUR_PATTERNS: readonly RegExp\[\] = \[/export const RUMOUR_PATTERNS: readonly RegExp[] = [\n  \/\\bsubject to\\b\/i,/' "$B"
check "'subject to' put back under document scope (the over-refusal returns)"

perl -0pi -e 's/  RUMOUR_PATTERNS\.some\(\(pattern\) => pattern\.test\(text\)\);/  false;/' "$B"
check "rumour framing never detected (a press rumour published as fact)"

perl -0pi -e 's/  for \(const pattern of CONDITIONAL_PATTERNS\) \{\n    const found = pattern\.exec\(text\);\n    if \(found !== null\) return found\[0\];\n  \}//' "$B"
check "conditional framing never detected"

perl -0pi -e 's/const AMBIGUITY_PATTERNS: readonly RegExp\[\] = \[\n  \.\.\.CONDITIONAL_PATTERNS,\n  \.\.\.RUMOUR_PATTERNS,\n\];/const AMBIGUITY_PATTERNS: readonly RegExp[] = [...RUMOUR_PATTERNS];/' "$B"
check "the union loses its conditional half (claim-verify stops refusing)"

echo ""
echo "=== the decision: drop the conditioned, keep the rest, refuse only if none ==="

perl -0pi -e 's/    const sentence = sentenceAt\(documentText, candidate\.start\)\.text;/    const sentence = documentText;/' "$X"
check "the check reverts to document scope (the over-refusal returns)"

perl -0pi -e 's/    const phrase = conditionalFramingIn\(sentence\);/    const phrase = null;/' "$X"
check "no candidate is ever dropped (a letter of intent is published)"

perl -0pi -e 's/  if \(admitted\.length === 0\) \{/  if (admitted.length < candidates.length) \{/' "$X"
check "one conditioned candidate refuses the whole filing"

perl -0pi -e 's/  if \(hasConditionalFraming\(summary\)\) \{/  if (false) \{/' "$X"
check "the summary's own conditional language ignored"

echo ""
echo "=== independence checks ==="
echo "A guarantee must die to the suite that OWNS it, not merely to whichever"
echo "suite happens to run alongside it — otherwise deleting one spec would"
echo "silently cost coverage that still looks covered."

LOCATOR='libs/filings/src/logic/sentence-scope'
CLAIMS='libs/filings/src/logic/claim-verify'
AMOUNT='libs/filings/src/logic/amount-extraction'

perl -0pi -e 's/^  .rs.,\n//m' "$S"
check_in "$LOCATOR" "'Rs' dropped, locator suite only"

perl -0pi -e 's/const AMBIGUITY_PATTERNS: readonly RegExp\[\] = \[\n  \.\.\.CONDITIONAL_PATTERNS,\n  \.\.\.RUMOUR_PATTERNS,\n\];/const AMBIGUITY_PATTERNS: readonly RegExp[] = [...RUMOUR_PATTERNS];/' "$B"
check_in "$CLAIMS" "the union loses its conditional half, claim suite only"

perl -0pi -e 's/    const phrase = conditionalFramingIn\(sentence\);/    const phrase = null;/' "$X"
check_in "$AMOUNT" "no candidate ever dropped, extractor suite only"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
