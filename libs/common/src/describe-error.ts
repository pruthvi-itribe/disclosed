/**
 * Turning a thrown value into text, without throwing.
 *
 * Every caller of everything in this file is a catch block, so nothing here may
 * raise. That is not a style preference: a describer that throws does so from
 * inside the handler whose whole job is to contain the failure, and the
 * original error is then replaced by a TypeError that escapes to whatever was
 * least prepared for it — a poll loop, a page mapper, a process bootstrap.
 *
 * This module exists because four files had each written their own version and
 * one of them had it wrong. `nse.adapter.ts` called `String(error)` unguarded
 * inside the catch that stops one bad record killing a page, so a single
 * null-prototype throw discarded the whole 20-record response.
 *
 * It lives in a library that depends on nothing so that `libs/filings` and
 * `libs/notify` can both use it without either depending on the other, and so
 * that neither has to reach into `apps/ingest`.
 */

/** Shown when a value cannot be converted to text by any means at all. */
export const UNPRINTABLE = '[unprintable]';

/**
 * Coerces to text without throwing.
 *
 * `String(value)` is NOT total. An object with a null prototype has neither
 * `Symbol.toPrimitive` nor `toString`, so it raises "Cannot convert object to
 * primitive value" — and `Object.create(null)` is exactly the shape a stripped
 * JSON parse, a `Object.setPrototypeOf` guard or a hostile payload produces.
 */
export const safeText = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return UNPRINTABLE;
  }
};

/**
 * Serialises a value for a log line without throwing on a circular structure.
 *
 * `JSON.stringify` returns `undefined` for `undefined` and a function, and
 * throws on a cycle or a BigInt. Both are handled: any description at all beats
 * losing the log line.
 */
export const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? safeText(value);
  } catch {
    return safeText(value);
  }
};

/**
 * Describes a thrown value for a log line, whatever shape it arrives in.
 *
 * `(error as Error).message` is unsound: a rejection can carry a string, a bare
 * object or nothing at all, and reading `.message` off `null` throws. The other
 * shapes render as the literal text "undefined", which tells an operator
 * nothing about what actually happened.
 *
 * The name is included because `Error: connect ECONNREFUSED` and
 * `TypeError: connect ECONNREFUSED` mean completely different things — one is
 * the network, the other is us.
 *
 * Two callers deliberately do NOT use this and wrap `safeText` themselves:
 * `NseAdapter`, which bounds the text through `safeEcho` because the value is
 * exchange-supplied, and `TelegramService`, which serialises a non-Error
 * rejection because Telegram's client rejects with plain API objects whose
 * contents are the whole diagnostic. Both message shapes are pinned by their
 * own tests; collapsing them into this one would lose information at the exact
 * moment it is needed.
 */
export const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : safeText(error);

/**
 * The stack, when there is one. Passed as the second argument to a Nest logger,
 * which renders `undefined` as "no stack" rather than as a broken line.
 */
export const stackOf = (error: unknown): string | undefined =>
  error instanceof Error ? error.stack : undefined;
