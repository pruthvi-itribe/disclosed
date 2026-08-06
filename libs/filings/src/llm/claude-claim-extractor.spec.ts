import { CLAIM_SYSTEM_PROMPT } from '../logic/claim-prompt';
import { CLAIM_MAX_TOKENS, DEFAULT_CLAIM_MODEL } from './claim-provider';
import {
  ClaudeClaimExtractor,
  type ClaudeMessagesApi,
} from './claude-claim-extractor';

/**
 * NO NETWORK. Every test here stands a recorder in for `client.beta.messages`,
 * so the whole language-model surface — the request shape, the caching
 * breakpoint, the refusal path and every way a reply can be unusable — is
 * exercised without a key and without a request leaving the process.
 */
class RecordingMessages implements ClaudeMessagesApi {
  public readonly bodies: Record<string, unknown>[] = [];

  constructor(
    private readonly reply: unknown = {
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            claims: [
              {
                span: 'The Company has joined the association.',
                text: 'joins the association',
                kind: 'partnership',
              },
            ],
          }),
        },
      ],
    },
    private readonly throws: Error | null = null,
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

const extractorWith = (messages: ClaudeMessagesApi): ClaudeClaimExtractor =>
  new ClaudeClaimExtractor(messages, {
    model: DEFAULT_CLAIM_MODEL.anthropic,
    effort: 'medium',
  });

describe('ClaudeClaimExtractor — the request', () => {
  it('asks the configured model', async () => {
    const messages = new RecordingMessages();
    await extractorWith(messages).extract(REQUEST);
    expect(messages.bodies[0].model).toBe(DEFAULT_CLAIM_MODEL.anthropic);
  });

  it('defaults to the current Opus', () => {
    expect(DEFAULT_CLAIM_MODEL.anthropic).toBe('claude-opus-5');
  });

  it('puts a cache breakpoint on the stable prompt', async () => {
    // The system prompt is byte-identical on every request. Without the
    // breakpoint every call pays full price for it, ~700 times a day.
    const messages = new RecordingMessages();
    await extractorWith(messages).extract(REQUEST);

    expect(messages.bodies[0].system).toEqual([
      {
        type: 'text',
        text: CLAIM_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('asks for the schema and the effort inside output_config', async () => {
    const messages = new RecordingMessages();
    await extractorWith(messages).extract(REQUEST);

    const config = messages.bodies[0].output_config as Record<string, unknown>;
    expect(config.effort).toBe('medium');
    expect((config.format as Record<string, unknown>).type).toBe('json_schema');
  });

  it('leaves room for a reasoning pass inside max_tokens', async () => {
    // `max_tokens` bounds thinking AND response together on this model, and
    // thinking is on by default. A tight budget truncates the JSON mid-object
    // and turns a good extraction into an unparseable reply.
    const messages = new RecordingMessages();
    await extractorWith(messages).extract(REQUEST);
    expect(messages.bodies[0].max_tokens).toBe(CLAIM_MAX_TOKENS);
    expect(CLAIM_MAX_TOKENS).toBeGreaterThanOrEqual(4_000);
  });

  it('opts into a server-side fallback for a classifier refusal', async () => {
    // A pharmaceutical or defence filing's ordinary vocabulary can trip a
    // safety classifier; routing the decline server-side keeps the filing.
    const messages = new RecordingMessages();
    await extractorWith(messages).extract(REQUEST);

    expect(messages.bodies[0].fallbacks).toBe('default');
    expect(messages.bodies[0].betas).toEqual([
      'server-side-fallback-2026-07-01',
    ]);
  });

  it('sends the filing in the user turn, not in the cached prefix', async () => {
    const messages = new RecordingMessages();
    await extractorWith(messages).extract(REQUEST);

    const turns = messages.bodies[0].messages as {
      role: string;
      content: string;
    }[];
    expect(turns).toHaveLength(1);
    expect(turns[0].role).toBe('user');
    expect(turns[0].content).toContain('SWIGGY');
    expect(JSON.stringify(messages.bodies[0].system)).not.toContain('SWIGGY');
  });
});

describe('ClaudeClaimExtractor — the reply', () => {
  it('returns the claims the parser read, not a shape of its own', async () => {
    // Pins the wiring rather than only the happy value: an adapter that stopped
    // calling `parseClaimResponse` and returned an empty list would look
    // healthy — every filing would simply record "the model found nothing".
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            claims: [
              { span: 'one sentence', text: 'one claim', kind: 'target' },
              {
                span: 'another sentence',
                text: 'another claim',
                kind: 'guidance',
              },
              { span: 'a malformed one', text: 'a claim', kind: 'not-a-kind' },
            ],
          }),
        },
      ],
    });

    const result = await extractorWith(messages).extract(REQUEST);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('expected ok');
    // Two good, one dropped by the parser — a count no bypass reproduces.
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0].kind).toBe('target');
  });

  it('reads the claims out of a good reply', async () => {
    const result = await extractorWith(new RecordingMessages()).extract(
      REQUEST,
    );
    expect(result).toEqual({
      outcome: 'ok',
      claims: [
        {
          span: 'The Company has joined the association.',
          text: 'joins the association',
          kind: 'partnership',
        },
      ],
    });
  });

  it('reports what the call cost, cache reads kept apart', async () => {
    // The comparison harness prices a run from these. `input_tokens` on this
    // API already EXCLUDES cache reads, so they are carried in their own field
    // rather than folded in — a cache hit billed at full rate would make the
    // cheaper provider look cheaper than it is.
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ claims: [] }) }],
      usage: {
        input_tokens: 421,
        output_tokens: 87,
        cache_read_input_tokens: 2_190,
        cache_creation_input_tokens: 0,
      },
    });

    const result = await extractorWith(messages).extract(REQUEST);
    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toEqual({
      inputTokens: 421,
      outputTokens: 87,
      cachedInputTokens: 2_190,
      cacheWriteInputTokens: 0,
    });
  });

  it.each([
    ['no usage block at all', {}],
    ['a usage block that is not an object', { usage: 'lots' }],
    ['a null usage block', { usage: null }],
  ])('leaves usage absent rather than zeroed for %s', async (_label, extra) => {
    // Absent and zero are different facts. Zeroes would let an unreported call
    // be priced as a free one, and a cost report would silently understate.
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ claims: [] }) }],
      ...(extra as Record<string, unknown>),
    });

    const result = await extractorWith(messages).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toBeUndefined();
  });

  it('reads a partial usage block as zero rather than NaN', async () => {
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ claims: [] }) }],
      usage: { input_tokens: 300 },
    });

    const result = await extractorWith(messages).extract(REQUEST);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toEqual({
      inputTokens: 300,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
    });
  });

  it('ignores thinking blocks when it reads the body', async () => {
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [
        { type: 'thinking', thinking: 'some reasoning' },
        { type: 'text', text: JSON.stringify({ claims: [] }) },
      ],
    });
    const result = await extractorWith(messages).extract(REQUEST);
    expect(result).toEqual({ outcome: 'ok', claims: [] });
  });

  it('checks stop_reason BEFORE it reads content', async () => {
    // A refusal returns HTTP 200 with an empty or partial content array. Code
    // that indexes into content first reports a parse failure for something
    // that was not one.
    const messages = new RecordingMessages({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber' },
      content: [],
    });

    const result = await extractorWith(messages).extract(REQUEST);
    expect(result).toEqual({
      outcome: 'failed',
      message: 'the model declined to answer for this document',
    });
  });

  it.each([
    ['an empty content array', { stop_reason: 'end_turn', content: [] }],
    ['no content at all', { stop_reason: 'end_turn' }],
    ['a reply that is not an object', 'nope'],
    [
      'blank text',
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '   ' }] },
    ],
  ])('fails with a reason for %s', async (_label, reply) => {
    const result = await extractorWith(new RecordingMessages(reply)).extract(
      REQUEST,
    );
    expect(result.outcome).toBe('failed');
  });

  it('ignores a text block with no text on it', async () => {
    // Defensive rather than hypothetical: the SDK's block union is wider than
    // this adapter reads, and a block typed `text` with no string on it would
    // otherwise concatenate `undefined` into the body.
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [
        { type: 'text' },
        { type: 'text', text: JSON.stringify({ claims: [] }) },
      ],
    });
    const result = await extractorWith(messages).extract(REQUEST);
    expect(result).toEqual({ outcome: 'ok', claims: [] });
  });

  it('fails rather than throws when the body is not JSON', async () => {
    const messages = new RecordingMessages({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I could not find any claims.' }],
    });
    const result = await extractorWith(messages).extract(REQUEST);
    expect(result.outcome).toBe('failed');
  });

  it('NEVER throws, whatever the API does', async () => {
    // An exception raised inside the worker's loop is indistinguishable from a
    // bug in the reading path, and would be logged as one.
    const messages = new RecordingMessages(null, new Error('429 rate limited'));
    const result = await extractorWith(messages).extract(REQUEST);
    expect(result).toEqual({ outcome: 'failed', message: '429 rate limited' });
  });

  it('describes a thrown non-Error too', async () => {
    const messages = new RecordingMessages(
      null,
      'a string' as unknown as Error,
    );
    const result = await extractorWith(messages).extract(REQUEST);
    expect(result.outcome).toBe('failed');
  });
});

describe('ClaudeClaimExtractor.fromApiKey', () => {
  it.each([[''], ['   ']])(
    'returns null for the missing key "%s"',
    (apiKey) => {
      // NULL rather than a client that fails on every call: an unconfigured
      // pipeline should say so once, at startup, not discover it 700 times a
      // day — and "no extractor" is a different fact from "the extractor
      // failed".
      expect(
        ClaudeClaimExtractor.fromApiKey(apiKey, {
          model: DEFAULT_CLAIM_MODEL.anthropic,
          effort: 'medium',
        }),
      ).toBeNull();
    },
  );

  it('builds an extractor when a key is present', () => {
    expect(
      ClaudeClaimExtractor.fromApiKey('sk-ant-not-a-real-key', {
        model: DEFAULT_CLAIM_MODEL.anthropic,
        effort: 'low',
      }),
    ).toBeInstanceOf(ClaudeClaimExtractor);
  });
});
