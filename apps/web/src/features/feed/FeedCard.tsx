import type { KeyboardEvent, MouseEvent } from 'react';
import type { FilingView } from '../../shared/types/api';
import { relativeTime } from '../../shared/format/relative-time';
import { safeHref } from '../../shared/format/safe-href';
import { describeKey } from '../../shared/format/describe';
import { TIER_TITLE } from '../../shared/format/vocab';
import { Insight } from '../../shared/ui/Insight';
import { IconLink } from '../../shared/ui/IconLink';
import { ICON_SOURCE, SOURCE_LABEL } from '../../shared/ui/icons';
import { insightLines } from './insight-lines';

/**
 * Claims a card leads with, measured at 1440px over the live feed: three
 * claims put tile heights at 234-330px (spread 1.41, worst void 149px), two
 * at 211-279px (spread 1.32, worst void 104px) — each claim dropped takes
 * about 45px off the ceiling. The truncation alternative was rejected
 * because a two-line clamp cuts "…interim dividend Rs. 20/share FY end…"
 * mid-figure. The rest of the filing is one click away in the focus dialog.
 */
export const CARD_CLAIMS = 2;

export interface FeedCardProps {
  readonly filing: FilingView;
  readonly onOpenCompany: (symbol: string) => void;
  readonly onOpenFocus: (filing: FilingView) => void;
  readonly onPickGroup: (group: string) => void;
}

/**
 * One card, element for element the old feedCard. "+N more" opens the focus
 * dialog — in-card expansion was removed along with state.expanded, and this
 * port must not reintroduce it: growing pushed every other card in the grid
 * row down and reflowed the feed under the clicker.
 */
export function FeedCard({
  filing,
  onOpenCompany,
  onOpenFocus,
  onPickGroup,
}: FeedCardProps): JSX.Element {
  const lines = insightLines(filing.enrichment);
  const quiet = lines.length === 0;
  const source = safeHref(filing.attachmentUrl);

  // The test is on the TARGET rather than on bubbling: the Source link must
  // not stop propagation (swallowing a click on a link is how a link stops
  // being one), and closest() also catches a click that landed on the SVG
  // inside a control. The group tag is a span, so — as shipped — a tag click
  // both filters and opens; parity keeps the quirk.
  const openFromClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as Element).closest('a, button')) return;
    onOpenFocus(filing);
  };

  // Enter only: Space scrolls a page, and stealing it from a container the
  // reader is tabbing through is worse than not handling it. Only when the
  // card itself has focus — a child control's Enter is its own.
  const openFromKey = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    event.preventDefault();
    onOpenFocus(filing);
  };

  return (
    <article
      className={`card${quiet ? ' quiet' : ''} openable`}
      data-ui="card"
      data-seq={filing.seqId}
      data-at={filing.disseminatedAt}
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`Open everything ${filing.symbol} filed`}
      onClick={openFromClick}
      onKeyDown={openFromKey}
    >
      <header className="cardhead" data-ui="card-head">
        <div className="who">
          <button
            type="button"
            className="sym"
            title={`All filings from ${filing.symbol}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenCompany(filing.symbol);
            }}
          >
            {filing.symbol}
          </button>
          <span className="coname" title={filing.companyName}>
            {filing.companyName}
          </span>
        </div>
        <div className="cardmeta">
          <span className="when" title={`${filing.disseminatedAtIst} IST`}>
            {relativeTime(filing.disseminatedAt)}
          </span>
          <span
            className={`tag group ${filing.categoryGroup} clickable`}
            onClick={() => onPickGroup(filing.categoryGroup)}
          >
            {filing.categoryGroupLabel}
          </span>
        </div>
      </header>
      {quiet ? (
        <p className="stated" data-ui="card-outcome">
          {filing.outcome}
        </p>
      ) : (
        <>
          <ul className="insights" data-ui="card-claims">
            {lines.slice(0, CARD_CLAIMS).map((line, i) => (
              <li key={i}>
                <Insight
                  text={line.text}
                  direction={line.direction}
                  evidence={line.evidence}
                />
              </li>
            ))}
          </ul>
          {lines.length > CARD_CLAIMS && (
            <button
              type="button"
              className="andmore"
              data-ui="card-more"
              onClick={(event) => {
                event.stopPropagation();
                onOpenFocus(filing);
              }}
            >
              {`+ ${lines.length - CARD_CLAIMS} more`}
            </button>
          )}
        </>
      )}
      <footer className="cardfoot" data-ui="card-foot">
        <span
          className={`tier tier-${filing.confidenceTier}`}
          data-ui="card-tier"
          title={describeKey(TIER_TITLE, filing.confidenceTier)}
        >
          {filing.confidenceTierLabel}
        </span>
        <span
          className="cardcat"
          data-ui="card-category"
          title={filing.category}
        >
          {filing.category}
        </span>
        <span className="grow" />
        {source !== null && (
          <IconLink
            shapes={ICON_SOURCE}
            label={SOURCE_LABEL}
            ui="card-source"
            href={source}
          />
        )}
      </footer>
    </article>
  );
}
