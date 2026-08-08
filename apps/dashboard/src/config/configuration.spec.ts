import {
  DASHBOARD_DEFAULTS,
  DASHBOARD_HOST,
  MAX_PORT,
  MIN_PORT,
  describeDashboardConfig,
  loadDashboardConfig,
  readPort,
  readString,
} from './configuration';

/** A clean environment, so nothing here depends on the developer's shell. */
const env = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  ...overrides,
});

describe('readPort', () => {
  it('returns the default when the key is absent', () => {
    expect(readPort(env())).toBe(DASHBOARD_DEFAULTS.DASHBOARD_PORT);
  });

  it.each([[''], ['   '], ['\t']])(
    'treats a blank assignment (%p) as not set',
    (raw) => {
      // `DASHBOARD_PORT=` is how a .env file spells "unset". Read as 0 it would
      // bind a random ephemeral port and the printed URL would answer nothing.
      expect(readPort(env({ DASHBOARD_PORT: raw }))).toBe(
        DASHBOARD_DEFAULTS.DASHBOARD_PORT,
      );
    },
  );

  it('reads a valid port', () => {
    expect(readPort(env({ DASHBOARD_PORT: '8123' }))).toBe(8123);
  });

  it.each([['abc'], ['NaN'], ['port'], ['7717abc'], ['1e4x']])(
    'rejects the non-numeric value %p instead of accepting NaN',
    (raw) => {
      // THE bug this file exists to prevent: NaN < 1024 is FALSE, so a bare
      // lower-bound check accepts it and `listen(NaN)` binds a random port.
      expect(() => readPort(env({ DASHBOARD_PORT: raw }))).toThrow(
        /must be a finite number/,
      );
    },
  );

  it('rejects Infinity', () => {
    expect(() => readPort(env({ DASHBOARD_PORT: 'Infinity' }))).toThrow(
      /must be a finite number/,
    );
  });

  it('rejects a fractional port with a different message than a non-numeric one', () => {
    // Collapsing the two would leave `=abc` and `=0.5` indistinguishable in
    // the log line that stops the process.
    expect(() => readPort(env({ DASHBOARD_PORT: '80.5' }))).toThrow(
      /must be a whole number/,
    );
  });

  it('rejects trailing junk rather than silently taking the leading digits', () => {
    // `parseInt('7717ms')` is 7717. `Number` refuses, which is the point.
    expect(() => readPort(env({ DASHBOARD_PORT: '7717ms' }))).toThrow(
      /must be a finite number/,
    );
  });

  it.each([['0'], ['1'], ['80'], ['1023'], ['-1']])(
    'rejects the privileged or invalid port %p',
    (raw) => {
      expect(() => readPort(env({ DASHBOARD_PORT: raw }))).toThrow(
        /must be between/,
      );
    },
  );

  it('rejects a port above the 16-bit ceiling', () => {
    expect(() => readPort(env({ DASHBOARD_PORT: '65536' }))).toThrow(
      /must be between/,
    );
  });

  it('accepts the exact bounds', () => {
    expect(readPort(env({ DASHBOARD_PORT: String(MIN_PORT) }))).toBe(MIN_PORT);
    expect(readPort(env({ DASHBOARD_PORT: String(MAX_PORT) }))).toBe(MAX_PORT);
  });
});

describe('readString', () => {
  it('returns the fallback when the key is absent', () => {
    expect(readString('MONGO_URI', env(), 'fallback')).toBe('fallback');
  });

  it('returns the fallback for a blank assignment', () => {
    // A `MONGO_URI=` read as '' produces a connection attempt against an empty
    // string, which fails with a message about the driver, not the config.
    expect(readString('MONGO_URI', env({ MONGO_URI: '  ' }), 'fallback')).toBe(
      'fallback',
    );
  });

  it('returns the value untrimmed when it is set', () => {
    expect(readString('MONGO_URI', env({ MONGO_URI: ' x ' }), 'fallback')).toBe(
      ' x ',
    );
  });
});

describe('loadDashboardConfig', () => {
  it('builds a configuration from an empty environment', () => {
    expect(loadDashboardConfig(env())).toEqual({
      mongoUri: DASHBOARD_DEFAULTS.MONGO_URI,
      port: DASHBOARD_DEFAULTS.DASHBOARD_PORT,
      host: DASHBOARD_HOST,
      sessionTtlDays: DASHBOARD_DEFAULTS.SESSION_TTL_DAYS,
      publicOrigin: `http://${DASHBOARD_HOST}:${DASHBOARD_DEFAULTS.DASHBOARD_PORT}`,
      // An environment with no Firebase keys signs people in the in-house way.
      // The whole decision table lives in `auth-config.spec.ts`; what this
      // asserts is that the dashboard config carries it at all.
      auth: { mode: 'local', firebase: null, missing: [] },
    });
  });

  it('binds loopback, and offers no way to change it', () => {
    // This is an unauthenticated view of an unauthenticated database. The
    // interface it binds is the only thing between it and the network, so
    // `0.0.0.0` must not be reachable through a typo in a .env file.
    const config = loadDashboardConfig(env({ HOST: '0.0.0.0' }));

    expect(config.host).toBe('127.0.0.1');
  });

  it('reads the overridden values', () => {
    const config = loadDashboardConfig(
      env({ MONGO_URI: 'mongodb://db:27017/x', DASHBOARD_PORT: '9001' }),
    );

    expect(config).toEqual({
      mongoUri: 'mongodb://db:27017/x',
      port: 9001,
      host: DASHBOARD_HOST,
      sessionTtlDays: DASHBOARD_DEFAULTS.SESSION_TTL_DAYS,
      // Defaulted to this process's own URL, so a loopback deployment needs no
      // configuration — and note it follows the PORT rather than the default,
      // or a dashboard on 9001 would refuse every mutation from its own page.
      publicOrigin: 'http://127.0.0.1:9001',
      auth: { mode: 'local', firebase: null, missing: [] },
    });
  });

  it('propagates a bad port rather than starting on a default', () => {
    expect(() => loadDashboardConfig(env({ DASHBOARD_PORT: 'nope' }))).toThrow(
      /DASHBOARD_PORT/,
    );
  });

  it('defaults to the loopback mongo the compose file publishes', () => {
    expect(DASHBOARD_DEFAULTS.MONGO_URI).toContain('27117');
  });
});

describe('loadDashboardConfig: the session lifetime', () => {
  it('defaults to thirty days', () => {
    expect(loadDashboardConfig(env()).sessionTtlDays).toBe(30);
  });

  it('reads an override', () => {
    expect(
      loadDashboardConfig(env({ SESSION_TTL_DAYS: '7' })).sessionTtlDays,
    ).toBe(7);
  });

  it.each([
    ['a word', 'nope'],
    ['a fraction', '0.5'],
    ['zero', '0'],
    ['a year and a day', '366'],
  ])('refuses %s rather than starting on a default', (_label, raw) => {
    // The same four checks `readPort` makes. `Number('nope')` is NaN and
    // `NaN < 1` is FALSE, so a bare lower bound would ACCEPT it — after which
    // every session's `expiresAt` is an Invalid Date the TTL index cannot act
    // on, and sessions never expire at all.
    expect(() => loadDashboardConfig(env({ SESSION_TTL_DAYS: raw }))).toThrow(
      /SESSION_TTL_DAYS/,
    );
  });
});

describe('loadDashboardConfig: the public origin', () => {
  it("defaults to this process's own loopback URL", () => {
    // Blank fails CLOSED in `isAllowedOrigin`, which is right for a
    // misconfiguration and wrong for the shipped loopback deployment — every
    // mutation from the real page would be refused before anyone configured
    // anything.
    expect(loadDashboardConfig(env()).publicOrigin).toBe(
      'http://127.0.0.1:7717',
    );
  });

  it('reads the https origin a reverse proxy terminates', () => {
    expect(
      loadDashboardConfig(env({ PUBLIC_ORIGIN: 'https://turret.example' }))
        .publicOrigin,
    ).toBe('https://turret.example');
  });
});

describe('describeDashboardConfig', () => {
  it('names the bind address and what this process may write', () => {
    const line = describeDashboardConfig(loadDashboardConfig(env()));

    expect(line).toContain('bind=127.0.0.1:7717');
    // NO LONGER `mode=read-only`. This process writes `users`, `sessions` and
    // `watchlists` now, and it still never writes a filing — which is the
    // claim the narrowed `FilingReadModel` actually enforces. The startup line
    // is where an operator looks to find out what this can do to their
    // database, so it must not overstate the restriction.
    expect(line).toContain('filings=read-only');
    expect(line).toContain('accounts=read-write');
    expect(line).not.toContain('mode=read-only');
  });

  it('redacts credentials in the mongo URI', () => {
    // This is the one place the configuration is printed, and a password in a
    // log file outlives the process that wrote it.
    const line = describeDashboardConfig(
      loadDashboardConfig(
        env({ MONGO_URI: 'mongodb://user:s3cret@host:27017/turret' }),
      ),
    );

    expect(line).toContain('mongodb://***@host:27017/turret');
    expect(line).not.toContain('s3cret');
  });
});
