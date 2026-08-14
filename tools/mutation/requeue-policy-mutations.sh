#!/usr/bin/env bash
#
# Mutation harness for the RE-QUEUE POLICY: the one module in this project that
# is allowed to reopen a terminal verdict.
#
# WHY THIS NEEDS ITS OWN HARNESS. `unparseable` is terminal by design, and the
# design is load-bearing — without it, 3.3% of NSE's PDFs and one whole
# 213-filing-a-month category are an infinite retry loop aimed at the exchange.
# This module is the single exception to that rule, so every one of its
# failure modes is a failure of the guarantee rather than of a feature:
#
#   1. TOO PERMISSIVE IS A REQUEST BILL AIMED AT A THIRD PARTY. A policy that
#      admits one reason too many spends one archive request per filing to
#      re-derive a verdict that has not moved. Blanket-resetting all 79 terminal
#      filings instead of the 21 whose handling actually changed is 58 wasted
#      fetches, and the code that does it looks identical from the outside — it
#      just returns `requeue` more often. No functional test notices.
#   2. TOO PERMISSIVE IS ALSO WRONG ABOUT `not-a-pdf` SPECIFICALLY, which is the
#      sharp edge. That reason is the fail-CLOSED verdict for every extension
#      this pipeline does not read — `.xml` sidecars, `.xlsx`, a url with no
#      extension — and exactly ONE of them became readable. The url must be put
#      back through `decideAttachment` and only a `zip` answer admitted. A
#      mutation that stops consulting the url passes every test that only ever
#      feeds it an archive.
#   3. TOO STRICT LOSES THE FILINGS SILENTLY. A `keep` where a `requeue` belongs
#      leaves a document unread forever and prints a tidy summary saying so.
#      The 21 filings this policy recovered carry 1,375,372 characters.
#   4. THE EXPLANATIONS ARE THE PRODUCT, NOT DECORATION. The operator's whole
#      audit of a sweep is the sentence printed beside each filing. An empty
#      one, or one copy-pasted from the reason above it, turns a reviewable
#      migration into an unreviewable one — and every assertion about a string
#      is exactly the kind a refactor silently loosens.
#   5. THE DECLARED ALLOWLIST CAN DRIFT FROM THE BEHAVIOUR. `REHANDLED_REASONS`
#      is a declaration; `decideRequeue` is what actually runs. Nothing in the
#      compiler ties them together, so both directions of drift are mutated.
#
# So this script breaks the module one way at a time, re-runs its suite, and
# asserts the break is caught — then restores.
#
# Usage:  bash tools/mutation/requeue-policy-mutations.sh
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
# NOTE ON THE MUTATION OPERATORS USED HERE. `&& false` and `if (false)` are NOT
# used, for the reason the house rules give: in narrowed TypeScript they usually
# produce a COMPILE rather than a mutant, because the arm they disable is what
# narrows the discriminated union the following lines read. Every mutation below
# is a value substitution or a return-site swap, which narrows identically to
# the original and therefore actually runs.
#
# Safety: refuses to mutate a TRACKED file with uncommitted changes, backs up
# every file it touches, verifies each restore byte-for-byte, and exits rather
# than returns on INT/TERM so it cannot resume past cleanup.
#
# NOT covered by mutation, and why:
#
#   - `decideAttachment` itself. It is this module's dependency, not its
#     subject, and it has its own harness in attachment-reading-mutations.sh.
#     Mutating it here would report that suite's coverage as this one's.
#   - `EnrichmentRepository.requeueUnparseable`, whose real guarantee is that
#     the attempt counters are NEITHER reset NOR incremented. It is deliberately
#     excluded because this project is currently worked on by concurrent agents
#     and that file is edited outside this task: a harness that backs up and
#     restores a file somebody else is editing destroys their work on restore,
#     and the git precondition below would refuse the run anyway the moment it
#     is dirty. The guarantee is covered instead by a direct assertion in
#     `enrichment.repository.spec.ts` ("keeps both attempt counters exactly as
#     they stood") against a real in-memory Mongo, which is a weaker check than
#     mutation and is named here rather than left implied.
#   - `tools/enrichment/requeue-terminal.ts`. A tool, not a library: it is
#     exercised by running it, and both a dry run and a live sweep are recorded
#     in the task report.
#
# Tally, so a report can quote it without recounting: 14 mutations in four
# groups = 14 `check` calls.


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
  "$LOGIC/requeue-policy.ts"
)
SUITE='libs/filings/src/logic/requeue-policy'

# --- precondition: refuse to mutate work that is not safely recoverable ------
for f in "${FILES[@]}"; do
  if git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    if ! git -C "$ROOT" diff --quiet -- "$f" ||
      ! git -C "$ROOT" diff --cached --quiet -- "$f"; then
      echo "refusing to run: uncommitted changes in a file this script mutates." >&2
      echo "  commit or stash them first — this script edits them in place." >&2
      git -C "$ROOT" status --short -- "$f" >&2
      exit 1
    fi
  else
    # A file git has never seen. The dirty-tree check exists so that a failed
    # restore can be recovered with `git checkout`; for an untracked file there
    # is no such recovery and there never was, so refusing would only mean this
    # harness cannot run until its subject is committed. It proceeds, and says
    # plainly that the backup copy is the ONLY way back.
    echo "note: $f is untracked. git cannot restore it if the restore below" >&2
    echo "      fails; the backup directory printed on failure is the only" >&2
    echo "      recovery. Commit it to get the usual safety net." >&2
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
    echo "Recover by copying the file back by hand:" >&2
    echo "  cp $BACKUP/requeue-policy.ts $LOGIC/requeue-policy.ts" >&2
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

check() {
  local label="$1"
  local out

  if ! dirty; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest "$SUITE" 2>&1)
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

R=$LOGIC/requeue-policy.ts

echo "=== the admitted reasons: losing a filing this pipeline can now read ==="

perl -0pi -e "s/    return requeue\(\n      'the download cap was raised/    return keep(\n      'the download cap was raised/" "$R"
check "oversized no longer re-queued (the 64 MiB cap buys nothing)"

perl -0pi -e "s/      return requeue\(\n        'the attachment is a ZIP archive/      return keep(\n        'the attachment is a ZIP archive/" "$R"
check "ZIP archives no longer re-queued (the whole category stays blank)"

echo ""
echo "=== the admitted reasons: spending NSE requests to learn nothing ==="

perl -0pi -e "s/const decision = decideAttachment\(attachmentUrl\);/const decision = decideAttachment('https:\/\/nsearchives.nseindia.com\/a.zip');/" "$R"
check "the url is ignored (every .xml and .xlsx re-queued as if it were a ZIP)"

perl -0pi -e "s/      return keep\(\n        \`the url is still refused before any fetch/      return requeue(\n        \`the url is still refused before any fetch/" "$R"
check "a url refused before any fetch is re-queued anyway"

perl -0pi -e "s/    return keep\(\n      'the url resolves to a PDF/    return requeue(\n      'the url resolves to a PDF/" "$R"
check "a .pdf carrying a not-a-pdf verdict re-queued on a guess"

perl -0pi -e 's/  return keep\(UNCHANGED_HANDLING\[reason\]\);/  return requeue(UNCHANGED_HANDLING[reason]);/' "$R"
check "BLANKET RESET: every terminal reason re-queued"

perl -0pi -e "s/  return keep\(UNCHANGED_HANDLING\[reason\]\);/  if (reason === 'truncated-at-origin') {\n    return requeue('the bytes might come back different this time');\n  }\n  return keep(UNCHANGED_HANDLING[reason]);/" "$R"
check "truncated-at-origin re-queued (its retry budget is already spent)"

perl -0pi -e "s/  return keep\(UNCHANGED_HANDLING\[reason\]\);/  if (reason === 'no-text-layer') {\n    return requeue('a raster scan might read this time');\n  }\n  return keep(UNCHANGED_HANDLING[reason]);/" "$R"
check "no-text-layer re-queued (there is still no OCR in this pipeline)"

echo ""
echo "=== the declared allowlist, which can drift from the behaviour ==="

perl -0pi -e "s/  'not-a-pdf',\n  'oversized',\n\]\);/  'not-a-pdf',\n  'oversized',\n  'no-text-layer',\n]);/" "$R"
check "REHANDLED_REASONS widened past what decideRequeue does"

perl -0pi -e "s/  'not-a-pdf',\n  'oversized',\n\]\);/]);/" "$R"
check "REHANDLED_REASONS emptied while decideRequeue still admits two"

echo ""
echo "=== the explanations, which are the operator's entire audit ==="

perl -0pi -e "s/  outcome: 'requeue',\n  explanation,/  outcome: 'requeue',\n  explanation: '',/" "$R"
check "a re-queue states no reason"

perl -0pi -e "s/  outcome: 'keep',\n  explanation,/  outcome: 'keep',\n  explanation: '',/" "$R"
check "a refusal states no reason"

perl -0pi -e "s/, as \\\$\{decision\.reason\}; \`/, as something else; \`/" "$R"
check "a pre-fetch refusal stops naming which verdict the url still earns"

perl -0pi -e "s/  'no-text-layer':\n    'the document parsed and carries no text: it is a raster scan, and this ' \+\n    'pipeline still has no OCR, so a re-read measures the same zero characters',/  'no-text-layer':\n    'the exchange answered about the request with a 404 or 410, which is a ' +\n    'statement about what it holds and not about what this pipeline can read',/" "$R"
check "no-text-layer's argument copy-pasted from not-found's"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
