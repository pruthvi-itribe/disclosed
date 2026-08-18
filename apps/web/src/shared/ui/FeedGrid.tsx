import { useEffect, useRef } from 'react';
import type { FilingView, PageMeta } from '../types/api';
import type { FilterState } from '../../app/filter-state';
import { groupInt } from '../format/group-int';
import { DIRECTION_GLYPH } from '../format/vocab';
import { feedBucket } from './feed-bucket';
import { insightLines } from './insight-lines';
import { FeedCard } from './FeedCard';

/** The server's MAX_LIMIT, restated for the at-cap note. */
const LIMIT_MAX = 500;

/**
 * Why the feed is empty, in the most specific words the page can honestly
 * manage — ported from emptyHint(). The Plans chip is named FIRST because it
 * is the narrowest filter (128 of 3,466 filings): when a search and this
 * chip are both on it is almost always this one that emptied the feed, and
 * letting the insight toggle take the blame would send the reader to the
 * wrong control. The picked-suggestion branch arrives with search in Plan 3.
 */
const emptyHint = (filters: FilterState): string => {
  if (filters.plans) {
    return (
      'Nothing here carries a line where the company said what it plans.' +
      ' Clear the Plans chip, or search a different company.'
    );
  }
  if (filters.onlyInsights) {
    return (
      'Only filings with a claim matched against the source document are shown.' +
      ' Untick the filter above to see everything that arrived.'
    );
  }
  if (filters.q) {
    return `Nothing said ${filters.q}. Try fewer words, or clear the search.`;
  }
  if (filters.symbol) {
    return `Nothing stored for ${filters.symbol} under these filters.`;
  }
  return 'Try a different group, or clear the search.';
};

export interface FeedGridProps {
  readonly items: readonly FilingView[];
  readonly meta: PageMeta | null;
  /** True only for the main feed: the legend, the count and Load more. */
  readonly chrome: boolean;
  readonly filters: FilterState;
  readonly todayIstDay: string | null;
  readonly previousIstDay: string | null;
  readonly onOpenCompany: (symbol: string) => void;
  readonly onOpenFocus: (filing: FilingView) => void;
  readonly onPickGroup: (group: string) => void;
  readonly onGrow: () => void;
}

/**
 * renderFeedInto as a component: cards keyed by seqId — the reconciler's
 * version of "pin by data-seq, never position" — with a day-divider heading
 * whenever the bucket label changes. The old feedSignature skip is not
 * ported because its job moved: a 304 sets no state, so an unchanged poll
 * never reaches this render at all.
 */
export function FeedGrid({
  items,
  meta,
  chrome,
  filters,
  todayIstDay,
  previousIstDay,
  onOpenCompany,
  onOpenFocus,
  onPickGroup,
  onGrow,
}: FeedGridProps): JSX.Element {
  const moreRef = useRef<HTMLButtonElement | null>(null);

  const shown = meta === null ? 0 : meta.offset + meta.returned;
  const atCap = filters.limit >= LIMIT_MAX;
  const moreHidden = meta === null || !meta.hasMore || atCap;

  // The auto-load sentinel is the button itself, pre-loading 200px out. The
  // button stays for keyboards, reduced-motion readers and browsers without
  // IntersectionObserver — they click it.
  useEffect(() => {
    if (!chrome || typeof IntersectionObserver === 'undefined') return;
    const button = moreRef.current;
    if (button === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !button.hidden) onGrow();
      },
      { rootMargin: '200px' },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [chrome, onGrow, moreHidden]);

  // The ONE count still done in the browser: whether any rendered claim
  // carries a movement mark. Only 23.2% of claims do, so a permanent legend
  // is furniture.
  const marks = chrome
    ? items.reduce(
        (n, f) =>
          n +
          insightLines(f.enrichment).filter((l) =>
            DIRECTION_GLYPH.has(l.direction),
          ).length,
        0,
      )
    : 0;

  const empty = items.length === 0;

  let lastBucket: string | null = null;
  const children: JSX.Element[] = [];
  for (const f of items) {
    const bucket = feedBucket(
      f.istDay,
      f.disseminatedAt,
      todayIstDay,
      previousIstDay,
    );
    if (bucket !== lastBucket) {
      lastBucket = bucket;
      children.push(
        <h2 key={`bucket-${bucket}-${f.seqId}`} className="bucket">
          {bucket}
        </h2>,
      );
    }
    children.push(
      <FeedCard
        key={f.seqId}
        filing={f}
        onOpenCompany={onOpenCompany}
        onOpenFocus={onOpenFocus}
        onPickGroup={onPickGroup}
      />,
    );
  }

  return (
    <>
      {chrome && (
        <div
          id="dir-legend"
          className="dirlegend"
          data-ui="direction-legend"
          hidden={marks === 0}
          title="The direction word and the figure the document printed beside it. They describe what the filing said about its own numbers — not a recommendation, and Disclosed publishes none. A fall is not bad news and a rise is not good news: these marks follow the figure, not the company. In the current collection, 13 of 45 marked decreases are falling bad loans, debt, borrowing costs or emissions — a decrease every reader would call an improvement. Read the claim, not the arrow. Where a filing did not print both a direction and a size, no mark appears: an absent mark means the filing was silent, not that nothing happened. Disclosed does not rate companies or securities. It reports what documents say and shows you where they say it."
        >
          ▲ ▼ ◆ mark movement the document itself printed — not a view on the
          company or its shares.
        </div>
      )}
      <div id={chrome ? 'feed' : undefined} className="feed" data-ui="feed">
        {empty ? (
          <div className="emptyfeed">
            <div className="emptytitle">
              {filters.onlyInsights
                ? 'Nothing verifiable yet'
                : 'No filings match'}
            </div>
            {/* Names the filter that is hiding things rather than leaving a
                reader to wonder whether the market is quiet or the page is
                broken. */}
            <div className="emptyhint">{emptyHint(filters)}</div>
          </div>
        ) : (
          children
        )}
      </div>
      {chrome && (
        <div className="feedfoot">
          <span id="feed-info" className="muted">
            {meta === null || empty
              ? ''
              : `${shown} of ${groupInt(meta.total)}${
                  atCap && meta.hasMore
                    ? ' - showing the 500 most recent. Narrow with search or a topic to reach the rest.'
                    : ''
                }`}
          </span>
          <button
            id="feed-more"
            ref={moreRef}
            type="button"
            className="more"
            hidden={moreHidden}
            onClick={onGrow}
          >
            Load more
          </button>
        </div>
      )}
    </>
  );
}
