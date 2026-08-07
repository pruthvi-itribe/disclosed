/**
 * The one response shape every JSON endpoint returns.
 *
 * A consistent envelope is worth the four extra keys because the consumer is a
 * hand-written page in `ui/`: without it, each endpoint's client code has to
 * know whether this particular route returns a bare array, a bare object or a
 * wrapper, and every new endpoint is a new special case in the browser.
 *
 * `error` is always present and always `null` on success, and `meta` is always
 * present too — `null` where a route has no metadata rather than `undefined`,
 * because `JSON.stringify` DROPS an undefined value and the key would simply
 * vanish from the wire. A field that is sometimes absent is a field the client
 * forgets to check, and then renders `undefined` as though it were data.
 */
export interface ApiEnvelope<TData, TMeta = null> {
  readonly success: true;
  readonly data: TData;
  readonly error: null;
  readonly meta: TMeta;
}

/** Wraps a payload with no metadata of its own. */
export const ok = <TData>(data: TData): ApiEnvelope<TData> => ({
  success: true,
  data,
  error: null,
  meta: null,
});

/** Wraps a payload alongside its metadata — pagination counts, mostly. */
export const okWith = <TData, TMeta>(
  data: TData,
  meta: TMeta,
): ApiEnvelope<TData, TMeta> => ({
  success: true,
  data,
  error: null,
  meta,
});

/**
 * The failure variant, the same four keys the other way round.
 *
 * A STABLE `code` BESIDE A HUMAN `message`, and both are needed. The page shows
 * the message — `WATCHLIST_FULL`, `UNKNOWN_SYMBOL` and `INVALID_CREDENTIALS`
 * are all things a reader has to be told — and branches on the code, because
 * branching on prose is how a copy edit becomes a behaviour change.
 *
 * NOTHING FROM AN EXCEPTION EVER REACHES THIS. Mongo errors, stack traces and
 * provider bodies are logged server-side; what is serialised is a value this
 * codebase wrote. The auth codes are deliberately LESS informative than a
 * developer would like — see `auth.service.ts` on enumeration.
 */
export interface ApiFailure {
  readonly success: false;
  readonly data: null;
  readonly error: { readonly code: string; readonly message: string };
  readonly meta: unknown;
}

/** Wraps a refusal, with optional metadata — `{used, cap}` on a full watchlist. */
export const failure = (
  code: string,
  message: string,
  meta: unknown = null,
): ApiFailure => ({
  success: false,
  data: null,
  error: { code, message },
  meta,
});
