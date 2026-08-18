import type { ClaimView, FilingView } from '../../shared/types/api';

/**
 * The deck's selection and ordering, ported rule for rule from
 * script-brief.ts. Every key is a countable property of OUR evidence, never
 * of the security; the word "ranking" appears nowhere.
 */

/**
 * 12 cards: a 25px sentence and a ticker glance measure ~4.5s a card, so
 * twelve is ~54 seconds and fifteen breaks the rail's promise of an end.
 */
export const BRIEF_MAX_CARDS = 12;

/** Below three segments a rail is chrome, not information. Cards still draw. */
export const BRIEF_MIN_CARDS = 3;

/** Same reason CARD_CLAIMS = 2: one talkative company must not become a wall. */
export const BRIEF_REST_CLAIMS = 2;

/** The outer thirds page; the middle third is where a reading thumb rests. */
export const BRIEF_TAP_ZONE = 1 / 3;

/**
 * The central honesty risk of the whole view, stated on the cover in these
 * exact words.
 */
export const BRIEF_RULE =
  'Ordered by how much of what each company said could be checked against its own document — not by how much it matters. That judgement is yours.';

/**
 * Not a figure parser: an ordering key over our evidence, counting claims
 * whose text prints a digit.
 */
const BRIEF_DIGIT = /\d/;

export interface BriefClaim {
  readonly claim: ClaimView;
  readonly filing: FilingView;
}

export interface BriefCandidate {
  readonly symbol: string;
  readonly companyName: string;
  readonly newest: string;
  readonly hasResults: boolean;
  readonly figures: number;
  readonly claims: readonly BriefClaim[];
}

/** The claim a card leads with: the first this company said that is not an echo. */
export const briefLede = (entry: BriefCandidate): BriefClaim | null => {
  for (const each of entry.claims) {
    if (each.claim.echo !== true) return each;
  }
  return null;
};

/**
 * One candidate per company. THE CLAIM TRAVELS WITH ITS FILING: the card's
 * Source link, tier badge and category belong to the document the lede was
 * matched against, not to the company's newest filing. A company whose every
 * claim is an echo is not a candidate — an earlier card in this same
 * response already stated those facts for it.
 */
export const briefCandidates = (
  items: readonly FilingView[],
): readonly BriefCandidate[] => {
  interface Building {
    symbol: string;
    companyName: string;
    newest: string;
    hasResults: boolean;
    figures: number;
    claims: BriefClaim[];
  }
  const bySymbol = new Map<string, Building>();
  for (const f of items) {
    let entry = bySymbol.get(f.symbol);
    if (entry === undefined) {
      entry = {
        symbol: f.symbol,
        companyName: f.companyName,
        newest: f.disseminatedAt,
        hasResults: false,
        figures: 0,
        claims: [],
      };
      bySymbol.set(f.symbol, entry);
    }
    if (f.enrichment.results) entry.hasResults = true;
    if (String(f.disseminatedAt) > String(entry.newest)) {
      entry.newest = f.disseminatedAt;
    }
    for (const claim of f.enrichment.claims) {
      entry.claims.push({ claim, filing: f });
      if (BRIEF_DIGIT.test(String(claim.text))) entry.figures += 1;
    }
  }
  return [...bySymbol.values()].filter((entry) => briefLede(entry) !== null);
};

/**
 * A total order from countable properties only. THE LAST KEY IS NOT
 * COSMETIC: the page repaints every four seconds, and two candidates equal
 * on every other key would otherwise be free to swap places under a
 * reader's thumb. Sorted on a copy.
 */
export const orderBrief = (
  candidates: readonly BriefCandidate[],
): readonly BriefCandidate[] =>
  [...candidates].sort((a, b) => {
    if (a.hasResults !== b.hasResults) return a.hasResults ? -1 : 1;
    if (a.figures !== b.figures) return b.figures - a.figures;
    if (a.claims.length !== b.claims.length) {
      return b.claims.length - a.claims.length;
    }
    if (a.newest !== b.newest) return a.newest < b.newest ? 1 : -1;
    return a.symbol < b.symbol ? -1 : 1;
  });

/**
 * What the deck would draw, as one string: the deck rebuilds only when this
 * changes, because replacing twelve full-viewport cards under a reader's
 * thumb costs them their place.
 */
export const briefSignature = (cards: readonly BriefCandidate[]): string =>
  cards
    .map((card) => `${card.symbol}:${briefLede(card)?.filing.seqId ?? ''}`)
    .join('|');
