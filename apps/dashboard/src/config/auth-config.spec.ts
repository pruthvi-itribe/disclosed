import {
  describeAuthConfig,
  loadAuthConfig,
  missingFirebaseKeys,
  readAuthMode,
  readFirebaseConfig,
} from './auth-config';

/**
 * The decision table, exhaustively, because getting it wrong has exactly two
 * failure modes and both are silent: an operator who asked for Google sign-in
 * quietly getting password sign-in, and a host with keys present serving a
 * provider its operator switched off.
 */

const KEYS = {
  FIREBASE_PROJECT_ID: 'disclosed-live',
  FIREBASE_WEB_API_KEY: 'AIza-not-a-secret',
};

describe('readFirebaseConfig', () => {
  it('reads a fully configured project', () => {
    expect(readFirebaseConfig({ ...KEYS })).toEqual({
      projectId: 'disclosed-live',
      webApiKey: 'AIza-not-a-secret',
      // DERIVED, not required. Asking the founder to retype what the console
      // provisions is a third variable to get wrong.
      authDomain: 'disclosed-live.firebaseapp.com',
    });
  });

  it('lets a custom domain override the derived one', () => {
    expect(
      readFirebaseConfig({
        ...KEYS,
        FIREBASE_AUTH_DOMAIN: 'auth.disclosed.live',
      })?.authDomain,
    ).toBe('auth.disclosed.live');
  });

  it('is null when either required key is absent', () => {
    expect(readFirebaseConfig({})).toBeNull();
    expect(
      readFirebaseConfig({ FIREBASE_PROJECT_ID: KEYS.FIREBASE_PROJECT_ID }),
    ).toBeNull();
    expect(
      readFirebaseConfig({ FIREBASE_WEB_API_KEY: KEYS.FIREBASE_WEB_API_KEY }),
    ).toBeNull();
  });

  it('reads a blank assignment as unset, not as an empty project', () => {
    // `FIREBASE_PROJECT_ID=` is how a .env file spells "not set". Read as '',
    // the verifier is configured with an empty audience and rejects every token
    // with a message about the claim rather than about the configuration.
    expect(
      readFirebaseConfig({ ...KEYS, FIREBASE_PROJECT_ID: '   ' }),
    ).toBeNull();
  });

  it('names exactly the keys that are missing', () => {
    expect(missingFirebaseKeys({})).toEqual([
      'FIREBASE_PROJECT_ID',
      'FIREBASE_WEB_API_KEY',
    ]);
    expect(missingFirebaseKeys(KEYS)).toEqual([]);
  });
});

describe('readAuthMode', () => {
  it('follows the keys when AUTH_MODE is unset', () => {
    // The founder's decision, in two lines: Firebase when a project is
    // configured, the in-house path otherwise.
    expect(readAuthMode({})).toBe('local');
    expect(readAuthMode({ ...KEYS })).toBe('firebase');
  });

  it('lets an explicit mode win in both directions', () => {
    // `local` on a host that HAS keys is how an operator falls back without
    // deleting them, and how the browser suite runs.
    expect(readAuthMode({ ...KEYS, AUTH_MODE: 'local' })).toBe('local');
    expect(readAuthMode({ AUTH_MODE: 'firebase' })).toBe('firebase');
  });

  it('accepts the mode in any case, and a blank one as unset', () => {
    expect(readAuthMode({ AUTH_MODE: 'LOCAL' })).toBe('local');
    expect(readAuthMode({ ...KEYS, AUTH_MODE: '  ' })).toBe('firebase');
  });

  it('stops the process on a value it does not recognise', () => {
    // Never read as one of the two. A typo silently meaning "local" on a host
    // configured for Firebase is the exact substitution this refuses.
    expect(() => readAuthMode({ AUTH_MODE: 'google' })).toThrow(/AUTH_MODE/);
    expect(() => readAuthMode({ AUTH_MODE: 'firebse' })).toThrow(
      /firebase, local/,
    );
  });
});

describe('loadAuthConfig', () => {
  it('carries the keys in firebase mode', () => {
    const config = loadAuthConfig({ ...KEYS });

    expect(config.mode).toBe('firebase');
    expect(config.firebase?.projectId).toBe('disclosed-live');
    expect(config.missing).toEqual([]);
  });

  it('discards the keys in local mode', () => {
    // NOT TIDINESS. `firebase !== null` is the single test for "this process
    // may verify a Firebase token"; leaving the keys populated would keep the
    // exchange route live on a host whose operator turned it off.
    const config = loadAuthConfig({ ...KEYS, AUTH_MODE: 'local' });

    expect(config.mode).toBe('local');
    expect(config.firebase).toBeNull();
  });

  it('is a state rather than a crash when firebase is asked for and unconfigured', () => {
    // The founder can run the branch before the console is set up. The page
    // says which variables are missing; the exchange route answers 503.
    const config = loadAuthConfig({ AUTH_MODE: 'firebase' });

    expect(config.mode).toBe('firebase');
    expect(config.firebase).toBeNull();
    expect(config.missing).toEqual([
      'FIREBASE_PROJECT_ID',
      'FIREBASE_WEB_API_KEY',
    ]);
  });

  it('reports a half-configured project as unconfigured, naming the gap', () => {
    const config = loadAuthConfig({
      AUTH_MODE: 'firebase',
      FIREBASE_PROJECT_ID: 'disclosed-live',
    });

    expect(config.firebase).toBeNull();
    expect(config.missing).toEqual(['FIREBASE_WEB_API_KEY']);
  });
});

describe('describeAuthConfig', () => {
  it('says which way in is open, and whether it works', () => {
    expect(describeAuthConfig(loadAuthConfig({}))).toBe(
      'auth=local(email+password)',
    );
    expect(describeAuthConfig(loadAuthConfig({ ...KEYS }))).toBe(
      'auth=firebase project=disclosed-live',
    );
    // LOUD IN THE LOG, because a host in this state serves a sign-in page
    // nobody can sign in through, and the startup line is where an operator
    // looks first.
    expect(describeAuthConfig(loadAuthConfig({ AUTH_MODE: 'firebase' }))).toBe(
      'auth=firebase UNCONFIGURED(missing FIREBASE_PROJECT_ID,FIREBASE_WEB_API_KEY)',
    );
  });

  // NO SECRET IN THE LINE. The web API key is not one, but the startup log is
  // the one place configuration is printed and the habit is what matters.
  it('prints no key material', () => {
    expect(describeAuthConfig(loadAuthConfig({ ...KEYS }))).not.toContain(
      KEYS.FIREBASE_WEB_API_KEY,
    );
  });
});
