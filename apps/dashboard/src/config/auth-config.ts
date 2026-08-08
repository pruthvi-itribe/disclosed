/**
 * Which identity provider is in force, and the Firebase keys behind it.
 *
 * A SIBLING OF `configuration.ts` RATHER THAN MORE OF IT, for the reason that
 * file gives about the ingest reader: one concern, one key list, one spec. It is
 * pure — the environment arrives as an argument — so the whole decision table
 * below is testable without touching `process.env`.
 *
 * ================================================================
 * TWO PROVIDERS, ONE SESSION
 * ================================================================
 *
 * FIREBASE IS IDENTITY ONLY. It answers "who is this person", and it answers it
 * once, at sign-in. What the browser then carries is the SAME opaque, revocable,
 * Mongo-backed session cookie the in-house path has always minted — see
 * `session-token.ts` for why that is not a JWT. Nothing downstream of
 * `POST api/auth/firebase` can tell which provider a session came from, and that
 * is the property that makes this a swap rather than a rewrite.
 *
 * THE IN-HOUSE PASSWORD PATH IS DORMANT, NOT DELETED. `AUTH_MODE=local` brings
 * it back whole: argon2id, the per-account backoff, the enumeration-resistant
 * one-message failure, all of it, untouched. It is what runs when Firebase is
 * not configured, which is what lets this branch boot before the keys arrive and
 * what lets the browser suite register a throwaway user.
 *
 * ================================================================
 * WHY AN UNCONFIGURED FIREBASE MODE IS A STATE AND NOT A CRASH
 * ================================================================
 *
 * `AUTH_MODE=firebase` with no keys does not stop the process. It produces a
 * mode with `firebase: null` and a populated `missing`, which the sign-in page
 * renders as "sign-in is not configured yet" naming the exact variables, and
 * which the token-exchange route answers 503 to.
 *
 * That is not a silent fallback — the opposite. The alternative readings are
 * both worse: throwing at boot means the founder cannot run the branch at all
 * before the Firebase console is set up, and quietly falling back to the local
 * password path would mean an operator who asked for Google sign-in silently got
 * password sign-in instead. "Nothing was configured" is stated, in the one place
 * a person is looking when they find out.
 */

/** The two providers. Nothing else is accepted, and an unknown value throws. */
export const AUTH_MODES = ['firebase', 'local'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** The keys the browser needs to talk to Firebase, and the server to check it. */
export interface FirebaseConfig {
  /**
   * The Firebase project. The ONLY value the server needs: `verifyIdToken`
   * checks the token's `aud` and `iss` against it and fetches Google's public
   * signing certificates over https. No service-account credential is involved,
   * which is why none is read here.
   */
  readonly projectId: string;
  /**
   * The Web API key. NOT A SECRET, and saying so matters because it is about to
   * be printed into an HTML page. Firebase web keys identify a project to
   * Google's endpoints; they authorise nothing on their own. What actually
   * guards the project is the authorised-domain list in the Firebase console and
   * the security rules — see the sign-in page's header.
   */
  readonly webApiKey: string;
  /** Where the sign-in popup goes. Firebase's own convention unless overridden. */
  readonly authDomain: string;
}

/** What the rest of the application asks about identity. */
export interface AuthConfig {
  readonly mode: AuthMode;
  /**
   * The keys, or null when `mode` is `local` — or when it is `firebase` and the
   * keys have not arrived. A non-null value here is the ONE test for "may this
   * process verify a Firebase token", so a partially configured project cannot
   * half-work.
   */
  readonly firebase: FirebaseConfig | null;
  /**
   * The environment keys `firebase` is waiting on. Empty unless somebody asked
   * for Firebase and did not finish configuring it; the sign-in page prints
   * these verbatim, because "auth is broken" and "FIREBASE_WEB_API_KEY is
   * unset" are different facts and only one of them can be acted on.
   */
  readonly missing: readonly string[];
}

/** The two keys a Firebase project cannot be identified without. */
export const FIREBASE_REQUIRED_KEYS = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_WEB_API_KEY',
] as const;

/**
 * Reads one key, treating a blank assignment as unset.
 *
 * The same rule `readString` in `configuration.ts` applies, and for the same
 * reason: `FIREBASE_PROJECT_ID=` is how a .env file spells "not set", and
 * reading it as `''` produces a token verifier configured with an empty audience
 * — which rejects every token with a message about the claim rather than about
 * the configuration.
 */
const read = (key: string, env: NodeJS.ProcessEnv): string | null => {
  const raw = env[key];
  return raw === undefined || raw.trim() === '' ? null : raw.trim();
};

/**
 * Which keys of a Firebase project are absent. Empty means fully configured.
 *
 * Returned as a list rather than a boolean so the sign-in page can name what is
 * missing. A page that says "not configured" without saying what to set sends
 * the reader to the source.
 */
export const missingFirebaseKeys = (
  env: NodeJS.ProcessEnv,
): readonly string[] =>
  FIREBASE_REQUIRED_KEYS.filter((key) => read(key, env) === null);

/**
 * The Firebase keys, or null when any required one is absent.
 *
 * `authDomain` is DERIVED rather than required. `<project>.firebaseapp.com` is
 * what the Firebase console provisions for every project, so asking the founder
 * for it would be asking them to retype a value we can compute — and a third
 * variable is a third thing to get wrong. `FIREBASE_AUTH_DOMAIN` overrides it,
 * because a project served from a custom domain has a different one and the
 * popup goes to the wrong place without it.
 */
export const readFirebaseConfig = (
  env: NodeJS.ProcessEnv,
): FirebaseConfig | null => {
  const projectId = read('FIREBASE_PROJECT_ID', env);
  const webApiKey = read('FIREBASE_WEB_API_KEY', env);
  if (projectId === null || webApiKey === null) return null;

  return {
    projectId,
    webApiKey,
    authDomain:
      read('FIREBASE_AUTH_DOMAIN', env) ?? `${projectId}.firebaseapp.com`,
  };
};

/**
 * Which provider is in force.
 *
 * THE DEFAULT FOLLOWS THE KEYS, which is the whole of the founder's decision:
 * Firebase when a project is configured, the in-house path otherwise. So a host
 * with the keys set needs no `AUTH_MODE` at all, and a developer with none gets
 * a working sign-in without asking for one.
 *
 * An explicit `AUTH_MODE` wins in both directions — `local` on a host that HAS
 * Firebase keys is how an operator falls back without deleting them, and it is
 * how the browser suite runs. An unrecognised value stops the process naming the
 * key and both legal values, rather than being read as one of them.
 */
export const readAuthMode = (env: NodeJS.ProcessEnv): AuthMode => {
  const raw = read('AUTH_MODE', env);
  if (raw === null) {
    return readFirebaseConfig(env) === null ? 'local' : 'firebase';
  }

  const wanted = raw.toLowerCase();
  if ((AUTH_MODES as readonly string[]).includes(wanted)) {
    return wanted as AuthMode;
  }

  throw new Error(
    `AUTH_MODE must be one of ${AUTH_MODES.join(', ')}, but was "${raw}". ` +
      'Leave it unset to follow the Firebase keys: firebase when ' +
      `${FIREBASE_REQUIRED_KEYS.join(' and ')} are set, local otherwise.`,
  );
};

/**
 * The whole identity configuration, or a throw naming the offending key.
 *
 * The `local` branch discards any Firebase keys that happen to be present. That
 * is not tidiness: `firebase !== null` is the single test for "this process may
 * verify a Firebase token", and leaving the keys populated in local mode would
 * make the exchange route live on a host whose operator explicitly turned it
 * off.
 */
export const loadAuthConfig = (
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig => {
  const mode = readAuthMode(env);

  if (mode === 'local') {
    return { mode, firebase: null, missing: [] };
  }

  return {
    mode,
    firebase: readFirebaseConfig(env),
    missing: missingFirebaseKeys(env),
  };
};

/** One line for the startup log, saying which way in is open and whether it works. */
export const describeAuthConfig = (config: AuthConfig): string => {
  if (config.mode === 'local') return 'auth=local(email+password)';
  if (config.firebase === null) {
    return `auth=firebase UNCONFIGURED(missing ${config.missing.join(',')})`;
  }
  return `auth=firebase project=${config.firebase.projectId}`;
};
