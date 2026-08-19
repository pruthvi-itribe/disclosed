import type { ApiEnvelope } from '../shared/api/api-get';
import type { SendMethod } from '../shared/api/api-send';
import type { MeView } from '../shared/types/account';
import type { ApiResult } from '../shared/api/api-get';
import type { WatchControls } from '../shared/ui/WatchButton';
import type { useWatch } from '../features/watch/use-watch';
import { AddWatch } from '../features/watch/AddWatch';
import { TopicFollows } from '../features/alerts/TopicFollows';
import { NotificationPrefs } from '../features/alerts/NotificationPrefs';
import type { DesktopAlertsState } from '../features/alerts/use-desktop-alerts';

/**
 * The account's UI surfaces, built once (plan C3 + the Watching manager):
 * the notifications panel for its two homes, and the shell-only manage
 * slots — search-to-add and followed topics. Everything null signed out.
 * Split from App at the line cap.
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
  readonly topics: JSX.Element | null;
  readonly watchControls: WatchControls | null;
} {
  if (me === undefined || me.signedIn !== true) {
    return { prefs: null, addWatch: null, topics: null, watchControls: null };
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
        permission={alerts.permission}
        onRequest={alerts.request}
        apiSend={apiSend}
        initialTopics={me.alertTopics ?? []}
        watchedCount={watchedCount}
      />
    ),
    // Manage-mode slots are the shell's alone; the web keeps its layout.
    addWatch: shell ? (
      <AddWatch apiGet={apiGet} controls={watchControls} />
    ) : null,
    topics: shell ? (
      <TopicFollows apiSend={apiSend} initialTopics={me.alertTopics ?? []} />
    ) : null,
  };
}
