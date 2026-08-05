#!/usr/bin/env bash
#
# Mutation harness for the poll loop and its configuration (Task 12).
#
# This is the component that turns every other task's guarantee into behaviour,
# and almost every way it can break is SILENT — the process stays up, the logs
# stay calm, and the only symptom is a chat that says less than it should:
#
#   1. THE CONFIGURATION. Every numeric setting is validated once, here, because
#      nothing downstream validates its own inputs. The specific hazard is NaN:
#      `NaN < 1` is FALSE, so a bare lower-bound check ACCEPTS it, and then
#      `alertWindowMs: NaN` mutes the bot outright, `failureThreshold: NaN`
#      makes the breaker report healthy through an unlimited outage, and an
#      interval of NaN turns `setTimeout` into a busy loop against Akamai.
#   2. THE CURSOR. It is a ROLLOVER marker, never a newness filter — the
#      database decides newness, because NSE disseminates out of seq_id order.
#      It may only move on proof: not from an empty page, not past a drain that
#      failed, not past a write that threw, and never backwards. Each of those
#      advances loses filings permanently and reports success.
#   3. THE DRAIN DECISION. Reconciliation is the whole no-loss guarantee, and
#      `holeDetected` alone does not deliver it: replaying the 32-day corpus
#      fires a rollover ONCE, so the scheduled sweep (every 5 minutes) and the
#      closing drain (23:30 IST) carry it. `holeDetected` is still independent
#      of how many new ids the page carried — a cold start reports a hole with
#      an empty list — and inferring the drain from the id count skips the one
#      drain that establishes the baseline.
#   4. THE IN-FLIGHT GUARD. A hard Akamai block takes ~30s to reject against a
#      2s interval, so an unguarded poller stacks ~15 requests during exactly
#      the outage where NSE is least willing to serve.
#   5. THE ALARMS. Four different silences — a blind poller, a page the mapper
#      only partly understood, a day re-pull that failed, and a database
#      refusing writes — each edge-triggered so the outage cannot mute the
#      channel that reports it. Weaken the edge and the operator gets ~1800
#      messages an hour and mutes the bot; remove it and they get none. The
#      partial skip is the quietest of the four: the fetch succeeded, filings
#      arrived, the breaker is clean and the cursor moved.
#
# All five are the kind a passing suite can imply without proving. So this
# script breaks the implementation one way at a time, re-runs the suite, and
# asserts the break is caught — then restores.
#
# Usage:  bash tools/mutation/poller-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Four outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   CRASHED  the mutation killed the test runner before it reported anything, so
#            there is no `Tests:` line to read. The suite is red, so the
#            guarantee IS covered, but it is labelled apart from an assertion
#            failure — "no verdict" must never be silently rounded to either a
#            kill or a survivor.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap. Conflating the
#            two would raise a false alarm about the poll loop itself.
#
# Safety mirrors tools/mutation/alert-service-mutations.sh — see that file for
# the full rationale. In short: refuses to run on a dirty tree, INT/TERM exit
# rather than return so the script cannot resume past cleanup, every restore is
# verified byte-for-byte, a jest run killed by a signal is reported as ABORTED
# rather than misread as a surviving mutation, and a mutation that does not
# type-check is reported as COMPILE rather than misread as SURVIVED.
#
# NOT covered by mutation, and why:
#
#   - `main.ts` and `ingest.module.ts` are composition, not logic. Mutating a
#     provider factory produces a container that fails to construct, which no
#     unit test observes and which the smoke test catches immediately. Pretending
#     otherwise would manufacture a page of SURVIVEDs about wiring that is
#     verified by running the process.
#   - Releasing the in-flight guard OUTSIDE a `finally` rather than inside it is
#     observationally identical for every failure `poll()` handles internally,
#     because it does not throw for any of them. The `finally` guards the
#     contract violation instead, and THAT is mutated below.
#   - `describeConfig`'s exact word spacing. It is a log line, and pinning its
#     punctuation would make an ordinary reword read as a test failure. Its
#     redaction and its configured/unconfigured verdict ARE mutated, because
#     both are load-bearing.
#
# Tally, so a report can quote it without recounting: 61 mutations against the
# poller and 12 against the configuration, plus 7 independence checks = 80
# `check` calls.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
POLL=$ROOT/apps/ingest/src/poller/poller.service.ts
CONF=$ROOT/apps/ingest/src/config/configuration.ts

# --- precondition: refuse to mutate a dirty tree -----------------------------
for f in "$POLL" "$CONF"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    echo "refusing to run: $f is not tracked by git." >&2
    exit 1
  fi
done
if ! git -C "$ROOT" diff --quiet -- "$POLL" "$CONF" ||
  ! git -C "$ROOT" diff --cached --quiet -- "$POLL" "$CONF"; then
  echo "refusing to run: uncommitted changes in the files this script mutates." >&2
  echo "  commit or stash them first — this script edits them in place." >&2
  git -C "$ROOT" status --short -- "$POLL" "$CONF" >&2
  exit 1
fi

# --- backups: an unchecked cp here would mean mutating with no way back ------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
cp "$POLL" "$BACKUP/poller.service.ts" || {
  echo "refusing to run: could not back up poller.service.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}
cp "$CONF" "$BACKUP/configuration.ts" || {
  echo "refusing to run: could not back up configuration.ts." >&2
  rm -rf "$BACKUP"
  exit 1
}

FAILURES=0
NOOPS=0
CRASHES=0

restore_verified() {
  local ok=0
  cp "$BACKUP/poller.service.ts" "$POLL" || ok=1
  cp "$BACKUP/configuration.ts" "$CONF" || ok=1
  cmp -s "$BACKUP/poller.service.ts" "$POLL" || ok=1
  cmp -s "$BACKUP/configuration.ts" "$CONF" || ok=1
  return $ok
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: sources could NOT be restored. Backups kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  cp $BACKUP/poller.service.ts $POLL" >&2
    echo "  cp $BACKUP/configuration.ts  $CONF" >&2
    echo "or: git -C $ROOT checkout -- $POLL $CONF" >&2
    exit 1
  fi
}

trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring sources."; exit 130' INT TERM

# check <label> <mutated-file> <jest-pattern> [extra jest args...]
check() {
  local label="$1" file="$2" pattern="$3"
  shift 3
  local backup_for out

  case "$file" in
  *poller.service.ts) backup_for=$BACKUP/poller.service.ts ;;
  *) backup_for=$BACKUP/configuration.ts ;;
  esac

  if cmp -s "$file" "$backup_for"; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  # `--forceExit` is not a convenience. This file schedules timers and runs an
  # unbounded loop, so a mutation can leave the event loop alive after the last
  # assertion has already failed — jest then prints its results and hangs
  # instead of exiting, and the harness stalls on a mutation it has in fact
  # ALREADY caught. Forcing the exit keeps a caught mutation from reading as a
  # hung harness. Results are printed before the exit, so no verdict is lost.
  # The unmutated suite exits on its own; the final summary run below omits it
  # deliberately, so a genuine leak in the real code still shows up as a hang.
  out=$(cd "$ROOT" && npx jest "$pattern" --forceExit "$@" 2>&1)
  local rc=$?

  if [ "$rc" -ge 128 ]; then
    echo "ABORTED  | $label"
    echo "           test run killed by signal $((rc - 128)); no verdict."
    echo ""
    echo "INTERRUPTED — restoring sources and stopping."
    exit 130
  fi

  # A mutation that does not type-check proves nothing: ts-jest fails the suite
  # before a single test runs. Counted as a failure, because a mutation that
  # never ran exercised no assertion.
  if echo "$out" | grep -qE "Test suite failed to run"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    FAILURES=$((FAILURES + 1))
    restore_verified || on_exit
    return
  fi

  # An uncaught exception or an unresolved promise can kill the runner before it
  # reports anything at all. The suite is red, so the mutation IS detected — but
  # a crashed run is labelled apart from an ordinary assertion failure, because
  # "no verdict" must never be quietly read as either a clean kill or a survivor.
  if ! echo "$out" | grep -qE "^Tests:"; then
    if [ "$rc" -eq 0 ]; then
      echo "SURVIVED | $label   <-- TEST GAP"
      FAILURES=$((FAILURES + 1))
    else
      echo "CRASHED  | $label"
      echo "           runner died before reporting (exit $rc); the suite is red"
      CRASHES=$((CRASHES + 1))
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

echo "=== config validation: NaN is what a bare lower bound lets through ==="

perl -0pi -e 's/  if \(!Number\.isFinite\(value\)\) \{\n    throw new Error\(\n      `\$\{key\} must be a finite number.*?\n    \);\n  \}\n\n  if \(!Number\.isInteger\(value\)\) \{\n    throw new Error\(`\$\{key\} must be a whole number, but was "\$\{raw\}"\.`\);\n  \}\n\n//s' "$CONF"
check "bare lower bound only (NaN and Infinity both accepted)" "$CONF" configuration

perl -0pi -e 's/  if \(!Number\.isFinite\(value\)\) \{\n    throw new Error\(\n      `\$\{key\} must be a finite number.*?\n    \);\n  \}\n\n//s' "$CONF"
check "finite check removed (the message no longer names the real fault)" "$CONF" configuration

perl -0pi -e 's/  if \(!Number\.isInteger\(value\)\) \{\n    throw new Error\(`\$\{key\} must be a whole number, but was "\$\{raw\}"\.`\);\n  \}\n\n//s' "$CONF"
check "integer check removed (a fractional interval is accepted)" "$CONF" configuration

perl -0pi -e 's/  if \(value < MINIMUM_NUMERIC\) \{\n    throw new Error\(\n      `\$\{key\} must be at least \$\{MINIMUM_NUMERIC\}, but was "\$\{raw\}"\.`,\n    \);\n  \}\n\n//s' "$CONF"
check "minimum check removed (a zero threshold busy-loops the poller)" "$CONF" configuration

perl -0pi -e 's/export const MINIMUM_NUMERIC = 1;/export const MINIMUM_NUMERIC = 0;/' "$CONF"
check "minimum lowered to zero (burstThreshold 0 makes every poll a burst)" "$CONF" configuration

perl -0pi -e 's/  const value = Number\(raw\);/  const value = parseInt(raw, 10);/' "$CONF"
check "parseInt instead of Number (\"2000ms\" silently becomes 2000)" "$CONF" configuration

perl -0pi -e 's/  if \(raw === undefined \|\| raw\.trim\(\) === ""\) return CONFIG_DEFAULTS\[key\];/  if (raw === undefined) return CONFIG_DEFAULTS[key];/' "$CONF"
perl -0pi -e "s/  if \\(raw === undefined \\|\\| raw\\.trim\\(\\) === ''\\) return CONFIG_DEFAULTS\\[key\\];/  if (raw === undefined) return CONFIG_DEFAULTS[key];/" "$CONF"
check "blank assignment not treated as unset (KEY= becomes 0 and throws)" "$CONF" configuration

perl -0pi -e 's/`\$\{key\} must be a finite number, but was "\$\{raw\}"\. A non-finite value is `/`must be a finite number. `/' "$CONF"
check "key name dropped from the error (operator cannot tell which one)" "$CONF" configuration

echo ""
echo "=== config parsing: a blank watchlist entry mutes the bot ==="

perl -0pi -e 's/    \.filter\(\(entry\) => entry\.length > 0\);/    ;/' "$CONF"
check "blank entries kept (WATCHLIST= parses to [''] and matches nothing)" "$CONF" configuration

perl -0pi -e 's/    \.map\(\(entry\) => entry\.trim\(\)\)\n//' "$CONF"
check "entries not trimmed (\"A, B\" never matches the symbol B)" "$CONF" configuration

perl -0pi -e 's/\n  uri\.replace\([^\n]*\);/\n  uri;/' "$CONF"
check "credentials not redacted (the mongo password lands in the log)" "$CONF" configuration

perl -0pi -e 's/config\.telegramBotToken && config\.telegramChatId/config.telegramBotToken || config.telegramChatId/' "$CONF"
check "half-set credentials reported as configured (nothing is delivered)" "$CONF" configuration

echo ""
echo "=== the cursor may only move on proof ==="

perl -0pi -e 's/    if \(observed\.length === 0\) return;\n\n//' "$POLL"
check "advances from an empty observation (claims a baseline it never saw)" "$POLL" poller.service

perl -0pi -e 's/    this\.cursor =\n      this\.cursor === null \? highest : Math\.max\(this\.cursor, highest\);/    this.cursor = highest;/' "$POLL"
check "cursor can go backwards (an older page re-offers everything above it)" "$POLL" poller.service

perl -0pi -e 's/      this\.advanceCursor\(\[\.\.\.page\.filings, \.\.\.dayFilings\]\);/      this.advanceCursor(page.filings);/' "$POLL"
check "drained ids ignored by the cursor (re-drains the day every poll)" "$POLL" poller.service

perl -0pi -e 's/    if \(!holdCursor\) \{\n      this\.advanceCursor\(\[\.\.\.page\.filings, \.\.\.dayFilings\]\);\n    \}/    this.advanceCursor([...page.filings, ...dayFilings]);/' "$POLL"
check "advances past a failed drain (steps over the missing records)" "$POLL" poller.service

perl -0pi -e 's/        inserted = await this\.repository\.insertNew\(offered\);/        inserted = await this.repository.insertNew(offered).catch(() => []);/' "$POLL"
check "a thrown write read as a retryable no-op (rows stored, never alerted)" "$POLL" poller.service

echo ""
echo "=== the database decides newness, not the cursor ==="
echo "NSE disseminates out of seq_id order: 414 of the corpus's 17,442 filings"
echo "(2.37%, on 23 of 32 IST days) arrive with an id BELOW the stream position."
echo "Re-introducing the cursor as a newness filter drops every one of them with"
echo "no log, no counter and no alert, and holeDetected cannot see it either."

perl -0pi -e 's/    let candidates: readonly Filing\[\] = page\.filings;/    const fresh = new Set(newSeqIds);\n    let candidates: readonly Filing[] = page.filings.filter((f) =>\n      fresh.has(f.seqId),\n    );/' "$POLL"
check "cursor re-instated as a newness filter (2.37% of filings lost silently)" "$POLL" poller.service

perl -0pi -e 's/        candidates = mergeById\(page\.filings, dayFilings\);/        candidates = dayFilings;/' "$POLL"
check "hot page dropped from the drain merge (loses what only the page carried)" "$POLL" poller.service

echo ""
echo "=== the recently-seen set is a PRE-FILTER, never the authority ==="

perl -0pi -e 's/    const offered = this\.recent\.unseen\(candidates\);/    const offered: readonly Filing[] = [];\n    void candidates;/' "$POLL"
check "pre-filter suppresses everything (nothing is ever offered to the database)" "$POLL" poller.service

# Remembering BEFORE the write is the fail-open direction: a batch the database
# never accepted is marked stored, the retry is suppressed, and the filings are
# lost with the write-failure alert already fired and nothing left to recover.
perl -0pi -e 's/        inserted = await this\.repository\.insertNew\(offered\);\n        this\.writeFailing = false;\n(.*?)        this\.recent\.remember\(offered\);/        this.recent.remember(offered);\n        inserted = await this.repository.insertNew(offered);\n        this.writeFailing = false;/s' "$POLL"
check "batch remembered before the write is proven (a failed write is never retried)" "$POLL" poller.service

echo ""
echo "=== the drain decision is the no-loss guarantee ==="

perl -0pi -e "s/    const reason: DrainReason \\| null = holeDetected\n      \\? 'rollover'/    const reason: DrainReason | null = holeDetected \&\& newSeqIds.length > 0\n      ? 'rollover'/" "$POLL"
check "drain inferred from the new-id count (skips the cold-start baseline)" "$POLL" poller.service

perl -0pi -e 's/        candidates = mergeById\(page\.filings, dayFilings\);/        candidates = page.filings;/' "$POLL"
check "drained page discarded (the recovered filings are thrown away)" "$POLL" poller.service

perl -0pi -e 's/      drained: reason !== null,/      drained: false,/' "$POLL"
check "drain never reported (the caller cannot see a rollover happened)" "$POLL" poller.service

perl -0pi -e 's/      drainReason: reason,/      drainReason: null,/' "$POLL"
check "drain reason never reported (rollover and sweep become indistinguishable)" "$POLL" poller.service

perl -0pi -e 's/      const result = await this\.adapter\.fetchDay\(day\);/      const result = await this.adapter.fetchDay(new Date());/' "$POLL"
check "drains the wall-clock day, not the instant it was handed" "$POLL" poller.service

echo ""
echo "=== the drain range: a hole can span IST midnight ==="
echo "The IST day rolls at 18:30 UTC, so a restart whose downtime crossed it"
echo "drains today while yesterday's filings beyond the newest twenty are never"
echo "fetched — and the cursor steps past them."

perl -0pi -e 's/    const \{ days, skippedDays \} = drainRange\(anchor, now\);/    void anchor;\n    const { days, skippedDays } = { days: [now], skippedDays: 0 };/' "$POLL"
check "drain collapsed to today (a hole spanning IST midnight stays open)" "$POLL" poller.service

perl -0pi -e 's/    const anchor = await this\.repository\.getMaxDisseminatedAt\(\);/    const anchor: Date | null = null;/' "$POLL"
check "range anchor never read (every drain is a single day again)" "$POLL" poller.service

perl -0pi -e 's/      const result = await this\.adapter\.fetchDay\(day\);\n      filings\.push\(\.\.\.result\.filings\);\n      skipped \+= result\.skipped;\n      received \+= result\.received;/      const result = await this.adapter\n        .fetchDay(day)\n        .catch(() => ({ filings: [], skipped: 0, received: 0 }));\n      filings.push(...result.filings);\n      skipped += result.skipped;\n      received += result.received;/' "$POLL"
check "a failed day in the range swallowed (a partial range reports as reconciled)" "$POLL" poller.service

perl -0pi -e 's/    return \{ filings, days: days\.length, skipped, received \};/    return { filings, days: 1, skipped, received };/' "$POLL"
check "day count hardcoded (a multi-day drain is invisible in the result)" "$POLL" poller.service

echo ""
echo "=== the scheduled drains: the reconciliation ran once per process ==="
echo "No 2s window in the corpus holds more than 6 filings and no 30s window"
echo "more than 9, against a 20-record page — so holeDetected fires once per"
echo "process lifetime. Replaying 32 days: 1 rollover drain, 9,059 periodic,"
echo "31 closing. Remove the schedule and the safety net is gone."

perl -0pi -e 's/          lastDrainAtMs: this\.lastDrainAtMs,\n          lastClosingDay: this\.lastClosingDay,\n          drainIntervalMs: this\.options\.drainIntervalMs,/          lastDrainAtMs: now.getTime(),\n          lastClosingDay: istDayKey(now),\n          drainIntervalMs: Number.MAX_SAFE_INTEGER,/' "$POLL"
check "scheduled drains removed (reconciliation runs once per process lifetime)" "$POLL" poller.service

perl -0pi -e 's/      this\.lastDrainAtMs = now\.getTime\(\);\n//' "$POLL"
check "drain clock never advanced (a re-pull of the whole day on every poll)" "$POLL" poller.service

perl -0pi -e "s/      if \(reason === 'closing'\) this\.lastClosingDay = istDayKey\(now\);\n//" "$POLL"
check "closing day never recorded (the day is re-closed on every tick after 23:30)" "$POLL" poller.service

perl -0pi -e "s/    const holdCursor = drainFailed \&\& reason === 'rollover';/    const holdCursor = drainFailed;/" "$POLL"
check "a failed scheduled drain holds the cursor (manufactures a permanent rollover loop)" "$POLL" poller.service

echo ""
echo "=== the in-flight guard ==="

perl -0pi -e 's/    if \(this\.polling\) \{.*?\n    \}\n\n    this\.polling = true;/    this.polling = true;/s' "$POLL"
check "guard removed (polls stack ~15 deep during a 30s Akamai block)" "$POLL" poller.service

# Released on the success path only, rather than in a `finally`. Written as a
# straight-line sequence rather than by deleting the `finally`, because a `try`
# with neither `catch` nor `finally` does not compile and a mutation that never
# ran proves nothing.
perl -0pi -e 's/    this\.polling = true;\n    try \{\n      return await this\.poll\(now\);\n    \} finally \{.*?\n      this\.polling = false;\n    \}/    this.polling = true;\n    const result = await this.poll(now);\n    this.polling = false;\n    return result;/s' "$POLL"
check "guard never released after a throw (the poller goes silent for good)" "$POLL" poller.service

perl -0pi -e 's/      return this\.barrenResult\(now, true\);/      return this.barrenResult(now, false);/' "$POLL"
check "a deferred tick reports as an ordinary quiet poll" "$POLL" poller.service

echo ""
echo "=== the breaker: the edge, and what counts as recovery ==="

perl -0pi -e 's/    if \(this\.breaker\.recordFailure\(\)\) \{/    this.breaker.recordFailure();\n    if (this.breaker.isDegraded()) {/' "$POLL"
check "branches on isDegraded (a message every 2s until the channel is muted)" "$POLL" poller.service

perl -0pi -e 's/    this\.breaker\.recordSuccess\(\);\n    await this\.reportBlindFeed\(page\);/    await this.reportBlindFeed(page);/' "$POLL"
check "success never recorded (one blip and the breaker never clears)" "$POLL" poller.service

perl -0pi -e 's/    this\.breaker\.recordSuccess\(\);/    if (page.filings.length > 0) this.breaker.recordSuccess();/' "$POLL"
check "recovery gated on records arriving (a quiet market trips the breaker)" "$POLL" poller.service

perl -0pi -e 's/        formatDegradedAlert\(this\.breaker\.consecutiveFailures\(\), message\),/        formatDegradedAlert(1, message),/' "$POLL"
check "failure count hardcoded (the outage duration is lost)" "$POLL" poller.service

echo ""
echo "=== the blind-feed alarm: received 0 is normal, all-rejected is not ==="

perl -0pi -e 's/    \/\/ `received === 0` is the ordinary quiet-market and market-holiday signal\.\n    if \(page\.received === 0\) return;\n//' "$POLL"
check "an empty day alarms (every market holiday pages the operator)" "$POLL" poller.service

perl -0pi -e 's/    if \(page\.filings\.length > 0\) \{\n      this\.feedBlind = false;\n      return;\n    \}/    if (page.received === 0) {\n      this.feedBlind = false;\n      return;\n    }/' "$POLL"
check "a partially rejected page alarms (one bad record is not blindness)" "$POLL" poller.service

# Re-arming on an empty page is not the same as re-arming on filings: an empty
# page is evidence of nothing, and a feed alternating empty and all-rejected
# would re-arm on every empty poll and re-alert on every blind one.
perl -0pi -e 's/    if \(page\.filings\.length > 0\) \{\n      this\.feedBlind = false;\n      return;\n    \}\n\n    \/\/ `received === 0` is the ordinary quiet-market and market-holiday signal\.\n    if \(page\.received === 0\) return;/    if (page.received === 0 || page.filings.length > 0) {\n      this.feedBlind = false;\n      return;\n    }/' "$POLL"
check "latch re-armed by an empty page (alternating feed re-alerts every episode)" "$POLL" poller.service

perl -0pi -e 's/    if \(this\.feedBlind\) return;\n//' "$POLL"
check "alarm not edge-triggered (a message every 2s until it is muted)" "$POLL" poller.service

perl -0pi -e 's/      this\.feedBlind = false;\n      return;/      return;/' "$POLL"
check "latch never re-armed (a second episode is never reported)" "$POLL" poller.service

perl -0pi -e 's/    await this\.reportBlindFeed\(page\);\n//' "$POLL"
check "blind feed never announced (an id-format change silences the feed)" "$POLL" poller.service

echo ""
echo "=== the partial-skip alarm: nineteen of twenty looks entirely healthy ==="

perl -0pi -e 's/    await this\.reportSkippedRecords\(skipped, received\);\n\n//' "$POLL"
check "dropped records never announced (a mapper drift is invisible)" "$POLL" poller.service

perl -0pi -e 's/    if \(this\.feedPartial\) return;\n    this\.feedPartial = true;\n//' "$POLL"
check "alarm not edge-triggered (a drifted mapper floods the channel)" "$POLL" poller.service

perl -0pi -e 's/    if \(skipped === 0\) \{\n      this\.feedPartial = false;\n      return;\n    \}/    if (skipped === 0) return;/' "$POLL"
check "latch never re-armed (a second drift episode is never reported)" "$POLL" poller.service

perl -0pi -e 's/    if \(skipped === received\) return;\n\n//' "$POLL"
check "a wholly rejected page double-reported (two alerts, two remedies)" "$POLL" poller.service

perl -0pi -e 's/        skipped \+= drain\.skipped;\n//' "$POLL"
check "drain skips not counted (a day-wide mapper drift reads as one bad record)" "$POLL" poller.service

perl -0pi -e 's/      skipped,\n      deferred: false,/      skipped: 0,\n      deferred: false,/' "$POLL"
check "skip count never reported (the caller cannot alarm on it either)" "$POLL" poller.service

echo ""
echo "=== the drain-failure alarm: the hole stays open and nothing else notices ==="

perl -0pi -e 's/        await this\.reportDrainFailure\(error\);/        this.logger.error("Drain failed");/' "$POLL"
check "failed drain never announced (the no-loss guarantee silently lapses)" "$POLL" poller.service

perl -0pi -e 's/    if \(this\.drainFailing\) return;\n    this\.drainFailing = true;\n//' "$POLL"
check "alarm not edge-triggered (a bad day endpoint floods the channel)" "$POLL" poller.service

perl -0pi -e 's/        this\.drainFailing = false;\n//' "$POLL"
check "latch never re-armed (a second drain outage is never reported)" "$POLL" poller.service

perl -0pi -e 's/    if \(this\.drainFailing\) return;\n    this\.drainFailing = true;\n    await this\.telegram\.send\(formatDrainFailureAlert\(message\)\);/    if (this.breaker.recordFailure()) {\n      await this.telegram.send(formatDegradedAlert(1, message));\n    }/' "$POLL"
check "failed drain counted as a failed poll (claims an outage that is not happening)" "$POLL" poller.service

echo ""
echo "=== the write-failure alarm ==="

perl -0pi -e 's/    if \(!this\.writeFailing\) \{\n      this\.writeFailing = true;\n      await this\.telegram\.send\(formatWriteFailureAlert\(batch\.length, message\)\);\n    \}\n\n//' "$POLL"
check "failed write never announced (rows stored without alerting, in silence)" "$POLL" poller.service

perl -0pi -e 's/    if \(!this\.writeFailing\) \{\n      this\.writeFailing = true;\n//' "$POLL"
perl -0pi -e 's/      await this\.telegram\.send\(formatWriteFailureAlert\(batch\.length, message\)\);\n    \}/      await this.telegram.send(formatWriteFailureAlert(batch.length, message));/' "$POLL"
check "alarm not edge-triggered (a database outage floods the channel)" "$POLL" poller.service

perl -0pi -e 's/        inserted = await this\.repository\.insertNew\(offered\);\n        this\.writeFailing = false;/        inserted = await this.repository.insertNew(offered);/' "$POLL"
check "latch never re-armed (a second outage is never reported)" "$POLL" poller.service

echo ""
echo "=== alerting is gated on confirmed inserts ==="

perl -0pi -e 's/    const alerted = await this\.alertOn\(inserted, now\);/    const alerted = await this.alertOn(candidates, now);/' "$POLL"
check "the whole poll result alerted (every record re-notifies on every poll)" "$POLL" poller.service

perl -0pi -e 's/    try \{\n      return \(await this\.alerts\.processInserted\(inserted, now\)\)\.length;\n    \} catch \(error\) \{.*?\n    \}\n/    return (await this.alerts.processInserted(inserted, now)).length;\n/s' "$POLL"
check "alert failure propagates (one poison record wedges the cursor forever)" "$POLL" poller.service

echo ""
echo "=== cadence and startup ==="

perl -0pi -e 's/      delayMs: this\.delayFor\(drainFailed \? 0 : newSeqIds\.length, now\),/      delayMs: this.delayFor(0, now),/' "$POLL"
check "burst signal dropped (the page turns over while we wait out the interval)" "$POLL" poller.service

# The defect this guard was added for. `newSeqIds` is derived from the cursor and
# a failed drain HOLDS the cursor, so the same ids stay "new" on every poll: pass
# that count through and the burst rule returns a zero delay forever, turning the
# loop into a fetchLatest+fetchDay storm at network speed against an endpoint
# that is already refusing. The breaker cannot see it — the hot fetch succeeds —
# and the in-flight guard cannot either, because the calls are sequential.
perl -0pi -e 's/      delayMs: this\.delayFor\(drainFailed \? 0 : newSeqIds\.length, now\),/      delayMs: this.delayFor(newSeqIds.length, now),/' "$POLL"
check "held-cursor count feeds the burst rule (busy-loops on a failed drain)" "$POLL" poller.service

perl -0pi -e 's/    return nextPollDelayMs\(\{ newCount, now, \.\.\.this\.options \}\);/    return nextPollDelayMs({ newCount, now: new Date(0), ...this.options });/' "$POLL"
check "cadence read off a frozen clock, not the instant supplied" "$POLL" poller.service

perl -0pi -e 's/    await this\.repository\.assertIndexes\(\);\n\n//' "$POLL"
check "index assertion skipped (a restart re-alerts the whole day)" "$POLL" poller.service

perl -0pi -e 's/    await this\.repository\.assertIndexes\(\);\n\n    this\.cursor = await this\.repository\.getMaxSeqId\(\);/    this.cursor = await this.repository.getMaxSeqId();\n    await this.repository.assertIndexes();/' "$POLL"
check "index asserted after the cursor read, not before it" "$POLL" poller.service

perl -0pi -e 's/      if \(this\.running && delayMs > 0\) await this\.sleep\(delayMs\);/      if (delayMs > 0) await this.sleep(delayMs);/' "$POLL"
check "sleeps after being told to stop (shutdown waits out a full interval)" "$POLL" poller.service

perl -0pi -e 's/    const wake = this\.wake;\n    this\.clearSleep\(\);\n    wake\?\.\(\);/    this.clearSleep();/' "$POLL"
check "stop does not wake the sleeper (SIGTERM hangs for the idle interval)" "$POLL" poller.service

perl -0pi -e 's/    if \(this\.running\) \{\n      throw new Error\(.PollerService is already running.\);\n    \}\n\n//' "$POLL"
check "a second loop allowed to start (two schedules against one cursor)" "$POLL" poller.service

perl -0pi -e 's/    try \{\n      return \(await this\.tick\(\)\)\.delayMs;\n    \} catch \(error\) \{.*?\n    \}\n/    return (await this.tick()).delayMs;\n/s' "$POLL"
check "loop dies on a contract violation (reads as a quiet market from outside)" "$POLL" poller.service

echo ""
echo "=== independence checks ==="
echo "Each guarantee must die to the suite that OWNS it, not merely to the"
echo "whole file. Otherwise deleting a describe block would silently cost"
echo "coverage that looks covered."

perl -0pi -e 's/    if \(this\.polling\) \{.*?\n    \}\n\n    this\.polling = true;/    this.polling = true;/s' "$POLL"
check "guard removed, in-flight suite only" "$POLL" poller.service -t "the in-flight guard"

perl -0pi -e "s/    const reason: DrainReason \\| null = holeDetected\n      \\? 'rollover'/    const reason: DrainReason | null = holeDetected \&\& newSeqIds.length > 0\n      ? 'rollover'/" "$POLL"
check "drain inferred from the count, drain suite only" "$POLL" poller.service -t "ingest and drain"

perl -0pi -e 's/          lastDrainAtMs: this\.lastDrainAtMs,\n          lastClosingDay: this\.lastClosingDay,\n          drainIntervalMs: this\.options\.drainIntervalMs,/          lastDrainAtMs: now.getTime(),\n          lastClosingDay: istDayKey(now),\n          drainIntervalMs: Number.MAX_SAFE_INTEGER,/' "$POLL"
check "scheduled drains removed, scheduled-drain suite only" "$POLL" poller.service -t "scheduled drains"

perl -0pi -e 's/    if \(!holdCursor\) \{\n      this\.advanceCursor\(\[\.\.\.page\.filings, \.\.\.dayFilings\]\);\n    \}/    this.advanceCursor([...page.filings, ...dayFilings]);/' "$POLL"
check "advances past a failed drain, cursor suite only" "$POLL" poller.service -t "cursor discipline"

perl -0pi -e 's/    if \(this\.breaker\.recordFailure\(\)\) \{/    this.breaker.recordFailure();\n    if (this.breaker.isDegraded()) {/' "$POLL"
check "branches on isDegraded, breaker suite only" "$POLL" poller.service -t "circuit breaker"

perl -0pi -e 's/    let candidates: readonly Filing\[\] = page\.filings;/    const fresh = new Set(newSeqIds);\n    let candidates: readonly Filing[] = page.filings.filter((f) =>\n      fresh.has(f.seqId),\n    );/' "$POLL"
check "cursor as newness filter, out-of-order suite only" "$POLL" poller.service -t "out-of-order dissemination"

perl -0pi -e 's/  if \(!Number\.isFinite\(value\)\) \{\n    throw new Error\(\n      `\$\{key\} must be a finite number.*?\n    \);\n  \}\n\n  if \(!Number\.isInteger\(value\)\) \{\n    throw new Error\(`\$\{key\} must be a whole number, but was "\$\{raw\}"\.`\);\n  \}\n\n//s' "$CONF"
check "bare lower bound, numeric-validation suite only" "$CONF" configuration -t "numeric validation"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest poller.service configuration 2>&1 |
  grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
