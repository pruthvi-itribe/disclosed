#!/usr/bin/env bash
#
# Mutation harness for the insight-headline pipeline: the modules that decide
# what a public message about a named listed company is allowed to say.
#
# This is the second component in the project whose failures are ACTIVELY
# harmful rather than merely silent, and it is worse than the first. The amount
# extractor can publish a wrong NUMBER. This can publish a wrong number, a
# wrong COUNTERPARTY — attributing a commercial relationship between two named
# listed companies that does not exist — and a wrong CLAIM ABOUT HISTORY
# ("largest order in the last 30 days" computed over two days of data, every
# word of it true and the whole sentence false).
#
# So the guarantees this script breaks one at a time are:
#
#   1. THE COUNTERPARTY GUARDS. Four of the ten Schedule III awarding-entity
#      rows in the corpus deliberately anonymise the party — "International
#      Customer", "A leading private sector bank in India*", "A large packaging
#      manufacturer listed on Indian Stock Exchange". Each is a complete answer
#      to the regulator and a useless one for a headline. Loosen the article
#      test, the role-word test or the legal-form test and the pipeline starts
#      naming people who were deliberately not named.
#   2. THE DEGRADE RULE. A headline states a figure only when one was read out
#      of a document. Every mutation that lets the enriched form assemble
#      without a verified amount is a headline that reads like a fact.
#   3. THE UNIT ARITHMETIC. The one place in the headline pipeline that is not
#      verbatim. A wrong constant here is a 100x misreport with a company's
#      name attached, and it is invisible in every other signal.
#   4. THE ACTION TABLE'S REFUSAL TO GUESS. An unmapped category must return
#      null. A fallback that derives a phrase from the category text would ship
#      invented copy for every category NSE adds next.
#   5. THE COVERAGE CLAMP. The honesty control on every windowed claim.
#   6. THE TERMINAL STATES. A ZIP, a "-" sentinel, a truncated PDF and a 404
#      must never be retried. 3.3% of NSE's PDFs are truncated at origin, so a
#      terminal state that is not terminal is an unbounded retry loop pointed
#      at the exchange.
#   7. THE SSRF ALLOWLIST. The URL is exchange-supplied and this process makes
#      outbound requests with it.
#   8. THE FOLLOW-UP ALERT'S GATES. An operator's watchlist must silence both
#      lanes or neither.
#
# Usage:  bash tools/mutation/insight-headline-mutations.sh
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
#   - `counterparty.ts`'s `verbatim-mismatch` branch. Like the amount
#     extractor's, it is an internal-consistency assertion that no document can
#     provoke: it fires only if this module's own offset arithmetic is wrong.
#     `isTraceableName` is mutated directly instead, and is tested with a
#     deliberately corrupted offset and a deliberately invented word.
#   - The `"-"` sentinel branch in `decideAttachment`. Measured, it is an
#     equivalent mutant: `new URL('-')` throws, so removing the explicit check
#     reaches the same `no-attachment` verdict through the catch. The branch
#     stays because it states the exchange's contract where a reader will look
#     for it, and because a future URL parser that ACCEPTS `-` would make the
#     two paths diverge silently. The catch's own verdict is mutated instead.
#   - The ROUTINE_CATEGORIES set and the ACTION table's CONTENTS. Mutating a
#     table entry mutates the specification, not the code; the suite asserts
#     the table's invariants (normalised keys, upper-case phrases, singular
#     nouns, no advisory words) rather than its rows.
#   - `apps/ingest/src/main.ts`. Composition, verified by running the process.
#
# Tally, so a report can quote it without recounting: 45 mutations across eight
# groups, plus 4 independence checks = 49 `check` calls. (Was 38 + 4 = 42, and
# had drifted: seven mutations were added without it. Recounted against a full
# run, which reported 49 verdicts.)


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
LOGIC=$ROOT/libs/filings/src/logic
FILES=(
  "$LOGIC/counterparty.ts"
  "$LOGIC/headline.ts"
  "$LOGIC/amount-format.ts"
  "$LOGIC/action-phrase.ts"
  "$LOGIC/context-line.ts"
  "$LOGIC/attachment.ts"
  "$LOGIC/enrichment-policy.ts"
  "$LOGIC/document-verdict.ts"
  "$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts"
)
SUITE='(libs/filings/src/logic/(counterparty|headline|amount-format|action-phrase|context-line|attachment|enrichment-policy|document-verdict)|apps/ingest/src/enrichment/)'

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
    echo "  git -C $ROOT checkout -- libs/filings/src/logic apps/ingest/src/enrichment" >&2
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

C=$LOGIC/counterparty.ts
H=$LOGIC/headline.ts
M=$LOGIC/amount-format.ts
A=$LOGIC/action-phrase.ts
X=$LOGIC/context-line.ts
T=$LOGIC/attachment.ts
P=$LOGIC/enrichment-policy.ts
V=$LOGIC/document-verdict.ts
W=$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts

echo "=== the counterparty guards: what stops a description being named ==="

perl -0pi -e 's/    INDEFINITE_OPENER\.test\(name\) \|\|\n//' "$C"
check "indefinite-article tell removed ('A leading private sector bank' named)"

perl -0pi -e 's/    ANONYMISING_WORDS\.test\(name\) \|\|\n//' "$C"
check "role words allowed ('International Customer' named as a company)"

perl -0pi -e 's/    NON_ANSWERS\.test\(name\)/    false/' "$C"
check "explicit non-answers accepted ('Not disclosed' named)"

perl -0pi -e "s/  if \(!ENTITY_FORM_WORDS\.test\(name\)\) return refuse\('no-entity-form'\);//" "$C"
check "legal-form requirement dropped (any capitalised phrase becomes a party)"

perl -0pi -e 's/export const MAX_NAME_TOKEN_CHARS = 30;/export const MAX_NAME_TOKEN_CHARS = 500;/' "$C"
check "legibility bound removed (a PDF that lost its spaces reaches the wire)"

perl -0pi -e 's/export const MAX_NAME_CHARS = 80;/export const MAX_NAME_CHARS = 5_000;/' "$C"
check "name length unbounded (a paragraph published as a counterparty)"

perl -0pi -e 's/export const MIN_NAME_CHARS = 3;/export const MIN_NAME_CHARS = 0;/' "$C"
check "empty row accepted as a name"

perl -0pi -e 's{  /significant\\s\*terms/i,\n}{}' "$C"
check "primary row terminator removed (the next disclosure row joins the name)"

perl -0pi -e 's/export const PARTY_WINDOW_CHARS = 300;/export const PARTY_WINDOW_CHARS = 20_000;/' "$C"
check "row window widened past the whole disclosure table"

perl -0pi -e 's/\.filter\(\(line\) => line\.length > 0 && !ENUMERATOR_ONLY\.test\(line\)\)/.filter((line) => line.length > 0)/' "$C"
check "enumerator lines kept ('Genus Power Infrastructures Limited 2')"

perl -0pi -e 's/  const match = matches\[0\];/  const match = matches[matches.length - 1];/' "$C"
check "the LAST awarding row wins (a second order names the first one's party)"

perl -0pi -e 's/  return name\.split\(. .\)\.every\(\(word\) => evidence\.includes\(word\)\);/  return true;/' "$C"
check "rendered name never checked against its own evidence"

perl -0pi -e 's/  if \(documentText\.slice\(offset, offset \+ evidence\.length\) !== evidence\) \{\n    return false;\n  \}//' "$C"
check "provenance offset never verified"

echo ""
echo "=== the degrade rule: what stops an unverified figure reaching the wire ==="

perl -0pi -e 's/  if \(actionPhrase === null \|\| amount === null\) \{/  if (actionPhrase === null \&\& amount === null) {/' "$H"
check "degrade only when BOTH are missing (a raw category beside a figure)"

perl -0pi -e 's/  if \(actionPhrase === null \|\| amount === null\) \{/  if (actionPhrase === null) {/' "$H"
check "a refused amount no longer degrades the headline"

perl -0pi -e 's/      components: \{\n        symbol: oneLine\(symbol\),\n        actionPhrase,\n        amount,\n        counterparty: null,\n      \},/      components: { symbol: oneLine(symbol), actionPhrase, amount, counterparty },/' "$H"
check "a counterparty recorded on a degraded line"

perl -0pi -e "s/  value\.replace\(\/\\\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, MAX_COMPONENT_CHARS\);/  value.trim();/" "$H"
check "components no longer collapsed to one line (a headline splits in two)"

perl -0pi -e 's/export const MAX_COMPONENT_CHARS = 120;/export const MAX_COMPONENT_CHARS = 100_000;/' "$H"
check "component length unbounded"

echo ""
echo "=== the unit arithmetic: the one place that is not verbatim ==="

perl -0pi -e 's/export const CRORE = 10_000_000;/export const CRORE = 1_000_000;/' "$M"
check "crore constant wrong by 10x (a company's order over-reported)"

perl -0pi -e 's/export const LAKH = 100_000;/export const LAKH = 10_000;/' "$M"
check "lakh constant wrong by 10x"

perl -0pi -e "s/  if \(rupees >= CRORE\) return render\(rupees \/ CRORE, 'cr'\);\n//" "$M"
check "crore band removed (18.54 cr rendered as 1,853.67 lakh)"

perl -0pi -e 's/  if \(!Number\.isFinite\(rupees\) \|\| rupees < 0\) return null;/  if (false) return null;/' "$M"
check "NaN and negatives rendered rather than refused"

perl -0pi -e "s/  return \`\\\$\{head\.replace\(\/\\\\B\(\?=\(\\\\d\{2\}\)\+\(\?!\\\\d\)\)\/g, ','\)\},\\\$\{tail\}\`;/  return head.replace(\/\\\\B(?=(\\\\d{3})+(?!\\\\d))\/g, ',') + ',' + tail;/" "$M"
check "international digit grouping (one lakh crore renders as 100,000)"

perl -0pi -e 's/export const AMOUNT_DECIMALS = 2;/export const AMOUNT_DECIMALS = 0;/' "$M"
check "decimals dropped (18.54 cr becomes 19 cr)"

echo ""
echo "=== the action table: what stops a phrase being invented ==="

perl -0pi -e 's/  return ACTIONS\.get\(normalise\(category\)\) \?\? null;/  return (\n    ACTIONS.get(normalise(category)) ?? {\n      phrase: category.toUpperCase(),\n      noun: null,\n    }\n  );/' "$A"
check "unmapped categories fall back to the category text (invented copy)"

perl -0pi -e "s/  category\.trim\(\)\.toLowerCase\(\)\.replace\(\/\\\\s\+\/g, ' '\);/  category;/" "$A"
check "category no longer normalised (a case change drops the mapping)"

echo ""
echo "=== the coverage clamp: what stops a claim about data we do not hold ==="

perl -0pi -e 's/  const days = Math\.min\(windowDays, Math\.floor\(coverageDays\)\);/  const days = windowDays;/' "$X"
check "coverage clamp removed ('largest in 30 days' on two days of filings)"

perl -0pi -e 's/export const MIN_CONTEXT_WINDOW_DAYS = 2;/export const MIN_CONTEXT_WINDOW_DAYS = 0;/' "$X"
check "a window of zero days still makes a claim"

perl -0pi -e 's/    priorsWithAmount >= 1 &&/    priorsWithAmount >= 0 \&\&/' "$X"
check "'largest' claimed with nothing to compare against"

perl -0pi -e 's/    priorsAtLeastAsLarge === 0/    priorsAtLeastAsLarge <= 1/' "$X"
check "'largest' claimed while a larger prior exists"

perl -0pi -e 's/  if \(lastTwo >= 11 && lastTwo <= 13\) return `\$\{value\}th`;//' "$X"
check "teen ordinals wrong (11th order reported as 11st)"

perl -0pi -e 's/  return `\$\{day\}-\$\{MONTHS\[Number\(month\) - 1\]\}`;/  return `\$\{day\}-\$\{MONTHS[Number(month)]\}`;/' "$X"
check "month off by one in the 'first since' date"

echo ""
echo "=== the terminal states: what stops an unbounded retry against NSE ==="

# ZIP IS NOW A LEGITIMATE FETCH, so deleting the pdf guard no longer says what
# this mutation means. Forcing the guard TRUE does, and says both halves of it
# at once: an xlsx is fetched instead of refused, and the zip branch below it is
# never reached, so an archive is fetched with `kind: 'pdf'` and handed to the
# PDF parser exactly as before.
perl -0pi -e "s/if \(extension === 'pdf'\) \{/if (true) {/" "$T"
check "every extension fetched (a ZIP handed to the PDF parser, forever)"

perl -0pi -e "s/    return skip\('no-attachment'\);\n  \}/    return skip('not-a-pdf');\n  }/" "$T"
check "a value that is not a URL reported as the wrong terminal reason"

perl -0pi -e 's/    \(trusted\) => host === trusted \|\| host\.endsWith\(`\.\$\{trusted\}`\),/    (trusted) => host.endsWith(trusted),/' "$T"
check "host allowlist matched by bare suffix (evil-nseindia.com trusted)"

perl -0pi -e "s/  if \(NOT_FOUND_STATUSES\.has\(status\)\) \{\n    return \{ kind: 'terminal', reason: 'not-found' \};\n  \}//" "$P"
check "a 404 retried until the attempt budget is spent"

perl -0pi -e 's/  if \(attempts >= maxAttempts\) return null;//' "$P"
check "attempt budget removed (a permanently failing fetch never gives up)"

perl -0pi -e 's/  const delay = baseMs \* Math\.pow\(2, exponent\);/  const delay = baseMs * (1 << exponent);/' "$P"
check "backoff shifted rather than raised (32-bit overflow shortens it)"

perl -0pi -e "s/  text\.replace\(\/\\\\s\+\/g, ''\)\.length >= MIN_TEXT_LAYER_CHARS;/  text.length >= MIN_TEXT_LAYER_CHARS;/" "$P"
check "whitespace counted as a text layer (a raster scan reads as readable)"

perl -0pi -e "s/  return tail\\.includes\\(EOF_MARKER\\) \\? 'unreadable-pdf' : 'truncated-at-origin';/  return 'truncated-at-origin';/" "$P"
check "every parse failure blamed on NSE's storage tier without evidence"

perl -0pi -e 's/    body\.subarray\(Math\.max\(0, body\.length - EOF_SCAN_BYTES\)\),/    body,/' "$P"
check "the whole file scanned for %%EOF (a linearisation stub reads as complete)"

echo ""
echo "=== the reading order and the follow-up alert's gates ==="

perl -0pi -e "s/    amount\.outcome === 'extracted' \? extractCounterparty\(documentText\) : null;/    extractCounterparty(documentText);/" "$V"
check "counterparty extracted for a filing whose amount was refused"

perl -0pi -e "s/    const headline = form === 'enriched' \? enrichment\.headline : null;/    const headline = enrichment.headline;/" "$W"
check "follow-up sent for a degraded headline (a second copy of the first alert)"

# `passesContentGates` was split into `isNotRoutine` and `isWatchedByOperator`
# precisely because it folded a fact about the filing together with one
# operator's preference — see `alert-gate.ts`. So the mutation now drops only
# the watchlist half of `passesOperatorGates`, which is what this label always
# meant: the operator's watchlist silences the poller lane and not this one.
perl -0pi -e 's/ && isWatchedByOperator\(filing, this\.watchlist\)//' "$W"
check "watchlist ignored by the enrichment lane"

perl -0pi -e 's/    if \(!isWithinAlertWindow\(filing, now, this\.options\.alertWindowMs\)\) return 0;//' "$W"
check "cold-start window ignored (a backfill floods the chat with old news)"

echo ""
echo "=== independence checks ==="
echo "A guarantee must die to the suite that OWNS it, not merely to the corpus"
echo "measurement — otherwise deleting the fixture would silently cost coverage"
echo "that looks covered. And the corpus must earn its place by catching"
echo "regressions the hand-written cases were never written to imagine."

HAND='libs/filings/src/logic/counterparty.spec'
CORPUS='libs/filings/src/logic/counterparty-corpus'

perl -0pi -e 's/    INDEFINITE_OPENER\.test\(name\) \|\|\n//' "$C"
check_in "$HAND" "indefinite-article tell, hand-written suite only (no corpus)"

perl -0pi -e 's/    ANONYMISING_WORDS\.test\(name\) \|\|\n//' "$C"
check_in "$CORPUS" "role words allowed, corpus measurement only"

perl -0pi -e 's/export const MAX_NAME_TOKEN_CHARS = 30;/export const MAX_NAME_TOKEN_CHARS = 500;/' "$C"
check_in "$CORPUS" "legibility bound removed, corpus measurement only"

perl -0pi -e 's/  const days = Math\.min\(windowDays, Math\.floor\(coverageDays\)\);/  const days = windowDays;/' "$X"
check_in 'apps/ingest/src/enrichment/filing-context' "coverage clamp removed, the service suite only"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
