/**
 * Email as identity: one normalisation, and a deliberately conservative shape
 * check.
 *
 * NORMALISED TO LOWERCASE AND TRIMMED, AND THAT IS ALL. Gmail's dot-stripping
 * and `+tag` removal are not done, and the omission is the decision rather than
 * an oversight: they differ per provider, they surprise people who deliberately
 * use a tagged address, and getting one wrong MERGES TWO PEOPLE'S ACCOUNTS —
 * which is not a bug you can back out of once both have signed in.
 *
 * The unique index is on the normalised form, so this function is what decides
 * whether two registrations are the same person.
 */

/**
 * The longest address accepted, from RFC 5321's 254-character path limit.
 *
 * A BOUND PLUS A PATTERN, NOT AN RFC 5322 PARSER. The full grammar admits
 * comments, quoted strings and nested folding, and hand-written versions of it
 * are a well-documented source of catastrophic backtracking — on a value that
 * arrives in an unauthenticated POST body. Everything below is linear.
 */
export const MAX_EMAIL_LENGTH = 254;

/**
 * The stored form: lowercased and trimmed.
 *
 * Idempotent, because it is applied both at registration and at every login,
 * and a normalisation that moved on a second application would let a user
 * register an address they can never sign in with.
 */
export const normaliseEmail = (raw: string): string =>
  typeof raw === 'string' ? raw.trim().toLowerCase() : '';

/**
 * A local part, an `@`, and a dotted domain. No whitespace anywhere.
 *
 * The character classes are NEGATIVE (`[^\s@]`) rather than an allowlist of
 * what an address may contain, because the real-world local part legitimately
 * holds apostrophes, plus signs and dots, and an allowlist written from memory
 * rejects somebody's actual address. What is excluded is what breaks something
 * downstream: whitespace of any kind, which covers the `\n` a header-injection
 * attempt carries, and a second `@`.
 */
const SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Whether the normalised form could be an address. */
export const isPlausibleEmail = (raw: string): boolean => {
  const email = normaliseEmail(raw);
  if (email === '' || email.length > MAX_EMAIL_LENGTH) return false;
  return SHAPE.test(email);
};
