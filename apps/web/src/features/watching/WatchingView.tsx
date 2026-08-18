import { useEffect } from 'react';
import type { FilingView } from '../../shared/types/api';
import type { WatchlistFeedMeta } from '../../shared/types/account';
import type { FilterState } from '../../app/filter-state';
import { groupInt } from '../../shared/format/group-int';
import { FeedGrid } from '../../shared/ui/FeedGrid';
import type { WatchControls } from '../../shared/ui/WatchButton';
import { Roster } from './Roster';

export interface WatchingViewProps {
  readonly items: readonly FilingView[];
  readonly meta: WatchlistFeedMeta | null;
  readonly filters: FilterState;
  readonly todayIstDay: string | null;
  readonly previousIstDay: string | null;
  readonly watch: WatchControls | null;
  readonly share?: ((filing: FilingView) => JSX.Element) | null;
  /**
   * Server-owned (MAX_WATCHED_SYMBOLS, on api/me and every watchlist
   * response's meta); null until one of those channels has answered.
   * Never invented client-side — a hardcoded denominator here once
   * printed 'N of 50' with a number no server sent.
   */
  readonly watchCap: number | null;
  /**
   * What the server LAST SAID about the whole list — the sign-in read and
   * every toggle answer. The count line reads this rather than the roster,
   * because this section sits in the document from sign-in (hidden, the way
   * the old page kept it) and the count must be right before this view has
   * ever polled: e2e stars a company on the FEED and reads #watch-count.
   * Structurally WatchCounts; not imported, because no feature imports a
   * feature.
   */
  readonly counts: { readonly used: number; readonly cap: number } | null;
  readonly onOpenCompany: (symbol: string) => void;
  readonly onOpenFocus: (filing: FilingView) => void;
  readonly onPickGroup: (group: string) => void;
  /** The roster half of every response, handed up to overwrite the set. */
  readonly onRoster: (
    rows: WatchlistFeedMeta['watching'],
    cap: number | null,
  ) => void;
  /** Looking at the tab IS reading it; the server has already stamped. */
  readonly onSeen: () => void;
}

/**
 * The watchlist first, then what it said — both halves drawn from the one
 * authenticated response, so they cannot disagree. The two empties are two
 * different sentences, and both deliberately skip the unread clear the
 * populated view performs, which is why a reader with zero filings keeps
 * their badge.
 */
export function WatchingView({
  items,
  meta,
  filters,
  todayIstDay,
  previousIstDay,
  watch,
  share = null,
  watchCap,
  onOpenCompany,
  onOpenFocus,
  counts,
  onPickGroup,
  onRoster,
  onSeen,
}: WatchingViewProps): JSX.Element {
  const rows = meta?.watching ?? [];
  const noWatches = meta !== null && rows.length === 0;
  const nothingFiled = meta !== null && rows.length > 0 && items.length === 0;
  const populated = meta !== null && rows.length > 0 && items.length > 0;

  // The response is authoritative: every poll overwrites the watched set
  // wholesale, which is what fixes a watchlist changed in a second tab.
  useEffect(() => {
    if (meta !== null) onRoster(meta.watching, watchCap);
  }, [meta, watchCap, onRoster]);

  useEffect(() => {
    if (populated) onSeen();
  }, [populated, onSeen]);

  return (
    <>
      <div className="watchhead" data-ui="watching-head">
        <h2>Companies you watch</h2>
        <span id="watch-count" className="watchcount">
          {counts === null
            ? ''
            : `${groupInt(counts.used)} of ${groupInt(counts.cap)} companies watched`}
        </span>
      </div>
      <p
        id="watch-roster-note"
        className="sectionnote"
        data-ui="watching-roster-note"
        hidden={rows.length === 0}
      >
        Every company you watch is here, the quiet ones included, with when it
        last filed anything held in this collection. The star takes one off the
        list.
      </p>
      {rows.length > 0 && (
        <Roster rows={rows} watch={watch} onOpenCompany={onOpenCompany} />
      )}
      <div
        id="watch-feed-head"
        className="watchhead"
        data-ui="watching-feed-head"
        hidden={rows.length === 0}
      >
        <h2>What they have said</h2>
      </div>
      {/* WHAT THE FEED BELOW IS LEAVING OUT, IN NUMBERS. A view that
          silently shows a short list is the bug this sentence closes. */}
      <p
        id="watch-feed-note"
        className="sectionnote"
        data-ui="watching-feed-note"
        hidden={!populated}
      >
        {meta === null
          ? ''
          : meta.hasMore
            ? `The newest ${groupInt(meta.returned)} of ${groupInt(meta.total)} filings from these companies. The list above is complete; this one is not.`
            : `All ${groupInt(meta.total)} filings from these companies.`}
      </p>
      <div
        id="watch-empty"
        className="watchempty"
        hidden={!noWatches && !nothingFiled}
      >
        {noWatches && (
          <>
            <strong>You are not watching anything yet</strong>
            {
              ' Press Watch on any card in the feed, or on a company page. Everything those companies file collects here.'
            }
          </>
        )}
        {nothingFiled && (
          <>
            <strong>{`None of the ${rows.length} companies above has filed anything we hold`}</strong>
            {
              ' The watches are working - they are listed above. This fills the moment one of them files.'
            }
          </>
        )}
      </div>
      {populated && (
        <FeedGrid
          items={items}
          meta={meta}
          chrome={false}
          id="watch-feed"
          filters={filters}
          todayIstDay={todayIstDay}
          previousIstDay={previousIstDay}
          onOpenCompany={onOpenCompany}
          onOpenFocus={onOpenFocus}
          onPickGroup={onPickGroup}
          onGrow={() => undefined}
          watch={watch}
          share={share}
        />
      )}
    </>
  );
}
