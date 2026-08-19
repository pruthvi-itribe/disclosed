import { useCallback, useState } from 'react';
import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';

/**
 * The topic subscriptions, kept in step with the server: every toggle's
 * answer is the WHOLE list, and the state takes what the server said
 * rather than what the click hoped — a refused toggle snaps the box back
 * with the server's sentence beside it, never a checkbox that lies.
 */
export const useAlertTopics = ({
  apiSend,
  initialTopics,
  initialWatchlist = true,
}: {
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  readonly initialTopics: readonly string[];
  readonly initialWatchlist?: boolean;
}): {
  readonly topics: readonly string[];
  readonly toggle: (topic: string, on: boolean) => void;
  readonly watchlistOn: boolean;
  readonly toggleWatchlist: (on: boolean) => void;
  readonly failure: string | null;
} => {
  const [topics, setTopics] = useState<readonly string[]>(initialTopics);
  const [watchlistOn, setWatchlistOn] = useState(initialWatchlist);
  const [failure, setFailure] = useState<string | null>(null);

  const toggle = useCallback(
    (topic: string, on: boolean) => {
      const ask = on
        ? apiSend<{ topics: readonly string[] }>(
            `/api/alerts/topics?topic=${encodeURIComponent(topic)}`,
            'POST',
          )
        : apiSend<{ topics: readonly string[] }>(
            `/api/alerts/topics/${encodeURIComponent(topic)}`,
            'DELETE',
          );
      ask.then(
        (body) => {
          setTopics(body.data.topics);
          setFailure(null);
        },
        (error: unknown) => {
          setFailure(
            error instanceof Error
              ? error.message
              : 'That change did not save.',
          );
        },
      );
    },
    [apiSend],
  );

  // The watched-companies ARM's switch, in the topics' own idiom.
  const toggleWatchlist = useCallback(
    (on: boolean) => {
      apiSend<{ watchlist: boolean }>(
        '/api/alerts/watchlist',
        on ? 'POST' : 'DELETE',
      ).then(
        (body) => {
          setWatchlistOn(body.data.watchlist);
          setFailure(null);
        },
        (error: unknown) => {
          setFailure(
            error instanceof Error
              ? error.message
              : 'That change did not save.',
          );
        },
      );
    },
    [apiSend],
  );

  return { topics, toggle, watchlistOn, toggleWatchlist, failure };
};
