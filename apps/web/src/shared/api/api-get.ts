import type { EtagStore } from './etag-store';

/** The envelope every route answers with. Errors carry a machine-readable code. */
export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly meta: unknown;
}

export type ApiResult<T> =
  | { readonly status: 'ok'; readonly body: ApiEnvelope<T> }
  | { readonly status: 'unchanged' }
  | { readonly status: 'stale' };

/**
 * The session ended under an open tab.
 *
 * Its own type so a caller can branch on it: every read is behind the session,
 * and a 401 answered with a red banner reappearing every four seconds reads as
 * an outage and tells the reader nothing they can act on.
 */
export class SessionEndedError extends Error {
  constructor() {
    super('the session ended');
    this.name = 'SessionEndedError';
  }
}

/** Injected so tests need no network and no mock server. */
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export const createApiGet =
  (store: EtagStore, fetcher: Fetcher = fetch) =>
  async <T>(path: string, current: () => boolean = () => true): Promise<ApiResult<T>> => {
    const validator = store.validatorFor(path);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (validator !== null) headers['If-None-Match'] = validator;

    const response = await fetcher(path, {
      // The whole session is this cookie, and it is HttpOnly so the page
      // cannot read it. A future edit to 'omit' would sign everybody out
      // silently.
      credentials: 'include',
      headers,
    });

    // A SUPERSEDED RESPONSE IS DISCARDED WHOLE, validator included. Remembering
    // it would let the next request revalidate against a body this client
    // never rendered.
    if (!current()) return { status: 'stale' };

    // BEFORE THE `ok` CHECK, because `res.ok` is false for 304.
    if (response.status === 304) return { status: 'unchanged' };

    if (response.status === 401) throw new SessionEndedError();

    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}`);
    }

    store.remember(path, response.headers.get('ETag'));
    return { status: 'ok', body: (await response.json()) as ApiEnvelope<T> };
  };
