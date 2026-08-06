import axios, { type AxiosInstance } from 'axios';
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
  openAiEffort,
  redactSecrets,
  type ClaimProviderOptions,
  type ClaimUsage,
} from './claim-provider';

/**
 * The claim extractor, backed by OpenRouter's OpenAI-compatible API.
 *
 * ================================================================
 * WHY A SECOND PROVIDER EXISTS AT ALL
 * ================================================================
 *
 * Not to be a fallback. It exists so the sentence "a cheaper model that invents
 * more is not cheaper" can be MEASURED instead of asserted. The verified target,
 * `deepseek/deepseek-v4-flash-0731`, is roughly fifty times cheaper per input
 * token than the Anthropic default; whether that is a saving or an absence
 * depends entirely on how often it quotes a sentence the document does not
 * contain, and that number is knowable — it is `span-not-found` over claims
 * proposed. `tools/claims/compare-providers.ts` runs both over one corpus and
 * prints it.
 *
 * ================================================================
 * WHAT IS HELD IDENTICAL, AND WHAT NECESSARILY DIFFERS
 * ================================================================
 *
 * Identical: the system prompt byte for byte, the user turn built by the same
 * `buildClaimRequest`, the document cap, the JSON schema, `CLAIM_MAX_TOKENS`,
 * `CLAIM_TIMEOUT_MS`, and the parser that reads the reply. A comparison in which
 * the two providers were asked different questions would measure the questions.
 *
 * Necessarily different, and normalised HERE so nothing above this file learns
 * of it:
 *
 *   - **Structured output.** Anthropic takes `output_config.format`; OpenAI's
 *     shape is `response_format.json_schema` with a name and a `strict` flag.
 *   - **Reasoning effort.** Anthropic's ladder has five rungs, OpenAI's has
 *     three. `openAiEffort` clamps, and says so, because a sweep at `xhigh`
 *     against `high` is a ladder difference, not a model difference.
 *   - **Refusals.** Anthropic answers 200 with `stop_reason: 'refusal'`;
 *     OpenAI-compatible answers with `finish_reason: 'content_filter'` or a
 *     `message.refusal` string. Both become the same failure here.
 *   - **Errors in a 200 body.** OpenRouter can return HTTP 200 carrying
 *     `{error: {...}}` when an upstream provider fails. Read first, before
 *     `choices` is indexed, for the same reason the Anthropic adapter checks
 *     `stop_reason` first: otherwise a routing failure is reported as a parse
 *     failure.
 *
 * ================================================================
 * WHAT IT NEVER DOES
 * ================================================================
 *
 * THROW, and LOG A KEY. Every failure returns `{outcome: 'failed'}` with a
 * message that has been through `redactSecrets` — a message written by somebody
 * else's server is stored on the filing and rendered on the dashboard, so it is
 * treated as untrusted text that may contain a credential.
 */

/** The API root. Path-only requests are made against it. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * The attribution headers OpenRouter asks callers to send.
 *
 * `HTTP-Referer` is an identifier, not a reachable site — this pipeline is not a
 * public web application and pointing the header at something that does not
 * belong to it would be worse than pointing it at a reserved name.
 */
export const OPENROUTER_REFERER = 'https://turret.local/';
export const OPENROUTER_TITLE = 'Turret NSE filings pipeline';

/** The schema's name in the OpenAI-style envelope. Required by the API. */
export const CLAIM_SCHEMA_NAME = 'notable_claims';

/** The subset of the API this adapter uses, so a test can stand in for it. */
export interface OpenRouterChatApi {
  create(body: Record<string, unknown>): Promise<unknown>;
}

interface ChatChoice {
  readonly finish_reason?: unknown;
  readonly message?: { readonly content?: unknown; readonly refusal?: unknown };
}

/** The `{error: {...}}` an upstream failure arrives as, inside a 200. */
const errorIn = (payload: unknown): string | null => {
  const error = (payload as { error?: unknown })?.error;
  if (typeof error !== 'object' || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim().length > 0
    ? message
    : 'the provider returned an error with no message';
};

const firstChoice = (payload: unknown): ChatChoice | null => {
  const choices = (payload as { choices?: unknown })?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const choice = choices[0];
  return typeof choice === 'object' && choice !== null
    ? (choice as ChatChoice)
    : null;
};

/**
 * Reads the usage block into the shared shape, or nothing.
 *
 * `prompt_tokens` is the TOTAL prompt on this API, cached tokens included —
 * the opposite of Anthropic's `input_tokens`, which excludes them. Subtracting
 * is what makes the two providers' cost arithmetic comparable; without it a
 * cache hit would look like extra spend on one side and a saving on the other.
 */
const usageOf = (payload: unknown): ClaimUsage | undefined => {
  const usage = (payload as { usage?: unknown })?.usage;
  if (typeof usage !== 'object' || usage === null) return undefined;
  const record = usage as Record<string, unknown>;
  const details = record.prompt_tokens_details;
  const cached = countOf(
    typeof details === 'object' && details !== null
      ? (details as Record<string, unknown>).cached_tokens
      : undefined,
  );
  return {
    inputTokens: Math.max(0, countOf(record.prompt_tokens) - cached),
    outputTokens: countOf(record.completion_tokens),
    cachedInputTokens: cached,
    // This API reports no separate cache-write count. Zero rather than a guess:
    // an invented figure would be priced at a premium rate and quietly inflate
    // the cheaper provider's cost.
    cacheWriteInputTokens: 0,
  };
};

export class OpenRouterClaimExtractor implements ClaimExtractor {
  constructor(
    private readonly chat: OpenRouterChatApi,
    private readonly options: ClaimProviderOptions,
  ) {}

  /**
   * Builds an extractor from an API key, or null when there is none.
   *
   * The same contract as the Anthropic adapter's, for the same reason: an
   * unconfigured pipeline says so once at startup rather than discovering it on
   * every eligible filing.
   */
  static fromApiKey(
    apiKey: string,
    options: ClaimProviderOptions,
  ): OpenRouterClaimExtractor | null {
    if (apiKey.trim().length === 0) return null;
    const http = axios.create({
      baseURL: OPENROUTER_BASE_URL,
      timeout: options.timeoutMs ?? CLAIM_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        'HTTP-Referer': OPENROUTER_REFERER,
        'X-Title': OPENROUTER_TITLE,
        'Content-Type': 'application/json',
      },
    });
    return new OpenRouterClaimExtractor(httpChat(http), options);
  }

  async extract(
    request: ClaimExtractionRequest,
  ): Promise<ClaimExtractionResult> {
    try {
      const payload = await this.chat.create({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? CLAIM_MAX_TOKENS,
        // Extraction, not composition. Zero is the closest this API offers to
        // "read what is there", and it also makes a repeated A/B run mean
        // something rather than resampling.
        temperature: 0,
        messages: [
          { role: 'system', content: CLAIM_SYSTEM_PROMPT },
          { role: 'user', content: buildClaimRequest(request) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: CLAIM_SCHEMA_NAME,
            strict: true,
            schema: CLAIM_OUTPUT_SCHEMA,
          },
        },
        reasoning: { effort: openAiEffort(this.options.effort) },
        // THE LOAD-BEARING ROUTING FLAG. OpenRouter silently drops parameters
        // an upstream provider does not support, so without this a request can
        // be routed to a host that ignores `response_format` — which returns
        // fluent prose, fails to parse, and records "the extractor failed" on
        // every filing while looking like a model problem.
        provider: { require_parameters: true },
      });

      // READ BEFORE `choices`. An upstream failure arrives as a 200 carrying an
      // error object, and indexing into an absent `choices` first would report
      // it as an unusable reply rather than as the routing failure it is.
      const failure = errorIn(payload);
      if (failure !== null) {
        return {
          outcome: 'failed',
          message: redactSecrets(`the provider returned an error: ${failure}`),
        };
      }

      const choice = firstChoice(payload);
      if (choice === null) {
        return { outcome: 'failed', message: 'the model returned no choices' };
      }

      const refusal = choice.message?.refusal;
      if (
        choice.finish_reason === 'content_filter' ||
        (typeof refusal === 'string' && refusal.trim().length > 0)
      ) {
        return {
          outcome: 'failed',
          message: 'the model declined to answer for this document',
        };
      }

      // Distinguished from an unparseable body on purpose: a reply cut off at
      // the token ceiling is a budget to raise, not a model that cannot follow
      // a schema, and the two are indistinguishable once JSON.parse has failed.
      if (choice.finish_reason === 'length') {
        return {
          outcome: 'failed',
          message: `the reply was truncated at ${
            this.options.maxTokens ?? CLAIM_MAX_TOKENS
          } tokens`,
        };
      }

      const content = choice.message?.content;
      return claimsFromText(
        typeof content === 'string' ? content : '',
        usageOf(payload),
      );
    } catch (error) {
      return { outcome: 'failed', message: describeHttpFailure(error) };
    }
  }
}

/**
 * Wraps an axios instance in the tiny port the adapter holds.
 *
 * Exported so the one line that names the endpoint is reachable by a test. It
 * is the only part of this file that touches a transport, and an adapter posting
 * to the wrong path would fail identically to one with a bad key.
 */
export const httpChat = (
  http: Pick<AxiosInstance, 'post'>,
): OpenRouterChatApi => ({
  create: async (body) => (await http.post('/chat/completions', body)).data,
});

/**
 * Describes a transport failure without echoing the request that caused it.
 *
 * ONLY the status and the server's own message are read. An axios error carries
 * the full request config — headers included — and a handler that stringified
 * it would write the Authorization header into the database.
 */
export const describeHttpFailure = (error: unknown): string => {
  if (!axios.isAxiosError(error)) return describeProviderFailure(error);
  const status = error.response?.status;
  const upstream = errorIn(error.response?.data);
  const detail = upstream ?? error.message;
  return redactSecrets(
    status === undefined
      ? `the request to OpenRouter failed: ${detail}`
      : `OpenRouter responded ${status}: ${detail}`,
  );
};
