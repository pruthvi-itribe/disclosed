import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiEnvelope } from '../../shared/api/api-get';
import type { SendMethod } from '../../shared/api/api-send';
import type { FilingView } from '../../shared/types/api';
import { alertLine } from './alert-line';
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

/**
 * How many filing ids one tab remembers having seen on the page.
 *
 * The page is 25 rows and a subscribed reader's feed grew by 137 rows in
 * 36 hours (measured 2026-08-20, seven topics and one watched company:
 * 3.8 an hour). 500 is days of an open tab, and an id evicted from here
 * fell off the bottom of a page sorted newest-first long ago — it cannot
 * come back and be mistaken for new.
 */
export const ALERT_SEEN_CAP = 500;

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
  /** Raises one banner now, so a quiet notifier can be told from a mute one. */
  readonly test: () => void;
}

const currentPermission = (): AlertPermission =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;

/**
 * Tab-open desktop alerts: a watched company's VERIFIED filing raises an OS
 * notification while the dashboard sits in a background tab.
 *
 * Verified only — "the only tier allowed near an alert" (TIER_TITLE), the
 * same gate every future channel carries. The body is `alertLine` — the
 * shortest verified form of ONE claim, and the outcome sentence only when
 * the filing carries no claim at all; exchange text never reaches a
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
  /**
   * The ids this tab has already accounted for — a SET, not a high-water
   * mark, and the difference dropped real alerts.
   *
   * A row enters this feed when its ENRICHMENT finishes; `seqId` is
   * assigned at INGESTION. Enrichment does not complete in ingestion
   * order (a long document takes longer to read), so a row routinely
   * appears BELOW one already on the page — measured over one evening on
   * production, 1 of 25. Against a high-water mark those rows are not
   * late, they are invisible: skipped in silence and never retried.
   *
   * Null until the first read seeds it, which is what makes "this tab has
   * seen nothing yet" different from "this tab has seen no filings".
   */
  const seenRef = useRef<Set<number> | null>(null);
  const stoppedRef = useRef(false);

  const request = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then(() =>
      setPermission(currentPermission()),
    );
  }, []);

  /**
   * GRANTED IS NOT DELIVERED, and the gap between them cost two hours of
   * log reading on 2026-08-20. Chrome reported `granted`, polled this
   * feed 130 times, and the reader saw nothing — and no evidence
   * available to the page could say whether the feed was quiet, the fire
   * loop was throwing, or macOS was routing banners to Notification
   * Center with the alert style set to None. This button answers that in
   * one click and forever: a banner appears, or the operating system is
   * eating them.
   *
   * It says it is a test. A banner indistinguishable from a real alert
   * would be this product inventing a filing, which is the one thing it
   * exists not to do.
   */
  const test = useCallback(() => {
    if (typeof Notification === 'undefined') return;
    const shown = new Notification('Disclosed', {
      body: 'This is a test alert. Notifications reach you here.',
      tag: 'disclosed-test',
    });
    shown.onclick = () => window.focus();
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
          const seed = seenRef.current === null;
          const seen = seenRef.current ?? new Set<number>();
          for (const filing of rows) {
            const known = seen.has(filing.seqId);
            seen.add(filing.seqId);
            if (seed || known) continue;
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
            // ONE CLAIM, IN ITS SHORTEST VERIFIED FORM, and never cut by
            // this file — see alert-line.ts for why a blind
            // `slice(0, 139)` on a claim whose p90 is 162 characters was
            // a correctness problem and not a formatting one.
            const shown = new Notification(title, {
              body: alertLine(filing, matched ?? null),
              tag: filing.symbol,
            });
            shown.onclick = () => window.focus();
          }
          // Bounded by dropping the oldest ids INSERTED, which are the
          // rows that left the page first. A Set keeps insertion order,
          // so this needs no sort and no second structure.
          seenRef.current =
            seen.size <= ALERT_SEEN_CAP
              ? seen
              : new Set([...seen].slice(seen.size - ALERT_SEEN_CAP));
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

  return { permission, request, test };
};
