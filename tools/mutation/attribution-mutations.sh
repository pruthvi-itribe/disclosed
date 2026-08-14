#!/usr/bin/env bash
#
# Mutation harness for the attribution gate: the rule that decides whether a
# sentence found in a document is a sentence ABOUT the company that filed it.
#
# THIS IS AN ACTIVELY HARMFUL FAILURE, NOT A SILENT ONE. Everywhere else in this
# pipeline a broken guard means the product says less. Here it means the product
# attributes another company's statutory notice to a listed company, with that
# company's name on the wire — and it is verified against a real span, so it is
# indistinguishable on the dashboard from a true claim. It has already happened:
# SANOFI INDIA LIMITED, a pharmaceutical company, carries the stored claim
# "Shareholders approved MOA alteration to include telecom and communication
# cables business", which is a cable company's notice on the same newspaper
# page. `shared-page.ts`'s header names it; this script is what proves the
# suites would notice the rule going away.
#
# The guarantees broken one at a time:
#
#   1. WHAT COUNTS AS A COMPANY. A CIN is exact and the COUNT of distinct ones
#      is a property of the whole document. Every part of that sentence is load
#      bearing: bounded at both ends so a longer alphanumeric run cannot
#      contribute a false one, upper-cased before counting so a filer writing
#      its own CIN two ways is one company and not two, DISTINCT rather than
#      occurrences so a CIN in a page header on forty pages is still one
#      company. Loosen any of them and an ordinary filing refuses its own
#      claims; tighten any and the newspaper page walks through.
#   2. THE BOUND, AND THAT IT IS FOUR. Measured over 1,257 live documents: four
#      or more distinct CINs appear on 71 newspaper pages and on 3 filings from
#      every other category combined. Two is not the bound — a company's own
#      filing legitimately names a subsidiary or a counterparty, and a two-CIN
#      rule would have refused 111 sound claims. A mutation that moves the bound
#      either loses the SANOFI class or refuses the 111.
#   3. THE GATE ITSELF, at both ends. `isSharedPage` is the exported judgement;
#      `claim-eligibility.ts` inlines the same comparison so its refusal can
#      state the count. Both are mutated, because a suite that covers one and
#      not the other covers half a rule.
#   4. WHICH REFUSAL IS RECORDED. `shared-page` is a measured property of the
#      bytes and `newspaper-page` is a category name; the eligibility header
#      argues at length that they are different facts, and the admin panel
#      groups on them under "why no model read the document". Swapping one for
#      the other keeps the filing refused and destroys the count.
#   5. THE ORDER. The attribution test runs AFTER the covering-letter test, so a
#      300-character stub that happens to list four group CINs is reported as
#      the stub it is. "shared-page" is a claim about attribution and should
#      only be made about a document there was something to attribute.
#
# Usage:  bash tools/mutation/attribution-mutations.sh
# Exit:   0 only if every mutation applied AND was caught. IT EXITS 2 TODAY —
#         see THE TWO SURVIVORS below, which are the finding this harness was
#         written to produce and must not be tuned away.
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
# ==============================================================================
# THE TWO SURVIVORS: NOTHING FEEDS A CIN THE PATTERN HAS TO WORK TO SEE
# ==============================================================================
#
# Both mutations in the CIN scan's case handling survive, and they survive on
# ONE cause. Each was measured 2026-08-14 against `npx jest` with no filter:
# 147 suites and 5,711 tests, all passing, with the mutation in place.
#
#   1. `[A-Za-z]{2}` and `[A-Za-z]{3}` narrowed to `[A-Z]`. The header says why
#      the lower-case half is there — "Matched case-insensitively because
#      filings print it both ways" — and no test disagrees when it goes.
#   2. `.toUpperCase()` dropped before the Set is built. The header says why
#      that is there too: one company writing its own CIN two ways "would
#      otherwise push an ordinary filing over the bound by itself".
#
# THE CAUSE IS A TEST THAT ONLY LOOKS LIKE IT COVERS THIS.
# `shared-page.spec.ts`'s first case is named "finds a CIN however the filing
# cases it". It feeds `CIN: <upper> and cin: <lower>` and asserts the set has
# ONE member. But the pattern's FIRST character class is `[LU]`, not `[LUlu]`,
# so the lower-cased half never matches at all: measured, that fixture yields
# exactly one match, `L24239MH1956PLC000001`. The test therefore asserts 1 == 1
# for a reason it does not intend, and it holds whether the rest of the pattern
# is case-insensitive or not and whether the upper-casing runs or not. Nothing
# else in the repository feeds a CIN that is not wholly upper-case — the three
# corpus fixtures print theirs upper-case and `claim-eligibility.spec.ts` builds
# its pages from an upper-case template.
#
# WHAT IT COSTS IF EITHER BREAKS. Both directions are live:
#   - a page printing `L24239mh1956plc000001` names ZERO companies, so
#     `identities.size` is 0 and it is sent to a model with the attribution gate
#     reporting nothing wrong. That is the SANOFI failure with the guard still
#     nominally in place.
#   - a filer printing its own CIN in two visible spellings counts as two
#     companies, which is half the bound spent on one company.
#
# AND THE PATTERN ITSELF IS NARROWER THAN ITS COMMENT CLAIMS. `[LU]` is not
# case-insensitive, so a wholly lower-cased CIN is invisible to this gate today.
# Whether that is worth widening is a measurement — how many live documents
# print one — and is a task-list entry, not a change smuggled in here.
#
# THEY ARE LEFT IN AND LEFT FAILING. Weakening them to make this script exit 0
# would be fitting the harness to the suite, which is the exact failure these
# scripts exist to expose. The missing tests are two lines in the module's own
# spec, and this harness does not touch specs.
#
# Tally, so a report can quote it without recounting: 17 mutations across three
# groups, plus 3 independence checks = 20 `check` calls.


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
  "$LOGIC/shared-page.ts"
  "$LOGIC/claim-eligibility.ts"
)

# The rule's own suite, its consumer's suite, the acceptance corpus, and the
# worker that runs the consumer in production. The corpus earns its place: it
# holds three real filings naming one CIN each (SWIGGY, BIOCON) and none
# (WELENT), so it is the only thing here that would notice a bound tightened
# until real single-company filings stop being read. The worker earns its place
# because `companyIdentitiesIn` is documented NEVER TO THROW and the worker is
# where a throw would cost the whole enrichment rather than the claim.
SUITE='(libs/filings/src/logic/(shared-page|claim-eligibility|claim-corpus)|apps/ingest/src/enrichment/enrichment.worker)'

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

# check_in <suite-regex> <label>  run ONLY the named suite
# check <label>                   run every suite that depends on the gate
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

S=$LOGIC/shared-page.ts
E=$LOGIC/claim-eligibility.ts

echo "=== what counts as a company: the CIN scan ==="

# KNOWN SURVIVOR 1 of 2. Read THE TWO SURVIVORS above before touching this
# line: it is the finding, not a stale anchor, and the fix is a test rather than
# a smaller mutation. Anchored on the two letter runs only — the `\b` bounds are
# a separate guarantee with its own mutation below.
# RE-ANCHORED 2026-08-14, and the reason is the point of this whole harness.
# This mutation SURVIVED when it was written: the scan read `[LU]...[A-Za-z]`,
# so a lower-case CIN matched nothing, the gate failed OPEN, and a shared page
# printed in lower case walked through the attribution refusal. The spec's
# "finds a CIN however the filing cases it" passed the entire time, because it
# asserted a count of 1 that it got from the upper-case half alone.
#
# The scan is now `[A-Z]...` with the `i` flag, so making it case-sensitive is
# dropping that flag rather than narrowing the classes. Anchored on the flags,
# which is the smallest fragment that still expresses the mutation.
perl -0pi -e 's/\\d\{6\}\\b\/gi;/\\d{6}\\b\/g;/' "$S"
check "CIN matched case-sensitively (a lower-case CIN names no company)"

perl -0pi -e 's|/\\b\[LU\](.*?)\\d\{6\}\\b/g|/[LU]$1\\d{6}/g|' "$S"
check "CIN bounds dropped (an order number contributes a company)"

# KNOWN SURVIVOR 2 of 2, same cause as the first.
perl -0pi -e 's/\(\(cin\) => cin\.toUpperCase\(\)\)/((cin) => cin)/' "$S"
check "identities not upper-cased (one filer's two spellings are two companies)"

perl -0pi -e 's/found\.map\(\(cin\) => cin\.toUpperCase\(\)\)/found.map((cin, at) => cin.toUpperCase() + at)/' "$S"
check "occurrences counted, not distinct (a CIN in a page header refuses itself)"

# The header's claim is NEVER THROWS, and it is not decoration: the worker calls
# this inside per-filing containment, so a throw here costs the enrichment —
# the amount, the counterparty and the headline — and not merely the claims.
perl -0pi -e 's/match\(COMPANY_IDENTITY\) \?\? \[\];/match(COMPANY_IDENTITY) as RegExpMatchArray;/' "$S"
check "no-match fallback removed (a document naming none throws)"

echo ""
echo "=== the bound: four, and why not three or five ==="

perl -0pi -e 's/SHARED_PAGE_MIN_IDENTITIES = 4;/SHARED_PAGE_MIN_IDENTITIES = 2;/' "$S"
check "bound lowered to two (the 111 sound claims the measurement kept)"

perl -0pi -e 's/SHARED_PAGE_MIN_IDENTITIES = 4;/SHARED_PAGE_MIN_IDENTITIES = Number.MAX_SAFE_INTEGER;/' "$S"
check "bound removed (no document is ever a shared page)"

# The constant is left at 4 on purpose. `shared-page.spec.ts` pins the LITERAL,
# so a mutation that edits the number is killed by that pin whether or not any
# behaviour is tested; an off-by-one at the comparison is the same neutering
# with the pin satisfied, and only a behavioural test can see it.
perl -0pi -e 's/\.size >= SHARED_PAGE_MIN_IDENTITIES;/.size > SHARED_PAGE_MIN_IDENTITIES;/' "$S"
check "off-by-one at the bound, constant untouched (a four-CIN page is read)"

perl -0pi -e 's/\.size >= SHARED_PAGE_MIN_IDENTITIES;/.size < SHARED_PAGE_MIN_IDENTITIES;/' "$S"
check "isSharedPage inverted (ordinary filings refused, shared pages read)"

perl -0pi -e 's/\.size >= SHARED_PAGE_MIN_IDENTITIES;/.size < 0;/' "$S"
check "isSharedPage always false (the exported gate removed entirely)"

echo ""
echo "=== the consumer: the same comparison, inlined so it can state the count ==="

perl -0pi -e 's/if \(identities\.size >= SHARED_PAGE_MIN_IDENTITIES\) \{/if (identities.size < 0) {/' "$E"
check "the gate removed from claimEligibility (every shared page reaches a model)"

perl -0pi -e 's/if \(identities\.size >= SHARED_PAGE_MIN_IDENTITIES\) \{/if (identities.size < SHARED_PAGE_MIN_IDENTITIES) {/' "$E"
check "the gate inverted at claimEligibility (a one-CIN filing refused instead)"

perl -0pi -e 's/if \(identities\.size >= SHARED_PAGE_MIN_IDENTITIES\) \{/if (identities.size > SHARED_PAGE_MIN_IDENTITIES) {/' "$E"
check "off-by-one at claimEligibility (SANOFI's four-company page is read)"

# A refactor that reads the wrong text is not hypothetical: `filing.summary` is
# in scope, is a string, and is the field every other test in this module reads.
perl -0pi -e 's/const identities = companyIdentitiesIn\(documentText\);/const identities = companyIdentitiesIn(filing.summary);/' "$E"
check "identities counted in the summary, not the document"

# THE ORDER, hoisted the wrong way round: the length test now runs only when the
# document is NOT a shared page, so a 300-character stub listing four group CINs
# reports an attribution problem instead of being the stub it is.
perl -0pi -e 's/if \(documentText\.length < MIN_CLAIM_DOCUMENT_CHARS\) \{/if (documentText.length < MIN_CLAIM_DOCUMENT_CHARS \&\& companyIdentitiesIn(documentText).size < SHARED_PAGE_MIN_IDENTITIES) {/' "$E"
check "attribution tested before length (a covering letter reported as shared)"

perl -0pi -e "s/'shared-page',/'newspaper-page',/" "$E"
check "refusal recorded as newspaper-page (a measured property told as a name)"

perl -0pi -e 's/names \$\{identities\.size\} companies/names several companies/' "$E"
check "the count dropped from the reason (nothing an operator can act on)"

echo ""
echo "=== independence checks ==="
echo "The rule is written once and judged in two places, so each place must own"
echo "its own guarantee: a consumer that only dies because the unit's spec is"
echo "red has no coverage of its own. And the corpus must notice a bound tight"
echo "enough to refuse the real single-company filings this product exists for."

UNIT='libs/filings/src/logic/shared-page'
CONSUMER='libs/filings/src/logic/claim-eligibility'
CORPUS='libs/filings/src/logic/claim-corpus'

perl -0pi -e 's/\.size >= SHARED_PAGE_MIN_IDENTITIES;/.size > SHARED_PAGE_MIN_IDENTITIES;/' "$S"
check_in "$UNIT" "off-by-one at the bound, shared-page suite only"

perl -0pi -e 's/if \(identities\.size >= SHARED_PAGE_MIN_IDENTITIES\) \{/if (identities.size < 0) {/' "$E"
check_in "$CONSUMER" "gate removed, claim-eligibility suite only"

# SWIGGY names one CIN and BIOCON names one; both are asserted eligible. A bound
# of one is the tightening that refuses a real press release and a real investor
# presentation, and the acceptance corpus is the only place that says so.
perl -0pi -e 's/SHARED_PAGE_MIN_IDENTITIES = 4;/SHARED_PAGE_MIN_IDENTITIES = 1;/' "$S"
check_in "$CORPUS" "bound lowered to one, corpus only (two real filings refused)"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived or errored, $NOOPS no-op (harness stale)."
  echo "        TWO SURVIVORS ARE EXPECTED — the CIN scan's case handling is"
  echo "        untested in both directions, on one cause. See THE TWO"
  echo "        SURVIVORS in this file's header. A THIRD is a new gap."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
