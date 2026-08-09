/**
 * The two injection tokens the identity switch needs.
 *
 * String tokens rather than classes, because both provide a value whose type is
 * a UNION with null — the resolved configuration, and a Firebase sign-in service
 * that does not exist in local mode. Nest resolves a class token by constructing
 * the class, which is exactly what must not happen when the answer is "there is
 * no such thing here".
 *
 * Their own file so `auth.controller.ts` and `dashboard.module.ts` can both
 * import them without either importing the other.
 */

/** The resolved `AuthConfig`. Tells a route which provider is in force. */
export const AUTH_CONFIG = 'AUTH_CONFIG';

/**
 * A `FirebaseSignInService`, or null in local mode and when the keys are absent.
 *
 * NULL IS THE CONFIGURED STATE, not a failure to wire. The exchange route reads
 * it as "this server cannot verify a Firebase token" and answers 503 naming the
 * missing variables, which is the honest answer on a host whose founder has not
 * created the project yet.
 */
export const FIREBASE_SIGN_IN = 'FIREBASE_SIGN_IN';

/**
 * Whether the operator panel is built into this process.
 *
 * A boolean behind a string token for the same reason `AUTH_CONFIG` is one: it
 * is a resolved CONFIGURATION value, not a class Nest could construct. Read by
 * `dashboard.controller.ts` to decide what the page contains and which routes
 * exist; the rule that produces it is in `config/configuration.ts`.
 */
export const ADMIN_ENABLED = 'ADMIN_ENABLED';
