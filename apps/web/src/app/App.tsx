import { useEffect, useState } from 'react';
import { SessionEndedError, type ApiResult } from '../shared/api/api-get';

interface Summary {
  readonly totalFilings: number;
}

export interface AppProps {
  /** Injected, so a test needs no network. */
  readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
  readonly onSessionEnded: () => void;
}

/**
 * The shell. It proves the wiring and draws no product surface.
 *
 * Plan 2 replaces the body with the feed; what must survive that is the
 * shape here — a component that is a function of its props, fetching through
 * an injected `apiGet` rather than reaching for `fetch` itself.
 */
export function App({ apiGet, onSessionEnded }: AppProps): JSX.Element {
  const [total, setTotal] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let current = true;

    apiGet<Summary>('/api/summary')
      .then((result) => {
        if (!current || result.status !== 'ok') return;
        setTotal(result.body.data.totalFilings);
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof SessionEndedError) {
          onSessionEnded();
          return;
        }
        setFailure(error instanceof Error ? error.message : String(error));
      });

    return () => {
      current = false;
    };
  }, [apiGet, onSessionEnded]);

  if (failure !== null) return <p role="alert">Could not load: {failure}</p>;
  if (total === null) return <p>Loading.</p>;
  return <p>{total} filings.</p>;
}
