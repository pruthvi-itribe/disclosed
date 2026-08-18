import type { ApiEnvelope } from './api-get';

/**
 * A write's failure, carrying everything a caller needs to branch on the
 * CODE rather than the prose — a copy edit must not be a behaviour change.
 * The message shown to the reader is the server's own sentence
 * (WATCHLIST_FULL, UNKNOWN_SYMBOL, INVALID_CREDENTIALS), never a client-side
 * rewording.
 */
export class ApiSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly meta: unknown,
  ) {
    super(message);
    this.name = 'ApiSendError';
  }
}

export type SendMethod = 'GET' | 'POST' | 'DELETE';

/**
 * postJson's port — a deliberate SIBLING of apiGet rather than a flag on it:
 * a failed read is "refresh failed", a failed write carries a sentence the
 * reader is waiting for.
 *
 * Two rules that bite:
 * - `Content-Type: application/json` rides EVERY non-GET, including the
 *   bodyless ones (watch add, watch remove, sign out). The 415 guard is a
 *   CSRF control — an HTML form cannot emit that type — and making the
 *   header conditional on a body is what would 415 the live product.
 * - The 'GET' method exists for the Watching feed alone: no Content-Type,
 *   and deliberately NO ETag store and no 304 branch, so that renderer
 *   always receives a real body.
 *
 * Parameters ride the path or the query string, never a body, except on
 * `/api/auth/*` — json parsing is mounted on that prefix alone. A password
 * cannot travel in a query string; a ticker in an access log is public data.
 */
export const createApiSend =
  (fetcher: typeof fetch = fetch) =>
  async <T = unknown>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ): Promise<ApiEnvelope<T>> => {
    const headers: Record<string, string> = {};
    if (method !== 'GET') headers['Content-Type'] = 'application/json';

    const response = await fetcher(path, {
      method,
      // The whole session is a cookie the page cannot read; a future edit
      // to 'omit' would sign everybody out silently.
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let parsed: ApiEnvelope<T> | null = null;
    try {
      parsed = (await response.json()) as ApiEnvelope<T>;
    } catch {
      parsed = null;
    }

    if (response.ok && parsed !== null && parsed.success === true) {
      return parsed;
    }

    throw new ApiSendError(
      parsed?.error?.message ?? `That did not work (${response.status}).`,
      response.status,
      parsed?.error?.code ?? '',
      parsed?.meta ?? null,
    );
  };
