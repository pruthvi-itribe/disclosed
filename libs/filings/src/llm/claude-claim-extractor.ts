import Anthropic from '@anthropic-ai/sdk';
import {
  buildClaimRequest,
  CLAIM_OUTPUT_SCHEMA,
  CLAIM_SYSTEM_PROMPT,
} from '../logic/claim-prompt';
import type {
  ClaimExtractionRequest,
  ClaimExtractionResult,
  ClaimExtractor,
} from './claim-extractor';
import {
  CLAIM_MAX_TOKENS,
  CLAIM_TIMEOUT_MS,
  claimsFromText,
  countOf,
  describeProviderFailure,
  type ClaimProviderOptions,
  type ClaimUsage,
} from './claim-provider';

/**
 * The claim extractor, backed by the Claude API.
 *
 * ================================================================
 * WHY THIS MODEL AND THIS EFFORT
 * ================================================================
 *
 * `claude-opus-5` is the default because the failure mode being defended
 * against is a fluent invention, and capability is what reduces the rate at
 * which one is proposed. It is not the only defence — `claim-verify.ts` catches
 * an invented span whatever produced it — but a cheaper model that proposes more
 * inventions produces a stream of discards rather than a stream of claims, and a
 * feature that refuses everything is not cheaper, it is absent.
 *
 * That is the claim `tools/claims/compare-providers.ts` exists to TEST rather
 * than assert, by running this adapter and the OpenRouter one over the same
 * documents and counting `span-not-found` per proposed claim.
 *
 * The model is nonetheless a CONFIGURED VALUE, not a constant, because the
 * cost/quality trade is the operator's to make and it can be made without a
 * deploy. `effort` likewise: the default is `medium` rather than the documented
 * `high` starting point, because this task is bounded extraction with a hard
 * verification gate downstream — the marginal value of deeper reasoning is
 * capped by what the gate will accept — and an effort sweep against a real
 * corpus is the honest way to move it, not a guess made here.
 *
 * ================================================================
 * WHAT MAKES THIS AFFORDABLE
 * ================================================================
 *
 *   - **The prompt is cached.** `CLAIM_SYSTEM_PROMPT` is byte-identical on every
 *     request and carries a `cache_control` breakpoint, so after the first call
 *     of a five-minute window its tokens bill at roughly a tenth. Nothing
 *     filing-specific may be interpolated into it — that would make every
 *     request a miss, which is the most expensive available mistake.
 *   - **The document is capped** at `MAX_DOCUMENT_CHARS` before it is sent.
 *   - **Most filings never get here at all.** `claim-eligibility.ts` runs first
 *     and is deterministic.
 *
 * ================================================================
 * WHAT IT NEVER DOES
 * ================================================================
 *
 * THROW. Every failure — no key, a 429, a refusal, a body that will not parse —
 * returns `{outcome: 'failed'}` with a message, for the reason `pdf-text.ts`
 * gives about parse failures: an exception raised inside the worker's loop is
 * indistinguishable from a bug in the reading path, and gets treated as one.
 */

/** The subset of the SDK this adapter uses, so a test can stand in for it. */
export interface ClaudeMessagesApi {
  create(body: Record<string, unknown>): Promise<unknown>;
}

interface TextBlock {
  readonly type: string;
  readonly text?: unknown;
}

/** Joins the response's text blocks, ignoring thinking and anything else. */
const textOf = (message: unknown): string => {
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is TextBlock =>
        typeof block === 'object' &&
        block !== null &&
        (block as TextBlock).type === 'text',
    )
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('');
};

/**
 * Reads the usage block into the shared shape, or nothing.
 *
 * Undefined rather than zeros when the reply carried no usage at all: a
 * comparison that treated an unreported call as a free one would under-report
 * spend, and silently.
 */
const usageOf = (message: unknown): ClaimUsage | undefined => {
  const usage = (message as { usage?: unknown })?.usage;
  if (typeof usage !== 'object' || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  return {
    inputTokens: countOf(record.input_tokens),
    outputTokens: countOf(record.output_tokens),
    cachedInputTokens: countOf(record.cache_read_input_tokens),
    cacheWriteInputTokens: countOf(record.cache_creation_input_tokens),
  };
};

export class ClaudeClaimExtractor implements ClaimExtractor {
  constructor(
    private readonly messages: ClaudeMessagesApi,
    private readonly options: ClaimProviderOptions,
  ) {}

  /**
   * Builds an extractor from an API key, or null when there is none.
   *
   * NULL RATHER THAN A CLIENT THAT WILL FAIL ON EVERY CALL. An unconfigured
   * pipeline should say "no extractor is configured" once, at startup, not
   * discover it 700 times a day — and `extractor-unavailable` is a different
   * fact about a filing from `extractor-error`.
   */
  static fromApiKey(
    apiKey: string,
    options: ClaimProviderOptions,
  ): ClaudeClaimExtractor | null {
    if (apiKey.trim().length === 0) return null;
    const client = new Anthropic({
      apiKey,
      timeout: options.timeoutMs ?? CLAIM_TIMEOUT_MS,
    });
    return new ClaudeClaimExtractor(
      client.beta.messages as unknown as ClaudeMessagesApi,
      options,
    );
  }

  async extract(
    request: ClaimExtractionRequest,
  ): Promise<ClaimExtractionResult> {
    try {
      const message = await this.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? CLAIM_MAX_TOKENS,
        // Safety classifiers can decline a request outright. Routing the
        // decline to the recommended fallback server-side keeps a filing from
        // being lost to a classifier that fired on a pharmaceutical or defence
        // filing's ordinary vocabulary.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          {
            type: 'text',
            text: CLAIM_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: {
          effort: this.options.effort,
          format: { type: 'json_schema', schema: CLAIM_OUTPUT_SCHEMA },
        },
        messages: [
          {
            role: 'user',
            content: buildClaimRequest({
              ...request,
              maxDocumentChars: this.options.maxDocumentChars,
            }),
          },
        ],
      });

      // CHECKED BEFORE `content` IS READ. A refusal returns HTTP 200 with an
      // empty or partial content array, so code that indexes into it first
      // reports a parse failure for something that was not a parse failure.
      const stopReason = (message as { stop_reason?: unknown })?.stop_reason;
      if (stopReason === 'refusal') {
        return {
          outcome: 'failed',
          message: 'the model declined to answer for this document',
        };
      }

      return claimsFromText(textOf(message), usageOf(message));
    } catch (error) {
      return { outcome: 'failed', message: describeProviderFailure(error) };
    }
  }
}
