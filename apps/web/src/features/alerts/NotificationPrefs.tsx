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
  channelNote = null,
  compact = false,
  apiSend,
  initialTopics,
  initialWatchlist = true,
  watchedCount,
}: {
  /** The delivery control for THIS home, or null where none exists. */
  readonly channel: JSX.Element | null;
  /**
   * A block under the channel row, for what the control cannot say in a
   * row's right-hand cell — today, whether a granted permission is
   * actually reaching the screen (`DeliveryCheck`). The caller's, for the
   * same reason the channel is.
   */
  readonly channelNote?: JSX.Element | null;
  /**
   * ONE LINE, on a screen that has a list to show. The panel's full form
   * spent ~260px above the Watching screen's search box — "half the
   * screen space is gone until the search bar" (2026-08-19) — on a
   * heading, a promise and a 3-row pill grid. Compact keeps every
   * control and drops everything that was not one: the label shrinks to
   * a caption, the watched-companies switch becomes the first pill, and
   * the row scrolls sideways instead of wrapping.
   */
  readonly compact?: boolean;
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

  const watchPill = (
    <button
      type="button"
      className={`followpill${watchlistOn ? ' on' : ''}`}
      data-ui="prefs-watchlist"
      aria-pressed={watchlistOn}
      onClick={() => toggleWatchlist(!watchlistOn)}
    >
      {compact ? 'Companies I watch' : watchlistOn ? 'On' : 'Off'}
    </button>
  );

  return (
    <div
      className={`notifprefs${compact ? ' compact' : ''}`}
      data-ui="notification-prefs"
    >
      {/* Two headings where there is one section is chrome: with no
          channel row (the app), "Notifications" and "Alert me about"
          stack with nothing between them. */}
      {compact ? (
        <span className="prefscaption">Alert me about</span>
      ) : (
        <h3>{channel === null ? 'Alert me about' : 'Notifications'}</h3>
      )}
      {channel !== null && (
        <>
          <div className="notifrow" data-ui="prefs-channel">
            <span>Desktop, this browser</span>
            {channel}
          </div>
          {channelNote}
          <h4>Alert me about</h4>
        </>
      )}
      {!compact && (
        <div className="notifrow">
          <span>
            Companies I watch
            <span className="muted" data-ui="prefs-watched">
              {watchedCount === 0
                ? ' · none yet'
                : ` · ${watchedCount} watched`}
            </span>
          </span>
          {watchPill}
        </div>
      )}
      <div className="followpills" data-ui="prefs-topics">
        {/* The watched-companies arm rides the row as its first pill:
            it is the same kind of choice as a topic, and a row of
            choices reads as one control. */}
        {compact && watchPill}
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
      {/* The promise belongs beside the controls that need explaining;
          in one compact line it is a third of the block's height. */}
      {!compact && (
        <div className="notifpromise">
          Only claims verified against the source document are ever sent.
        </div>
      )}
      <div className="doorfail" hidden={failure === null}>
        {failure ?? ''}
      </div>
    </div>
  );
}
