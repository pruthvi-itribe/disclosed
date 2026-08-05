#!/usr/bin/env bash
#
# Mutation harness for the notify lib (Task 10): the wire-format alert formatter
# and the Telegram client.
#
# This is the last hop before a filing reaches a human, and its two files carry
# guarantees that fail SILENTLY rather than loudly:
#
#   1. HTML escaping is a security control. The message ships with
#      `parse_mode: 'HTML'` and every interpolated value is exchange-controlled
#      text. Drop an escape and three things go wrong at once — markup we never
#      authored renders in the user's client, entity-looking text is silently
#      rewritten (Telegram turns a literal "&#8377;" into a rupee sign, changing
#      the exchange's words), and unparseable HTML makes Telegram reject the
#      message outright, so the filing is simply never delivered. None of that
#      shows up as an exception anywhere.
#   2. The send failure swallow is deliberate but must stay LOUD. A Telegram
#      outage must never stop ingestion, so `send()` catches everything. That is
#      only defensible while the catch logs at error level with a usable reason.
#      Weakened to a bare `catch {}`, the bot goes quiet and nothing in the logs
#      says why.
#
# Both guarantees are the kind that a passing test suite can imply without
# actually proving. So this script breaks the implementation one way at a time,
# re-runs the suite, and asserts the break is caught — then restores.
#
# Usage:  bash tools/mutation/notify-mutations.sh
# Exit:   0 only if every mutation applied AND was caught.
#
# Three outcomes per mutation, deliberately distinguished:
#   CAUGHT   the tests failed — the guarantee is covered.
#   SURVIVED the tests passed — a real test gap.
#   NO-OP    the perl pattern matched nothing, so nothing was mutated. This is
#            harness staleness after a refactor, NOT a test gap. Conflating the
#            two would raise a false alarm about the alerting path itself.
#
# Safety mirrors tools/mutation/circuit-breaker-mutations.sh — see that file for
# the full rationale. In short: refuses to run on a dirty tree, INT/TERM exit
# rather than return so the script cannot resume past cleanup, every restore is
# verified byte-for-byte, a jest run killed by a signal is reported as ABORTED
# rather than misread as a surviving mutation, and a mutation that does not
# type-check is reported as COMPILE rather than misread as SURVIVED.
#
# This harness mutates TWO files, so each mutation names the jest pattern that
# should catch it. That is not just plumbing: it asserts the mutation dies to
# the suite that OWNS the guarantee, rather than to some unrelated suite that
# happens to import the same module.
#
# NOT covered by mutation, and why: the em dash and the exact line ordering of
# the wire format are pinned by a whole-message equality assertion rather than
# by behaviour, so mutating them proves only that the assertion exists. The
# The
# "adds no interpretation, recommendation or advisory framing" test is a ratchet
# against a sentiment tag or price being added to the template LATER — there is
# no such code to mutate today, so it is deliberately outside this harness, in
# the same way the circuit breaker's no-time-based-behaviour suite is outside
# its own. `IST_OFFSET_MS`, `pad2`, `safeText`, `safeJson` and `stackOf` moved
# to `libs/common` and are mutated by tools/mutation/common-mutations.sh, which
# runs them against THIS suite as well as its own — including the half-hour
# offset against the IST-clock tests specifically — so no guarantee moved off a
# test when the copies were consolidated.
#
# Tally, so a report can quote it without recounting: 36 mutations across nine
# groups, plus 5 independence checks = 45 `check` calls.

set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
FMT=$ROOT/libs/notify/src/alert-formatter.ts
SVC=$ROOT/libs/notify/src/telegram.service.ts

SOURCES=("$FMT" "$SVC")

# --- precondition: refuse to mutate a dirty tree -----------------------------
for src in "${SOURCES[@]}"; do
  if ! git -C "$ROOT" ls-files --error-unmatch "$src" >/dev/null 2>&1; then
    echo "refusing to run: $src is not tracked by git." >&2
    exit 1
  fi
  if ! git -C "$ROOT" diff --quiet -- "$src" ||
    ! git -C "$ROOT" diff --cached --quiet -- "$src"; then
    echo "refusing to run: uncommitted changes in a file this script mutates." >&2
    echo "  commit or stash them first — this script edits it in place." >&2
    git -C "$ROOT" status --short -- "$src" >&2
    exit 1
  fi
done

# --- backup: an unchecked cp here would mean mutating with no way back -------
BACKUP=$(mktemp -d) || {
  echo "refusing to run: could not create a backup directory." >&2
  exit 1
}
for src in "${SOURCES[@]}"; do
  cp "$src" "$BACKUP/$(basename "$src")" || {
    echo "refusing to run: could not back up $(basename "$src")." >&2
    rm -rf "$BACKUP"
    exit 1
  }
done

FAILURES=0
NOOPS=0

restore_verified() {
  local ok=0
  for src in "${SOURCES[@]}"; do
    cp "$BACKUP/$(basename "$src")" "$src" || ok=1
    cmp -s "$BACKUP/$(basename "$src")" "$src" || ok=1
  done
  return $ok
}

on_exit() {
  if restore_verified; then
    rm -rf "$BACKUP"
  else
    echo "" >&2
    echo "FATAL: source could NOT be restored. Backup kept at:" >&2
    echo "  $BACKUP" >&2
    echo "Recover with:" >&2
    echo "  cp $BACKUP/*.ts $ROOT/libs/notify/src/" >&2
    echo "or: git -C $ROOT checkout -- libs/notify/src" >&2
    exit 1
  fi
}

trap on_exit EXIT
trap 'echo ""; echo "INTERRUPTED — restoring source."; exit 130' INT TERM

# True when nothing on disk differs from the backups.
sources_unchanged() {
  for src in "${SOURCES[@]}"; do
    cmp -s "$src" "$BACKUP/$(basename "$src")" || return 1
  done
  return 0
}

# check <label> <jest-pattern> [extra jest args...]
check() {
  local label="$1"
  local pattern="$2"
  shift 2
  local out

  if sources_unchanged; then
    echo "NO-OP    | $label"
    echo "           <-- HARNESS STALE: pattern matched nothing; not a test gap"
    NOOPS=$((NOOPS + 1))
    restore_verified || on_exit
    return
  fi

  out=$(cd "$ROOT" && npx jest "$pattern" "$@" 2>&1)
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
  if echo "$out" | grep -qE "Test suite failed to run"; then
    echo "COMPILE  | $label"
    echo "           <-- mutation did not type-check; no assertion was exercised"
    FAILURES=$((FAILURES + 1))
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

echo "=== escaping: every interpolated field, or the control is not a control ==="

perl -0pi -e 's/    escapeHtml\(filing\.summary\),/    filing.summary,/' "$FMT"
check "summary not escaped (the injection vector the brief already covered)" alert-formatter

perl -0pi -e 's/escapeHtml\(filing\.symbol\.toUpperCase\(\)\)/filing.symbol.toUpperCase()/' "$FMT"
check "symbol not escaped (M&M, J&KBANK — 94 records in one corpus month)" alert-formatter

perl -0pi -e 's/escapeHtml\(\n      filing\.category\.toUpperCase\(\),\n    \)/filing.category.toUpperCase()/' "$FMT"
check "category not escaped (Registrar & Share Transfer Agent Update is real)" alert-formatter

perl -0pi -e 's/\$\{escapeHtml\(filing\.attachmentUrl\)\}/\${filing.attachmentUrl}/' "$FMT"
check "attachment url not escaped (exchange-supplied, query strings carry &)" alert-formatter

echo ""
echo "=== escapeHtml itself: order and completeness ==="

perl -0pi -e 's/text\.replace\(\/&\/g, .&amp;.\)\.replace\(\/<\/g, .&lt;.\)\.replace\(\/>\/g, .&gt;.\)/text.replace(\/<\/g, "&lt;").replace(\/>\/g, "&gt;").replace(\/&\/g, "&amp;")/' "$FMT"
check "ampersand replaced LAST, so every escape is itself escaped" alert-formatter

perl -0pi -e 's/text\.replace\(\/&\/g, .&amp;.\)\./text./' "$FMT"
check "ampersand not escaped at all (entity text silently rewritten by Telegram)" alert-formatter

perl -0pi -e 's/\.replace\(\/<\/g, .&lt;.\)//' "$FMT"
check "less-than not escaped (opens a tag)" alert-formatter

perl -0pi -e 's/\.replace\(\/>\/g, .&gt;.\)//' "$FMT"
check "greater-than not escaped (closes a tag)" alert-formatter

perl -0pi -e 's/escapeHtml\(filing\.symbol\.toUpperCase\(\)\)/escapeHtml(filing.symbol).toUpperCase()/' "$FMT"
check "escape before uppercase, emitting &AMP; which Telegram will not parse" alert-formatter

echo ""
echo "=== the IST clock: the one number a reader acts on ==="

perl -0pi -e 's/new Date\(new Date\(date\)\.getTime\(\) \+ IST_OFFSET_MS\)/new Date(new Date(date).getTime() - IST_OFFSET_MS)/' "$FMT"
check "offset applied backwards (11 hours wrong)" alert-formatter

perl -0pi -e 's/new Date\(new Date\(date\)\.getTime\(\) \+ IST_OFFSET_MS\)/new Date(date.getTime() + IST_OFFSET_MS)/' "$FMT"
check "storage re-wrap dropped (a string disseminatedAt throws mid-send)" alert-formatter

perl -0pi -e 's/toIstClock\(filing\.disseminatedAt\)/toIstClock(filing.ingestedAt)/' "$FMT"
check "clock reads ingestedAt (our wall time, 'now' for a whole cold-start drain)" alert-formatter

perl -0pi -e 's/toIstClock\(filing\.disseminatedAt\)/toIstClock(filing.announcedAt)/' "$FMT"
check "clock reads announcedAt (the company's time, lags dissemination)" alert-formatter

echo ""
echo "=== wire structure and the relay-verbatim discipline ==="

perl -0pi -e 's/if \(filing\.attachmentUrl\) \{/if (filing.attachmentUrl !== null) {/' "$FMT"
check "empty-string url emits a bare 'Source: ' line" alert-formatter

perl -0pi -e 's/  if \(filing\.attachmentUrl\) \{\n    lines\.push\(`Source: \$\{escapeHtml\(filing\.attachmentUrl\)\}`\);\n  \}/  lines.push(`Source: \${escapeHtml(String(filing.attachmentUrl))}`);/' "$FMT"
check "source line always pushed, printing 'Source: null'" alert-formatter

perl -0pi -e 's/    escapeHtml\(filing\.summary\),/    escapeHtml(filing.summary).slice(0, 100),/' "$FMT"
check "summary truncated (the exchange's words silently cut)" alert-formatter

echo ""
echo "=== the degraded alert: the message that says we have gone blind ==="

perl -0pi -e 's/`Last error: \$\{escapeHtml\(lastError\)\}`/`Last error: \${lastError}`/' "$FMT"
check "error text not escaped (NSE's HTML error page breaks the message)" alert-formatter

perl -0pi -e 's/.INGEST DEGRADED./"Ingest degraded"/' "$FMT"
check "headline no longer shouts (operator filters miss it)" alert-formatter

echo ""
echo "=== the other three operator alerts: same escaping, same shouted headline ==="
echo "Each names a different way the pipeline goes silent while looking healthy."
echo "The escaping is not cosmetic on any of them: all three interpolate driver"
echo "or exchange text, and HTML that does not parse makes Telegram REJECT the"
echo "message outright — losing the one alert that says something is wrong."

perl -0pi -e 's/.INGEST BLIND./"Ingest blind"/' "$FMT"
check "blind-feed headline no longer shouts (operator filters miss it)" alert-formatter

perl -0pi -e 's/NSE returned \$\{received\} record\(s\)/NSE returned 20 record(s)/' "$FMT"
check "blind-feed count hardcoded (says 20 whatever NSE actually sent)" alert-formatter

perl -0pi -e 's/.INGEST DRAIN FAILED./"Ingest drain failed"/' "$FMT"
check "drain-failure headline no longer shouts (operator filters miss it)" alert-formatter

# Anchored on the line above, because the `Last error:` line is identical in
# three formatters and an unanchored pattern would mutate the first one only.
perl -0pi -e 's/(have not been fetched[^\n]*\n    `Last error: )\$\{escapeHtml\(lastError\)\}/$1\${lastError}/' "$FMT"
check "drain error not escaped (NSE's HTML block page breaks the message)" alert-formatter

perl -0pi -e 's/.INGEST WRITE FAILED./"Ingest write failed"/' "$FMT"
check "write-failure headline no longer shouts (operator filters miss it)" alert-formatter

perl -0pi -e 's/A batch of \$\{batchSize\} filing\(s\)/A batch of 0 filing(s)/' "$FMT"
check "write-failure batch size hardcoded (reports 0 rows at risk, always)" alert-formatter

perl -0pi -e 's/(re-return them[^\n]*\n    `Last error: )\$\{escapeHtml\(lastError\)\}/$1\${lastError}/' "$FMT"
check "write error not escaped (a document fragment breaks the message)" alert-formatter

echo ""
echo "=== the deliberate swallow must stay loud ==="

perl -0pi -e 's/        stackOf\(error\),\n      \);/        stackOf(error),\n      );\n      throw error;/' "$SVC"
check "rethrows after logging (a Telegram 502 reaches the poll loop)" telegram.service

perl -0pi -e 's/      this\.logger\.error\(\n        `Telegram send failed: \$\{describeError\(error\)\}`,\n        stackOf\(error\),\n      \);/      \/* swallowed silently *\//' "$SVC"
check "bare catch, nothing logged (the bot goes quiet with no trace)" telegram.service

perl -0pi -e 's/      this\.logger\.error\(\n        `Telegram send failed:/      this.logger.log(\n        `Telegram send failed:/' "$SVC"
check "logged at info level (lost in the poll-cycle noise)" telegram.service

perl -0pi -e 's/\$\{describeError\(error\)\}/\${(error as Error).message}/' "$SVC"
check "naive error description (throws on a null rejection, inside the catch)" telegram.service

perl -0pi -e 's/        stackOf\(error\),\n//' "$SVC"
check "stack dropped (a programming bug reads as a flaky channel)" telegram.service

echo ""
echo "=== send options are a contract with the formatter ==="

perl -0pi -e 's/  parse_mode: .HTML.,/  parse_mode: "Markdown",/' "$SVC"
check "parse mode switched to Markdown (escapes render as literal text)" telegram.service

perl -0pi -e 's/  disable_web_page_preview: true,/  disable_web_page_preview: false,/' "$SVC"
check "link preview enabled (unfurled PDF card buries the headline)" telegram.service

perl -0pi -e 's/\{ polling: false \}/{ polling: true }/' "$SVC"
check "polling enabled (opens a long-lived update connection we never read)" telegram.service

echo ""
echo "=== absent credentials must degrade, never crash and never lose the alert ==="

perl -0pi -e 's/this\.bot = token \? new TelegramBot\(token, \{ polling: false \}\) : null;/this.bot = new TelegramBot(token, { polling: false });/' "$SVC"
check "bot constructed with an empty token (throws at boot on a fresh .env)" telegram.service

perl -0pi -e 's/    if \(!this\.bot \|\| !this\.chatId\) \{/    if (!this.bot) {/' "$SVC"
check "chat id guard dropped (sends to an empty chat id every poll)" telegram.service

perl -0pi -e 's/this\.logger\.warn\(.TELEGRAM_BOT_TOKEN[^;]*;//' "$SVC"
check "startup warning removed (silent channel looks like a quiet market)" telegram.service

perl -0pi -e 's/      this\.logger\.log\(`\[alert suppressed\]\\n\$\{text\}`\);\n//' "$SVC"
check "suppressed alert not logged (the filing is lost, not deferred)" telegram.service

echo ""
echo "=== independence checks ==="
echo "Each guarantee must die to the suite that OWNS it, not merely to the"
echo "seven hand-written tests from the brief. Otherwise deleting a suite would"
echo "silently cost coverage that looks covered."

perl -0pi -e 's/escapeHtml\(filing\.symbol\.toUpperCase\(\)\)/filing.symbol.toUpperCase()/' "$FMT"
check "unescaped symbol, all-fields suite only" alert-formatter -t "every interpolated field is escaped"

perl -0pi -e 's/    escapeHtml\(filing\.summary\),/    escapeHtml(filing.summary).slice(0, 100),/' "$FMT"
check "truncated summary, wire structure suite only" alert-formatter -t "wire structure"

perl -0pi -e 's/\$\{describeError\(error\)\}/\${(error as Error).message}/' "$SVC"
check "naive error description, failure suite only" telegram.service -t "when Telegram fails"

perl -0pi -e 's/    if \(!this\.bot \|\| !this\.chatId\) \{/    if (!this.bot) {/' "$SVC"
check "chat id guard dropped, absent-credentials suite only" telegram.service -t "with credentials absent"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught; no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest libs/notify 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
