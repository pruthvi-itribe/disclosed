import { groupInt } from '../../shared/format/group-int';
import { BRIEF_RULE } from './brief-model';
import type { SummaryView } from '../../shared/types/api';

/**
 * Card 0: the day, at phone scale — drawn from the summary the page already
 * polls, so it costs no request. The title deliberately states no count: the
 * deck is capped at twelve and often holds fewer, and a heading with a
 * number the deck does not have is the first thing a reader could catch this
 * view lying about.
 */
export function BriefCover({
  summary,
  seen,
  companies,
}: {
  readonly summary: SummaryView | null;
  /** Null before the first filings answer: the rule line stays blank. */
  readonly seen: number | null;
  readonly companies: number;
}): JSX.Element {
  const byGroup: Readonly<Record<string, number>> = summary?.todayByGroup ?? {};
  const groups = Object.keys(byGroup)
    .sort((a, b) => {
      // Ties broken by name, so a repaint cannot reorder two equal segments
      // and make the bar appear to move on its own.
      const diff = (byGroup[b] ?? 0) - (byGroup[a] ?? 0);
      return diff !== 0 ? diff : a < b ? -1 : 1;
    })
    .filter((group) => (byGroup[group] ?? 0) !== 0);

  return (
    <article id="brief-cover" className="bcard bcover">
      <div id="brief-day" className="bday">
        {summary === null ? '—' : `${summary.todayIstDay} IST`}
      </div>
      <h1 className="btitle">The day, card by card</h1>
      <div id="brief-mix" className="mix">
        {groups.map((group) => (
          <div
            key={group}
            className={`mixseg g-${group}`}
            style={{ flexGrow: byGroup[group] }}
            title={`${group}: ${byGroup[group]}`}
          />
        ))}
      </div>
      <div id="brief-cover-line" className="bcoverline">
        {summary === null
          ? ''
          : summary.todayCount === 0
            ? 'No filings yet today. The deck below is drawn from the window the cover states.'
            : `${groupInt(summary.todayCount)} filings arrived today; ${groupInt(summary.todayVerified)} carry something a document verified.`}
      </div>
      <div id="brief-cover-rule" className="bcoverrule">
        {/* Blank until the window has actually been asked for — the old
            page's served cover — because "the 0 most recent" is a claim
            about a request that never happened. */}
        {seen === null
          ? ''
          : `Drawn from the ${groupInt(seen)} most recent verified filings, from ${groupInt(companies)} companies. ${BRIEF_RULE}`}
      </div>
      {/* The gesture, named for the device holding it: two spans and a media
          query rather than a branch in the script — the stylesheet already
          owns which deck this is. */}
      <div className="bhint">
        <span className="bhintnear">
          Swipe, or tap the sides. There is an end.
        </span>
        <span className="bhintwide">
          Scroll for the cards. There is an end.
        </span>
      </div>
    </article>
  );
}
