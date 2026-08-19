import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import { TOPIC_CHIPS } from '../../shared/format/vocab';
import { AlertsToggle } from './AlertsToggle';
import { useAlertTopics } from './use-alert-topics';
import type { AlertPermission } from './use-desktop-alerts';
import './alerts.css';

/**
 * The notifications section, one component with two homes — the app's
 * Profile sheet and the web's Watching view (plan C3). Channels first,
 * honestly: the desktop row is the real control, the mobile row states
 * plainly that push arrives with the app release rather than showing a
 * dead toggle. Then what to be alerted about: watched companies as the
 * always-on fact they are, and the topic list — the chip row's own
 * vocabulary, one implementation for filtering and subscribing alike.
 * The product's promise is printed where the decision happens.
 */
export function NotificationPrefs({
  permission,
  onRequest,
  apiSend,
  initialTopics,
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
  readonly watchedCount: number;
}): JSX.Element {
  const { topics, toggle, failure } = useAlertTopics({
    apiSend,
    initialTopics,
  });

  return (
    <div className="notifprefs" data-ui="notification-prefs">
      <h3>Notifications</h3>
      <div className="notifchannels">
        <div className="notifrow">
          <span>Desktop, this browser</span>
          <AlertsToggle permission={permission} onRequest={onRequest} />
        </div>
        <div className="notifrow">
          <span>Mobile push</span>
          <span className="muted">Arrives with the app release</span>
        </div>
      </div>

      <h4>Alert me about</h4>
      <div className="notifrow">
        <span>Companies I watch</span>
        <span className="muted" data-ui="prefs-watched">
          {watchedCount === 0
            ? 'None watched yet'
            : `Always on · ${watchedCount} watched`}
        </span>
      </div>
      <div className="notiftopics" data-ui="prefs-topics">
        {TOPIC_CHIPS.filter(([value]) => value !== '').map(([value, label]) => (
          <label key={value} className="notiftopic">
            <input
              type="checkbox"
              data-topic={value}
              checked={topics.includes(value)}
              onChange={(event) => toggle(value, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
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
