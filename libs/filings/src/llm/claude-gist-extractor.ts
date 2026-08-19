import Anthropic from '@anthropic-ai/sdk';
import {
  buildGistRequest,
  GIST_OUTPUT_SCHEMA,
  GIST_SYSTEM_PROMPT,
  parseGistResponse,
  type GistRequestItem,
} from '../logic/gist-prompt';
import {
  CLAIM_TIMEOUT_MS,
  describeProviderFailure,
  countOf,
  type ClaimProviderOptions,
  type ClaimUsage,
} from './claim-provider';
import type { ClaudeMessagesApi } from './claude-claim-extractor';
import type { GistExtractionResult, GistExtractor } from './gist-extractor';

/**
 * Asking Claude to choose a headline out of a sentence it is given.
 *
 * ================================================================
 * WHY THIS IS A CHEAP CALL AND THE CLAIM LANE IS NOT
 * ================================================================
 *
 * The claim extractor sends a whole document and defends against a
 * fluent invention with capability plus a gate. This adapter sends no
 * document at all: the span is already stored, already matched character
 * for character against the source, and the task is to pick a
 * contiguous run of words out of it. The search space is a substring of
 * one sentence, and `verifyGist` rejects everything outside it.
 *
 * So the model is a CONFIGURED VALUE with a cheap default, unlike the
 * claim lane's. A weaker model here produces more refusals, not more
 * risk — and a refusal costs a card its shorter line, which is the
 * feature being absent rather than wrong.
 *
 * THE SYSTEM PROMPT IS CACHED, and the batch is what makes that pay: the
 * rules are ~300 tokens against ~150 for one span, so ten claims a
 * request turn the instruction from the dominant cost into a tenth of
 * one, and the cache turns the remainder into a read.
 */

/** Enough for ten short answers and the JSON around them. */
export const GIST_MAX_TOKENS = 2_048;

const textOf = (message: unknown): string => {
  const content = (message as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => (block as { type?: unknown })?.type === 'text')
    .map((block) => {
      const text = (block as { text?: unknown })?.text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
};

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

export class ClaudeGistExtractor implements GistExtractor {
  constructor(
    private readonly messages: ClaudeMessagesApi,
    private readonly options: ClaimProviderOptions,
  ) {}

  /** Null rather than a client that will fail on every call. */
  static fromApiKey(
    apiKey: string,
    options: ClaimProviderOptions,
  ): ClaudeGistExtractor | null {
    if (apiKey.trim().length === 0) return null;
    const client = new Anthropic({
      apiKey,
      timeout: options.timeoutMs ?? CLAIM_TIMEOUT_MS,
    });
    return new ClaudeGistExtractor(
      client.beta.messages as unknown as ClaudeMessagesApi,
      options,
    );
  }

  async proposeGists(
    items: readonly GistRequestItem[],
  ): Promise<GistExtractionResult> {
    if (items.length === 0) return { outcome: 'ok', answers: [] };
    try {
      const message = await this.messages.create({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? GIST_MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [
          {
            type: 'text',
            text: GIST_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        output_config: {
          effort: this.options.effort,
          format: { type: 'json_schema', schema: GIST_OUTPUT_SCHEMA },
        },
        messages: [{ role: 'user', content: buildGistRequest(items) }],
      });

      // Checked before `content` is read: a refusal returns HTTP 200 with
      // an empty or partial content array.
      const stopReason = (message as { stop_reason?: unknown })?.stop_reason;
      if (stopReason === 'refusal') {
        return {
          outcome: 'failed',
          reason: 'the model declined to answer for this batch',
        };
      }

      const raw: unknown = JSON.parse(textOf(message));
      return {
        outcome: 'ok',
        answers: parseGistResponse(raw),
        usage: usageOf(message),
      };
    } catch (error) {
      return { outcome: 'failed', reason: describeProviderFailure(error) };
    }
  }
}
