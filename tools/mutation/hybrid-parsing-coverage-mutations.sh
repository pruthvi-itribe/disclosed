#!/usr/bin/env bash
#
# Mutation harness for the HYBRID PARSING and UNIVERSAL COVERAGE modules: the
# code that decides which parser reads a document, what it does when the
# expensive one is not there, whether the number it read can be read at all, and
# how much of what this pipeline says about a filing may leave the building.
#
# WHY THESE SEVEN MODULES ARE ONE HARNESS. They are the two halves of a single
# change and they fail into each other. The parsing half added an OPTIONAL
# dependency — a Python service a deployment may simply not run — and an
# optional dependency is the one kind whose absence is silent by construction:
# every failure resolves to "use what pdf-parse gave you", every test still
# passes, and the only thing distinguishing a healthy deployment from one whose
# Docling has been down since Tuesday is a string nobody asserts on. The
# coverage half removed a category allowlist that had made 71% of filings
# produce nothing, and replaced the filter with a LABEL — which means the label
# is now the only thing standing between the dashboard and the wire.
#
# The guarantees broken one at a time:
#
#   1. THE ROUTE IS DECIDED AFTER THE CHEAP READ, AND THE DEGRADED PATH WINS.
#      `!doclingAvailable` is stated first so nothing can shadow it; a machine
#      with no Python must never route a filing to a parser it cannot run.
#      Scanned must beat results, because without OCR there is no text for the
#      layout pass to align. And the two page ceilings are DIFFERENT numbers for
#      different reasons — 40 for OCR at 2.5-4 s a page, 150 for layout-only —
#      so one shared bound would either starve the cheap route or hand a worker
#      lease to a 640-page annual report.
#   2. `basisReachFor` IS THE MOST DANGEROUS FUNCTION IN THE PARSING HALF.
#      Reading Docling markdown with the pdf-parse bound refuses 74 of 77
#      measured tables; reading pdf-parse output with the Docling bound admits
#      statement/heading pairings that module measured as false at 936
#      characters and up. Both directions are mutated.
#   3. THE AVAILABILITY LATCH, AND THE TWO THINGS THAT MUST NOT OPEN IT. Only
#      the ABSENCE of a response is evidence about the SERVICE. A reply the
#      client cannot read is a statement about ONE DOCUMENT, and so is a status
#      code: docling-serve answers 504 past its own `max_sync_wait` while still
#      finishing the conversion, and a live sweep that read that as an outage
#      recovered 1 filing of 21 — the cooldown silently skipped the 19
#      one-to-four-page scans queued behind one 15-page one. Both directions are
#      mutated, because the latch failing OPEN costs ~85 results filings a day
#      against a 300-second ceiling, which is seven hours of a worker waiting on
#      a dependency it was told to treat as optional.
#   4. THE TWO HAZARDS THE SPIKE MEASURED, ENCODED RATHER THAN COMMENTED.
#      `do_ocr` is the entire cost model, and the page bound goes out as
#      `page_range` — a 1-indexed inclusive PAIR — because `max_num_pages`
#      REJECTS an over-long document instead of truncating it.
#   5. THE FALLBACK IS RECORDED. `fallbackReason` is the field that makes an
#      optional dependency honest: "read by pdf-parse" and "read by pdf-parse
#      because the optional service was unreachable" are the same text and
#      completely different facts about the deployment.
#   6. THE OCR DECIMAL-TO-COMMA HAZARD. Docling emits `1,48,388,57` where the
#      page reads `1,48,388.57`. Every digit is correct and only the separator
#      is wrong, which is what makes it dangerous: anything that strips commas
#      reads 14,838,857 — a HUNDREDFOLD error, in the silent direction, about a
#      named listed company. pdf-parse produces the same shape by column
#      welding at a measured 8.40%, a HIGHER rate than OCR.
#   7. THE COVERAGE POLICY'S TWO REMAINING TESTS. Legal exposure is a SAFETY
#      refusal and is deliberately first; the covering-letter length is a cost
#      one. Neither looks at the category, which is the whole of the fix.
#   8. THE OUTCOME AND ITS TIER. Every filing states an outcome, and the tier
#      says how it could be checked. `restatesCategory` is the 72.82/27.18
#      split; make it always true and the `stated` tier vanishes and every
#      outcome degrades to its category.
#   9. AND THE ONE MUTATION THIS FILE EXISTS FOR: `isAlertableTier`. It is what
#      stands between universal coverage on the DASHBOARD, which is the feature,
#      and universal coverage on TELEGRAM — 12,415 of 17,442 corpus filings
#      survive the routine gate, which is about 388 messages a day and a peak of
#      106 in one hour. A channel at that volume is muted inside a day, and
#      every operator alert (INGEST DEGRADED, BLIND, DRAIN FAILED) is muted with
#      it, so the pipeline goes dark exactly when it most needs to be heard.
#      Both the one-word widening and the total one are broken below.
#
# Tally, so a report can quote it without recounting: 50 `check` calls, being 47
# mutations plus 3 independence checks.
#
# Usage:  bash tools/mutation/hybrid-parsing-coverage-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished — see
# tools/mutation/alert-service-mutations.sh for the full rationale, which this
# script mirrors: CAUGHT, CRASHED, SURVIVED (a real test gap) and NO-OP (the
# perl pattern matched nothing, i.e. harness staleness, NOT a test gap). A
# mutation that does not type-check is COMPILE and counts as a failure, because
# a mutation that never ran proved nothing.
#
# NO `&& false` AND NO `if (false)` ANYWHERE, for the reason the results harness
# records: a provably-false condition makes the block unreachable, TypeScript
# drops the flow narrowing the following lines depend on, and the mutation fails
# to COMPILE rather than running — which proves nothing. `routed-text.ts` is
# built entirely out of narrowed discriminated unions, so every mutation here is
# a value substitution, a predicate swap or a return-site swap.
#
# NO FIXTURE IS SIZED FROM THE CONSTANT IT PINS, which is what lets
# `DOCLING_OCR_MAX_PAGES = 1_000_000` be caught rather than silently satisfied.
#
# Safety: backs up every file it touches, verifies each restore byte-for-byte,
# and exits rather than returns on INT/TERM. It reports, per file, whether git
# is a second way back — see the precondition block, which deliberately does not
# refuse.
#
# NOT covered by mutation, and why:
#
#   - The CONTENTS of `GROUP_BY_CATEGORY`. Mutating one of its 111 rows mutates
#     the specification rather than the code; the suite asserts the invariants
#     instead (every corpus category maps to a real group, every group is
#     labelled, all ten are reached from the corpus alone). What IS mutated is
#     the lookup and its normalisation, because those are code.
#   - `SUMMARY_LEAD` and the category action phrases, for the same reason.
#   - `apps/ingest/src/enrichment/docling.factory.ts` and `ingest.module.ts`.
#     Composition.
#   - `pdf-text.ts`, `zip-*.ts` and the fetcher, which are the READING path
#     rather than the ROUTING one and have their own harness in
#     tools/mutation/attachment-reading-mutations.sh. Mutating them here would
#     report that harness's coverage as this one's.

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
PDF=$ROOT/libs/filings/src/pdf
LOGIC=$ROOT/libs/filings/src/logic
FILES=(
  "$PDF/parse-route.ts"
  "$PDF/docling-client.ts"
  "$PDF/routed-text.ts"
  "$LOGIC/grouped-number.ts"
  "$LOGIC/claim-eligibility.ts"
  "$LOGIC/filing-outcome.ts"
  "$LOGIC/category-group.ts"
  "$LOGIC/confidence-tier.ts"
)

# The owning suites plus every consumer that could catch a break the owner
# misses: `grouped-number` is read by results-verify and rupee-parse, the
# outcome/group/tier trio is read by the dashboard's filing-query service, and
# the routing is read by the enrichment worker.
#
# `dashboard.controller.spec.ts` is deliberately NOT here. It renders the HTML
# page and reaches none of these modules except through `filing-query`, which is
# included; adding it would only couple every verdict in this file to a suite
# that compiles the whole UI bundle.
SUITE='(libs/filings/src/(pdf/(parse-route|docling-client|routed-text)|logic/(grouped-number|rupee-parse|results-verify|claim-eligibility|filing-outcome|category-group|confidence-tier))|apps/(ingest/src/enrichment/enrichment.worker|dashboard/src/filings/filing-query))'

# --- precondition: every file must be recoverable, and say how ---------------
#
# This block REPORTS rather than refuses, which is a deliberate departure from
# the older harnesses in this directory and is worth the sentence. Their check
# exists so that a failed restore can be undone with `git checkout`; that is
# only true for a file which is both tracked AND clean. Most of the subjects
# here are brand new and untracked, and one of them is tracked with uncommitted
# work in it — for which `git checkout` is not a recovery but a second, worse
# loss. Refusing would mean this harness cannot run until its subjects are
# committed, so instead it names every file for which the backup directory is
# the ONLY way back, and the restore is verified byte-for-byte below.
UNPROTECTED=0
for f in "${FILES[@]}"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "note: $(basename "$f") is untracked — the backup is the only way back." >&2
    UNPROTECTED=$((UNPROTECTED + 1))
  elif ! git -C "$ROOT" diff --quiet -- "$f" ||
    ! git -C "$ROOT" diff --cached --quiet -- "$f"; then
    echo "note: $(basename "$f") has uncommitted changes — \`git checkout\` would" >&2
    echo "      DISCARD them, so the backup is the only way back." >&2
    UNPROTECTED=$((UNPROTECTED + 1))
  fi
done
if [ "$UNPROTECTED" -gt 0 ]; then
  echo "      $UNPROTECTED of ${#FILES[@]} subjects have no git safety net. Commit them to get" >&2
  echo "      the usual one." >&2
  echo "" >&2
fi

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
    echo "Recover by copying each file back out of it BY HAND — several of the" >&2
    echo "subjects are untracked or dirty, so a git checkout is not a recovery." >&2
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

P=$PDF/parse-route.ts
D=$PDF/docling-client.ts
R=$PDF/routed-text.ts
G=$LOGIC/grouped-number.ts
E=$LOGIC/claim-eligibility.ts
F=$LOGIC/filing-outcome.ts
C=$LOGIC/category-group.ts
T=$LOGIC/confidence-tier.ts

echo "=== the route: the degraded path is the branch nothing may shadow ==="

# The destructure gained `textLayerCorrupt` and prettier broke it over two
# lines, which staled a pattern pinned to the whole statement. The GUARD is the
# thing that must not be shadowed, so that is what is broken now — falsified
# with a `pages` test rather than a literal, so the branch stays reachable to
# the compiler and the mutation is a behaviour change rather than dead code.
perl -0pi -e 's/if \(!doclingAvailable\) \{/if (!doclingAvailable \&\& pages < 0) {/' "$P"
check "a service known to be down still gets the filing (no Python, no read)"

perl -0pi -e 's/  if \(!hasTextLayer\) \{/  if (!hasTextLayer \&\& !looksLikeResultsStatement(text)) \{/' "$P"
check "results beats scanned, so a raster results filing gets layout-only"

perl -0pi -e 's/    if \(pages > DOCLING_OCR_MAX_PAGES\) \{/    if (pages > DOCLING_LAYOUT_MAX_PAGES) \{/' "$P"
check "the OCR branch bounded by the LAYOUT ceiling (a 60-page scan OCR'd)"

perl -0pi -e 's/export const DOCLING_OCR_MAX_PAGES = 40;/export const DOCLING_OCR_MAX_PAGES = 1_000_000;/' "$P"
check "the OCR ceiling widened (a 600-page scan sent for OCR, ~40 minutes)"

perl -0pi -e 's/export const DOCLING_LAYOUT_MAX_PAGES = 150;/export const DOCLING_LAYOUT_MAX_PAGES = 1_000_000;/' "$P"
check "the layout ceiling widened (NHPC's 640-page annual report re-parsed)"

perl -0pi -e 's/\{ route, reason, maxPages, forceOcr \}/{ route, reason, maxPages: null, forceOcr }/' "$P"
check "no page ceiling sent at all (max_num_pages then rejects the document)"

echo ""
echo "=== what counts as a results statement: BOTH structural tests ==="

# Both tests now read the shared structural projection rather than the raw text,
# so the argument is `structural`, not `documentText`.
perl -0pi -e 's/RESULTS_STATEMENT_PATTERN\.test\(structural\) &&/RESULTS_STATEMENT_PATTERN.test(structural) ||/' "$P"
check "one of the two structural tests is enough (a covering letter escalated)"

echo ""
echo "=== basisReachFor: the most dangerous function in the parsing half ==="

perl -0pi -e "s/  route === 'pdf-parse' \? BASIS_HEADING_REACH : DOCLING_BASIS_HEADING_REACH;/  route === 'pdf-parse' ? BASIS_HEADING_REACH : BASIS_HEADING_REACH;/" "$P"
check "the pdf-parse bound used for every route (74 of 77 tables refused)"

perl -0pi -e "s/  route === 'pdf-parse' \? BASIS_HEADING_REACH : DOCLING_BASIS_HEADING_REACH;/  route === 'pdf-parse' ? DOCLING_BASIS_HEADING_REACH : DOCLING_BASIS_HEADING_REACH;/" "$P"
check "the Docling bound used for pdf-parse output (pairings false at 936)"

echo ""
echo "=== the availability latch, and the asymmetry that keeps one bad PDF cheap ==="

perl -0pi -e 's/      if \(status === null\) this\.openedAt = this\.options\.now\(\);\n//' "$D"
check "the latch never opens on a dead socket (7 hours of waiting a day)"

# The regression this rule was written from: docling-serve answers 504 past its
# own `max_sync_wait` while STILL finishing the conversion, and reading that as
# an outage recovered 1 filing of 21 in a live run. A status code is proof the
# service is alive; only the absence of a response says anything about it.
perl -0pi -e 's/      const status = error instanceof DoclingHttpError \? error\.status : null;/      const status: number | null = null;/' "$D"
check "any error opens the latch, so one 504 skips the 19 filings behind it"

perl -0pi -e "s/    return textFromDoclingReply\(payload\);/    const answer = textFromDoclingReply(payload);\n    if (answer.outcome !== 'ok') this.openedAt = this.options.now();\n    return answer;/" "$D"
check "the latch opens on an unreadable REPLY too (one bad PDF takes it down)"

perl -0pi -e 's/      this\.openedAt = this\.options\.now\(\);\n      return false;/      return false;/' "$D"
check "a failed startup probe leaves the service believed up"

perl -0pi -e 's/    if \(this\.openedAt === null\) return true;/    if (this.openedAt === null || this.openedAt >= 0) return true;/' "$D"
check "the latch never reports the service as down at all"

perl -0pi -e 's/    if \(this\.options\.now\(\) - this\.openedAt >= this\.options\.cooldownMs\) \{/    if (this.options.now() - this.openedAt > this.options.cooldownMs) \{/' "$D"
check "the cooldown held one millisecond past its own boundary"

echo ""
echo "=== the two hazards the spike measured, encoded rather than commented ==="

perl -0pi -e "s/  form\.append\('page_range', String\(Math\.max\(1, request\.maxPages\)\)\);\n//" "$D"
check "page_range sent as one value (max_num_pages semantics: the doc rejected)"

perl -0pi -e "s/  form\.append\('do_ocr', request\.ocr \? 'true' : 'false'\);/  form.append('do_ocr', request.ocr ? 'false' : 'true');/" "$D"
check "do_ocr inverted (a raster scan read with OCR off returns nothing)"

perl -0pi -e "s/  if \(typeof markdown !== 'string' \|\| markdown\.length === 0\) \{/  if (typeof markdown !== 'string') \{/" "$D"
check "an empty md_content accepted as a successful read"

perl -0pi -e "s/  value\.replace\(\/\\\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, MAX_DOCLING_MESSAGE_CHARS\);/  value.replace(\/\\\\s+\/g, ' ').trim();/" "$D"
check "a remote service chooses the length of our log line"

echo ""
echo "=== the fallback: what makes an optional dependency honest ==="

perl -0pi -e 's/      text,\n      route: \x27pdf-parse\x27,\n      routeReason: decision\.reason,\n      fallbackReason: `\$\{decision\.route\} was chosen/      text: converted.message,\n      route: decision.route,\n      routeReason: decision.reason,\n      fallbackReason: `\${decision.route} was chosen/' "$R"
check "a failed conversion's own error published as the document text"

perl -0pi -e 's/      fallbackReason: `\$\{decision\.route\} was chosen but did not run: \$\{converted\.message\}`,/      fallbackReason: null,/' "$R"
check "a route that did not run recorded as an ordinary pdf-parse read"

perl -0pi -e 's/  if \(!hasUsableTextLayer\(converted\.text\)\) \{/  if (!hasUsableTextLayer(text)) \{/' "$R"
check "the empty-markdown check applied to the CHEAP read instead"

perl -0pi -e 's/      fallbackReason:\n        `\$\{decision\.route\} returned \$\{converted\.text\.length\} character\(s\), ` \+\n        \x27which is not a usable text layer\x27,/      fallbackReason: null,/' "$R"
check "an unusable Docling reading rejected silently"

perl -0pi -e "s/    ocr: decision\.route === 'docling-ocr',/    ocr: decision.route === 'docling-layout',/" "$R"
check "the two configurations swapped (OCR on where it buys under 1%)"

perl -0pi -e 's/    maxPages: decision\.maxPages \?\? 1,/    maxPages: 1,/' "$R"
check "every escalation truncated to its first page"

perl -0pi -e 's/    doclingAvailable: converter !== null && converter\.isAvailable\(\),/    doclingAvailable: converter !== null,/' "$R"
check "the cooldown ignored when the route is decided (the latch bypassed)"

echo ""
echo "=== the OCR decimal-to-comma hazard: a hundredfold error, silently ==="

perl -0pi -e 's/  return \(\n    INDIAN_GROUPING\.test\(integerPart\) \|\|\n    INTERNATIONAL_GROUPING\.test\(integerPart\)\n  \);/  return integerPart.length >= 0;/' "$G"
check "any comma grouping accepted (1,48,388,57 reads as 14,838,857)"

perl -0pi -e 's{export const INDIAN_GROUPING = /\^\\d\{1,2\}\(\?:,\\d\{2\}\)\*,\\d\{3\}\$/;}{export const INDIAN_GROUPING = /^\\d{1,2}(?:,\\d{2})*,\\d{3}(?:,\\d+)?\$/;}' "$G"
check "a final comma group of any length (the JKIL reading passes)"

perl -0pi -e 's{export const INTERNATIONAL_GROUPING = /\^\\d\{1,3\}\(\?:,\\d\{3\}\)\*\$/;}{export const INTERNATIONAL_GROUPING = /^\\d{1,3}(?:,\\d{1,3})*\$/;}' "$G"
check "international groups of any length (3,114,25 passes, and 3,114.25 was meant)"

perl -0pi -e 's{const DECORATION = /\[\(\)\\s₹%\]/g;}{const DECORATION = /[(),\\s₹%]/g;}' "$G"
check "the comma stripped as decoration, which IS the failure being guarded"

perl -0pi -e "s/  if \(parts\.length === 2 && parts\[1\]\.includes\(','\)\) return false;/  if (parts.length === 2 \&\& parts[1].includes(';')) return false;/" "$G"
check "a comma inside the fractional part accepted (3,114.2,5)"

perl -0pi -e 's/  if \(parts\.length > 2\) return false;/  if (parts.length > 3) return false;/' "$G"
check "two decimal points accepted (a comma OCR'd as a point, the other way)"

echo ""
echo "=== the coverage policy: one safety refusal and one cost one ==="

perl -0pi -e "s/  if \(isLegallyBlocked\(filing\)\) \{/  if (isLegallyBlocked({ category: '', summary: '' })) \{/" "$E"
check "the legal-exposure test skipped (a SEBI notice reaches an extractor)"

perl -0pi -e 's/  if \(documentText\.length < MIN_CLAIM_DOCUMENT_CHARS\) \{/  if (documentText.length < 0) \{/' "$E"
check "the covering-letter test skipped (an address block sent to a model)"

perl -0pi -e 's/\): ClaimEligibility \{/): ClaimEligibility {\n  if (documentText.length >= 0) return { eligible: true };/' "$E"
check "every filing eligible unconditionally, safety refusal and all"

perl -0pi -e 's/  if \(isLegallyBlocked\(filing\)\) \{/  if (isLegallyBlocked(filing) \&\& documentText.length >= MIN_CLAIM_DOCUMENT_CHARS) \{/' "$E"
check "the legal test no longer first (a short blocked filing counted as empty)"

perl -0pi -e 's/export const MIN_CLAIM_DOCUMENT_CHARS = 1_500;/export const MIN_CLAIM_DOCUMENT_CHARS = 15_000;/' "$E"
check "the covering-letter bound widened tenfold (real filings go unread)"

echo ""
echo "=== the outcome: NSE's own sentence, or an honest floor ==="

perl -0pi -e 's/  return left === right \|\| right\.includes\(left\);/  return right.length >= 0;/' "$F"
check "every summary restates its category (the stated tier vanishes)"

perl -0pi -e 's/  if \(left\.length === 0\) return true;/  if (left.length === 0) return false;/' "$F"
check "nothing left after the template lead treated as adding something"

perl -0pi -e 's/    text: `\$\{symbol\}: \$\{rest\}`\.slice\(0, MAX_OUTCOME_CHARS\),/    text: `\${symbol}: \${rest}`,/' "$F"
check "the dashboard column unbounded (a 600-character scheme recital)"

perl -0pi -e 's/      \? `\$\{symbol\} — \$\{category\.toUpperCase\(\)\}`/      ? `\${category.toUpperCase()}`/' "$F"
check "the floor drops the symbol, so a blank category yields an EMPTY line"

echo ""
echo "=== the group: a reader's taxonomy, never an eligibility filter ==="

perl -0pi -e "s/  return GROUP_BY_LOOKUP_KEY\.get\(lookupKey\(category\)\) \?\? 'other';/  return 'other';/" "$C"
check "every category filed under other (111 groups collapse to one)"

perl -0pi -e 's/  category\.trim\(\)\.toLowerCase\(\)\.replace\(\/\\s\+\/g, \x27 \x27\);/  category;/' "$C"
check "the lookup key stops normalising (NSE's own double space misses)"

echo ""
echo "=== the tier, and the 388 messages a day it holds back ==="

perl -0pi -e "s/export const isAlertableTier = \(tier: ConfidenceTier\): boolean =>\n  tier === 'verified';/export const isAlertableTier = (tier: ConfidenceTier): boolean =>\n  CONFIDENCE_TIERS.includes(tier);/" "$T"
check "EVERY tier alertable — 388 Telegram messages a day, channel muted"

perl -0pi -e "s/export const isAlertableTier = \(tier: ConfidenceTier\): boolean =>\n  tier === 'verified';/export const isAlertableTier = (tier: ConfidenceTier): boolean =>\n  tier !== 'labelled';/" "$T"
check "the one-word widening: 'stated' reaches the wire unverified"

perl -0pi -e 's/    input\.hasVerifiedResults \|\|\n    input\.hasVerifiedAmount\n  \) \{/    input.hasVerifiedResults\n  ) \{/' "$T"
check "a verified AMOUNT no longer reaches the verified tier"

perl -0pi -e "s/  return input\.outcomeSource === 'exchange-summary' \? 'stated' : 'labelled';/  return input.outcomeSource === 'exchange-summary' ? 'labelled' : 'labelled';/" "$T"
check "the stated tier unreachable (NSE's own sentence demoted to a label)"

echo ""
echo "=== independence checks ==="
echo "A guarantee must die to the suite that OWNS it, not merely to a consumer's"
echo "integration test — otherwise moving the consumer would silently cost"
echo "coverage that looks covered. Each of the three below is re-run against its"
echo "owning spec alone, with every downstream suite excluded."

TIER='libs/filings/src/logic/confidence-tier\.spec'
ROUTE='libs/filings/src/pdf/parse-route\.spec'
NUMBER='libs/filings/src/logic/grouped-number\.spec'

perl -0pi -e "s/export const isAlertableTier = \(tier: ConfidenceTier\): boolean =>\n  tier === 'verified';/export const isAlertableTier = (tier: ConfidenceTier): boolean =>\n  CONFIDENCE_TIERS.includes(tier);/" "$T"
check_in "$TIER" "every tier alertable, the tier's own suite only"

perl -0pi -e "s/  route === 'pdf-parse' \? BASIS_HEADING_REACH : DOCLING_BASIS_HEADING_REACH;/  route === 'pdf-parse' ? BASIS_HEADING_REACH : BASIS_HEADING_REACH;/" "$P"
check_in "$ROUTE" "one basis reach for every route, the route's own suite only"

perl -0pi -e 's{export const INDIAN_GROUPING = /\^\\d\{1,2\}\(\?:,\\d\{2\}\)\*,\\d\{3\}\$/;}{export const INDIAN_GROUPING = /^\\d{1,2}(?:,\\d{2})*,\\d{3}(?:,\\d+)?\$/;}' "$G"
check_in "$NUMBER" "the JKIL grouping admitted, the number rule's own suite only"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
