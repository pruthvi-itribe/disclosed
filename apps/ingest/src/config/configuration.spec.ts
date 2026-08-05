import {
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
      MONGO_URI: 'mongodb://alice:hunter2@db:27017/redbox',
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
    expect(describeConfig(config)).toContain('db:27017/redbox');
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
