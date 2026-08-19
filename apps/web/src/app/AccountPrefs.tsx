import type { ApiEnvelope } from '../shared/api/api-get';
import type { SendMethod } from '../shared/api/api-send';
import type { MeView } from '../shared/types/account';
import { NotificationPrefs } from '../features/alerts/NotificationPrefs';
import type { DesktopAlertsState } from '../features/alerts/use-desktop-alerts';

/**
 * The notifications panel, built once for its two homes (plan C3) — the
 * web's Watching view and the shell's Profile sheet. Null signed out:
 * nothing to prefer. Split from App at the line cap.
 */
export function accountPrefs({
  me,
  alerts,
  watchedCount,
  apiSend,
}: {
  readonly me: MeView | undefined;
  readonly alerts: DesktopAlertsState;
  readonly watchedCount: number;
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
}): JSX.Element | null {
  if (me === undefined || me.signedIn !== true) return null;
  return (
    <NotificationPrefs
      permission={alerts.permission}
      onRequest={alerts.request}
      apiSend={apiSend}
      initialTopics={me.alertTopics ?? []}
      watchedCount={watchedCount}
    />
  );
}
