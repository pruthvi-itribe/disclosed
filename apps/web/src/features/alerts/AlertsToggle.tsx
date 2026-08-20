import type { AlertPermission } from './use-desktop-alerts';

/**
 * The alerts control, beside the watch count. Three honest states rather
 * than a switch that lies: a browser without the API gets nothing (not a
 * dead control), 'default' gets the one button whose click is the user
 * gesture the permission prompt requires, 'granted' states the fact, and
 * 'denied' names the only place it can be undone — the browser's own site
 * settings, which no page is allowed to reach into.
 *
 * 'granted' STATES A PERMISSION, NOT A DELIVERY. Whether a banner reaches
 * the screen is `DeliveryCheck`'s question, asked in its own block under
 * this row — it needs a sentence and two answers, which is not a thing a
 * row's right-hand cell can hold.
 */
export function AlertsToggle({
  permission,
  onRequest,
}: {
  readonly permission: AlertPermission;
  readonly onRequest: () => void;
}): JSX.Element | null {
  if (permission === 'unsupported') return null;
  if (permission === 'granted') {
    return (
      <span id="alerts-state" className="muted" data-ui="alerts">
        Desktop alerts on
      </span>
    );
  }
  if (permission === 'denied') {
    return (
      <span id="alerts-state" className="muted" data-ui="alerts">
        Alerts are blocked in this browser&apos;s site settings.
      </span>
    );
  }
  return (
    <button
      id="alerts-enable"
      type="button"
      className="more"
      data-ui="alerts"
      onClick={onRequest}
    >
      Enable desktop alerts
    </button>
  );
}
