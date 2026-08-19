import type { ApiEnvelope } from '../shared/api/api-get';
import type { SendMethod } from '../shared/api/api-send';
import type { MeView } from '../shared/types/account';
import type { ApiResult } from '../shared/api/api-get';
import type { WatchControls } from '../shared/ui/WatchButton';
import type { useWatch } from '../features/watch/use-watch';
import { AddWatch } from '../features/watch/AddWatch';
import { AlertsToggle } from '../features/alerts/AlertsToggle';
import { NotificationPrefs } from '../features/alerts/NotificationPrefs';
import type { DesktopAlertsState } from '../features/alerts/use-desktop-alerts';

/**
 * The account's UI surfaces, built once (plan C3 + the Watching manager):
 * the notifications panel and the shell-only search-to-add. Everything
 * null signed out. Split from App at the line cap.
 *
 * ONE PANEL, ONE HOME. The topic subscriptions were drawn twice in the
 * shell — as follow pills on Watching and again as preference pills in
 * Profile — which is one stored list behind two independent useStates: a
 * toggle in one left the other stale until the next api/me. Called out
 * 2026-08-19 ("its repeating in profile and here, we need to simplify
 * it"), and the duplicate is deleted rather than synchronised. The panel
 * lives where the following happens: the Watching screen in the app, the
 * Watching view on the web.
 */
export function accountSurfacesUi({
  me,
  alerts,
  watchedCount,
  apiSend,
  shell,
  apiGet,
  watch,
  onToggled,
}: {
  readonly shell: boolean;
  readonly apiGet: <T>(path: string) => Promise<ApiResult<T>>;
  readonly watch: ReturnType<typeof useWatch>;
  /** A toggle from inside the Watching view asks for an immediate poll. */
  readonly onToggled: () => void;
  readonly me: MeView | undefined;
  readonly alerts: DesktopAlertsState;
  readonly watchedCount: number;
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
}): {
  readonly prefs: JSX.Element | null;
  readonly addWatch: JSX.Element | null;
  readonly watchControls: WatchControls | null;
} {
  if (me === undefined || me.signedIn !== true) {
    return { prefs: null, addWatch: null, watchControls: null };
  }
  // Null when signed out, so every star-drawing surface draws nothing. An
  // unwatched row must not sit in the Watching view for four seconds, so
  // a toggle there asks for the immediate poll through onToggled.
  const watchControls: WatchControls = {
    watched: watch.watched,
    pending: watch.pending,
    onToggle: (symbol) => {
      void watch.toggle(symbol).then(onToggled);
    },
  };
  return {
    watchControls,
    prefs: (
      <NotificationPrefs
        // The desktop-permission control belongs to the browser alone:
        // inside the native shell there is no "this browser" to speak of,
        // and Phase B's push is the row that will stand here instead.
        channel={
          shell ? null : (
            <AlertsToggle
              permission={alerts.permission}
              onRequest={alerts.request}
            />
          )
        }
        // A phone screen owes its space to the list, not to the panel.
        compact={shell}
        apiSend={apiSend}
        initialTopics={me.alertTopics ?? []}
        initialWatchlist={me.alertWatchlist ?? true}
        watchedCount={watchedCount}
      />
    ),
    // Manage-mode slots are the shell's alone; the web keeps its layout.
    addWatch: shell ? (
      <AddWatch apiGet={apiGet} controls={watchControls} />
    ) : null,
  };
}
