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

describe('describeDashboardConfig', () => {
  it('names the bind address and the mode', () => {
    const line = describeDashboardConfig(loadDashboardConfig(env()));

    expect(line).toContain('bind=127.0.0.1:7717');
    expect(line).toContain('mode=read-only');
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
