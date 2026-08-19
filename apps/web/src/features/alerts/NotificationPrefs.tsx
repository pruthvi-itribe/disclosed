import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import { TOPIC_CHIPS } from '../../shared/format/vocab';
import { useAlertTopics } from './use-alert-topics';
import './alerts.css';

/**
 * The notifications section, one component with two homes — the app's
 * Profile sheet and the web's Watching view (plan C3).
 *
 * CHANNELS ARE THE CALLER'S, because they differ per home: the browser
 * gets the desktop-permission control, the native shell gets NONE and so
 * the whole row is absent there — "Desktop, this browser" is a sentence
 * about a surface the app is not (called out 2026-08-19), and a
 * mobile-push placeholder saying "arrives with the app release" read as
 * nonsense inside the app for the same reason. An absent feature earns
 * no row; the shell's row returns when Phase B makes it a control.
 *
 * Below the channels, what to be alerted about, all of it in the pill
 * language the rest of the product speaks — the watchlist arm as a real
 * switch (off silences it at the server's predicate, not at the banner),
 * topics as the same pills the Watching screen follows with.
 */
export function NotificationPrefs({
  channel,
  apiSend,
  initialTopics,
  initialWatchlist = true,
  watchedCount,
}: {
  /** The delivery control for THIS home, or null where none exists. */
  readonly channel: JSX.Element | null;
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
      {/* Two headings where there is one section is chrome: with no
          channel row (the app), "Notifications" and "Alert me about"
          stack with nothing between them. */}
      <h3>{channel === null ? 'Alert me about' : 'Notifications'}</h3>
      {channel !== null && (
        <>
          <div className="notifrow" data-ui="prefs-channel">
            <span>Desktop, this browser</span>
            {channel}
          </div>
          <h4>Alert me about</h4>
        </>
      )}
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
