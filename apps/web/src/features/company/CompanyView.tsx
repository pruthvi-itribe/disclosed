import type { FilingView, PageMeta } from '../../shared/types/api';
import type { FilterState } from '../../app/filter-state';
import { groupInt } from '../../shared/format/group-int';
import { relativeTime } from '../../shared/format/relative-time';
import { FeedGrid } from '../../shared/ui/FeedGrid';
import { WatchButton, type WatchControls } from '../../shared/ui/WatchButton';
import { coverageLine } from './company-model';
import { Figures } from './Figures';
import { NextUp } from './NextUp';
import { Marks } from './Marks';
import { TopicMix } from './TopicMix';
import { PlansList } from './PlansList';

export interface CompanyViewProps {
  readonly symbol: string;
  readonly items: readonly FilingView[];
  readonly meta: PageMeta | null;
  readonly filters: FilterState;
  readonly todayIstDay: string | null;
  readonly previousIstDay: string | null;
  readonly onBack: () => void;
  readonly onOpenCompany: (symbol: string) => void;
  readonly onOpenFocus: (filing: FilingView) => void;
  readonly onPickGroup: (group: string) => void;
  /** Null when signed out: the head's star is absent, not disabled. */
  readonly watch?: WatchControls | null;
  readonly share?: ((filing: FilingView) => JSX.Element) | null;
}

/**
 * One company, from the one symbol= payload — every widget below derives
 * from it in the browser. The watch star joins the head in Plan 3.
 */
export function CompanyView({
  symbol,
  items,
  meta,
  filters,
  todayIstDay,
  previousIstDay,
  onBack,
  onOpenCompany,
  onOpenFocus,
  onPickGroup,
  watch = null,
  share = null,
}: CompanyViewProps): JSX.Element {
  const first = items[0];
  const industry = first?.industry ?? null;
  const industrySource = first?.industrySource ?? null;
  const verified = items.filter((f) => f.confidenceTier === 'verified').length;

  return (
    <section
      id="view-company"
      data-ui="view-company"
      className="view"
      role="tabpanel"
    >
      <button id="company-back" className="back" type="button" onClick={onBack}>
        Back to feed
      </button>

      <div className="cohead" data-ui="company-head">
        <div className="coident">
          <span id="co-symbol" className="cosym">
            {symbol}
          </span>
          <span id="co-name" className="coname">
            {first?.companyName ?? ''}
          </span>
          {/* Industry appears ONLY when known — NSE printed one for 522 of
              1,289 companies, BSE covers 357 more, 410 have neither, so it
              can never be structural. A BSE-sourced value carries a mark; an
              unmarked chip is NSE's own string. */}
          {industry !== null && (
            <span
              id="co-industry"
              className="tag"
              title={`Industry as classified by ${industrySource === 'bse' ? 'BSE' : 'NSE'}`}
            >
              {industry}
              {industrySource === 'bse' && (
                <span className="tagfrom" data-ui="co-industry-source">
                  BSE
                </span>
              )}
            </span>
          )}
          {watch !== null && (
            <WatchButton id="co-watch" symbol={symbol} controls={watch} />
          )}
        </div>
        <div id="co-coverage" className="cocoverage">
          {coverageLine(items, meta?.total ?? 0)}
        </div>
      </div>

      <div className="hero">
        <div className="herostat">
          <div id="co-filings" className="herovalue">
            {meta === null ? '—' : groupInt(meta.total)}
          </div>
          <div className="herolabel">filings held</div>
        </div>
        <div className="herostat">
          <div id="co-verified" className="herovalue accent">
            {groupInt(verified)}
          </div>
          <div className="herolabel">verified</div>
        </div>
        <div className="herostat">
          <div id="co-last" className="herovalue">
            {first === undefined ? '—' : relativeTime(first.disseminatedAt)}
          </div>
          <div className="herolabel">last filed</div>
        </div>
      </div>

      <Figures items={items} />
      <NextUp items={items} />
      <Marks items={items} />
      <TopicMix items={items} />
      <PlansList items={items} />

      <h2 className="bucket">Filings</h2>
      <FeedGrid
        items={items}
        meta={meta}
        chrome={false}
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
    </section>
  );
}
