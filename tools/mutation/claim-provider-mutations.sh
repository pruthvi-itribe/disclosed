#!/usr/bin/env bash
#
# Mutation harness for the provider boundary: the modules that decide WHICH
# model is asked for a claim, what it is asked, and what a comparison between
# two of them reports.
#
# WHY THIS EXISTS SEPARATELY from claim-extraction-mutations.sh. That harness
# guards the gate — whether a proposed claim may be published. This one guards
# two different things, and neither is covered by it:
#
#   1. THAT THE TWO PROVIDERS ARE ASKED THE SAME QUESTION. The gate is
#      provider-agnostic by construction, so a divergence between the adapters
#      cannot make a bad claim publishable — it can only make a MEASUREMENT
#      meaningless. A prompt, a document cap, a token ceiling or an effort level
#      that drifted between the two would report the difference between two
#      requests as a difference between two models, and the whole reason a
#      second provider exists is to answer that question with a number.
#   2. THE ARITHMETIC OF THE COMPARISON ITSELF. The invention rate, the cost and
#      the latency percentiles leave this process and are the basis of a
#      decision about what to run in production. A denominator that quietly
#      counted discards instead of proposals, or a cost that divided by the
#      calls which happened to report usage, is worse than no measurement: it is
#      a measurement somebody will act on.
#
# The guarantees broken one at a time:
#
#   1. ONE REQUEST, TWO PROVIDERS. Same system prompt, same schema, same token
#      ceiling, same temperature, same routing constraint.
#   2. THE EFFORT LADDER CLAMP. Anthropic has five rungs and the OpenAI-
#      compatible API has three. Sending an unclamped level is a 400 or a
#      silently-dropped parameter; clamping the wrong way runs the comparison at
#      the wrong depth.
#   3. SECRET REDACTION. Every failure message is written to the filing and
#      rendered on the dashboard. A key echoed back inside a 401 body would
#      otherwise be persisted by the code that is reporting the error.
#   4. THE ADAPTER CONTRACT. Never throw; read an upstream error before
#      indexing into `choices`; tell a refusal, a truncation and a bad body
#      apart, because the three have different remedies.
#   5. USAGE ARITHMETIC. Four token classes billed at three rates. Folding them
#      together, or reporting an unreported call as a free one, understates a
#      bill.
#   6. CONFIGURATION. An unknown provider name must stop the process at load,
#      and each provider must default to a model it can actually resolve.
#   7. PROVIDER SELECTION. The factory must build the adapter the operator
#      asked for, with the model the operator configured.
#   8. THE INVENTION RATE. `span-not-found` over claims PROPOSED. Every other
#      column in the report is context for this one number.
#   9. THE REPORT. A table that dropped its zero rows, or its warnings about
#      partial data, would read as evidence it is not.
#
# Tally, so a report can quote it without recounting: 47 mutations across nine
# groups, plus 3 independence checks = 50 `check` calls.
#
# Usage:  bash tools/mutation/claim-provider-mutations.sh
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
#   - The prices in CLAIM_PROVIDER_PRICING and the model ids in
#     DEFAULT_CLAIM_MODEL. Mutating those mutates the specification rather than
#     the code; the suites pin each against a literal, which is what a fact
#     verified out of band deserves.
#   - tools/claims/compare-providers.ts. It is I/O around the pure modules below
#     and cannot be exercised without a key and a network.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LLM=$ROOT/libs/filings/src/llm
FILES=(
  "$LLM/claim-provider.ts"
  "$LLM/openrouter-claim-extractor.ts"
  "$LLM/claude-claim-extractor.ts"
  "$ROOT/apps/ingest/src/config/configuration.ts"
  "$ROOT/apps/ingest/src/enrichment/claim-extractor.factory.ts"
  "$ROOT/tools/claims/comparison-report.ts"
)
SUITE='(libs/filings/src/llm/|apps/ingest/src/(config/|enrichment/claim-extractor)|tools/claims/)'

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
    echo "  git -C $ROOT checkout -- libs/filings/src apps/ingest/src tools/claims" >&2
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

P=$LLM/claim-provider.ts
O=$LLM/openrouter-claim-extractor.ts
A=$LLM/claude-claim-extractor.ts
C=$ROOT/apps/ingest/src/config/configuration.ts
F=$ROOT/apps/ingest/src/enrichment/claim-extractor.factory.ts
R=$ROOT/tools/claims/comparison-report.ts

echo "=== one request, two providers: what makes them comparable at all ==="

# Mutated at the CALL, not in the message array: `ask()` became shared with the
# results lane and now takes the prompt as a parameter, so the array says
# `content: system` and pinning it would break the wrong lane.
perl -0pi -e 's/await this\.ask\(\s*CLAIM_SYSTEM_PROMPT,/await this.ask(\n      \`\${CLAIM_SYSTEM_PROMPT} Be generous.\`,/' "$O"
check "the OpenRouter prompt drifts from the Anthropic one"

perl -0pi -e 's/        max_tokens: this\.options\.maxTokens \?\? CLAIM_MAX_TOKENS,/        max_tokens: 2_000,/' "$O"
check "one provider measured with a smaller token ceiling than the other"

# Both ceilings were raised — 8_000 -> 32_000 and 120_000 -> 180_000 — and the
# harness kept naming the old numbers, so it stopped mutating anything. The
# literal is the point of these two, so the pattern re-states it and must be
# updated with it; claim-provider.spec.ts pins both against the same values.
perl -0pi -e 's/export const CLAIM_MAX_TOKENS = 32_000;/export const CLAIM_MAX_TOKENS = 3_000;/' "$P"
check "the shared token ceiling changed out from under both adapters"

perl -0pi -e 's/export const CLAIM_TIMEOUT_MS = 180_000;/export const CLAIM_TIMEOUT_MS = 5_000;/' "$P"
check "the shared timeout changed (a slow model reported as a failing one)"

perl -0pi -e 's/        temperature: 0,/        temperature: 1,/' "$O"
check "extraction resampled rather than read (a rerun stops meaning anything)"

# Both flags kept their meaning and lost their line. `provider` grew the
# quantization floor and the host order, and `json_schema` collapsed onto one
# line — so the flag alone is the anchor, and neither reflow can reach it again.
perl -0pi -e 's/require_parameters: true/require_parameters: false/' "$O"
check "routing allowed to a host that would ignore the JSON schema"

perl -0pi -e 's/strict: true/strict: false/' "$O"
check "the schema sent unenforced"

perl -0pi -e "s/export const CLAIM_SCHEMA_NAME = 'notable_claims';/export const CLAIM_SCHEMA_NAME = '';/" "$O"
check "the schema sent with no name"

echo ""
echo "=== the effort ladder: five rungs against three ==="

perl -0pi -e "s/  effort === 'low' \|\| effort === 'medium' \? effort : 'high';/  effort as 'low' | 'medium' | 'high';/" "$P"
check "an effort level sent that the OpenAI ladder does not have"

perl -0pi -e "s/  effort === 'low' \|\| effort === 'medium' \? effort : 'high';/  effort === 'low' || effort === 'medium' ? effort : 'low';/" "$P"
check "the two top rungs clamped DOWN to low instead of high"

perl -0pi -e 's/        reasoning: \{ effort: openAiEffort\(this\.options\.effort\) \},//' "$O"
check "the effort never sent to OpenRouter at all"

echo ""
echo "=== secret redaction: a failure message is stored and rendered ==="

perl -0pi -e 's/export const redactSecrets = \(text: string\): string =>\n  SECRET_PATTERNS\.reduce\(\n    \(redacted, pattern\) => redacted\.replace\(pattern, .\[redacted\].\),\n    text,\n  \);/export const redactSecrets = (text: string): string => text;/' "$P"
check "redaction hands a secret straight back"

perl -0pi -e 's/  \/\\bsk-\[A-Za-z0-9_-\]\{4,\}\/g,/  \/\\bsk-[A-Za-z0-9_-]{4,}\/,/' "$P"
check "only the first key in a message redacted"

perl -0pi -e 's/  redactSecrets\(error instanceof Error \? error\.message : String\(error\)\);/  error instanceof Error ? error.message : String(error);/' "$P"
check "a thrown error's message stored unredacted"

perl -0pi -e 's/  return redactSecrets\(\n    status === undefined/  return ((x: string) => x)(\n    status === undefined/' "$O"
check "an HTTP failure's body stored unredacted"

echo ""
echo "=== the adapter's contract ==="

perl -0pi -e 's/      return \{ outcome: .failed., message: describeHttpFailure\(error\) \};/      throw error;/' "$O"
check "the OpenRouter adapter throws out of the worker's loop"

perl -0pi -e 's/      const failure = errorIn\(payload\);/      const failure: string | null = null;/' "$O"
check "a 200 carrying an upstream error read as an unusable reply"

perl -0pi -e "s/        choice\.finish_reason === 'content_filter' \|\|/        false ||/" "$O"
check "a content-filter decline reported as a parse failure"

perl -0pi -e "s/      if \(choice\.finish_reason === 'length'\) \{/      if (false) {/" "$O"
check "a reply truncated at the ceiling reported as bad JSON"

# One line now, not four: reading the content out of the envelope moved into
# `ask()`, which hands back a `RawReply`, so `extract` just parses it. Both of
# the old spellings described the shape it used to have.
perl -0pi -e "s/return claimsFromText\(reply\.text, reply\.usage\);/return { outcome: 'ok', claims: [] };/" "$O"
check "OpenRouter reply parsing bypassed (every filing finds nothing)"

perl -0pi -e "s/    if \(apiKey\.trim\(\)\.length === 0\) return null;//" "$O"
check "an OpenRouter extractor built with no key"

perl -0pi -e "s/  if \(text\.trim\(\)\.length === 0\) \{/  if (false) {/" "$P"
check "an empty body parsed instead of refused"

echo ""
echo "=== usage arithmetic: four token classes, three rates ==="

perl -0pi -e 's/    cachedInputTokens: countOf\(record\.cache_read_input_tokens\),/    cachedInputTokens: 0,/' "$A"
check "Anthropic cache reads dropped from the usage report"

perl -0pi -e 's/    cacheWriteInputTokens: countOf\(record\.cache_creation_input_tokens\),/    cacheWriteInputTokens: 0,/' "$A"
check "Anthropic cache writes dropped (the premium never billed)"

perl -0pi -e 's/    inputTokens: Math\.max\(0, countOf\(record\.prompt_tokens\) - cached\),/    inputTokens: countOf(record.prompt_tokens),/' "$O"
check "OpenRouter cache reads counted twice, once as fresh input"

perl -0pi -e 's/  if \(typeof usage !== .object. \|\| usage === null\) return undefined;/  if (typeof usage !== "object" || usage === null)\n    return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 };/' "$O"
check "an unreported call priced as a free one"

perl -0pi -e "s/  typeof value === 'number' && Number\.isFinite\(value\) \? value : 0;/  typeof value === 'number' ? value : 0;/" "$P"
check "a NaN token count admitted (every later total becomes NaN)"

echo ""
echo "=== the configuration ==="

perl -0pi -e 's/  if \(!\(allowed as readonly string\[\]\)\.includes\(value\)\) \{/  if (false) {/' "$C"
check "an unknown provider or effort accepted at load"

perl -0pi -e 's/      DEFAULT_CLAIM_MODEL_ID\[claimProvider\],/      DEFAULT_CLAIM_MODEL_ID.anthropic,/' "$C"
check "OpenRouter defaulted to a model id it cannot resolve"

perl -0pi -e 's/  config\.claimProvider === .openrouter.\n    \? config\.openrouterApiKey\n    : config\.anthropicApiKey;/  config.anthropicApiKey;/' "$C"
check "the wrong provider's key reported as configuring the lane"

echo ""
echo "=== provider selection ==="

perl -0pi -e "s/    case 'openrouter':\n      return OpenRouterClaimExtractor\.fromApiKey\(apiKey, options\);/    case 'openrouter':\n      return ClaudeClaimExtractor.fromApiKey(apiKey, options);/" "$F"
check "the Anthropic adapter built when OpenRouter was asked for"

# The options object grew two document caps and broke onto five lines, so only
# the field being ignored is named. It is hardcoded to the factory spec's own
# DEFAULT model, deliberately: the test that must die is the one configuring a
# different one, not every test that happens to use the default.
perl -0pi -e "s/model: config\.claimModel,/model: 'claude-opus-5',/" "$F"
check "the factory ignores the configured model"

echo ""
echo "=== the invention rate: the number the decision turns on ==="

perl -0pi -e "s/        : \(discardsByReason\['span-not-found'\] \?\? 0\) \/ proposed,/        : (discardsByReason['span-not-found'] ?? 0) \/\n          mine.reduce((sum, r) => sum + r.discards.length, 0),/" "$R"
check "invention rate measured over discards instead of proposals"

perl -0pi -e "s/        : \(discardsByReason\['span-not-found'\] \?\? 0\) \/ proposed,/        : mine.reduce((sum, r) => sum + r.discards.length, 0) \/ proposed,/" "$R"
check "every discard counted as an invention, not just span-not-found"

perl -0pi -e 's/      proposed === 0\n        \? null/      proposed === 0\n        ? 0/' "$R"
check "a model that proposed nothing reported as inventing nothing"

perl -0pi -e 's/    costUsd === null \|\| mine\.length === 0 \? null : costUsd \/ mine\.length;/    costUsd === null || mine.length === 0 ? null : costUsd \/ withUsage.length;/' "$R"
check "cost per document divided by the calls that happened to report usage"

perl -0pi -e 's/  \(usage\.cachedInputTokens \/ 1e6\) \* pricing\.cachedInputPerMTok \+/  (usage.cachedInputTokens \/ 1e6) * pricing.inputPerMTok +/' "$R"
check "cache reads priced at the full input rate"

perl -0pi -e 's/  \(usage\.cacheWriteInputTokens \/ 1e6\) \* pricing\.cacheWritePerMTok \+//' "$R"
check "cache writes priced at nothing"

perl -0pi -e 's/    withUsage\.length === 0\n      \? null/    withUsage.length === 0\n      ? 0/' "$R"
check "an unpriceable run reported as a free one"

perl -0pi -e 's/  const mine = records\.filter\(\(record\) => record\.provider === provider\);/  const mine = records;/' "$R"
check "one provider's summary counts the other provider's calls"

perl -0pi -e 's/    failures: mine\.filter\(\(record\) => record\.failure !== null\)\.length,/    failures: 0,/' "$R"
check "failed calls reported as none"

perl -0pi -e 's/  const rank = Math\.ceil\(fraction \* sorted\.length\);/  const rank = Math.floor(fraction * sorted.length);/' "$R"
check "the percentile rank off by one"

perl -0pi -e 's/  if \(values\.length === 0\) return null;/  if (values.length === 0) return 0;/' "$R"
check "no observations reported as a zero-millisecond latency"

echo ""
echo "=== the report itself ==="

perl -0pi -e 's/        `\*\*\$\{rate\(summary\.inventionRate\)\}\*\*`,/        "",/' "$R"
check "the invention rate column emptied"

perl -0pi -e 's/      REPORTED_DISCARD_REASONS\.map\(\(reason\) => \[/      REPORTED_DISCARD_REASONS.filter((reason) =>\n        summaries.some((s) => (s.discardsByReason[reason] ?? 0) > 0),\n      ).map((reason) => [/' "$R"
check "discard reasons that never fired dropped from the table"

perl -0pi -e 's/    if \(summary\.model !== pricing\.model\) \{/    if (false) {/' "$R"
check "a run priced at the wrong model's rates reported without a warning"

perl -0pi -e 's/    if \(summary\.callsWithUsage < summary\.documents\) \{/    if (false) {/' "$R"
check "a partially-priced run reported as a total"

echo ""
echo "=== independence checks ==="
echo "A guarantee must die to the suite that OWNS it. The invention rate is"
echo "computed in the comparison report and nowhere else, and the effort clamp"
echo "is specified in the shared provider module rather than in whichever"
echo "adapter happens to call it — if either only died to a neighbouring suite,"
echo "deleting that suite would silently cost a guarantee that looks covered."

REPORT='tools/claims/comparison-report'
PROVIDER='libs/filings/src/llm/claim-provider'
CONFIG='apps/ingest/src/config/'

perl -0pi -e "s/        : \(discardsByReason\['span-not-found'\] \?\? 0\) \/ proposed,/        : (discardsByReason['span-not-found'] ?? 0) \/\n          mine.reduce((sum, r) => sum + r.discards.length, 0),/" "$R"
check_in "$REPORT" "invention rate denominator, the comparison suite only"

perl -0pi -e "s/  effort === 'low' \|\| effort === 'medium' \? effort : 'high';/  effort === 'low' || effort === 'medium' ? effort : 'low';/" "$P"
check_in "$PROVIDER" "the effort clamp, the shared provider suite only"

perl -0pi -e 's/  if \(!\(allowed as readonly string\[\]\)\.includes\(value\)\) \{/  if (false) {/' "$C"
check_in "$CONFIG" "the allowlist, the configuration suite only"

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "RESULT: all mutations applied and were caught ($CRASHES by crashing the"
  echo "        runner rather than by an assertion); no test gaps."
else
  echo "RESULT: $FAILURES survived (test gap), $NOOPS no-op (harness stale)."
fi

cd "$ROOT" && npx jest "$SUITE" 2>&1 | grep -E "^(Tests|Test Suites):"
exit $((FAILURES + NOOPS))
