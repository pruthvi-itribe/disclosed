import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import { TOPIC_CHIPS } from '../../shared/format/vocab';
import { AlertsToggle } from './AlertsToggle';
import { useAlertTopics } from './use-alert-topics';
import type { AlertPermission } from './use-desktop-alerts';
import './alerts.css';

/**
 * The notifications section, one component with two homes — the app's
 * Profile sheet and the web's Watching view (plan C3). The desktop
 * channel row is the one real channel control; a mobile-push row used to
 * sit beside it saying "arrives with the app release" and read as
 * nonsense INSIDE the app (called out 2026-08-19) — an absent feature
 * earns no row, and the row returns when Phase B makes it a control.
 * Below: what to be alerted about, all of it in the pill language the
 * rest of the product speaks — the watchlist arm as a real switch (off
 * silences it at the server's predicate, not at the banner), topics as
 * the same pills the Watching screen follows with.
 */
export function NotificationPrefs({
  permission,
  onRequest,
  apiSend,
  initialTopics,
  initialWatchlist = true,
  watchedCount,
}: {
  readonly permission: AlertPermission;
  readonly onRequest: () => void;
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  readonly initialTopics: readonly string[];
  readonly initialWatchlist?: boolean;
  readonly watchedCount: number;
}): JSX.Element {
  const { topics, toggle, watchlistOn, toggleWatchlist, failure } =
    useAlertTopics({ apiSend, initialTopics, initialWatchlist });

  return (
    <div className="notifprefs" data-ui="notification-prefs">
      <h3>Notifications</h3>
      <div className="notifrow">
        <span>Desktop, this browser</span>
        <AlertsToggle permission={permission} onRequest={onRequest} />
      </div>

      <h4>Alert me about</h4>
      <div className="notifrow">
        <span>
          Companies I watch
          <span className="muted" data-ui="prefs-watched">
            {watchedCount === 0 ? ' · none yet' : ` · ${watchedCount} watched`}
          </span>
        </span>
        <button
          type="button"
          className={`followpill${watchlistOn ? ' on' : ''}`}
          data-ui="prefs-watchlist"
          aria-pressed={watchlistOn}
          onClick={() => toggleWatchlist(!watchlistOn)}
        >
          {watchlistOn ? 'On' : 'Off'}
        </button>
      </div>
      <div className="followpills" data-ui="prefs-topics">
        {TOPIC_CHIPS.filter(([value]) => value !== '').map(([value, label]) => {
          const on = topics.includes(value);
          return (
            <button
              key={value}
              type="button"
              className={`followpill${on ? ' on' : ''}`}
              data-topic={value}
              aria-pressed={on}
              onClick={() => toggle(value, !on)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="notifpromise">
        Only claims verified against the source document are ever sent.
      </div>
      <div className="doorfail" hidden={failure === null}>
        {failure ?? ''}
      </div>
    </div>
  );
}
