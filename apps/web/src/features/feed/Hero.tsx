import { groupInt } from '../../shared/format/group-int';
import { duration, lagClass } from '../../shared/format/duration';
import type { SummaryView } from '../../shared/types/api';

/**
 * The three big numbers, drawn from api/summary and nothing else.
 *
 * BOTH COUNTS ARE THE SERVER'S. hero-insights used to be counted in the
 * browser over loaded rows, and on 2026-08-09 that showed "8 filings today"
 * beside "22 verified insights", growing with every Load more. Both are now
 * counts of FILINGS over the server's IST day, and the second is a subset by
 * construction. The titles carry the long form, as this page does everywhere.
 */
export function Hero({
  summary,
}: {
  readonly summary: SummaryView | null;
}): JSX.Element {
  return (
    <div className="hero" data-ui="feed-hero">
      <div
        className="herostat"
        title="Filings the exchange disseminated in the current IST day, 00:00 to 24:00 at UTC+05:30. Counted by the server, which is the process that owns the one definition of an IST day."
      >
        <div id="hero-today" className="herovalue">
          {summary === null ? '—' : groupInt(summary.todayCount)}
        </div>
        <div className="herolabel">filings today</div>
      </div>
      <div
        className="herostat"
        title="How many of today's filings carry a claim or a results line matched against the source document — the two things a card prints as an insight. One filing counts once, over the same IST day, so this can never be larger than the number beside it."
      >
        <div id="hero-insights" className="herovalue accent">
          {summary === null ? '—' : groupInt(summary.todayVerified)}
        </div>
        <div className="herolabel">with verified claims</div>
      </div>
      <div
        className="herostat"
        title="Since the newest filing held, which on a quiet morning is earlier than today. Deliberately not scoped to today: it is the only one of these three that tells a quiet market from a stopped pipeline."
      >
        <div
          id="hero-lag"
          className={`herovalue ${summary === null ? '' : lagClass(summary.feedLagMs)}`}
        >
          {summary === null ? '—' : duration(summary.feedLagMs)}
        </div>
        <div className="herolabel">since the last one</div>
      </div>
    </div>
  );
}
