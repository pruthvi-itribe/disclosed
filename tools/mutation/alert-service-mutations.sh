#!/usr/bin/env bash
#
# Mutation harness for the AlertService (Task 11): the component that decides
# which newly-inserted filings become Telegram messages.
#
# This is the routing decision between "we stored it" and "a human is told", and
# almost every way it can go wrong is SILENT. Nothing here throws when it
# misbehaves; the bot simply says less, says it in the wrong order, or says it
# twice, and all three look like an ordinary quiet market from the outside:
#
#   1. THE GATES. Three of them — the cold-start window, the routine-category
#      taxonomy and the optional watchlist — each guarding a different failure.
#      Weaken the window and a restart floods the chat with a day of history.
#      Weaken the routine gate and the signal drowns in newspaper publications.
#      Break watchlist normalisation and the bot goes COMPLETELY quiet, because
#      an entry that matches nothing is indistinguishable from a slow day.
#   2. THE CONTAINMENT. `formatFilingAlert` and `isRoutine` throw a TypeError on
#      a record whose symbol, category or summary is absent or not a string,
#      which a projected read can produce. Unhandled, one such record aborts the
#      batch and takes the filing the user is waiting for with it. The catch is
#      only defensible while it stays LOUD and names the seqId that was lost.
#   3. THE ORDER AND THE PACING. Sends are sequential and sorted ascending by
#      seqId. Concurrent sends hit Telegram's per-chat rate limit, whose 429 is
#      swallowed by `send()` by design, so the filing is lost with nothing
#      raised — and they land in completion order, undoing the sort. Relaying
#      NSE's own newest-first order posts the newest filing as the OLDEST
#      message, burying the freshest news above older news.
#
# All three are the kind a passing suite can imply without proving. So this
# script breaks the implementation one way at a time, re-runs the suite, and
# asserts the break is caught — then restores.
#
# Usage:  bash tools/mutation/alert-service-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   CRASHED  the mutation killed the test runner before it reported anything, so
#            there is no `Tests:` line to read. Dropping the `await` on a send
#            does this: the floating rejection becomes a Node-level uncaught
#            exception. The suite is red, so the guarantee IS covered, but it is
#            labelled apart from an assertion failure — "no verdict" must never
#            be silently rounded to either a kill or a survivor.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap. Conflating the
#            two would raise a false alarm about the alerting path itself.
#
# Safety mirrors tools/mutation/notify-mutations.sh — see that file for the full
# rationale. In short: refuses to run on a dirty tree, INT/TERM exit rather than
# return so the script cannot resume past cleanup, every restore is verified
# byte-for-byte, a jest run killed by a signal is reported as ABORTED rather
# than misread as a surviving mutation, and a mutation that does not type-check
# is reported as COMPILE rather than misread as SURVIVED.
#
# NOT covered by mutation, and why:
#
#   - The `if (filings.length === 0) return []` fast path is semantically
#     redundant: partitioning an empty batch yields two empty arrays and the
#     send loop is a no-op, so the method returns `[]` either way. No mutation
#     can distinguish it, and pretending otherwise would manufacture a
#     SURVIVED. The empty-batch test pins the observable behaviour regardless.
#   - `[...alertable]` before the sort is a defensive copy. `partitionForAlerting`
#     already returns arrays that do not alias the caller's batch — pinned by its
#     own suite — so sorting in place is observationally identical TODAY. The
#     copy guards a future refactor of that function, which is not something a
#     mutation of this file can speak to.
#   - `safeText` applied to `filing.seqId` when `filing` itself is null: that
#     shape throws inside `partitionForAlerting` before it ever reaches the loop
#     (documented on the method), so no test constructs it.
#   - The `@Injectable()` decorator has no observable effect until Task 12 wires
#     the module; there is no container to resolve it from yet.
#   - The message BODY is the formatter's contract, not this service's, and is
#     mutated by tools/mutation/notify-mutations.sh. The single assertion here
#     is that the text sent is `formatFilingAlert`'s output verbatim.
#   - `safeText`, `describeError` and `stackOf` themselves. They moved to
#     `libs/common` when four hand-written copies were consolidated, and are
#     mutated by tools/mutation/common-mutations.sh — which runs them against
#     THIS suite as well as its own, so the guarantee did not move off a test.
#     What is still mutated here is every CALL to them.
#
# Tally, so a report can quote it without recounting: 29 mutations across five
# groups, plus 6 independence checks = 35 `check` calls.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SRC=$ROOT/apps/ingest/src/alert/alert.service.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
if ! git -C "$ROOT" ls-files --error-unmatch "$SRC" >/dev/null 2>&1; then
  echo "refusing to run: $SRC is not tracked by git." >&2
  exit 1
fi
if ! git -C "$ROOT" diff --quiet -- "$SRC" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$SRC"; then
  echo "refusing to run: uncommitted changes in the file this script mutates." >&2
  echo "  commit or stash them first — this script edits it in place." >&2
  git -C "$ROOT" status --short -- "$SRC" >&2
  exit 1
fi

# --- backup: an unchecked cp here would mean mutating with no way back -------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$SRC" "$BACKUP/alert.service.ts" || {
  echo "refusing to run: could not back up the source." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0
CRASHES=0

restore_verified() {
  cp "$BACKUP/alert.service.ts" "$SRC" || return 1
  cmp -s "$BACKUP/alert.service.ts" "$SRC" || return 1
  return 0
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: source could NOT be restored. Backup kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  cp $BACKUP/alert.service.ts $SRC" >&2
    echo "or: git -C $ROOT checkout -- apps/ingest/src/alert" >&2
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

  if cmp -s "$SRC" "$BACKUP/alert.service.ts"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest alert.service "$@" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring source and stopping."
    exit 130
  fi

  # A mutation that does not type-check proves nothing: ts-jest fails the suite
  # before a single test runs, and jest then prints a `Tests:` line with no
  # failure count, so the grep below would fall through to SURVIVED. Counted as
  # a failure, because a mutation that never ran proved nothing.
  # A TYPE error specifically: "Test suite failed to run" on its own is also
  # printed when a jest worker dies at runtime, which is a kill, not a stale
  # mutation. Requiring a `TS####` diagnostic keeps the two apart.
  if echo "$out" | grep -qE "error TS[0-9]+"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    FAILURES=$((FAILURES + 1))
    restore_verified || on_exit
    return
  fi

  # An uncaught exception can kill the runner before it reports anything at all:
  # dropping the `await` on a send leaves a floating rejection, which Node turns
  # into a process-level uncaughtException, and jest never prints a `Tests:`
  # line. The suite is red, so the mutation IS detected — but a crashed run is
  # labelled apart from an ordinary assertion failure, because "no verdict" must
  # never be quietly read as either a clean kill or a survivor.
  #
  # POSITIVE EVIDENCE IS REQUIRED before that may be scored as a kill. A non-zero
  # exit with no `Tests:` line is also what a typo'd suite name, a broken jest
  # config, an OOM or a missing `npx` produces: `npx jest zzz-no-such-suite`
  # exits 1 with no `Tests:` line, and the old branch counted that as caught AND
  # excluded it from the exit code — turning a fail-safe misclassification into
  # a fail-open one. So a CRASHED verdict now requires proof that jest reached a
  # suite at all; anything else is a HARNESS ERROR and counts toward FAILURES.
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
      echo "           jest never reached a suite (exit $rc). No verdict, and NOT"
      echo "           a kill — check the pattern, the config and the toolchain."
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

echo "=== send order: chronological, or the newest news is buried ==="

perl -0pi -e 's/\[\.\.\.alertable\]\.sort\(\(a, b\) => a\.seqId - b\.seqId\)/[...alertable].sort((a, b) => b.seqId - a.seqId)/' "$SRC"
check "sorted descending (newest sent first, so it reads as the oldest message)"

perl -0pi -e 's/\[\.\.\.alertable\]\.sort\(\(a, b\) => a\.seqId - b\.seqId\)/[...alertable]/' "$SRC"
check "not sorted at all (NSE's newest-first order relayed verbatim)"

perl -0pi -e 's/a\.seqId - b\.seqId/a.symbol.localeCompare(b.symbol)/' "$SRC"
check "sorted by symbol (alphabetical, not chronological)"

perl -0pi -e 's/a\.seqId - b\.seqId/a.disseminatedAt.getTime() - b.disseminatedAt.getTime()/' "$SRC"
check "sorted by timestamp (ties on a shared dissemination second)"

echo ""
echo "=== sequential sending: a 429 is swallowed, so concurrency loses filings ==="

perl -0pi -e 's/        await this\.telegram\.send\(formatFilingAlert\(filing\)\);/        void this.telegram.send(formatFilingAlert(filing));/' "$SRC"
check "fire-and-forget send (resolves before the batch has been delivered)"

perl -0pi -e 's/    for \(const filing of ordered\) \{\n      try \{\n        if \(!this\.shouldAlert\(filing\)\) continue;/    await Promise.all(\n      ordered.map(async (filing) => {\n      try {\n        if (!this.shouldAlert(filing)) return;/' "$SRC"
perl -0pi -e 's/      \}\n    \}\n\n    return attempted;/      }\n      }),\n    );\n\n    return attempted;/' "$SRC"
check "Promise.all (rate limit exposed, delivery order scrambled)"

echo ""
echo "=== containment: one bad record must not cost the batch ==="

perl -0pi -e 's/      try \{\n        if \(!this\.shouldAlert\(filing\)\) continue;\n        await this\.telegram\.send\(formatFilingAlert\(filing\)\);\n        attempted\.push\(filing\);\n      \} catch \(error\) \{.*?\n      \}\n/      if (!this.shouldAlert(filing)) continue;\n      await this.telegram.send(formatFilingAlert(filing));\n      attempted.push(filing);\n/s' "$SRC"
check "try\/catch removed (a projected read aborts the whole batch)"

perl -0pi -e 's/          stackOf\(error\),\n        \);\n/          stackOf(error),\n        );\n        throw error;\n/' "$SRC"
check "rethrows after logging (the containment is decorative)"

perl -0pi -e 's/        this\.logger\.error\(\n          `Alert failed.*?\n        \);\n/        \/* swallowed silently *\/\n/s' "$SRC"
check "bare catch, nothing logged (a filing vanishes with no trace)"

perl -0pi -e 's/        this\.logger\.error\(\n          `Alert failed/        this.logger.log(\n          `Alert failed/' "$SRC"
check "logged at info level (a lost filing reads as routine chatter)"

perl -0pi -e 's/`Alert failed for seqId \$\{safeText\(filing\.seqId\)\}: /`Alert failed: /' "$SRC"
check "seqId dropped from the log (the loss is no longer replayable)"

perl -0pi -e 's/\$\{describeError\(\n            error,\n          \)\}/\${(error as Error).message}/' "$SRC"
check "naive error description (throws on a null rejection, inside the catch)"

perl -0pi -e 's/\n          stackOf\(error\),//' "$SRC"
check "stack dropped (a programming bug reads as a bad record)"

perl -0pi -e 's/safeText\(filing\.seqId\)/String(filing.seqId)/' "$SRC"
check "bare String() on the seqId (throws while formatting the log line)"

perl -0pi -e 's/        await this\.telegram\.send\(formatFilingAlert\(filing\)\);\n        attempted\.push\(filing\);/        attempted.push(filing);\n        await this.telegram.send(formatFilingAlert(filing));/' "$SRC"
check "counted before sending (claims filings the formatter rejected)"

perl -0pi -e 's/    return attempted;/    return ordered;/' "$SRC"
check "returns the whole window (suppressed filings reported as alerted)"

echo ""
echo "=== the gates: each one guards a different silence ==="

perl -0pi -e 's/    if \(isRoutine\(filing\.category\)\) return false;\n//' "$SRC"
check "routine gate removed (newspaper publications drown the signal)"

perl -0pi -e 's/if \(isRoutine\(filing\.category\)\) return false;/if (!isRoutine(filing.category)) return false;/' "$SRC"
check "routine gate inverted (only the noise is delivered)"

perl -0pi -e 's/    if \(this\.watchlist\.size === 0\) return true;\n    return this\.watchlist\.has\(normalise\(filing\.symbol\)\);/    return true;/' "$SRC"
check "watchlist ignored (a configured watchlist alerts on everything)"

perl -0pi -e 's/if \(this\.watchlist\.size === 0\) return true;/if (this.watchlist.size > 0) return true;/' "$SRC"
check "empty-watchlist branch inverted (mutes the bot outright)"

perl -0pi -e 's/this\.watchlist\.has\(normalise\(filing\.symbol\)\)/this.watchlist.has(filing.symbol)/' "$SRC"
check "symbol side not normalised (a lowercase symbol never matches)"

perl -0pi -e 's/symbol\.trim\(\)\.toUpperCase\(\)/symbol.toUpperCase()/' "$SRC"
check "trim dropped (WATCHLIST=A, B silently matches nothing after the comma)"

perl -0pi -e 's/symbol\.trim\(\)\.toUpperCase\(\)/symbol.trim()/' "$SRC"
check "case folding dropped (a lowercase config entry never matches)"

perl -0pi -e 's/new Set\(watchlist\.map\(normalise\)\.filter\(\(symbol\) => symbol\.length > 0\)\)/new Set(watchlist.map(normalise))/' "$SRC"
check "blank entries kept (WATCHLIST= parses to [''] and mutes the bot)"

echo ""
echo "=== the window and the clock ==="

perl -0pi -e 's/      this\.options\.alertWindowMs,/      600000,/' "$SRC"
check "window hardcoded (config no longer controls the cold-start gate)"

perl -0pi -e 's/\[\.\.\.alertable\]/[...silent]/' "$SRC"
check "alerts on the silent half (the cold-start storm, inverted)"

perl -0pi -e 's/    now = new Date\(\),/    now = new Date(0),/' "$SRC"
check "default clock frozen at the epoch (every live filing reads as stale)"

perl -0pi -e 's/if \(silent\.length > 0\) \{/if (silent.length >= 0) {/' "$SRC"
check "window line logged unconditionally (noise on every ordinary poll)"

perl -0pi -e 's/Stored \$\{silent\.length\}/Stored \${alertable.length}/' "$SRC"
check "window line counts the wrong array (reports 0 stored during a drain)"

echo ""
echo "=== independence checks ==="
echo "Each guarantee must die to the suite that OWNS it, not merely to the"
echo "seven hand-written tests from the brief. Otherwise deleting a suite would"
echo "silently cost coverage that looks covered."

perl -0pi -e 's/\[\.\.\.alertable\]\.sort\(\(a, b\) => a\.seqId - b\.seqId\)/[...alertable].sort((a, b) => b.seqId - a.seqId)/' "$SRC"
check "descending sort, order suite only" -t "send order is chronological"

perl -0pi -e 's/        await this\.telegram\.send\(formatFilingAlert\(filing\)\);/        void this.telegram.send(formatFilingAlert(filing));/' "$SRC"
check "fire-and-forget, sequential suite only" -t "sends sequentially"

perl -0pi -e 's/      try \{\n        if \(!this\.shouldAlert\(filing\)\) continue;\n        await this\.telegram\.send\(formatFilingAlert\(filing\)\);\n        attempted\.push\(filing\);\n      \} catch \(error\) \{.*?\n      \}\n/      if (!this.shouldAlert(filing)) continue;\n      await this.telegram.send(formatFilingAlert(filing));\n      attempted.push(filing);\n/s' "$SRC"
check "no containment, malformed-record suite only" -t "a malformed record is skipped"

perl -0pi -e 's/symbol\.trim\(\)\.toUpperCase\(\)/symbol.toUpperCase()/' "$SRC"
check "trim dropped, watchlist suite only" -t "the watchlist"

perl -0pi -e 's/        await this\.telegram\.send\(formatFilingAlert\(filing\)\);\n        attempted\.push\(filing\);/        attempted.push(filing);\n        await this.telegram.send(formatFilingAlert(filing));/' "$SRC"
check "counted before sending, return-value suite only" -t "attempted, not delivered"

perl -0pi -e 's/      this\.options\.alertWindowMs,/      600000,/' "$SRC"
check "window hardcoded, window suite only" -t "the window and the clock"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest alert.service 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
