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
