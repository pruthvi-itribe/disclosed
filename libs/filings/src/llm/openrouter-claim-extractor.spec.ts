import { CLAIM_SYSTEM_PROMPT } from '../logic/claim-prompt';
import { CLAIM_MAX_TOKENS, DEFAULT_CLAIM_MODEL } from './claim-provider';
import {
  CLAIM_SCHEMA_NAME,
  describeHttpFailure,
  httpChat,
  OPENROUTER_BASE_URL,
  OPENROUTER_REFERER,
  OPENROUTER_TITLE,
  OpenRouterClaimExtractor,
  type OpenRouterChatApi,
} from './openrouter-claim-extractor';

/**
 * NO NETWORK. Every test here stands a recorder in for the chat-completions
 * call, so the whole OpenAI-compatible surface — the request shape, the schema
 * envelope, the effort clamp, every way a reply can be unusable and every way a
 * transport can fail — is exercised without a key and without a request leaving
 * the process. `.spec.ts` files in this project never make one.
 */
const GOOD_REPLY = {
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          claims: [
            {
              span: 'The Company has joined the association.',
              text: 'joins the association',
              kind: 'partnership',
            },
          ],
        }),
      },
    },
  ],
};

class RecordingChat implements OpenRouterChatApi {
  public readonly bodies: Record<string, unknown>[] = [];

  constructor(
    private readonly reply: unknown = GOOD_REPLY,
    private readonly throws: unknown = null,
  ) {}

  async create(body: Record<string, unknown>): Promise<unknown> {
    this.bodies.push(body);
    if (this.throws !== null) throw this.throws;
    return this.reply;
  }
}

const REQUEST = {
  symbol: 'SWIGGY',
  category: 'Press Release',
  summary: 'a press release',
  documentText: 'The Company has joined the association.',
};

const extractorWith = (
  chat: OpenRouterChatApi,
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'medium',
): OpenRouterClaimExtractor =>
  new OpenRouterClaimExtractor(chat, {
    model: DEFAULT_CLAIM_MODEL.openrouter,
    effort,
  });

const bodyOf = async (
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
): Promise<Record<string, unknown>> => {
  const chat = new RecordingChat();
  await extractorWith(chat, effort).extract(REQUEST);
  return chat.bodies[0];
};

describe('OpenRouterClaimExtractor — the request', () => {
  it('asks the configured model', async () => {
    expect((await bodyOf()).model).toBe(DEFAULT_CLAIM_MODEL.openrouter);
  });

  it('defaults to the verified long-context DeepSeek', () => {
    // Pinned against a literal, not against itself: the model id is the one
    // thing here that was verified out of band, and a test that read the
    // constant back would survive it being changed to anything at all.
    expect(DEFAULT_CLAIM_MODEL.openrouter).toBe(
      'deepseek/deepseek-v4-flash-0731',
    );
  });

  it('addresses OpenRouter itself', () => {
    expect(OPENROUTER_BASE_URL).toBe('https://openrouter.ai/api/v1');
  });

  it('names the schema, against a literal rather than against itself', () => {
    // The mutation harness caught this one: asserting `schema.name` equals
    // CLAIM_SCHEMA_NAME survives the constant being emptied, and an unnamed
    // json_schema is a 400 on every call. This is the fourth time this exact
    // shape has appeared in this project.
    expect(CLAIM_SCHEMA_NAME).toBe('notable_claims');
  });

  it('identifies Turret in the attribution headers', () => {
    expect(OPENROUTER_TITLE).toContain('Turret');
    expect(OPENROUTER_REFERER).toMatch(/^https:\/\//);
  });

  it('sends the SAME system prompt as the Anthropic path, byte for byte', async () => {
    // The comparison is only a comparison if both providers are asked the same
    // question. A prompt that drifted between adapters would report the
    // difference between two prompts as a difference between two models.
    const turns = (await bodyOf()).messages as {
      role: string;
      content: string;
    }[];
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({ role: 'system', content: CLAIM_SYSTEM_PROMPT });
    expect(turns[1].role).toBe('user');
    expect(turns[1].content).toContain('SWIGGY');
  });

  it('asks for the schema in the OpenAI envelope, strictly', async () => {
    const format = (await bodyOf()).response_format as Record<string, unknown>;
    expect(format.type).toBe('json_schema');

    const schema = format.json_schema as Record<string, unknown>;
    expect(schema.name).toBe(CLAIM_SCHEMA_NAME);
    expect(schema.strict).toBe(true);
    // The span field must precede the text field, here as it does on the
    // Anthropic path: the model quotes before it compresses, and field order is
    // the prompt's first defence against a claim written and then justified.
    const sent = schema.schema as {
      properties: {
        claims: { items: { properties: Record<string, unknown> } };
      };
    };
    expect(Object.keys(sent.properties.claims.items.properties)).toEqual([
      'span',
      'text',
      'kind',
    ]);
  });

  it('refuses to be routed to a host that would ignore the schema', async () => {
    // OpenRouter silently drops parameters an upstream provider does not
    // support. Without this the request can land on a host that ignores
    // `response_format`, returns fluent prose, and records "the extractor
    // failed" on every filing while looking like a model problem.
    expect((await bodyOf()).provider).toEqual({ require_parameters: true });
  });

  it('reads rather than composes', async () => {
    expect((await bodyOf()).temperature).toBe(0);
  });

  it('shares the token ceiling with the other provider', async () => {
    expect((await bodyOf()).max_tokens).toBe(CLAIM_MAX_TOKENS);
  });

  it.each([
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    // The two rungs above `high` do not exist on this API. They clamp, which is
    // a real limit on what a sweep can compare — an A/B at `max` is asking one
    // provider for `max` and the other for `high`.
    ['xhigh', 'high'],
    ['max', 'high'],
  ] as const)('sends effort %s as %s', async (configured, sent) => {
    const reasoning = (await bodyOf(configured)).reasoning as Record<
      string,
      unknown
    >;
    expect(reasoning.effort).toBe(sent);
  });
});

describe('OpenRouterClaimExtractor — the reply', () => {
  it('reads the claims out of a good reply', async () => {
    const result = await extractorWith(new RecordingChat()).extract(REQUEST);
    expect(result).toEqual({
      outcome: 'ok',
      summary: null,
      claims: [
        {
          span: 'The Company has joined the association.',
          text: 'joins the association',
          kind: 'partnership',
        },
      ],
    });
  });

  it('returns the claims the parser read, not a shape of its own', async () => {
    // Pins the wiring rather than only the happy value: an adapter that stopped
    // parsing and returned an empty list would look healthy — every filing
    // would simply record "the model found nothing".
    const chat = new RecordingChat({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              claims: [
                { span: 'one sentence', text: 'one claim', kind: 'target' },
                {
                  span: 'another sentence',
                  text: 'another claim',
                  kind: 'guidance',
                },
                {
                  span: 'a malformed one',
                  text: 'a claim',
                  kind: 'not-a-kind',
                },
              ],
            }),
          },
        },
      ],
    });

    const result = await extractorWith(chat).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].kind).toBe('target');
  });

  it('reads an upstream error BEFORE it indexes into choices', async () => {
    // OpenRouter answers 200 with an error object when routing fails. Indexing
    // an absent `choices` first would report a routing failure as an unusable
    // reply, and the two need different remedies.
    const chat = new RecordingChat({
      error: { code: 502, message: 'upstream provider is down' },
    });
    const result = await extractorWith(chat).extract(REQUEST);
    expect(result).toEqual({
      outcome: 'failed',
      message: 'the provider returned an error: upstream provider is down',
    });
  });

  it('names an error even when the body gives no message', async () => {
    const chat = new RecordingChat({ error: { code: 502 } });
    const result = await extractorWith(chat).extract(REQUEST);
    expect(result.outcome).toBe('failed');
    if (result.outcome !== 'failed') throw new Error('expected failure');
    expect(result.message).toContain('no message');
  });

  it.each([
    [
      'a content filter',
      { choices: [{ finish_reason: 'content_filter', message: {} }] },
    ],
    [
      'an explicit refusal string',
      {
        choices: [
          { finish_reason: 'stop', message: { refusal: 'I cannot help.' } },
        ],
      },
    ],
  ])('reports %s as a decline, not a parse failure', async (_label, reply) => {
    const result = await extractorWith(new RecordingChat(reply)).extract(
      REQUEST,
    );
    expect(result).toEqual({
      outcome: 'failed',
      message: 'the model declined to answer for this document',
    });
  });

  it('reports a truncated reply as truncation, not as bad JSON', async () => {
    // The remedy differs: a reply cut off at the ceiling is a budget to raise,
    // and once JSON.parse has failed it is indistinguishable from a model that
    // cannot follow a schema.
    const chat = new RecordingChat({
      choices: [
        { finish_reason: 'length', message: { content: '{"claims":[{"span"' } },
      ],
    });
    const result = await extractorWith(chat).extract(REQUEST);
    expect(result.outcome).toBe('failed');
    if (result.outcome !== 'failed') throw new Error('expected failure');
    expect(result.message).toBe(
      `the reply was truncated at ${CLAIM_MAX_TOKENS} tokens`,
    );
  });

  it.each([
    ['no choices at all', {}],
    ['an empty choices array', { choices: [] }],
    ['a choice that is not an object', { choices: ['nope'] }],
  ])('fails with a reason for %s', async (_label, reply) => {
    const result = await extractorWith(new RecordingChat(reply)).extract(
      REQUEST,
    );
    expect(result.outcome).toBe('failed');
    if (result.outcome !== 'failed') throw new Error('expected failure');
    expect(result.message).toBe('the model returned no choices');
  });

  it.each([
    ['no message', { choices: [{ finish_reason: 'stop' }] }],
    [
      'content that is not a string',
      { choices: [{ finish_reason: 'stop', message: { content: 42 } }] },
    ],
    [
      'blank content',
      { choices: [{ finish_reason: 'stop', message: { content: '   ' } }] },
    ],
  ])('fails with a reason for %s', async (_label, reply) => {
    const result = await extractorWith(new RecordingChat(reply)).extract(
      REQUEST,
    );
    expect(result).toEqual({
      outcome: 'failed',
      message: 'the model returned no text',
    });
  });

  it('fails rather than throws when the body is not JSON', async () => {
    const chat = new RecordingChat({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'I could not find any claims.' },
        },
      ],
    });
    const result = await extractorWith(chat).extract(REQUEST);
    expect(result.outcome).toBe('failed');
  });

  it('NEVER throws, whatever the transport does', async () => {
    // An exception raised inside the worker's loop is indistinguishable from a
    // bug in the reading path, and would be logged as one.
    const chat = new RecordingChat(null, new Error('socket hang up'));
    const result = await extractorWith(chat).extract(REQUEST);
    expect(result).toEqual({ outcome: 'failed', message: 'socket hang up' });
  });

  it('describes a thrown non-Error too', async () => {
    const chat = new RecordingChat(null, 'a string');
    const result = await extractorWith(chat).extract(REQUEST);
    expect(result.outcome).toBe('failed');
  });

  it('never lets a key reach the stored failure message', async () => {
    // The message is written to the filing and rendered on the dashboard. A
    // server that echoes the Authorization header into a 401 body would
    // otherwise have this pipeline persist its own credential.
    const chat = new RecordingChat(
      null,
      new Error('401 for Bearer sk-or-v1-abcdef0123456789'),
    );
    const result = await extractorWith(chat).extract(REQUEST);
    if (result.outcome !== 'failed') throw new Error('expected failure');
    expect(result.message).not.toContain('sk-or-v1-abcdef0123456789');
    expect(result.message).toContain('[redacted]');
  });
});

describe('OpenRouterClaimExtractor — usage', () => {
  it('reports cached prompt tokens apart from fresh ones', async () => {
    // `prompt_tokens` on this API is the TOTAL, cache reads included — the
    // opposite of Anthropic's `input_tokens`. Subtracting is what makes the two
    // providers' cost arithmetic comparable at all.
    const chat = new RecordingChat({
      ...GOOD_REPLY,
      usage: {
        prompt_tokens: 3_000,
        completion_tokens: 120,
        prompt_tokens_details: { cached_tokens: 2_500 },
      },
    });

    const result = await extractorWith(chat).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toEqual({
      inputTokens: 500,
      outputTokens: 120,
      cachedInputTokens: 2_500,
      cacheWriteInputTokens: 0,
    });
  });

  it('never reports a negative fresh-token count', async () => {
    const chat = new RecordingChat({
      ...GOOD_REPLY,
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    });

    const result = await extractorWith(chat).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage?.inputTokens).toBe(0);
  });

  it.each([
    ['no usage block', {}],
    ['a usage block that is not an object', { usage: 7 }],
  ])('leaves usage absent rather than zeroed for %s', async (_label, extra) => {
    const chat = new RecordingChat({ ...GOOD_REPLY, ...extra });
    const result = await extractorWith(chat).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toBeUndefined();
  });

  it('reads a usage block with no details as uncached', async () => {
    const chat = new RecordingChat({
      ...GOOD_REPLY,
      usage: { prompt_tokens: 3_000, completion_tokens: 120 },
    });
    const result = await extractorWith(chat).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toEqual({
      inputTokens: 3_000,
      outputTokens: 120,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });
});

describe('describeHttpFailure', () => {
  const axiosError = (
    status: number | undefined,
    data: unknown,
    message = 'Request failed',
  ): unknown => ({
    isAxiosError: true,
    message,
    response: status === undefined ? undefined : { status, data },
    // Present on every real axios error, and the reason this function reads
    // only two fields: stringifying an axios error writes the Authorization
    // header into whatever is logging it.
    config: { headers: { Authorization: 'Bearer sk-or-v1-secret' } },
  });

  it('names the status and the server’s own message', () => {
    expect(
      describeHttpFailure(
        axiosError(429, { error: { message: 'rate limit exceeded' } }),
      ),
    ).toBe('OpenRouter responded 429: rate limit exceeded');
  });

  it('falls back to the transport message when the body has none', () => {
    expect(describeHttpFailure(axiosError(500, {}, 'Request failed'))).toBe(
      'OpenRouter responded 500: Request failed',
    );
  });

  it('says so when there was no response at all', () => {
    expect(
      describeHttpFailure(axiosError(undefined, null, 'timeout of 120000ms')),
    ).toBe('the request to OpenRouter failed: timeout of 120000ms');
  });

  it('never echoes the request that caused it', () => {
    const described = describeHttpFailure(
      axiosError(401, { error: { message: 'invalid key sk-or-v1-secret' } }),
    );
    expect(described).not.toContain('sk-or-v1-secret');
    expect(described).toContain('[redacted]');
  });

  it('handles something that is not an axios error at all', () => {
    expect(describeHttpFailure(new Error('boom'))).toBe('boom');
  });
});

describe('httpChat', () => {
  it('posts the body to the chat-completions path and returns the data', async () => {
    // NO NETWORK: a stub stands in for the axios instance. What is pinned is
    // the path and the unwrapping — an adapter posting to the wrong endpoint
    // fails identically to one holding a bad key, and only one of those is a
    // configuration problem.
    const calls: [string, unknown][] = [];
    const chat = httpChat({
      post: async (url: string, body: unknown) => {
        calls.push([url, body]);
        return { data: { choices: [] } } as never;
      },
    } as never);

    await expect(chat.create({ model: 'x' })).resolves.toEqual({ choices: [] });
    expect(calls).toEqual([['/chat/completions', { model: 'x' }]]);
  });
});

describe('OpenRouterClaimExtractor.fromApiKey', () => {
  it.each([[''], ['   ']])(
    'returns null for the missing key "%s"',
    (apiKey) => {
      // NULL rather than a client that fails on every call: an unconfigured
      // pipeline should say so once, at startup, not discover it on every
      // eligible filing.
      expect(
        OpenRouterClaimExtractor.fromApiKey(apiKey, {
          model: DEFAULT_CLAIM_MODEL.openrouter,
          effort: 'medium',
        }),
      ).toBeNull();
    },
  );

  it('builds an extractor when a key is present', () => {
    expect(
      OpenRouterClaimExtractor.fromApiKey('sk-or-v1-not-a-real-key', {
        model: DEFAULT_CLAIM_MODEL.openrouter,
        effort: 'low',
      }),
    ).toBeInstanceOf(OpenRouterClaimExtractor);
  });
});
