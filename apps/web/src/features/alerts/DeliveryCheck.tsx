import { useState } from 'react';
import { useLearned } from '../../shared/ui/use-learned';
import type { AlertPermission } from './use-desktop-alerts';

/**
 * Whether a granted permission actually reaches the screen.
 *
 * ================================================================
 * THE BROWSER CANNOT ANSWER THIS, AND THAT IS THE WHOLE PROBLEM
 * ================================================================
 *
 * `Notification.permission` reports what the SITE was granted. Whether the
 * operating system then draws anything is a layer below, and no web API
 * exposes it: Chrome believes it displayed a banner that macOS routed
 * silently to Notification Center, so `granted` and delivered look
 * identical from here.
 *
 * On 2026-08-20 that cost a full diagnosis — 130 polls, permission
 * granted, 137 matching filings, and a reader who saw nothing because
 * notifications for the browser were switched off in macOS. Nothing on
 * the page could have said so, and no amount of server logging could
 * either.
 *
 * So this does not detect. It ASKS, once, and remembers the answer the
 * way `useLearned` remembers a dismissed legend — the reader is the only
 * instrument that can see the screen. Until they answer, the panel says
 * plainly that a permission is not a delivery, which is the strongest
 * true statement available to it.
 *
 * NOT SHOWN BEFORE 'granted': with no permission yet, the enable button
 * is the thing to press, and a warning about a banner nobody has asked
 * for is noise.
 */
export function DeliveryCheck({
  permission,
  onTest,
}: {
  readonly permission: AlertPermission;
  readonly onTest: () => void;
}): JSX.Element | null {
  const { learned, learn } = useLearned('disclosed.alert-delivery');
  const [state, setState] = useState<'idle' | 'asked' | 'hidden'>('idle');

  if (permission !== 'granted' || learned) return null;

  const send = (): void => {
    onTest();
    setState('asked');
  };

  if (state === 'asked') {
    return (
      <div className="deliverycheck" data-ui="delivery-check">
        <span>Sent. Did a banner appear?</span>
        <button type="button" className="more" onClick={learn}>
          Yes
        </button>
        <button
          type="button"
          className="more"
          data-ui="delivery-none"
          onClick={() => setState('hidden')}
        >
          No, nothing
        </button>
      </div>
    );
  }

  if (state === 'hidden') {
    return (
      <div className="deliverycheck" data-ui="delivery-check">
        <span>
          Then your computer is hiding them, not this site. On macOS: System
          Settings &rarr; Notifications &rarr; your browser &mdash; turn on
          Allow notifications, set the alert style to Banners or Alerts, and
          check that Do Not Disturb or a Focus is off.
        </span>
        <button type="button" className="more" onClick={send}>
          Send another test
        </button>
      </div>
    );
  }

  return (
    <div className="deliverycheck" data-ui="delivery-check">
      <span>
        Granting permission is not the same as seeing one &mdash; your computer
        can still hide these.
      </span>
      <button
        type="button"
        className="more"
        data-ui="delivery-test"
        onClick={send}
      >
        Send a test
      </button>
    </div>
  );
}
