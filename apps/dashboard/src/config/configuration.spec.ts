import {
  DASHBOARD_DEFAULTS,
  DASHBOARD_HOST,
  MAX_PORT,
  MIN_PORT,
  describeDashboardConfig,
  loadDashboardConfig,
  readAdminEnabled,
  readPort,
  readString,
  readTrustProxy,
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
      // A laptop: no NODE_ENV and a loopback origin. See `readAdminEnabled`.
      adminEnabled: true,
      // Nothing is in front of this process, so a forwarded header is a claim
      // rather than a fact. Express's own default, restated.
      trustProxy: false,
      // Nothing calls this API cross-origin by default. The React client is
      // served same-origin by the Caddy sidecar and never needs an entry here.
      corsAllowedOrigins: [],
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
      adminEnabled: true,
      trustProxy: false,
      corsAllowedOrigins: [],
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

describe('readTrustProxy', () => {
  it('is off when the key is absent, which is express’s own default', () => {
    // The shipped loopback deployment reads no forwarded header at all: with
    // nothing between the browser and this process, `X-Forwarded-Proto: https`
    // is a sentence the caller wrote rather than a fact a proxy established.
    expect(readTrustProxy(env())).toBe(false);
  });

  it.each([[''], ['   '], ['\t']])(
    'treats a blank assignment (%p) as not set',
    (raw) => {
      expect(readTrustProxy(env({ TRUST_PROXY: raw }))).toBe(false);
    },
  );

  it('reads a hop count as a number, not as an address', () => {
    // Express parses a STRING as a list of addresses, so '2' passed through
    // verbatim throws `invalid IP address: 2` from inside `app.set`.
    expect(readTrustProxy(env({ TRUST_PROXY: '2' }))).toBe(2);
  });

  it.each([
    ['0', 0],
    ['1', 1],
    ['10', 10],
  ])('reads hop count %p', (raw, expected) => {
    expect(readTrustProxy(env({ TRUST_PROXY: raw }))).toBe(expected);
  });

  it('passes an address list through for express to parse', () => {
    // Express owns the syntax of this form — presets, subnets and bare
    // addresses — and throws at boot on anything it cannot read.
    expect(readTrustProxy(env({ TRUST_PROXY: 'loopback,10.0.0.0/8' }))).toBe(
      'loopback,10.0.0.0/8',
    );
  });

  it('trims the surrounding whitespace of either form', () => {
    expect(readTrustProxy(env({ TRUST_PROXY: '  2  ' }))).toBe(2);
    expect(readTrustProxy(env({ TRUST_PROXY: ' loopback ' }))).toBe('loopback');
  });

  it('accepts an explicit false, so a host can say off out loud', () => {
    expect(readTrustProxy(env({ TRUST_PROXY: 'false' }))).toBe(false);
    expect(readTrustProxy(env({ TRUST_PROXY: 'FALSE' }))).toBe(false);
  });

  it.each([['true'], ['TRUE'], ['True']])(
    'refuses %p, the one value that hands the identity to the client',
    (raw) => {
      // `trust proxy: true` walks X-Forwarded-For to its LEFTMOST entry, which
      // is the one the client wrote. The rate limiter would then count an
      // address the attacker picks, and the `Secure` decision would be made by
      // whoever asked for it.
      expect(() => readTrustProxy(env({ TRUST_PROXY: raw }))).toThrow(
        /TRUST_PROXY must not be "true"/,
      );
    },
  );

  it('names the working forms in the refusal', () => {
    expect(() => readTrustProxy(env({ TRUST_PROXY: 'true' }))).toThrow(
      /TRUST_PROXY=2/,
    );
  });

  it('is carried onto the config the process boots with', () => {
    expect(loadDashboardConfig(env()).trustProxy).toBe(false);
    expect(loadDashboardConfig(env({ TRUST_PROXY: '2' })).trustProxy).toBe(2);
  });
});

describe('describeDashboardConfig', () => {
  it('says what the forwarded headers are worth', () => {
    // Both things that key off it — which address the rate limiter counts, and
    // whether the cookie carries `Secure` — are invisible until somebody is
    // already locked out or already signed out.
    expect(describeDashboardConfig(loadDashboardConfig(env()))).toContain(
      'proxy=off',
    );
    expect(
      describeDashboardConfig(loadDashboardConfig(env({ TRUST_PROXY: '2' }))),
    ).toContain('proxy=2');
  });

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

  it('prints neither the credentials nor the host of a remote mongo', () => {
    // This is the one place the configuration is printed. The password was
    // always redacted; the HOST no longer survives either, because naming the
    // cluster names the target and these logs are destined to be shipped off
    // the node. The database name is what an operator actually reads this line
    // for. See `libs/common/src/mongo-target.ts`.
    const line = describeDashboardConfig(
      loadDashboardConfig(
        env({ MONGO_URI: 'mongodb://user:s3cret@some-cluster.example/turret' }),
      ),
    );

    expect(line).toContain('mongodb://***@<host-withheld>/turret');
    expect(line).not.toContain('s3cret');
    expect(line).not.toContain('some-cluster');
  });

  // Loopback is printed in full on purpose: it gives an attacker nothing, and
  // on a laptop the port is the whole question.
  it('still prints a loopback mongo in full, port included', () => {
    const line = describeDashboardConfig(
      loadDashboardConfig(
        env({ MONGO_URI: 'mongodb://localhost:27117/turret' }),
      ),
    );

    expect(line).toContain('mongodb://localhost:27117/turret');
  });
});

describe('readAdminEnabled — where the operator panel exists', () => {
  const LOOPBACK = 'http://127.0.0.1:7717';
  const PUBLIC = 'https://disclosed.live';

  it('is on for a laptop: no NODE_ENV, loopback origin', () => {
    // The shipped local run, which needs no configuration at all.
    expect(readAdminEnabled(env(), LOOPBACK)).toBe(true);
    expect(readAdminEnabled(env({ NODE_ENV: 'development' }), LOOPBACK)).toBe(
      true,
    );
    expect(readAdminEnabled(env({ NODE_ENV: 'test' }), LOOPBACK)).toBe(true);
  });

  it('is off in production, whatever the origin says', () => {
    expect(readAdminEnabled(env({ NODE_ENV: 'production' }), LOOPBACK)).toBe(
      false,
    );
    expect(readAdminEnabled(env({ NODE_ENV: 'production' }), PUBLIC)).toBe(
      false,
    );
  });

  it('is off behind a public origin, even with NODE_ENV unset', () => {
    // THE SIGNAL THAT CANNOT BE FORGOTTEN. `NODE_ENV` is a convention nothing
    // enforces, so a host started without it looks exactly like a laptop.
    // `PUBLIC_ORIGIN` is not optional behind the proxy — leave it at the
    // loopback default and every mutation from the real page is refused by
    // `origin-guard.ts` — so a host serving the internet has necessarily set it.
    expect(readAdminEnabled(env(), PUBLIC)).toBe(false);
    expect(readAdminEnabled(env(), 'https://app.example.com:8443')).toBe(false);
  });

  it('counts localhost and ::1 as this machine, and nothing else', () => {
    expect(readAdminEnabled(env(), 'http://localhost:7717')).toBe(true);
    expect(readAdminEnabled(env(), 'http://[::1]:7717')).toBe(true);
    // Loopback by RFC and not a value this application is ever configured
    // with. A gate recognises the shipped values and refuses the rest.
    expect(readAdminEnabled(env(), 'http://127.13.9.2:7717')).toBe(false);
  });

  it('fails CLOSED on an origin it cannot parse', () => {
    // "Nothing was found" and "nothing was looked for" must not read the same
    // — and for a gate the safe reading of "unreadable" is off. The startup
    // line says `admin=off`, which is where an operator who expected it looks.
    expect(readAdminEnabled(env(), 'not a url')).toBe(false);
    expect(readAdminEnabled(env(), '')).toBe(false);
  });

  it('lets ADMIN_ENABLED win in BOTH directions', () => {
    // An explicit setting is an operator's decision and outranks the
    // inference, exactly as `AUTH_MODE` does.
    expect(
      readAdminEnabled(
        env({ ADMIN_ENABLED: 'true', NODE_ENV: 'production' }),
        PUBLIC,
      ),
    ).toBe(true);
    expect(readAdminEnabled(env({ ADMIN_ENABLED: 'false' }), LOOPBACK)).toBe(
      false,
    );
    // Case and padding are an operator typing, not a different answer.
    expect(readAdminEnabled(env({ ADMIN_ENABLED: ' TRUE ' }), PUBLIC)).toBe(
      true,
    );
  });

  it('treats a blank assignment as unset, like every other key here', () => {
    // `ADMIN_ENABLED=` is how a .env file spells "not set".
    expect(readAdminEnabled(env({ ADMIN_ENABLED: '' }), PUBLIC)).toBe(false);
    expect(readAdminEnabled(env({ ADMIN_ENABLED: '  ' }), LOOPBACK)).toBe(true);
  });

  it('refuses a value it cannot read, naming the key', () => {
    // Not guessed at. `ADMIN_ENABLED=yes` read as false silently removes a
    // surface, and read as true ships it — so it stops the process instead.
    expect(() =>
      readAdminEnabled(env({ ADMIN_ENABLED: 'yes' }), LOOPBACK),
    ).toThrow(/ADMIN_ENABLED must be "true" or "false"/);
    expect(() =>
      readAdminEnabled(env({ ADMIN_ENABLED: '1' }), LOOPBACK),
    ).toThrow(/ADMIN_ENABLED/);
  });

  it('says which way it went in the startup line', () => {
    expect(
      describeDashboardConfig(
        loadDashboardConfig(env({ ADMIN_ENABLED: 'false' })),
      ),
    ).toContain('admin=off');
    expect(describeDashboardConfig(loadDashboardConfig(env()))).toContain(
      'admin=on',
    );
  });
});

describe('CORS_ALLOWED_ORIGINS', () => {
  it('is empty when unset, which allows nothing', () => {
    expect(loadDashboardConfig(env()).corsAllowedOrigins).toEqual([]);
  });

  // FAILS CLOSED, the posture isAllowedOrigin already takes: a blank setting
  // that parsed to [''] would match an empty Origin header and allow it.
  it('is empty when blank, rather than holding an empty entry', () => {
    expect(
      loadDashboardConfig(env({ CORS_ALLOWED_ORIGINS: '  ' }))
        .corsAllowedOrigins,
    ).toEqual([]);
  });

  it('splits on commas and trims', () => {
    expect(
      loadDashboardConfig(
        env({ CORS_ALLOWED_ORIGINS: 'https://a.example, https://b.example' }),
      ).corsAllowedOrigins,
    ).toEqual(['https://a.example', 'https://b.example']);
  });

  // A wildcard is refused rather than honoured: `*` and credentials are
  // mutually exclusive per the CORS specification, so an operator who sets it
  // gets a server that will not start instead of a session that never arrives.
  it('refuses a wildcard by stopping the process', () => {
    expect(() =>
      loadDashboardConfig(env({ CORS_ALLOWED_ORIGINS: '*' })),
    ).toThrow(/CORS_ALLOWED_ORIGINS/);
  });

  // Printed because an empty list is both the shipped production value and the
  // shape of a dev server whose origin was never added — an operator debugging
  // a blocked preflight reads this line first.
  it('counts the origins in the startup line', () => {
    expect(describeDashboardConfig(loadDashboardConfig(env()))).toContain(
      'cors=0',
    );
    expect(
      describeDashboardConfig(
        loadDashboardConfig(env({ CORS_ALLOWED_ORIGINS: 'https://a.example' })),
      ),
    ).toContain('cors=1');
  });
});
