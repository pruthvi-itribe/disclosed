import {
  CLAIM_EFFORT_LEVELS,
  CLAIM_MAX_TOKENS,
  CLAIM_PROVIDERS,
  CLAIM_TIMEOUT_MS,
  claimsFromText,
  countOf,
  DEFAULT_CLAIM_MODEL,
  describeProviderFailure,
  openAiEffort,
  redactSecrets,
} from './claim-provider';

describe('the provider vocabulary', () => {
  it('names exactly the two providers that have an adapter', () => {
    // A name here with no adapter behind it is a config value that selects
    // nothing; an adapter with no name here cannot be selected at all.
    expect([...CLAIM_PROVIDERS]).toEqual(['anthropic', 'openrouter']);
  });

  it('gives every provider a default model', () => {
    for (const provider of CLAIM_PROVIDERS) {
      expect(DEFAULT_CLAIM_MODEL[provider]).toMatch(/\S/);
    }
  });

  it('names the five effort rungs', () => {
    expect([...CLAIM_EFFORT_LEVELS]).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('holds one token ceiling and one timeout for both providers', () => {
    // Asserted against literals, not against themselves. Two providers measured
    // with different budgets are not being compared, and a per-provider ceiling
    // is exactly how that would happen without anyone noticing.
    expect(CLAIM_MAX_TOKENS).toBe(8_000);
    expect(CLAIM_TIMEOUT_MS).toBe(120_000);
  });
});

describe('openAiEffort', () => {
  it.each([
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'high'],
    ['max', 'high'],
  ] as const)('maps %s to %s', (level, expected) => {
    expect(openAiEffort(level)).toBe(expected);
  });

  it('maps every rung to something the OpenAI ladder has', () => {
    for (const level of CLAIM_EFFORT_LEVELS) {
      expect(['low', 'medium', 'high']).toContain(openAiEffort(level));
    }
  });
});

describe('redactSecrets', () => {
  it.each([
    ['an Anthropic key', 'auth failed for sk-ant-api03-AbC123_def-456'],
    ['an OpenRouter key', 'invalid key sk-or-v1-0123456789abcdef'],
    ['a bearer header echoed back', 'sent Bearer eyJhbGciOiJIUzI1NiJ9.abc'],
    ['a labelled key', 'api_key=abcdef0123456789 was rejected'],
    ['a quoted key', 'field "apiKey": "abcdef0123456789" is invalid'],
  ])('removes %s', (_label, message) => {
    const redacted = redactSecrets(message);
    expect(redacted).toContain('[redacted]');
    // The literal that follows the marker in each case is the secret itself.
    expect(redacted).not.toMatch(/abcdef0123456789|AbC123_def-456|eyJhbGciOi/);
  });

  it('leaves an ordinary message alone', () => {
    expect(redactSecrets('the model returned no text')).toBe(
      'the model returned no text',
    );
  });

  it('removes every occurrence, not just the first', () => {
    const redacted = redactSecrets(
      'sk-ant-firstsecret and also sk-ant-secondsecret',
    );
    expect(redacted).not.toContain('firstsecret');
    expect(redacted).not.toContain('secondsecret');
  });
});

describe('describeProviderFailure', () => {
  it('reads an Error’s message', () => {
    expect(describeProviderFailure(new Error('429 rate limited'))).toBe(
      '429 rate limited',
    );
  });

  it.each([
    ['a string', 'a string'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('describes the thrown non-Error %p', (thrown, expected) => {
    expect(describeProviderFailure(thrown)).toBe(expected);
  });

  it('redacts on the way out', () => {
    expect(describeProviderFailure(new Error('key sk-ant-leak was bad'))).toBe(
      'key [redacted] was bad',
    );
  });
});

describe('claimsFromText', () => {
  it.each([[''], ['   '], ['\n\t ']])('refuses the blank body "%s"', (text) => {
    expect(claimsFromText(text)).toEqual({
      outcome: 'failed',
      message: 'the model returned no text',
    });
  });

  it('reads well-formed claims', () => {
    const result = claimsFromText(
      JSON.stringify({
        claims: [{ span: 'a sentence', text: 'a claim', kind: 'target' }],
      }),
    );
    expect(result).toEqual({
      outcome: 'ok',
      claims: [{ span: 'a sentence', text: 'a claim', kind: 'target' }],
      usage: undefined,
    });
  });

  it('drops a malformed claim rather than repairing it', () => {
    // Repairing would be this pipeline authoring a claim about a named listed
    // company.
    const result = claimsFromText(
      JSON.stringify({
        claims: [
          { span: 'a sentence', text: 'a claim', kind: 'target' },
          { span: 'another', text: 'another', kind: 'not-a-kind' },
        ],
      }),
    );
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.claims).toHaveLength(1);
  });

  it('carries usage through untouched', () => {
    const usage = {
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 3,
      cacheWriteInputTokens: 4,
    };
    const result = claimsFromText(JSON.stringify({ claims: [] }), usage);
    if (result.outcome !== 'ok') throw new Error('expected ok');
    expect(result.usage).toBe(usage);
  });

  it('throws on a body that is not JSON, for the adapter to catch', () => {
    // Deliberate: the message a bad body produces belongs to the provider that
    // sent it, and each adapter's own catch supplies it.
    expect(() => claimsFromText('not json at all')).toThrow();
  });
});

describe('countOf', () => {
  it.each([
    [42, 42],
    [0, 0],
    [undefined, 0],
    [null, 0],
    ['42', 0],
    [NaN, 0],
    [Infinity, 0],
  ])('reads %p as %p', (value, expected) => {
    // NaN and Infinity are the realistic bad values from an untyped payload,
    // and both would poison a cost total silently — NaN makes every subsequent
    // sum NaN, and a report of NaN dollars is a report of nothing.
    expect(countOf(value)).toBe(expected);
  });
});
