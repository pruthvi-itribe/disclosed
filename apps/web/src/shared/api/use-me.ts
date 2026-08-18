import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope } from './api-get';
import type { SendMethod } from './api-send';
import type { MeView } from '../types/account';

export interface UseMeArgs {
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  /** The latched full-page reload — the only signed-out transition there is. */
  readonly onReload: () => void;
}

export interface MeState {
  /** undefined = "we do not know yet" — the header renders neither state. */
  readonly me: MeView | undefined;
  readonly unread: number;
  readonly failure: string | null;
  readonly refreshMe: () => void;
  readonly signOut: () => void;
  readonly clearUnread: () => void;
  /** The poll's clearError(): every healthy cycle wipes the sentence. */
  readonly clearFailure: () => void;
}

/**
 * api/me and everything that hangs off it. Three states, and the third is
 * load-bearing: until the answer lands the header shows neither signed
 * state, because rendering a false default flickers the controls on every
 * load. Signed-out is a RELOAD, not a repaint — the server answers the
 * front door with the landing page — latched in a ref so concurrent
 * answers cause one reload, never a loop. The badge count is read once
 * here and cleared by the Watching view; the server stamps
 * lastSeenWatchlistAt, so "unread" always means "since you last looked".
 */
export const useMe = ({ apiSend, onReload }: UseMeArgs): MeState => {
  const [me, setMe] = useState<MeView | undefined>(undefined);
  const [unread, setUnread] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const reloadedRef = useRef(false);
  // Responses do not arrive in the order requests were sent: the mount read
  // and a sign-out-failure refreshMe can be in flight together, and the
  // slower first ask landing last would overwrite the fresher me and unread
  // with stale ones. Same shape as usePoll's seq — claimed before dispatch,
  // a superseded answer is discarded whole.
  const seqRef = useRef(0);

  const reloadOnce = useCallback(() => {
    if (reloadedRef.current) return;
    reloadedRef.current = true;
    onReload();
  }, [onReload]);

  const refreshMe = useCallback(() => {
    const seq = ++seqRef.current;
    apiSend<MeView>('/api/me', 'GET').then(
      (body) => {
        if (seq !== seqRef.current) return;
        setMe(body.data);
        if (!body.data.signedIn) {
          reloadOnce();
          return;
        }
        // No setFailure(null) here: a failed sign-out's sentence must
        // survive the refreshMe it triggers — the old page's banner is
        // cleared by the next successful poll, never by a me answer.
        setUnread(body.data.unread ?? 0);
      },
      (error: unknown) => {
        if (seq !== seqRef.current) return;
        // Deliberately not swallowed — the reader is told.
        const text = error instanceof Error ? error.message : String(error);
        setFailure(`Could not read your account: ${text}`);
      },
    );
  }, [apiSend, reloadOnce]);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const signOut = useCallback(() => {
    apiSend('/api/auth/logout', 'POST').then(
      () => reloadOnce(),
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        setFailure(text || 'Could not sign out.');
        refreshMe();
      },
    );
  }, [apiSend, reloadOnce, refreshMe]);

  const clearUnread = useCallback(() => setUnread(0), []);
  const clearFailure = useCallback(() => setFailure(null), []);

  return { me, unread, failure, refreshMe, signOut, clearUnread, clearFailure };
};
