import { CLAIM_TIMEOUT_MS } from '@app/filings/llm/claim-provider';
import { MAX_CLAIMS_ON_WIRE } from '@app/filings/logic/claim-line';
import { MAX_CLAIMS_EXTRACTED } from '@app/filings/logic/claim-verify';
import {
  claimApiKeyOf,
  CONFIG_DEFAULTS,
  describeConfig,
  loadConfig,
  MINIMUM_NUMERIC,
  NUMERIC_KEYS,
  type IngestConfig,
  type NumericKey,
} from './configuration';

/** A clean environment: nothing set, so every value falls back to a default. */
const empty: NodeJS.ProcessEnv = {};

const withEnv = (overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...overrides,
});

describe('loadConfig: defaults', () => {
  it('loads without a single environment variable set', () => {
    expect(() => loadConfig(empty)).not.toThrow();
  });

  const DEFAULT_CASES: ReadonlyArray<readonly [keyof IngestConfig, unknown]> = [
    ['mongoUri', CONFIG_DEFAULTS.MONGO_URI],
    ['hotIntervalMs', CONFIG_DEFAULTS.NSE_HOT_INTERVAL_MS],
    ['idleIntervalMs', CONFIG_DEFAULTS.NSE_IDLE_INTERVAL_MS],
    ['drainIntervalMs', CONFIG_DEFAULTS.NSE_DRAIN_INTERVAL_MS],
    [
      'telegramMinSendIntervalMs',
      CONFIG_DEFAULTS.TELEGRAM_MIN_SEND_INTERVAL_MS,
    ],
    ['alertWindowMs', CONFIG_DEFAULTS.ALERT_WINDOW_MS],
    ['burstThreshold', CONFIG_DEFAULTS.BURST_THRESHOLD],
    ['failureThreshold', CONFIG_DEFAULTS.FAILURE_THRESHOLD],
  ];

  it.each(DEFAULT_CASES)('%s falls back to its default', (field, expected) => {
    expect(loadConfig(empty)[field]).toBe(expected);
  });

  it('leaves the telegram credentials empty rather than inventing them', () => {
    // An absent token must degrade to logging, never crash the boot; that
    // decision lives in TelegramService and depends on getting '' from here.
    const config = loadConfig(empty);

    expect(config.telegramBotToken).toBe('');
    expect(config.telegramChatId).toBe('');
  });

  it('defaults the watchlist to empty, meaning alert on everything', () => {
    expect(loadConfig(empty).watchlist).toEqual([]);
  });

  it('every shipped default is itself valid', () => {
    // A default that would be rejected on the way in is a trap: the config
    // only validates what the operator set, so a bad default never surfaces.
    for (const key of NUMERIC_KEYS) {
      const value = CONFIG_DEFAULTS[key];
      expect(Number.isFinite(value)).toBe(true);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(MINIMUM_NUMERIC);
    }
  });
});

describe('loadConfig: numeric validation', () => {
  /**
   * The hazard this whole function exists for.
   *
   * `parseInt(undefined)` is NaN and `NaN < 1` is FALSE, so a bare lower bound
   * ACCEPTS NaN. What that buys, per setting:
   *
   *   - alertWindowMs NaN: `age < NaN` is false for every filing, so the
   *     cold-start gate suppresses everything and the bot goes silent forever.
   *   - burstThreshold NaN: `newCount >= NaN` is false, so every poll takes the
   *     interval — the burst escape hatch is gone. At 0 the comparison is
   *     always true instead, and the poller busy-loops at zero delay.
   *   - failureThreshold NaN: `failures >= NaN` is false forever, so the
   *     breaker reports healthy through an unlimited outage.
   *   - the intervals NaN: `setTimeout(fn, NaN)` fires immediately, which is a
   *     2ms poll loop against Akamai bot protection.
   *
   * None of those throw. All of them are silent. So every numeric setting is
   * required to be a finite whole number >= 1, and anything else stops the
   * process at load with the offending key named.
   */
  const REJECTED: ReadonlyArray<readonly [string, string]> = [
    ['not a number at all', 'abc'],
    ['the literal NaN', 'NaN'],
    ['a trailing-junk number', '2000ms'],
    ['positive infinity', 'Infinity'],
    ['negative infinity', '-Infinity'],
    ['an overflowing exponent', '1e400'],
    ['zero', '0'],
    ['negative', '-1'],
    ['a fraction below one', '0.5'],
    ['a fraction above one', '1.5'],
    ['null spelled out', 'null'],
    ['a hyphen', '-'],
    ['a comma-grouped number', '2,000'],
  ];

  const cases: ReadonlyArray<readonly [NumericKey, string, string]> =
    NUMERIC_KEYS.flatMap((key) =>
      REJECTED.map(([label, raw]) => [key, label, raw] as const),
    );

  it.each(cases)('%s rejects %s', (key, _label, raw) => {
    expect(() => loadConfig(withEnv({ [key]: raw }))).toThrow(key);
  });

  it.each(NUMERIC_KEYS)('%s names itself and the value it was given', (key) => {
    expect(() => loadConfig(withEnv({ [key]: 'abc' }))).toThrow(/abc/);
  });

  const NON_FINITE: readonly string[] = ['NaN', 'abc', 'Infinity', '-Infinity'];

  it.each(NON_FINITE)('says %s is not a finite number', (raw) => {
    // The distinct message matters: "finite" and "whole" point an operator at
    // different fixes, and NaN is the one a bare lower bound lets through.
    expect(() => loadConfig(withEnv({ BURST_THRESHOLD: raw }))).toThrow(
      /finite/i,
    );
  });

  it('says a fraction is not a whole number', () => {
    expect(() => loadConfig(withEnv({ BURST_THRESHOLD: '1.5' }))).toThrow(
      /whole number/i,
    );
  });

  it('says an in-range-but-too-small value is below the minimum', () => {
    expect(() => loadConfig(withEnv({ BURST_THRESHOLD: '0' }))).toThrow(
      new RegExp(`at least ${MINIMUM_NUMERIC}`, 'i'),
    );
  });

  it('stops at the FIRST offending key rather than reporting a later one', () => {
    expect(() =>
      loadConfig(
        withEnv({ NSE_HOT_INTERVAL_MS: 'abc', BURST_THRESHOLD: 'xyz' }),
      ),
    ).toThrow(/NSE_HOT_INTERVAL_MS/);
  });

  const ACCEPTED: ReadonlyArray<readonly [string, string, number]> = [
    ['the minimum', '1', 1],
    ['a plain integer', '2500', 2500],
    ['surrounding whitespace', '  2500  ', 2500],
    ['an exponent form', '2e3', 2000],
    ['a redundant plus sign', '+42', 42],
    ['a trailing zero decimal', '42.0', 42],
  ];

  it.each(ACCEPTED)('accepts %s', (_label, raw, expected) => {
    expect(loadConfig(withEnv({ BURST_THRESHOLD: raw })).burstThreshold).toBe(
      expected,
    );
  });

  const ABSENT: ReadonlyArray<readonly [string, string]> = [
    ['an empty assignment', ''],
    ['a whitespace-only assignment', '   '],
  ];

  it.each(ABSENT)('treats %s as unset and uses the default', (_label, raw) => {
    // `KEY=` in a .env file is how operators write "not set". Crashing on it
    // would turn a blank line into a boot loop; 0 would be worse still.
    expect(loadConfig(withEnv({ BURST_THRESHOLD: raw })).burstThreshold).toBe(
      CONFIG_DEFAULTS.BURST_THRESHOLD,
    );
  });

  it('reads each numeric setting from its own key', () => {
    const config = loadConfig(
      withEnv({
        NSE_HOT_INTERVAL_MS: '11',
        NSE_IDLE_INTERVAL_MS: '22',
        NSE_DRAIN_INTERVAL_MS: '66',
        TELEGRAM_MIN_SEND_INTERVAL_MS: '77',
        ALERT_WINDOW_MS: '33',
        BURST_THRESHOLD: '44',
        FAILURE_THRESHOLD: '55',
      }),
    );

    expect(config.hotIntervalMs).toBe(11);
    expect(config.idleIntervalMs).toBe(22);
    expect(config.drainIntervalMs).toBe(66);
    expect(config.telegramMinSendIntervalMs).toBe(77);
    expect(config.alertWindowMs).toBe(33);
    expect(config.burstThreshold).toBe(44);
    expect(config.failureThreshold).toBe(55);
  });
});

describe('loadConfig: strings and the watchlist', () => {
  it('reads the mongo uri', () => {
    expect(
      loadConfig(withEnv({ MONGO_URI: 'mongodb://db:27017/x' })).mongoUri,
    ).toBe('mongodb://db:27017/x');
  });

  it('reads the telegram credentials verbatim', () => {
    const config = loadConfig(
      withEnv({ TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '-100' }),
    );

    expect(config.telegramBotToken).toBe('123:abc');
    expect(config.telegramChatId).toBe('-100');
  });

  const WATCHLIST_CASES: ReadonlyArray<readonly [string, string, string[]]> = [
    ['a single symbol', 'RELIANCE', ['RELIANCE']],
    ['a comma-separated list', 'RELIANCE,TCS', ['RELIANCE', 'TCS']],
    [
      'spacing after the commas',
      'RELIANCE, TCS , INFY',
      ['RELIANCE', 'TCS', 'INFY'],
    ],
    ['an empty assignment', '', []],
    ['a lone comma', ',', []],
    ['blank entries between symbols', 'RELIANCE,,TCS', ['RELIANCE', 'TCS']],
    ['a trailing comma', 'RELIANCE,', ['RELIANCE']],
    ['symbols containing an ampersand', 'M&M, J&KBANK', ['M&M', 'J&KBANK']],
  ];

  it.each(WATCHLIST_CASES)('parses %s', (_label, raw, expected) => {
    expect(loadConfig(withEnv({ WATCHLIST: raw })).watchlist).toEqual(expected);
  });

  it('preserves the case the operator wrote, leaving folding to the consumer', () => {
    // AlertService normalises both sides of the comparison; doing it twice in
    // two places is how the two sides drift apart.
    expect(loadConfig(withEnv({ WATCHLIST: 'reliance' })).watchlist).toEqual([
      'reliance',
    ]);
  });
});

describe('loadConfig: purity', () => {
  it('does not mutate the environment it reads', () => {
    const env = withEnv({ BURST_THRESHOLD: '4' });

    loadConfig(env);

    expect(env).toEqual({ BURST_THRESHOLD: '4' });
  });

  it('reads process.env when handed nothing', () => {
    const previous = process.env.BURST_THRESHOLD;
    process.env.BURST_THRESHOLD = '6';
    try {
      expect(loadConfig().burstThreshold).toBe(6);
    } finally {
      if (previous === undefined) delete process.env.BURST_THRESHOLD;
      else process.env.BURST_THRESHOLD = previous;
    }
  });
});

describe('describeConfig', () => {
  const config = loadConfig(
    withEnv({
      MONGO_URI: 'mongodb://alice:hunter2@db:27017/turret',
      TELEGRAM_BOT_TOKEN: '123456:AAH-super-secret-token',
      TELEGRAM_CHAT_ID: '-1001234567890',
      WATCHLIST: 'RELIANCE,TCS',
    }),
  );

  it('reports the operational knobs', () => {
    const line = describeConfig(config);

    expect(line).toContain('hot=2000ms');
    expect(line).toContain('idle=30000ms');
    expect(line).toContain('drain=300000ms');
    expect(line).toContain('send=1000ms');
    expect(line).toContain('window=600000ms');
    expect(line).toContain('burst=8');
    expect(line).toContain('failures=3');
    expect(line).toContain('watchlist=2');
  });

  const SECRETS: ReadonlyArray<readonly [string, string]> = [
    ['the bot token', '123456:AAH-super-secret-token'],
    ['the mongo password', 'hunter2'],
    ['the mongo username', 'alice'],
  ];

  it.each(SECRETS)('never prints %s', (_label, secret) => {
    expect(describeConfig(config)).not.toContain(secret);
  });

  it('still shows where mongo is, minus the credentials', () => {
    expect(describeConfig(config)).toContain('db:27017/turret');
  });

  it('reports whether telegram is configured, without the values', () => {
    expect(describeConfig(config)).toContain('telegram=configured');
    expect(describeConfig(loadConfig(empty))).toContain(
      'telegram=unconfigured',
    );
  });

  const HALF_CONFIGURED: ReadonlyArray<readonly [string, NodeJS.ProcessEnv]> = [
    ['only a token', { TELEGRAM_BOT_TOKEN: 'x' }],
    ['only a chat id', { TELEGRAM_CHAT_ID: 'x' }],
  ];

  it.each(HALF_CONFIGURED)(
    'reports %s as unconfigured, because a half-set pair sends nothing',
    (_label, env) => {
      expect(describeConfig(loadConfig(withEnv(env)))).toContain(
        'telegram=unconfigured',
      );
    },
  );

  it('leaves a credential-free uri alone', () => {
    expect(describeConfig(loadConfig(empty))).toContain(
      CONFIG_DEFAULTS.MONGO_URI,
    );
  });
});

describe('the background attachment worker settings', () => {
  it('ships enabled, because a worker that is off looks like an empty queue', () => {
    expect(loadConfig(empty).enrichmentEnabled).toBe(true);
  });

  it.each([
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['no', false],
    ['off', false],
    [' Off ', false],
    ['true', true],
    ['1', true],
    ['yes', true],
    ['anything else', true],
  ])('reads ENRICH_ENABLED=%s as %s', (raw, expected) => {
    // Permissive towards ON, deliberately: a typo must not silently disable the
    // worker, because there is no signal that distinguishes a stopped worker
    // from a queue with nothing in it.
    expect(loadConfig(withEnv({ ENRICH_ENABLED: raw })).enrichmentEnabled).toBe(
      expected,
    );
  });

  it.each([[''], ['   ']])(
    'treats a blank ENRICH_ENABLED="%s" as unset',
    (raw) => {
      expect(
        loadConfig(withEnv({ ENRICH_ENABLED: raw })).enrichmentEnabled,
      ).toBe(true);
    },
  );

  it('ships the measured defaults', () => {
    const config = loadConfig(empty);

    // 800ms is deliberately slower than the ~2.5 req/s that drew no rate
    // limiting across 60 sampled requests, because the population is 17,000.
    expect(config.enrichmentRequestDelayMs).toBe(800);
    expect(config.enrichmentMaxAttempts).toBe(5);
    // The lease must outlast everything one document can cost. With two model
    // calls at a 120s ceiling each, plus the fetch, the old 120,000 expired
    // while the worker still held the filing — which is a second worker
    // claiming it and both writing a verdict.
    expect(config.enrichmentLeaseMs).toBe(600_000);
    expect(config.enrichmentLeaseMs).toBeGreaterThan(2 * CLAIM_TIMEOUT_MS);
    expect(config.contextWindowDays).toBe(30);
    // A parse failure is only an upload race while the filing is minutes old.
    expect(config.enrichmentParseWindowMs).toBe(3_600_000);
    expect(config.enrichmentMaxParseAttempts).toBe(3);
    expect(config.enrichmentParseRetryBaseMs).toBe(300_000);
    // Clears the largest attachment observed in the recorded month (22.2 MB).
    expect(config.enrichmentMaxBytes).toBeGreaterThan(22.2 * 1024 * 1024);
  });

  it.each([
    ['ENRICH_REQUEST_DELAY_MS', 'enrichmentRequestDelayMs', '1500', 1500],
    ['ENRICH_BATCH_SIZE', 'enrichmentBatchSize', '5', 5],
    ['ENRICH_MAX_ATTEMPTS', 'enrichmentMaxAttempts', '2', 2],
    ['ENRICH_LEASE_MS', 'enrichmentLeaseMs', '9000', 9000],
    ['ENRICH_PARSE_WINDOW_MS', 'enrichmentParseWindowMs', '600000', 600_000],
    ['ENRICH_MAX_PARSE_ATTEMPTS', 'enrichmentMaxParseAttempts', '2', 2],
    [
      'ENRICH_PARSE_RETRY_BASE_MS',
      'enrichmentParseRetryBaseMs',
      '30000',
      30_000,
    ],
    ['CONTEXT_WINDOW_DAYS', 'contextWindowDays', '7', 7],
  ] as const)('honours %s', (key, field, raw, expected) => {
    expect(loadConfig(withEnv({ [key]: raw }))[field]).toBe(expected);
  });

  it.each([
    ['ENRICH_REQUEST_DELAY_MS'],
    ['ENRICH_MAX_ATTEMPTS'],
    ['ENRICH_MAX_BYTES'],
    ['ENRICH_PARSE_WINDOW_MS'],
    ['ENRICH_MAX_PARSE_ATTEMPTS'],
    ['CONTEXT_WINDOW_DAYS'],
  ])('rejects a non-finite %s at load rather than in a consumer', (key) => {
    expect(() => loadConfig(withEnv({ [key]: 'abc' }))).toThrow(
      /finite number/,
    );
  });

  it('reports the worker in the startup line, both ways', () => {
    expect(describeConfig(loadConfig(empty))).toContain('enrich=on');
    expect(
      describeConfig(loadConfig(withEnv({ ENRICH_ENABLED: 'false' }))),
    ).toContain('enrich=off');
    expect(describeConfig(loadConfig(empty))).toContain('context=30d');
    expect(describeConfig(loadConfig(empty))).toContain('enrichDelay=800ms');
  });

  it('runs the lane in-process by default and says where it runs', () => {
    // In-process is the default so a single-process deployment keeps working;
    // the startup line names it either way, because "the worker is running
    // somewhere else" and "nothing is running it" produce identical symptoms.
    expect(loadConfig(empty).enrichmentInProcess).toBe(true);
    expect(describeConfig(loadConfig(empty))).toContain(
      'enrichWhere=in-process',
    );
    expect(
      describeConfig(loadConfig(withEnv({ ENRICH_IN_PROCESS: 'false' }))),
    ).toContain('enrichWhere=separate-process');
  });

  it.each([
    ['false', false],
    ['off', false],
    ['0', false],
    ['true', true],
    ['', true],
  ])('reads ENRICH_IN_PROCESS=%s as %s', (raw, expected) => {
    expect(
      loadConfig(withEnv({ ENRICH_IN_PROCESS: raw })).enrichmentInProcess,
    ).toBe(expected);
  });
});

describe('the notable-claim settings', () => {
  it('ships on, with the current Opus and no key', () => {
    const config = loadConfig(empty);

    expect(config.claimsEnabled).toBe(true);
    expect(config.claimModel).toBe('claude-opus-5');
    expect(config.claimEffort).toBe('medium');
    // The EXTRACTION budget, not the wire line's. Asserted against the
    // constant rather than a literal: a literal here is exactly what let the
    // config hold 3 while `claim-verify.ts` had moved on, so the prompt kept
    // asking a forty-slide deck for three facts.
    expect(config.claimMaxClaims).toBe(MAX_CLAIMS_EXTRACTED);
    expect(config.claimMaxClaims).toBeGreaterThan(MAX_CLAIMS_ON_WIRE);
    // No key is a supported state: the worker keeps reading documents and every
    // eligible filing records `extractor-unavailable` instead of a claim.
    expect(config.anthropicApiKey).toBe('');
  });

  it.each([['low'], ['medium'], ['high'], ['xhigh'], ['max']])(
    'accepts the effort level %s',
    (raw) => {
      expect(loadConfig(withEnv({ CLAIM_EFFORT: raw })).claimEffort).toBe(raw);
    },
  );

  it('accepts an effort level in any case, with padding', () => {
    expect(loadConfig(withEnv({ CLAIM_EFFORT: '  HIGH  ' })).claimEffort).toBe(
      'high',
    );
  });

  it.each([['ludicrous'], ['none'], ['1'], ['medium-high']])(
    'rejects the effort level "%s" at load rather than on every call',
    (raw) => {
      // An unrecognised level is a 400 from the API on every single request,
      // which presents as an extractor that has silently stopped working rather
      // than as a typo in one environment variable.
      expect(() => loadConfig(withEnv({ CLAIM_EFFORT: raw }))).toThrow(
        /must be one of low, medium, high, xhigh, max/,
      );
    },
  );

  it.each([[''], ['   ']])(
    'treats a blank CLAIM_EFFORT "%s" as unset',
    (raw) => {
      expect(loadConfig(withEnv({ CLAIM_EFFORT: raw })).claimEffort).toBe(
        'medium',
      );
    },
  );

  it('honours an operator’s model and cap', () => {
    const config = loadConfig(
      withEnv({ CLAIM_MODEL: 'claude-sonnet-5', CLAIM_MAX_CLAIMS: '2' }),
    );
    expect(config.claimModel).toBe('claude-sonnet-5');
    expect(config.claimMaxClaims).toBe(2);
  });

  it.each([
    ['false', false],
    ['off', false],
    ['true', true],
  ])('reads CLAIM_ENABLED=%s as %s', (raw, expected) => {
    expect(loadConfig(withEnv({ CLAIM_ENABLED: raw })).claimsEnabled).toBe(
      expected,
    );
  });

  it('reports the claim lane in the startup line, all three ways', () => {
    // "Off" is a decision and "unconfigured" is a misconfiguration, and both
    // present as a market with nothing to say unless the line distinguishes them.
    expect(describeConfig(loadConfig(empty))).toContain(
      'claims=anthropic/unconfigured',
    );
    expect(
      describeConfig(loadConfig(withEnv({ CLAIM_ENABLED: 'false' }))),
    ).toContain('claims=off');
    expect(
      describeConfig(
        loadConfig(
          withEnv({ ANTHROPIC_API_KEY: 'sk-ant-x', CLAIM_EFFORT: 'low' }),
        ),
      ),
    ).toContain('claims=anthropic/claude-opus-5/low');
  });

  it('names the provider even when the lane is unconfigured', () => {
    // "Which key is missing?" has two answers now, and the startup line is
    // where an operator looks for it.
    expect(
      describeConfig(loadConfig(withEnv({ CLAIM_PROVIDER: 'openrouter' }))),
    ).toContain('claims=openrouter/unconfigured');
  });

  it.each([
    ['ANTHROPIC_API_KEY', 'sk-ant-secret'],
    ['OPENROUTER_API_KEY', 'sk-or-v1-secret'],
  ])('never prints %s itself', (key, value) => {
    expect(describeConfig(loadConfig(withEnv({ [key]: value })))).not.toContain(
      value,
    );
  });
});

describe('the claim provider', () => {
  it('ships pointed at Anthropic, with both keys read', () => {
    const config = loadConfig(empty);
    expect(config.claimProvider).toBe('anthropic');
    expect(config.anthropicApiKey).toBe('');
    expect(config.openrouterApiKey).toBe('');
  });

  it.each([['anthropic'], ['openrouter']])('accepts the provider %s', (raw) => {
    expect(loadConfig(withEnv({ CLAIM_PROVIDER: raw })).claimProvider).toBe(
      raw,
    );
  });

  it('accepts a provider in any case, with padding', () => {
    expect(
      loadConfig(withEnv({ CLAIM_PROVIDER: '  OpenRouter  ' })).claimProvider,
    ).toBe('openrouter');
  });

  it.each([['openai'], ['claude'], ['1'], ['open-router'], ['anthropic ai']])(
    'rejects the provider "%s" at load rather than on every call',
    (raw) => {
      // An unrecognised provider selects no adapter at all, which presents as
      // an extractor that has silently stopped working rather than as a typo in
      // one environment variable.
      expect(() => loadConfig(withEnv({ CLAIM_PROVIDER: raw }))).toThrow(
        /CLAIM_PROVIDER must be one of anthropic, openrouter/,
      );
    },
  );

  it.each([[''], ['   ']])(
    'treats a blank CLAIM_PROVIDER "%s" as unset',
    (raw) => {
      expect(loadConfig(withEnv({ CLAIM_PROVIDER: raw })).claimProvider).toBe(
        'anthropic',
      );
    },
  );

  it.each([
    ['anthropic', 'claude-opus-5'],
    ['openrouter', 'deepseek/deepseek-v4-flash-0731'],
  ])('defaults the model to %s’s own: %s', (provider, model) => {
    // The failure this pins: an operator sets CLAIM_PROVIDER and nothing else,
    // and the lane sends OpenRouter a `claude-opus-5` it cannot resolve — a 404
    // on every eligible filing, which reads as a broken extractor.
    expect(loadConfig(withEnv({ CLAIM_PROVIDER: provider })).claimModel).toBe(
      model,
    );
  });

  it('still lets an operator name a model explicitly', () => {
    expect(
      loadConfig(
        withEnv({
          CLAIM_PROVIDER: 'openrouter',
          CLAIM_MODEL: 'qwen/qwen3-max',
        }),
      ).claimModel,
    ).toBe('qwen/qwen3-max');
  });

  it.each([
    ['anthropic', 'ANTHROPIC_API_KEY', 'sk-ant-x'],
    ['openrouter', 'OPENROUTER_API_KEY', 'sk-or-v1-x'],
  ])('reports %s configured only by %s', (provider, key, value) => {
    const withOwnKey = describeConfig(
      loadConfig(withEnv({ CLAIM_PROVIDER: provider, [key]: value })),
    );
    expect(withOwnKey).not.toContain(`claims=${provider}/unconfigured`);

    // The other provider's key does not configure this one. The failure being
    // pinned: an operator switches provider, keeps the key they already had,
    // and the startup line reports a working lane that then extracts nothing.
    const otherKey =
      key === 'ANTHROPIC_API_KEY' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
    const withWrongKey = describeConfig(
      loadConfig(withEnv({ CLAIM_PROVIDER: provider, [otherKey]: value })),
    );
    expect(withWrongKey).toContain(`claims=${provider}/unconfigured`);
  });
});

describe('claimApiKeyOf', () => {
  it.each([
    ['anthropic', 'sk-ant-x'],
    ['openrouter', 'sk-or-v1-x'],
  ] as const)('returns the %s key', (claimProvider, expected) => {
    expect(
      claimApiKeyOf({
        claimProvider,
        anthropicApiKey: 'sk-ant-x',
        openrouterApiKey: 'sk-or-v1-x',
      }),
    ).toBe(expected);
  });
});
