import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import type { FilingView } from '../../shared/types/api';
import { topicLabel } from '../../shared/format/vocab';

/**
 * The notifier's own cadence, and it deliberately IGNORES document.hidden —
 * that is the whole point. The main poll pauses in a hidden tab (an
 * unattended tab at 4s is load), but a hidden tab is exactly where a
 * desktop alert matters: a reader looking at the feed does not need a
 * banner about it. One authenticated watchlist read a minute, opt-in via
 * the browser's own permission prompt, is 15x lighter than the polling the
 * visibility pause saves — and it reads the same route the Watching view
 * already polls.
 */
export const ALERT_POLL_MS = 60_000;

export type AlertPermission = NotificationPermission | 'unsupported';

export interface DesktopAlertsArgs {
  readonly apiSend: <T>(
    path: string,
    method: SendMethod,
    body?: unknown,
  ) => Promise<ApiEnvelope<T>>;
  /** Signed in — the watchlist route needs a session to answer at all. */
  readonly enabled: boolean;
}

export interface DesktopAlertsState {
  readonly permission: AlertPermission;
  /** Must be called from a user gesture; browsers ignore it otherwise. */
  readonly request: () => void;
}

const currentPermission = (): AlertPermission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

/**
 * Tab-open desktop alerts: a watched company's VERIFIED filing raises an OS
 * notification while the dashboard sits in a background tab.
 *
 * Verified only — "the only tier allowed near an alert" (TIER_TITLE), the
 * same gate every future channel carries. The body is the server-composed
 * outcome sentence the card shows; exchange text never reaches a
 * notification raw, and no time is formatted here (IST is server-owned).
 *
 * THE FIRST READ SEEDS AND SAYS NOTHING. Enabling alerts must not replay
 * the whole watchlist as a banner storm; "new" means a seqId above what
 * this tab has already seen, and before the seed nothing has been seen.
 *
 * FAILURES ARE DELIBERATELY SILENT here, like the suggest box's and for
 * the same reason: the live dot and the visible poll own outage reporting,
 * and a red banner raised by a background heartbeat would report the
 * page's own timing as a fault. A 401 stops the notifier — the session
 * ended; the visible poll hands that to the reload path when the reader
 * returns.
 */
export const useDesktopAlerts = ({
  apiSend,
  enabled,
}: DesktopAlertsArgs): DesktopAlertsState => {
  const [permission, setPermission] =
    useState<AlertPermission>(currentPermission);
  const highestSeenRef = useRef<number | null>(null);
  const stoppedRef = useRef(false);

  const request = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then(() =>
      setPermission(currentPermission()),
    );
  }, []);

  useEffect(() => {
    if (!enabled || permission !== 'granted') return;
    stoppedRef.current = false;

    const read = (): void => {
      if (stoppedRef.current) return;
      // The ONE predicate, served by the server (plan C2): verified
      // filings from watched companies OR subscribed topics. Which arm
      // matched decides the words below — that part is presentation, and
      // the meta carries both lists so no second read is needed.
      apiSend<readonly FilingView[]>(
        '/api/alerts/feed?limit=25&offset=0',
        'GET',
      ).then(
        (body) => {
          if (stoppedRef.current) return;
          const rows = body.data;
          const fromMeta = body.meta as {
            watched?: readonly string[];
            topics?: readonly string[];
          } | null;
          const watched = new Set(fromMeta?.watched ?? []);
          const subscribed = new Set(fromMeta?.topics ?? []);
          const seed = highestSeenRef.current === null;
          let highest = highestSeenRef.current ?? 0;
          for (const filing of rows) {
            if (filing.seqId > highest) highest = filing.seqId;
            if (seed) continue;
            if (filing.seqId <= (highestSeenRef.current ?? 0)) continue;
            if (filing.confidenceTier !== 'verified') continue;
            // One banner per company (`tag` collapses), replaced in place
            // when the same company files again within a burst. A watched
            // company leads with its name; a topic-only match leads with
            // the topic, because that is why the reader is being told.
            const claims = filing.enrichment?.claims ?? [];
            const matched = claims.find(
              (claim) => claim.topic !== null && subscribed.has(claim.topic),
            );
            const title = watched.has(filing.symbol)
              ? `${filing.symbol} filed`
              : `${topicLabel(matched?.topic ?? '')}: ${filing.symbol}`;
            // A notification is a glance, not a card: the claim TEXT is the
            // extractor's verified-span-backed one-liner and is already
            // notification-sized; the outcome sentence is the card-length
            // fallback for the rare verified filing with no claim line. A
            // dedicated model-written alert line is plan C5 — measured
            // there before it is built.
            const line = matched?.text ?? claims[0]?.text ?? filing.outcome;
            const body = line.length > 140 ? `${line.slice(0, 139)}…` : line;
            const shown = new Notification(title, {
              body,
              tag: filing.symbol,
            });
            shown.onclick = () => window.focus();
          }
          highestSeenRef.current = highest;
        },
        (error: unknown) => {
          if ((error as { status?: number }).status === 401) {
            stoppedRef.current = true;
          }
        },
      );
    };

    read();
    const tick = setInterval(read, ALERT_POLL_MS);
    return () => {
      clearInterval(tick);
    };
  }, [apiSend, enabled, permission]);

  return { permission, request };
};
