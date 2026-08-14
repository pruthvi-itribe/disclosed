#!/usr/bin/env bash
#
# Mutation harness for claim extraction: the modules that decide whether a
# sentence a language model wrote about a named listed company may be published.
#
# THIS IS THE HIGHEST-CONSEQUENCE COMPONENT IN THE PROJECT. The amount extractor
# can publish a wrong number and the headline composer can attribute a
# commercial relationship that does not exist; both read from the document. This
# one takes text a MODEL wrote and decides whether the document said it. A model
# asked to compress a filing will eventually produce a fluent, plausible,
# entirely invented corporate statement, and nothing downstream can tell one
# from a real one — so every guarantee below is the only thing standing between
# the wire and an invented claim about a real company.
#
# The guarantees broken one at a time:
#
#   1. THE VERBATIM SPAN GATE. A claim must quote a sentence that is in the
#      document, matched character for character with only whitespace runs
#      collapsed. Every mutation that loosens the match — folding case,
#      substring-matching a fragment, skipping the check entirely — publishes a
#      sentence the filing does not contain.
#   2. THE OFFSET MAP. What is stored as evidence is the DOCUMENT'S bytes at the
#      matched position. A wrong offset ships provenance pointing at the wrong
#      part of the document, which survives human review — worse than none.
#   3. THE NUMBER RULE, SPAN-SCOPED. A figure in a claim must be in the sentence
#      it quotes. Widen it to the document and any two-digit number in a
#      forty-page presentation supports any claim; drop the canonicalisation and
#      a filer's comma placement refuses true claims; add arithmetic and
#      "₹10,000 Cr" becomes "100 billion" — the same money, different evidence.
#   4. THE ADVISORY FILTER. Enforced on the output because a prompt is a request
#      and a gate is a control. One unhonoured instruction is a message reading
#      "positive for the stock" over a filing, which is the SEBI
#      research-analyst line.
#   5. THE INDIVIDUAL AND LEGAL FILTERS. A wire line about a person is a
#      defamation claim rather than a correction. Both fail closed.
#   6. THE CONDITIONAL CHECK. A claim read out of "a letter of intent, subject
#      to..." publishes an unconfirmed event as fact.
#   7. THE ELIGIBILITY GATE. Not a correctness control — a cost one — but a
#      mutation that opens it wide is a bill, and one that closes it is a
#      product that says nothing.
#   8. THE PARSE-RETRY WINDOW. The filing this pipeline lost. Terminal too
#      early loses a document NSE was still uploading; terminal too late is an
#      unbounded retry loop pointed at the exchange.
#   9. THE EXTRACTOR'S CONTRACT. It must never throw and must check
#      `stop_reason` before it reads `content`.
#
# Tally, so a report can quote it without recounting: 66 `check` calls in all,
# including 4 independence checks.
#
# Usage:  bash tools/mutation/claim-extraction-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished — see
# tools/mutation/alert-service-mutations.sh for the full rationale, which this
# script mirrors: CAUGHT, CRASHED, SURVIVED (a real test gap) and NO-OP (the
# perl pattern matched nothing, i.e. harness staleness, NOT a test gap). A
# mutation that does not type-check is COMPILE and counts as a failure, because
# a mutation that never ran proved nothing.
#
# Safety: refuses to run on a dirty tree, backs up every file it touches,
# verifies each restore byte-for-byte, and exits rather than returns on INT/TERM.
#
# NOT covered by mutation, and why:
#
#   - The CONTENTS of CLAIM_BEARING_CATEGORIES, ADVISORY_PATTERNS and
#     INDIVIDUAL_PATTERNS. Mutating a table entry mutates the specification
#     rather than the code; the suites assert the invariants (lower-cased keys,
#     a stated reason on every pattern, the six real published lines surviving
#     both filters) and pin the load-bearing rows against literals.
#   - The prompt TEXT. It is a request, not a control; every rule it states is
#     also enforced by claim-verify.ts, and those enforcements are mutated here.
#     What IS mutated is the schema's field order and the reply parser, because
#     those are code.
#   - apps/ingest/src/ingest.module.ts and the entrypoints. Composition.

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
  "$LOGIC/claim-span.ts"
  "$LOGIC/claim-numbers.ts"
  "$LOGIC/claim-period.ts"
  "$LOGIC/claim-summary.ts"
  "$LOGIC/claim-advisory.ts"
  "$LOGIC/claim-eligibility.ts"
  "$LOGIC/claim-verify.ts"
  "$LOGIC/claim-line.ts"
  "$LOGIC/claim-prompt.ts"
  "$LOGIC/parse-retry.ts"
  "$ROOT/libs/filings/src/llm/claude-claim-extractor.ts"
  "$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts"
)
SUITE='(libs/filings/src/(logic/(claim|parse-retry)|llm/)|apps/ingest/src/enrichment/)'

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
S=$LOGIC/claim-span.ts
D=$LOGIC/claim-period.ts
M=$LOGIC/claim-summary.ts
N=$LOGIC/claim-numbers.ts
A=$LOGIC/claim-advisory.ts
E=$LOGIC/claim-eligibility.ts
V=$LOGIC/claim-verify.ts
L=$LOGIC/claim-line.ts
P=$LOGIC/claim-prompt.ts
R=$LOGIC/parse-retry.ts
X=$ROOT/libs/filings/src/llm/claude-claim-extractor.ts
W=$ROOT/apps/ingest/src/enrichment/enrichment.worker.ts

echo "=== the verbatim span gate: the only check that a document said it ==="

perl -0pi -e 's/  const at = haystack\.text\.indexOf\(needle\);/  const at = haystack.text.toLowerCase().indexOf(needle.toLowerCase());/' "$S"
check "span match folds case ('no' and 'No' become the same disclosure)"

perl -0pi -e 's/  if \(needle\.length < MIN_SPAN_CHARS\) return null;//' "$S"
check "minimum span dropped (a company name becomes evidence for anything)"

perl -0pi -e 's/export const MIN_SPAN_CHARS = 12;/export const MIN_SPAN_CHARS = 1;/' "$S"
check "minimum span reduced to one character"

perl -0pi -e 's/export const MAX_SPAN_CHARS = 400;/export const MAX_SPAN_CHARS = 100_000;/' "$S"
check "span length unbounded (a whole document quoted into a Telegram message)"

# DELETED 2026-08-14: "whitespace collapse widened to swallow word characters".
# The collapse and its index map moved out of `claim-span.ts` into
# `span-canon.ts` when the projection grew repairs beyond whitespace, and this
# harness backs up neither that file nor runs its suite (`$SUITE` matches
# `logic/claim*`). Mutating it would leave a file modified after the run.

echo ""
echo "=== the offset map: evidence must be the document's own bytes ==="

perl -0pi -e 's/  const start = haystack\.origin\[at\];/  const start = at;/' "$S"
check "offset reported in collapsed coordinates (evidence points elsewhere)"

# The end is now one past the SOURCE index of the last projected character
# rather than the next map entry — the ternary this used to pin is gone, and the
# `+ 1` is the whole of what is left to break.
perl -0pi -e 's/const end = haystack\.origin\[lastIndex\] \+ 1;/const end = haystack.origin[lastIndex];/' "$S"
check "span end short by one character (evidence loses its last character)"

perl -0pi -e 's/  return \{ offset: start, evidence: documentText\.slice\(start, end\) \};/  return { offset: start, evidence: needle };/' "$S"
check "the caller's version stored as evidence, not the document's"

echo ""
echo "=== the number rule, span-scoped ==="

perl -0pi -e 's/  const supported = new Set\(figuresIn\(span\)\);/  const supported = new Set<string>();\n  figuresIn(span);\n  return [];/' "$N"
check "number check disabled (a claim states a figure its source does not)"

perl -0pi -e "s/  token\.replace\(\/,\/g, ''\)/  token.replace(\/ZZZ\/g, '')/" "$N"
check "comma canonicalisation dropped (10,000 stops matching 10000)"

perl -0pi -e 's/const NUMBER_TOKEN = .*;/const NUMBER_TOKEN = \/[0-9]\/g;/' "$N"
check "figures read one digit at a time (any claim supported by any span)"

perl -0pi -e 's/    \(value\) => !supported\.has\(value\),/    () => false,/' "$V" 2>/dev/null
perl -0pi -e 's/    \(value\) => !supported\.has\(value\),/    () => false,/' "$N"
check "unsupported figures reported as none"

echo ""
echo "=== the advisory and individual filters, enforced on the output ==="

perl -0pi -e 's/  const advisory = advisoryHitIn\(text\);/  const advisory = null;/' "$V"
check "advisory framing published ('positive for the stock' reaches the wire)"

perl -0pi -e 's/  const individual = individualHitIn\(text\) \?\? individualHitIn\(claim\.span\);/  const individual = individualHitIn(text);/' "$V"
check "a claim read from a sentence naming a person is published"

perl -0pi -e 's/  const legal = LEGAL_BLOCK_PATTERNS\.find\(\n    \(pattern\) => pattern\.test\(text\) \|\| pattern\.test\(claim\.span\),\n  \);/  const legal = undefined;/' "$V"
check "litigation and enforcement claims published"

perl -0pi -e 's/  if \(hasAmbiguityKeyword\(claim\.span\)\) \{/  if (false) {/' "$V"
check "a claim read out of a conditional sentence published as fact"

perl -0pi -e 's/  for \(const \{ pattern, why \} of patterns\) \{/  for (const { pattern, why } of patterns.slice(0, 0)) {/' "$A"
check "every forbidden-phrase pattern skipped"

echo ""
echo "=== the gate's bookkeeping ==="

perl -0pi -e 's/  const match = findVerbatimSpan\(documentText, claim\.span\);/  const match = { offset: 0, evidence: claim.span };/' "$V"
check "the span is never looked for in the document at all"

perl -0pi -e "s/seen\.has\(key\(result\.text\)\)/seen.has(key(result.text) + 'ZZZ')/" "$V"
check "the same claim published twice on one line"

perl -0pi -e 's/    claims: ranked\.slice\(0, limit\),/    claims: ranked,/' "$V"
check "per-filing claim cap removed"

# The digits are not pinned: the cap was 120 and became 200 on 2026-08-13, and
# pinning the value is what made this a no-op for a day. What must not change is
# that there IS a cap.
perl -0pi -e 's/export const MAX_CLAIM_CHARS = \d[\d_]*;/export const MAX_CLAIM_CHARS = 100_000;/' "$V"
check "claim length unbounded"

perl -0pi -e 's/  if \(text\.length < MIN_CLAIM_CHARS\) \{/  if (false) {/' "$V"
check "an empty claim accepted"

echo ""
echo "=== the wire line ==="

perl -0pi -e "s/  return parts\.length === 0 \? null : \`\\\${head} \\\${parts\.join\(CLAIM_SEPARATOR\)}\`;/  return \`\\\${head} \\\${parts.join(CLAIM_SEPARATOR)}\`;/" "$L"
check "a bare SYMBOL: emitted when there is nothing to say"

perl -0pi -e "s/export const CLAIM_SEPARATOR = ' \|\| ';/export const CLAIM_SEPARATOR = ' ';/" "$L"
check "claim separator removed (two claims read as one sentence)"

perl -0pi -e 's/    if \(length \+ cost > MAX_CLAIM_LINE_CHARS\) break;//' "$L"
check "line length unbounded (a message Telegram discards outright)"

echo ""
echo "=== the eligibility gate: the cost control ==="

# The fail-CLOSED category list and the reused routine list are both gone —
# `claim-eligibility.ts` argues at length why an allowlist of category names
# cannot be shown to be safe. What replaced them is two fail-OPEN triage skips,
# named categories measured at 6.8% and 16.7% yield, and those are the two
# category tests there are now to break. A renamed category must still be READ,
# so these mutations open the gate rather than closing it.
perl -0pi -e "s/category === NEWSPAPER_PAGE_CATEGORY/category === 'no-category-is-ever-this'/" "$E"
check "newspaper pages sent to a model (the 6.8%-yield triage skip removed)"

perl -0pi -e "s/category === CON_CALL_INTIMATION_CATEGORY/category === 'no-category-is-ever-this'/" "$E"
check "earnings-call intimations sent to a model (the 16.7%-yield skip removed)"

perl -0pi -e 's/  if \(isLegallyBlocked\(filing\)\) \{/  if (false) {/' "$E"
check "a litigation filing reaches the extractor"

perl -0pi -e 's/  if \(documentText\.length < MIN_CLAIM_DOCUMENT_CHARS\) \{/  if (false) {/' "$E"
check "covering letters sent to a model"

# DELETED 2026-08-14: "documents with no claim vocabulary sent to a model".
# `CLAIM_SIGNAL_PATTERN` was removed on purpose and has no successor — it
# refused 100 of 932 live filings for not using one of forty words, which is the
# same fail-closed shape as the category list. There is no code left to break.

echo ""
echo "=== the reply parser: the model's output is untrusted input ==="

perl -0pi -e "s/  typeof value === 'string' &&\n  \(CLAIM_KINDS as readonly string\[\]\)\.includes\(value\);/  typeof value === 'string';/" "$P"
check "an unknown claim kind accepted (the ranker reads undefined)"

perl -0pi -e "s/    if \(typeof entry !== 'object' \|\| entry === null\) continue;//" "$P"
check "a null or bare-string entry accepted"

perl -0pi -e "s/  if \(typeof raw !== 'object' \|\| raw === null\) return \[\];//" "$P"
check "a null reply dereferenced instead of refused"

perl -0pi -e 's/  const document = input\.documentText\.slice\(0, cap\);/  const document = input.documentText;/' "$P"
check "the document cap removed from the request"

echo ""
echo "=== the extractor's contract ==="

perl -0pi -e "s/      if \(stopReason === 'refusal'\) \{/      if (false) {/" "$X"
check "a model refusal read as a parse failure instead"

# Retargeted when the adapter moved onto the shared provider boundary: the
# parse now happens inside `claimsFromText`, which both providers call — and
# again when `ask` started returning a decoded reply, so what is handed in is
# `reply.text`/`reply.usage` rather than the raw message.
perl -0pi -e "s/return claimsFromText\(reply\.text, reply\.usage\);/return { outcome: 'ok', claims: [] };/" "$X"
check "reply parsing bypassed (every filing records 'the model found nothing')"

perl -0pi -e "s/    if \(apiKey\.trim\(\)\.length === 0\) return null;//" "$X"
check "an extractor built with no key (700 failing calls a day)"

echo ""
echo "=== the parse-retry window: the filing this pipeline lost ==="

perl -0pi -e 's/  if \(!RACEABLE_PARSE_FAILURES\.has\(reason\)\) return terminal;//' "$R"
check "a ZIP and a 404 retried as if they were an upload race"

perl -0pi -e 's/  if \(parseAttempts >= maxParseAttempts\) return terminal;//' "$R"
check "parse attempts unbounded (an infinite loop pointed at NSE)"

perl -0pi -e 's/  if \(!Number\.isFinite\(age\) \|\| age >= windowMs\) return terminal;/  if (age >= windowMs) return terminal;/' "$R"
check "an unreadable timestamp treated as a young filing (NaN >= x is false)"

perl -0pi -e 's/  if \(age \+ delay >= windowMs\) return terminal;//' "$R"
check "a retry scheduled past the window it will then be refused by"

echo ""
echo "=== the worker's claim stage ==="

perl -0pi -e 's/    const eligibility = claimEligibility\(filing, documentText\);/    const eligibility = { eligible: true } as ReturnType<typeof claimEligibility>;/' "$W"
check "the eligibility gate bypassed by the worker"

perl -0pi -e "s/    private readonly claimExtractor: ClaimExtractor \| null = null,/    private readonly claimExtractor: ClaimExtractor | null = { extract: async () => ({ outcome: 'ok', claims: [] }) },/" "$W"
check "an absent extractor silently replaced by one that finds nothing"

perl -0pi -e 's/    const result = checkOne\(proposal, input\.documentText\);/    const result = { text: proposal.text, span: proposal.span, kind: proposal.kind, periodSpan: null };/' "$V"
check "the gate skipped entirely: proposed claims published unverified"

perl -0pi -e 's/      maxClaims: this\.options\.maxClaims,/      maxClaims: Number.MAX_SAFE_INTEGER,/' "$W"
check "the worker ignores the configured per-filing claim cap"

echo ""
echo "=== the follow-up alert's claim gate ==="

# The guard grew a third reason to send (a results line) and the condition was
# reflowed across four lines, so what is pinned is the EARLY RETURN rather than
# the condition — `\s*` between the two statements so the next reflow does not
# stale it again. Dropping the return announces a filing with nothing to say.
perl -0pi -e 's/this\.noteMutedLine\(filing, enrichment, now\);\s*\n\s*return 0;/this.noteMutedLine(filing, enrichment, now);/' "$W"
check "a follow-up sent for a filing with neither a figure nor a claim"

# What reaches the wire is `wireClaimLine` — the MUTED line — not the stored
# one, so that is the name to break.
perl -0pi -e 's/claimLine: wireClaimLine,/claimLine: null,/' "$W"
check "the claim line dropped on its way to the wire"


echo ""
echo "=== the fiscal period: a label, never its bare digits ==="

perl -0pi -e 's/  const period = supportPeriods\(\{/  const period = { missing: [] as string[], evidence: null }; void supportPeriods({/' "$V"
check "the period check bypassed entirely"

perl -0pi -e 's/export const PERIOD_CONTEXT_CHARS = 800;/export const PERIOD_CONTEXT_CHARS = 100_000_000;/' "$D"
check "the period neighbourhood widened to the whole document"

perl -0pi -e 's/  const inSpan = periodsIn\(input\.span\);/  const inSpan = new Set(["Q1FY27", "Q4FY26", "Q3FY24", "Q2FY23"]);/' "$D"
check "every period treated as if the span had stated it"

perl -0pi -e 's/    const hit = nearby\.find\(\(label\) => label\.canonical === period\);/    const hit = nearby[0];/' "$D"
check "any nearby period accepting any claimed period"

perl -0pi -e 's/  if \(missing\.length > 0\) return \{ missing, evidence: null \};/  if (missing.length > 1000) return { missing, evidence: null };/' "$D"
check "an unsupported period reported as supported"

perl -0pi -e 's/\? `\$\{prefix\}\$\{first\.slice\(-2\)\}`/? `${prefix}${first}`/' "$D"
check "FY2027 and FY27 no longer the same fiscal year"

perl -0pi -e 's/\$\{first\.slice\(-2\)\}-\$\{second\.slice\(-2\)\}/\${second.slice(-2)}/' "$D"
check "a hyphenated range collapsed into one of its endpoints"

perl -0pi -e 's/    const inPeriod = periods\.some\(\n      \(period\) => start < period\.end && end > period\.start,\n    \);/    const inPeriod = false;/' "$N"
check "a period's digits counted as figures again, which is the original bug"

perl -0pi -e 's/  const supported = new Set\(figuresIn\(span\)\);/  const supported = new Set(numbersIn(span));/' "$N"
check "the span side counting a period's digits as figures it can support"

echo ""
echo "=== the summary, which is NOT a claim and never reaches the wire ==="

perl -0pi -e 's/      documentSummary: claims\.summary,/      documentSummary: null,/' "$W"
check "the summary dropped on its way to the database"

perl -0pi -e 's/  const advisory = advisoryHitIn\(text\);/  const advisory: string | null = null;\n  void advisoryHitIn(text);/' "$M"
check "the advisory filter removed from the summary"

perl -0pi -e 's/  const legal = LEGAL_BLOCK_PATTERNS\.find\(\(pattern\) => pattern\.test\(text\)\);/  const legal = undefined;/' "$M"
check "the legal blocklist removed from the summary"

perl -0pi -e 's/  if \(text\.length > MAX_SUMMARY_CHARS\) \{/  if (text.length > MAX_SUMMARY_CHARS * 1000) \{/' "$M"
check "the summary length bound widened a thousandfold"

perl -0pi -e 's/  if \(text\.length < MIN_SUMMARY_CHARS\) \{/  if (text.length < 0) \{/' "$M"
check "a two-word fragment accepted as a summary"

perl -0pi -e 's/    return \{ outcome: .refused., reason: .empty., detail: .no summary. \};/    return { outcome: \x27ok\x27, summary: String(raw) };/' "$M"
check "a non-string reply coerced into a summary"

echo ""
echo "=== independence checks ==="
echo "A guarantee must die to the suite that OWNS it, not merely to the corpus"
echo "measurement — otherwise deleting the fixture would silently cost coverage"
echo "that looks covered. And the corpus, which is the three real filings this"
echo "product failed on, must earn its place by catching regressions the"
echo "hand-written cases were never written to imagine."

HAND='libs/filings/src/logic/claim-(span|verify)\.spec'
CORPUS='libs/filings/src/logic/claim-corpus'

perl -0pi -e 's/  const at = haystack\.text\.indexOf\(needle\);/  const at = haystack.text.toLowerCase().indexOf(needle.toLowerCase());/' "$S"
check_in "$HAND" "case-folded span match, hand-written suites only (no corpus)"

perl -0pi -e 's/  const match = findVerbatimSpan\(documentText, claim\.span\);/  const match = { offset: 0, evidence: claim.span };/' "$V"
check_in "$CORPUS" "span never looked for, the real-filings corpus only"

perl -0pi -e 's/  const supported = new Set\(figuresIn\(span\)\);/  const supported = new Set<string>();\n  figuresIn(span);\n  return [];/' "$N"
check_in "$CORPUS" "number check disabled, the real-filings corpus only"

perl -0pi -e 's/  if \(documentText\.length < MIN_CLAIM_DOCUMENT_CHARS\) \{/  if (false) {/' "$E"
check_in "$CORPUS" "covering-letter bound removed, the real-filings corpus only"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
