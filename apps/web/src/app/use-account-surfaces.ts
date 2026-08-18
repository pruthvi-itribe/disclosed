import { useCallback } from 'react';
import type { ApiEnvelope } from '../shared/api/api-get';
import type { SendMethod } from '../shared/api/api-send';
import { useMe, type MeState } from '../shared/api/use-me';
import { useWatch } from '../features/watch/use-watch';
import {
  useDesktopAlerts,
  type DesktopAlertsState,
} from '../features/alerts/use-desktop-alerts';

/**
 * The three signed-in surfaces behind one seam — account, watchlist, and
 * the desktop notifier — plus the healthy-cycle signal that wipes their
 * failure sentences (the old page's clearError() on a successful poll).
 * Pure composition, split from App when it crossed the line cap; App.spec
 * covers the behaviour through the shell.
 */
export interface AccountSurfacesArgs {
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  readonly onSessionEnded: () => void;
}

export const useAccountSurfaces = ({
  apiSend,
  onSessionEnded,
}: AccountSurfacesArgs): {
  readonly account: MeState;
  readonly watch: ReturnType<typeof useWatch>;
  readonly alerts: DesktopAlertsState;
  readonly onHealthy: () => void;
} => {
  const account = useMe({ apiSend, onReload: onSessionEnded });
  const signedIn = account.me?.signedIn === true;
  const watch = useWatch({ apiSend, enabled: signedIn });
  // The tab-open notifier: its own 60s heartbeat, deliberately alive while
  // the tab is hidden — see use-desktop-alerts.ts.
  const alerts = useDesktopAlerts({ apiSend, enabled: signedIn });

  // Every healthy cycle wipes the account and watchlist sentences. Without
  // this a transient 502 stayed red all session while the dot said 'live'.
  const accountClearFailure = account.clearFailure;
  const watchClearFailure = watch.clearFailure;
  const onHealthy = useCallback(() => {
    accountClearFailure();
    watchClearFailure();
  }, [accountClearFailure, watchClearFailure]);

  return { account, watch, alerts, onHealthy };
};
