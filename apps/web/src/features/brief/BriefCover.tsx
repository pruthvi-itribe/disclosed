import { groupInt } from '../../shared/format/group-int';
import { BRIEF_RULE, briefDayLabel } from './brief-model';
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
  istDay,
  filings,
  companies,
}: {
  readonly summary: SummaryView | null;
  /**
   * The day the DECK holds, which is not always today — before the day's
   * first verified filing it is the one before. The cover states the
   * deck's day rather than the clock's, because a cover dated today over
   * yesterday's cards is the view lying about the one thing it is for.
   */
  readonly istDay: string | null;
  /** Null before the first filings answer: the rule line stays blank. */
  readonly filings: number | null;
  readonly companies: number;
}): JSX.Element {
  const label =
    istDay === null
      ? null
      : briefDayLabel(
          istDay,
          summary?.todayIstDay ?? null,
          summary?.previousIstDay ?? null,
        );
  const isToday = label === 'Today';
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
        {istDay === null ? '—' : `${istDay} IST`}
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
      {/* THE SAME SENTENCE, with its two numbers wearing the weight — the
          cover's whole job is those two figures and the reader met them
          set in the same grey as the words around them. The characters
          are unchanged (BriefView.spec compares the line whole); only
          the numerals are wrapped. */}
      {/* TODAY'S NUMBERS BELONG ON TODAY'S DECK AND NOWHERE ELSE. The
          summary counts the current IST day; printing it over a deck of
          yesterday's cards is two different days in one sentence. When
          the deck has fallen back, the line says so instead. */}
      <div id="brief-cover-line" className="bcoverline">
        {summary === null ? (
          ''
        ) : !isToday && label !== null ? (
          `Nothing verified has arrived today yet. This is ${label}'s.`
        ) : summary.todayCount === 0 ? (
          'No filings yet today. The deck below is drawn from the window the cover states.'
        ) : (
          <>
            <b className="bcovernum">{groupInt(summary.todayCount)}</b>
            {' filings arrived today; '}
            <b className="bcovernum">{groupInt(summary.todayVerified)}</b>
            {' carry something a document verified.'}
          </>
        )}
      </div>
      <div id="brief-cover-rule" className="bcoverrule">
        {/* Blank until the window has actually been asked for — the old
            page's served cover — because "the 0 most recent" is a claim
            about a request that never happened. */}
        {/* "the N most recent" described the whole 200-filing window,
            which is no longer what the deck draws from: it is one day's
            filings, and the sentence has to say the same thing the cards
            do. */}
        {filings === null || label === null
          ? ''
          : `Drawn from ${label}'s ${groupInt(filings)} verified filing${
              filings === 1 ? '' : 's'
            }, from ${groupInt(companies)} compan${
              companies === 1 ? 'y' : 'ies'
            }. ${BRIEF_RULE}`}
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
