import {
  parseClaimResponse,
  parseSummaryResponse,
} from '../logic/claim-prompt';
import { parseResultsResponse } from '../logic/results-prompt';
import type { ClaimExtractionResult } from './claim-extractor';
import type { ResultsExtractionResult } from './results-extractor';

/**
 * Everything two model providers must agree on, and nothing either one owns.
 *
 * ================================================================
 * WHY THE BOUNDARY IS HERE
 * ================================================================
 *
 * `ClaimExtractor` is the seam the worker holds: one request in, normalised
 * claim candidates out. This module is the layer BELOW it — the pieces both
 * adapters need in order to be interchangeable, kept in one place so that
 * "which provider answered" cannot become a difference in what the gate sees.
 *
 * The rule the whole comparison rests on: **the two adapters send the same
 * request and return the same shape.** Same system prompt, same user turn, same
 * document cap, same output schema, same token ceiling, same timeout. What
 * differs is only how each API spells "give me JSON in this shape" — Anthropic's
 * `output_config.format` against OpenAI's `response_format.json_schema` — and
 * that difference is normalised inside each adapter, never leaked upward. If it
 * leaked, an A/B measurement would be reporting the difference between two
 * requests rather than between two models.
 *
 * PURE. No SDK, no HTTP client, no key. This module is in the `@app/filings`
 * barrel; the adapters that pull in a transport deliberately are not.
 */

/** The providers a claim may be extracted by. */
export const CLAIM_PROVIDERS = ['anthropic', 'openrouter'] as const;

export type ClaimProviderName = (typeof CLAIM_PROVIDERS)[number];

/**
 * The effort ladder, Anthropic's five rungs.
 *
 * The single source of truth for both the configuration allowlist and the
 * adapters. It was previously written out in two places, which is how the
 * config comes to accept a level the adapter cannot send.
 */
export const CLAIM_EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ClaimEffortLevel = (typeof CLAIM_EFFORT_LEVELS)[number];

/**
 * The model each provider uses when the operator names none.
 *
 * `claude-opus-5` because the failure being defended against is a fluent
 * invention and capability reduces the rate at which one is proposed.
 * `deepseek/deepseek-v4-flash-0731` because it is the verified long-context
 * option on OpenRouter (1,048,576-token context, $0.09/$0.18 per MTok) and the
 * whole point of the second provider is to measure whether two orders of
 * magnitude less money buys a materially worse invention rate.
 */
export const DEFAULT_CLAIM_MODEL: Readonly<Record<ClaimProviderName, string>> =
  {
    anthropic: 'claude-opus-5',
    openrouter: 'deepseek/deepseek-v4-flash-0731',
  };

/**
 * Output ceiling, shared.
 *
 * On Anthropic's side `max_tokens` bounds thinking AND response text together
 * and thinking is on by default; on the OpenAI-compatible side it bounds the
 * completion. Three claims of JSON is a few hundred tokens either way, and the
 * rest is headroom so a reasoning pass cannot truncate the answer mid-object and
 * turn a good extraction into an unparseable one.
 *
 * ONE VALUE FOR BOTH PROVIDERS, deliberately. A per-provider ceiling would let
 * one model be measured with room to think and the other without.
 *
 * RAISED FROM 8,000, AND THE RAISE IS NOT A CURE. The previous report named this
 * as the first thing to raise, and the results lane is what forced it: on a live
 * sample of twelve results filings, two — BRITANNIA and EIHOTEL, both ordinary
 * thirty-thousand-character statements — came back `the reply was truncated at
 * 8000 tokens` and produced nothing. A results reply is several times a claims
 * reply: five figures, each with a quoted table row of up to 400 characters,
 * plus the column header.
 *
 * At 16,000, BRITANNIA returned a full four-figure proposal — and HITECHGEAR,
 * which had answered fine at 8,000, came back `truncated at 16000 tokens`. So
 * the ceiling was genuinely too low AND it is not what dominates: this
 * provider's reasoning length varies run to run by more than the whole budget.
 * Raising it removes a floor on the failure rate; it does not remove the
 * failures, and a report that claimed otherwise would be wrong.
 *
 * A CEILING IS NOT A SPEND — only tokens actually generated are billed — so the
 * cost of the raise is zero. What it does cost is LATENCY: a results call on
 * this provider now takes 60 to 120 seconds, which is why the enrichment lease
 * had to be raised with it.
 */
export const CLAIM_MAX_TOKENS = 16_000;

/**
 * Wall-clock ceiling for one call, shared.
 *
 * The worker is not latency-critical — the filing has already been stored and
 * alerted — but it is sequential, so a call that hangs stops the queue behind
 * it. Two minutes is far beyond the observed shape of this request and well
 * inside the claim lease.
 */
export const CLAIM_TIMEOUT_MS = 120_000;

/**
 * What one call cost, as the provider reported it.
 *
 * The four fields partition the whole request: fresh prompt tokens, prompt
 * tokens written into a cache, prompt tokens read back out of one, and the
 * completion. They are kept apart rather than summed because they are billed at
 * three different rates — roughly 1x, 1.25x and 0.1x of the input price on the
 * Anthropic side — and a total that folded them together could not be priced.
 */
export interface ClaimUsage {
  /** Prompt tokens neither read from nor written to a cache. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Prompt tokens served from a cache, billed at a fraction. */
  readonly cachedInputTokens: number;
  /** Prompt tokens written INTO a cache, billed at a premium. */
  readonly cacheWriteInputTokens: number;
}

/** The knobs an adapter takes. Identical across providers on purpose. */
export interface ClaimProviderOptions {
  readonly model: string;
  readonly effort: ClaimEffortLevel;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  /**
   * How much of the document reaches the model. `MAX_DOCUMENT_CHARS` when unset.
   *
   * CONFIGURABLE because the right value is a measurement rather than a
   * constant, and the measurement moved: the cap was set at 24,000 characters
   * against a model context that no longer binds. It is on the provider options
   * rather than in the prompt module so a sweep can change it without a deploy
   * and so the two adapters cannot drift apart on it.
   */
  readonly maxDocumentChars?: number;
  /**
   * How much of the document reaches the model in the RESULTS lane.
   *
   * A SEPARATE KNOB from `maxDocumentChars`, because the two lanes need
   * different amounts of the same document. A claim lives in the narrative at
   * the front; a statutory results statement does not. In the Apollo Tyres
   * filing the consolidated statement begins at character 7,400 and the
   * standalone one at 21,900, so a cap that suits a press release would send
   * the covering letter and none of the table.
   */
  readonly maxResultsDocumentChars?: number;
}

/**
 * The OpenAI-compatible reasoning ladder has three rungs, not five.
 *
 * `xhigh` and `max` clamp to `high`. Stated here rather than buried in the
 * adapter because it is a REAL limit on what an A/B sweep can compare: asking
 * both providers for `max` asks one of them for `high`, and a report that did
 * not say so would attribute a ladder difference to the models.
 */
export const openAiEffort = (
  effort: ClaimEffortLevel,
): 'low' | 'medium' | 'high' =>
  effort === 'low' || effort === 'medium' ? effort : 'high';

/**
 * Anything that looks like a credential, replaced.
 *
 * Runs on every message an adapter returns, because a failure message is
 * written by somebody else's server and ends up in a log line, in the database's
 * `claimRefusalDetail`, and on the dashboard. A key echoed back inside a 401
 * body would otherwise be persisted by the very code that is reporting the
 * error — and a secret in a log outlives the process that wrote it.
 *
 * Deliberately pattern-based rather than "redact the configured key": the key
 * this process holds is not the only secret that can appear in a reply, and a
 * redactor that only knows one of them gives false confidence.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{4,}/g,
  /\b(?:Bearer|Authorization:)\s+[A-Za-z0-9._-]{8,}/gi,
  /\b[A-Za-z0-9_-]*api[_-]?key["'\s:=]+[A-Za-z0-9._-]{8,}/gi,
];

export const redactSecrets = (text: string): string =>
  SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[redacted]'),
    text,
  );

/**
 * Turns anything thrown into a failure message, redacted.
 *
 * NEVER RETHROWS. Both adapters promise never to throw, for the reason
 * `pdf-text.ts` gives about parse failures: an exception raised inside the
 * worker's loop is indistinguishable from a bug in the reading path and gets
 * treated as one.
 */
export const describeProviderFailure = (error: unknown): string =>
  redactSecrets(error instanceof Error ? error.message : String(error));

/**
 * Reads a model's JSON body into claim candidates.
 *
 * SHARED BY BOTH ADAPTERS so a claim is parsed the same way whoever proposed it.
 * The model's reply is untrusted input: `parseClaimResponse` drops anything
 * malformed rather than repairing it, because repairing would be this pipeline
 * authoring a claim.
 *
 * Throws only from `JSON.parse`, which each adapter's own catch turns into a
 * failure. That is deliberate: the message a bad body produces belongs to the
 * provider that sent it.
 */
export const claimsFromText = (
  text: string,
  usage?: ClaimUsage,
): ClaimExtractionResult => {
  if (text.trim().length === 0) {
    return { outcome: 'failed', message: 'the model returned no text' };
  }
  const payload: unknown = JSON.parse(text);
  return {
    outcome: 'ok',
    claims: parseClaimResponse(payload),
    // Carried on the SAME reply and kept in a separate field all the way down,
    // because the two have different guarantees: a claim is verified against
    // the document and a summary cannot be. See `claim-summary.ts`.
    summary: parseSummaryResponse(payload),
    usage,
  };
};

/**
 * Reads a model's JSON body into a proposed results block.
 *
 * SHARED BY BOTH ADAPTERS, exactly as `claimsFromText` is, so a results table is
 * parsed the same way whoever read it. A body that parses to no usable table
 * yields `results: null` — which is the ordinary answer for a board-meeting
 * outcome about a dividend — rather than a failure, because "the document has no
 * statement in it" and "the extractor broke" are different facts about a filing.
 *
 * Throws only from `JSON.parse`, which each adapter's own catch turns into a
 * failure.
 */
export const resultsFromText = (
  text: string,
  usage?: ClaimUsage,
): ResultsExtractionResult => {
  if (text.trim().length === 0) {
    return { outcome: 'failed', message: 'the model returned no text' };
  }
  const payload: unknown = JSON.parse(text);
  return { outcome: 'ok', results: parseResultsResponse(payload), usage };
};

/** Reads a number off an untyped payload, or zero. Never NaN. */
export const countOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
