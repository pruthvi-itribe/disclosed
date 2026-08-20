import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilingView, PageMeta, SummaryView } from '../../shared/types/api';
import { groupInt } from '../../shared/format/group-int';
import {
  briefDeck,
  briefSignature,
  BRIEF_MAX_CARDS,
  BRIEF_MIN_CARDS,
  BRIEF_TAP_ZONE,
} from './brief-model';
import { BriefCover } from './BriefCover';
import { BriefCard } from './BriefCard';

/**
 * WHICH WAY THIS DECK PAGES, ASKED OF THE STYLESHEET. The phone deck is a
 * row that snaps on x, the desktop deck a column that snaps on y; the media
 * query that decides is in brief.css and this reads its answer off the
 * resolved style. One breakpoint, one place — and deliberately not measured
 * from scrollWidth, because a one-card deck overflows on neither axis.
 */
const deckPagesAcross = (deck: HTMLElement): boolean =>
  (window.getComputedStyle(deck).scrollSnapType || '').indexOf('x') === 0;

const cardStart = (card: HTMLElement, across: boolean): number =>
  across ? card.offsetLeft : card.offsetTop;

/**
 * One card per press, per tap, per click — the tap zones, the pager and the
 * arrow keys all arrive here. Without it a keyboard reader cannot move at
 * all: mandatory scroll-snap pulls the 40px an arrow key scrolls straight
 * back. Compared against the card's own offset (±4px for fractional-density
 * displays) because the scroll position is the truth about where a reader
 * is. Smoothness lives in the stylesheet, which is how
 * prefers-reduced-motion becomes an instant jump without this knowing.
 */
const briefStep = (deck: HTMLElement, forward: boolean): void => {
  const cards = deck.getElementsByClassName('bcard');
  const across = deckPagesAcross(deck);
  const at = across ? deck.scrollLeft : deck.scrollTop;
  let target: HTMLElement | null = null;
  if (forward) {
    for (const card of cards) {
      if (cardStart(card as HTMLElement, across) > at + 4) {
        target = card as HTMLElement;
        break;
      }
    }
  } else {
    for (let j = cards.length - 1; j >= 0; j--) {
      const card = cards[j] as HTMLElement;
      if (cardStart(card, across) < at - 4) {
        target = card;
        break;
      }
    }
  }
  if (target === null) return;
  target.scrollIntoView(
    across ? { block: 'nearest', inline: 'start' } : { block: 'start' },
  );
  target.focus({ preventScroll: true });
};

export interface BriefViewProps {
  readonly items: readonly FilingView[];
  readonly meta: PageMeta | null;
  readonly summary: SummaryView | null;
  readonly onOpenCompany: (symbol: string) => void;
  readonly onPickTopic: (topic: string) => void;
  readonly onToFeed: () => void;
}

/** The day as a finite deck: cover, up to twelve company cards, the end. */
export function BriefView({
  items,
  meta,
  summary,
  onOpenCompany,
  onPickTopic,
  onToFeed,
}: BriefViewProps): JSX.Element {
  const deckRef = useRef<HTMLDivElement | null>(null);
  const [railAt, setRailAt] = useState(0);
  const [ends, setEnds] = useState({ prev: true, next: false });

  // ONE DAY, ranked inside it — see `briefDeck`. The window the page polls
  // spans more than a day, and ranking across all of it put yesterday's
  // long documents on every card under a cover dated today.
  const deck = briefDeck(items);
  const candidates = deck.cards;
  // The WINDOW, for the empty sentence only: an empty deck means no day in
  // the window had anything, and the honest N for that is all of it.
  const seen = meta?.returned ? meta.returned : items.length;
  const shown = candidates.slice(0, BRIEF_MAX_CARDS);
  const rest = candidates.length - shown.length;
  const signature = briefSignature(shown);
  // Only a real zero-row ANSWER is empty. Before the first answer the deck
  // shows its blank cover — the old page's served DOM — never the empty
  // sentence, whose "last 0 filings" would be a false claim about a window
  // nobody has asked for yet.
  const empty = candidates.length === 0 && meta !== null;

  /**
   * THE PAGER'S STATE COMES FROM THE SCROLL POSITION, not from the rail: the
   * rail indexes company cards while the deck also holds the cover and the
   * end, so the two ends asked about here are the deck's own.
   */
  const syncPager = useCallback(() => {
    const deck = deckRef.current;
    if (deck === null) return;
    const across = deckPagesAcross(deck);
    const at = across ? deck.scrollLeft : deck.scrollTop;
    const span = across ? deck.clientWidth : deck.clientHeight;
    const total = across ? deck.scrollWidth : deck.scrollHeight;
    // A pixel of tolerance: a snapped offset plus the span lands a fraction
    // short of the total on a fractional-density display.
    setEnds({ prev: at <= 1, next: at + span >= total - 2 });
  }, []);

  // THE RAIL IS DERIVED FROM SCROLL, NOT FROM A COUNTER — a counter drifts
  // the moment a reader flicks past two cards. Re-registered whenever the
  // card set changes; guarded, because a browser without the observer still
  // gets every card, just a rail that does not move.
  useEffect(() => {
    const deck = deckRef.current;
    if (deck === null || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setRailAt(Number(entry.target.getAttribute('data-index')));
        }
      },
      { root: deck, threshold: 0.6 },
    );
    for (const card of deck.querySelectorAll('[data-ui="brief-card"]')) {
      observer.observe(card);
    }
    setRailAt(0);
    syncPager();
    return () => observer.disconnect();
  }, [signature, syncPager]);

  return (
    <>
      <div
        id="brief-rail"
        className="brail"
        aria-hidden="true"
        hidden={empty || shown.length < BRIEF_MIN_CARDS}
      >
        {shown.map((card, i) => (
          <span
            key={card.symbol}
            className={`brailseg${i <= railAt ? ' on' : ''}`}
            data-ui="brief-rail-seg"
          />
        ))}
      </div>
      <div
        id="brief-deck"
        ref={deckRef}
        className="bdeck"
        role="region"
        aria-roledescription="card deck"
        aria-label="The day, one company per card"
        tabIndex={0}
        hidden={empty}
        onScroll={syncPager}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          const deck = deckRef.current;
          if (deck === null) return;
          const { key } = event;
          // Both axes, whichever way the deck is laid out — the keyboard is
          // the one way in that is not a gesture.
          if (
            key === 'ArrowDown' ||
            key === 'ArrowRight' ||
            key === 'PageDown' ||
            key === ' '
          ) {
            event.preventDefault();
            briefStep(deck, true);
            return;
          }
          if (key === 'ArrowUp' || key === 'ArrowLeft' || key === 'PageUp') {
            event.preventDefault();
            briefStep(deck, false);
          }
        }}
        onClick={(event) => {
          const deck = deckRef.current;
          if (deck === null || !deckPagesAcross(deck)) return;
          // Every control on a card stays a control: a tap that reached one
          // has already been answered.
          if (
            (event.target as Element).closest(
              'a, button, input, select, textarea, summary',
            )
          ) {
            return;
          }
          // A tap that finished a text selection is not a tap.
          const selection = window.getSelection?.() ?? null;
          if (selection !== null && String(selection).length > 0) return;
          const box = deck.getBoundingClientRect();
          if (box.width <= 0) return;
          const across = (event.clientX - box.left) / box.width;
          if (across >= 1 - BRIEF_TAP_ZONE) briefStep(deck, true);
          else if (across <= BRIEF_TAP_ZONE) briefStep(deck, false);
        }}
      >
        <BriefCover
          summary={summary}
          istDay={deck.istDay}
          filings={meta === null ? null : deck.filings}
          companies={candidates.length}
        />
        {shown.map((entry, i) => (
          <BriefCard
            key={entry.symbol}
            entry={entry}
            index={i}
            total={shown.length}
            onOpenCompany={onOpenCompany}
            onPickTopic={onPickTopic}
          />
        ))}
        <article id="brief-end" className="bcard bend">
          <h2 className="btitle">That is the day.</h2>
          <div id="brief-end-line" className="bendline">
            {meta === null || empty
              ? ''
              : rest === 0
                ? `${groupInt(shown.length)} of the ${groupInt(candidates.length)} companies in this window filed something a document verified, and every one of them is in this deck.`
                : `${groupInt(shown.length)} of the ${groupInt(candidates.length)} companies in this window filed something a document verified. The rest are in the feed: ${groupInt(rest)} more.`}
          </div>
          <button id="brief-to-feed" type="button" onClick={onToFeed}>
            Open the feed
          </button>
        </article>
      </div>
      <div className="bpager" data-ui="brief-pager">
        <button
          id="brief-prev"
          type="button"
          className="bpage bprev"
          aria-label="Previous card"
          aria-controls="brief-deck"
          disabled={ends.prev}
          onClick={() => {
            const deck = deckRef.current;
            if (deck === null) return;
            briefStep(deck, false);
            // The smooth scroll has not landed; the deck's own scroll
            // handler settles the buttons — this only disables an end
            // immediately.
            syncPager();
          }}
        />
        <button
          id="brief-next"
          type="button"
          className="bpage bnext"
          aria-label="Next card"
          aria-controls="brief-deck"
          disabled={ends.next}
          onClick={() => {
            const deck = deckRef.current;
            if (deck === null) return;
            briefStep(deck, true);
            syncPager();
          }}
        />
      </div>
      {/* NOT AN EMPTY DECK: "nothing was found" and "nothing was looked
          for" are different facts, and the real N tells them apart. */}
      <div id="brief-empty" className="bempty" hidden={!empty}>
        {empty
          ? `Nothing in the last ${groupInt(seen)} filings carried a claim matched against its source document. Here is the feed.`
          : ''}
      </div>
    </>
  );
}
