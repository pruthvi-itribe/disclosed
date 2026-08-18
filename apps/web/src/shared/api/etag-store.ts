/**
 * The last validator seen for each path, in memory.
 *
 * IN MEMORY ONLY, and that is a contract rather than a convenience. `/api/*`
 * is served `Cache-Control: private, no-store` because an authenticated
 * response may never be stored or replayed; a validator is a fingerprint of
 * one, and putting it in `localStorage` would outlive the session it belongs
 * to.
 */
export interface EtagStore {
  readonly remember: (path: string, validator: string | null) => void;
  readonly validatorFor: (path: string) => string | null;
}

/** A weak validator, which Express attaches to every response by default. */
const WEAK = /^W\//;

export const createEtagStore = (): EtagStore => {
  const byPath = new Map<string, string>();

  return {
    remember: (path, validator) => {
      // ONLY STRONG VALIDATORS. Express tags everything `W/"..."`, so keeping
      // those would send `If-None-Match` on every route and start 304-ing
      // views that have no branch for it.
      if (validator === null || WEAK.test(validator)) return;
      byPath.set(path, validator);
    },
    validatorFor: (path) => byPath.get(path) ?? null,
  };
};
