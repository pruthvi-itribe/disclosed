/**
 * The example cards on the landing page.
 *
 * ================================================================
 * WHY THESE COMPANIES DO NOT EXIST
 * ================================================================
 *
 * The obvious landing page shows three real cards from this morning's feed. It
 * is ruled out twice over, and the second reason is the serious one.
 *
 *   1. A SIGNED-OUT VISITOR PERFORMS NO READ. The whole platform is behind the
 *      session guard, and a landing page that fetched the live feed to decorate
 *      itself would be the one hole in it — an unauthenticated route returning
 *      real filing data, added for a screenshot.
 *
 *   2. A CLAIM ON THIS PAGE IS A PUBLICATION. `results-line.ts` carries the
 *      argument in full: a competitor published `EBITDA MARGIN 13.32%` for
 *      APOLLOTYRE where the arithmetic gives 13.23% — a figure the filing never
 *      printed, about a named listed company. Hand-writing a plausible figure
 *      next to a real ticker on a marketing page is that failure with none of
 *      the pipeline's defences in front of it: no span to match against, no
 *      verbatim gate, no discard path. It would be the first thing this product
 *      could be caught doing that it says it does not do.
 *
 * So the companies are invented, the figures are invented, and the page SAYS SO
 * beside them. What is real is the SHAPE: these are the fields a card actually
 * carries — the claim line, the direction the document printed, the span it was
 * matched against, the tier, the category — so a visitor sees the real product
 * rather than a real filing.
 *
 * ================================================================
 * THE NAMES ARE DELIBERATELY NOT NEAR-MISSES
 * ================================================================
 *
 * "NORTHFLD" and "Northfield Steel Works Limited" cannot be confused with a
 * listed scrip. A landing page using "RELIANC" or "Infosis" would be inviting
 * exactly the misreading the paragraph above is about.
 */

/** One claim on an example card, with the span it was matched against. */
export interface SampleClaim {
  /** The claim line, as the feed would render it. */
  readonly text: string;
  /**
   * The movement the document printed: `expansion`, `contraction`, `mixed`, or
   * empty for the great majority that print none. The same vocabulary
   * `claim-direction.ts` uses, so the marks mean here what they mean there.
   */
  readonly direction: '' | 'expansion' | 'contraction' | 'mixed';
  /**
   * The sentence the claim was matched against.
   *
   * THE POINT OF THE WHOLE PAGE. A card without its span is a headline, and
   * every product in this space ships headlines. The span is what makes the
   * claim checkable, so it is shown on the landing page rather than kept one
   * click down as it is in the feed.
   */
  readonly span: string;
}

/** One example card. The fields a real `FilingView` carries, and no others. */
export interface SampleCard {
  readonly symbol: string;
  readonly companyName: string;
  readonly category: string;
  readonly categoryGroupLabel: string;
  readonly when: string;
  readonly tier: 'verified' | 'stated' | 'labelled';
  readonly tierLabel: string;
  readonly claims: readonly SampleClaim[];
  /** The figures table a results filing prints, if it printed one. */
  readonly resultsLine: string | null;
}

/**
 * Three cards, chosen to show three different shapes rather than three good
 * ones.
 *
 * The first is a results day: the figures lead, because on the day a company
 * reports its numbers ARE the event. The second is the ordinary case — a claim
 * with no figure and no direction, which is most of what a filing says. The
 * third is a decrease, and it is a decrease that is GOOD NEWS: the landing page
 * makes the same point the feed's legend does, because a triangle pointing down
 * beside a falling default rate is the fastest way to explain that these marks
 * follow the figure and never the company.
 */
export const SAMPLE_CARDS: readonly SampleCard[] = [
  {
    symbol: 'NORTHFLD',
    companyName: 'Northfield Steel Works Limited',
    category: 'Financial Results',
    categoryGroupLabel: 'Results',
    when: '19 min ago',
    tier: 'verified',
    tierLabel: 'verified',
    resultsLine:
      'Q1 FY27 consolidated — revenue 4,182 CR vs 3,640 CR, PAT 291 CR vs 208 CR',
    claims: [
      {
        text: 'Revenue from operations grew 14.9% year on year',
        direction: 'expansion',
        span: 'Revenue from operations for the quarter grew 14.9% year on year to Rs. 4,182 crore, driven by higher realisations in the long products segment.',
      },
      {
        text: 'Commissioned the second billet caster at the Raipur plant',
        direction: '',
        span: 'The Company has commissioned the second billet caster at its Raipur plant with effect from 12 July 2026.',
      },
    ],
  },
  {
    symbol: 'MERIDNPH',
    companyName: 'Meridian Pharmaceuticals Limited',
    category: 'Award of Order / Receipt of Order',
    categoryGroupLabel: 'Orders',
    when: '1h 12m ago',
    tier: 'verified',
    tierLabel: 'verified',
    resultsLine: null,
    claims: [
      {
        text: 'Received a supply order from a European health authority for an oncology formulation',
        direction: '',
        span: 'The Company has received a supply order from a European national health authority for supply of its oncology formulation over a period of thirty-six months.',
      },
    ],
  },
  {
    symbol: 'KAVERIFIN',
    companyName: 'Kaveri Finance Limited',
    category: 'Investor Presentation',
    categoryGroupLabel: 'Narrative',
    when: '3h 04m ago',
    tier: 'verified',
    tierLabel: 'verified',
    resultsLine: null,
    claims: [
      {
        text: 'Gross non-performing assets declined to 2.1% from 3.4%',
        direction: 'contraction',
        span: 'Gross non-performing assets declined to 2.1% as at 30 June 2026, from 3.4% a year earlier.',
      },
    ],
  },
];

/*
 * WHAT USED TO BE HERE, AND WHY IT IS NOT. Two more exports fed a "how it works"
 * section on the landing page: a worked example, and a claim the verify step
 * threw away with the reason it gave (`span-not-found`). Both were honest and
 * both were written for us — a stranger deciding whether to sign up cannot read
 * a refusal reason without first learning what a span is. The section is gone,
 * so its data is deleted rather than left for a future reader to wonder about.
 * The argument the discard existed to make — that a precision claim is worth
 * nothing without its denominator — is one this repository still owes its
 * readers somewhere they will understand it.
 */
