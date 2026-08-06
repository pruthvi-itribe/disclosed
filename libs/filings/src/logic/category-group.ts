/**
 * NSE's 111 raw categories, collapsed into a set a person can scan.
 *
 * ================================================================
 * WHY A GROUPING EXISTS AT ALL
 * ================================================================
 *
 * The exchange's `desc` field is an operational taxonomy, not a reader's one.
 * Over a 32-day corpus of 17,442 filings it takes **111 distinct values**, and
 * the tail is savage: 44 of them appear five times or fewer, and `FCCBs`,
 * `Forfeiture` and `Voluntary Delisting` appear once each. A dashboard column
 * keyed on the raw value is 111 filter options of which 40 are almost always
 * empty, and no reader can hold that in their head.
 *
 * The grouping is DERIVED FROM THE CORPUS rather than invented: every one of the
 * 111 observed values is placed below, and the counts in each group's comment are
 * that corpus's own. A category NSE has not published yet falls to `other`,
 * which is counted and visible — never silently absorbed into a neighbour.
 *
 * ================================================================
 * WHAT THIS IS NOT
 * ================================================================
 *
 * NOT AN ELIGIBILITY FILTER, and nothing downstream may use it as one. That is
 * the whole lesson of the results gap: `Outcome of Board Meeting` — 1,346
 * filings, the largest recurring event in an equity market's calendar — produced
 * nothing for weeks because a category set decided what was worth reading. A
 * group here says what KIND of filing something is, for a reader sorting a
 * table. It never decides whether a document is read, whether a model is called,
 * or whether an alert is sent.
 *
 * The one place a category legitimately gates behaviour is `taxonomy.ts`'s
 * routine list, which decides what reaches TELEGRAM, and it is deliberately not
 * this module: alerting is a volume problem with a documented 388-messages-a-day
 * constraint, and coverage is a completeness problem. Conflating them is what
 * produced the gap.
 */

/**
 * The reader-facing groups.
 *
 * Ten, and the number is the corpus's rather than a target. Each one below is a
 * cluster that a filings desk treats as a single beat — somebody watching order
 * flow does not also want ESOP allotments — and each is large enough in the
 * corpus to be worth a filter of its own.
 */
export type CategoryGroup =
  /** Periodic financial statements and the exchange's correspondence about them. 1,545 corpus filings. */
  | 'results'
  /** The company describing itself: presentations, releases, calls, business updates. 3,528. */
  | 'narrative'
  /** Order wins, capacity, production, plant and operational disruption. 243. */
  | 'orders'
  /** Acquisitions, mergers, schemes, stake changes and the agreements behind them. 546. */
  | 'mna'
  /** Credit ratings, in all four spellings NSE uses. 249. */
  | 'ratings'
  /** Securities, dividends, buybacks, record dates and the use of raised funds. 907. */
  | 'capital'
  /** Boards, officers, meetings, constitutional documents and compliance certificates. 4,897. */
  | 'governance'
  /** Enforcement, litigation, insolvency, default and delisting. 233. */
  | 'legal'
  /** Exchange-prompted answers to a price move, a volume spurt or a news report. 234. */
  | 'verification'
  /** Newspaper scans, trading-window notices and generic updates. 5,041. */
  | 'routine'
  /**
   * A category this table has never seen.
   *
   * FAILS OPEN AND IS COUNTED. NSE adds categories without notice, and the
   * alternative — quietly filing an unknown into the nearest-looking group —
   * would make a new kind of filing indistinguishable from an old one. A rising
   * `other` count on the dashboard is how somebody learns the taxonomy moved.
   */
  | 'other';

export const CATEGORY_GROUPS: readonly CategoryGroup[] = [
  'results',
  'narrative',
  'orders',
  'mna',
  'ratings',
  'capital',
  'governance',
  'legal',
  'verification',
  'routine',
  'other',
];

/** How a group is spelled for a reader. */
export const CATEGORY_GROUP_LABEL: Readonly<Record<CategoryGroup, string>> = {
  results: 'Results',
  narrative: 'Narrative',
  orders: 'Orders',
  mna: 'M&A',
  ratings: 'Ratings',
  capital: 'Capital',
  governance: 'Governance',
  legal: 'Legal',
  verification: 'Verification',
  routine: 'Routine',
  other: 'Other',
};

/**
 * Every category observed in the 32-day corpus, spelled AS NSE SPELLS IT.
 *
 * Written as a literal map rather than as prefix rules on purpose. NSE's strings
 * are inconsistent in ways a rule would get wrong — `Credit Rating- Revision`
 * has no space after the hyphen while `Reply to Clarification- Financial
 * results` also lower-cases its last word, and `Integrated Filing- Financial`
 * and `Integrated Filing- Governance` share a prefix and belong in different
 * groups. A lookup is checkable against the corpus; a rule is not.
 *
 * THE KEYS ARE NSE'S OWN SPELLINGS, not normalised ones, and that is load
 * bearing rather than tidy: `categoriesInGroup` hands these straight to a
 * Mongo `$in` against the stored `category` field, so they have to be the
 * bytes the exchange sent. Lookup normalises both sides separately.
 */
const GROUP_BY_CATEGORY: readonly (readonly [string, CategoryGroup])[] = [
  // --- results: the statements themselves, and the exchange's questions about
  // them. `Outcome of Board Meeting` is the largest single entry in this whole
  // table and is the category the pipeline was blind to.
  ['Outcome of Board Meeting', 'results'],
  ['Integrated Filing- Financial', 'results'],
  ['Clarification - Financial Results', 'results'],
  ['Reply to Clarification- Financial results', 'results'],

  // --- narrative: the company talking about itself, in prose.
  ['Analysts/Institutional Investor Meet/Con. Call Updates', 'narrative'],
  ['Press Release', 'narrative'],
  ['Press Release (Revised)', 'narrative'],
  ['Investor Presentation', 'narrative'],
  ['Monthly Business Updates', 'narrative'],
  ['Business Update', 'narrative'],
  // Regulation 30's catch-all. Genuinely mixed in the corpus — companies file
  // SAST shareholding disclosures and exchange applications under it alike — so
  // it sits with the other "the company is telling you something about itself"
  // categories rather than being split by guesswork about each document.
  ['Disclosure of material issue', 'narrative'],

  // --- orders: what the company won, built, started or stopped doing.
  ['Bagging/Receiving of orders/contracts', 'orders'],
  ['Awarding of order(s)/contract(s)', 'orders'],
  ['Capacity addition', 'orders'],
  ['Commencement of commercial production/operations', 'orders'],
  ['Product launch', 'orders'],
  ['New Product Launch', 'orders'],
  ['Adoption of new line(s) of business', 'orders'],
  ['Disruption of Operations', 'orders'],
  ['Closure of operations', 'orders'],
  ['Strikes/Lockouts/Disturbances', 'orders'],
  [
    'Granting/withdrawal/surrender/cancellation/suspension of key licenses/ regulatory approvals',
    'orders',
  ],

  // --- mna: ownership changing hands, and the paperwork that moves it.
  ['Acquisition', 'mna'],
  ['Updates on Acquisition', 'mna'],
  ['Amalgamation/Merger', 'mna'],
  ['Scheme of Arrangement', 'mna'],
  ['Demerger', 'mna'],
  ['Sale or disposal', 'mna'],
  ['Other Restructuring', 'mna'],
  ['Diversification/Disinvestment', 'mna'],
  ['Agreements', 'mna'],
  ['Memorandum of Understanding/Agreements', 'mna'],
  [
    'Arrangements for strategic, technical, manufacturing, or marketing tie up',
    'mna',
  ],
  ['Joint Venture', 'mna'],
  ['Disclosure under SEBI Takeover Regulations', 'mna'],
  ['Public Announcement-Open Offer', 'mna'],
  ['Rescission/termination(s)', 'mna'],
  ['Giving guarantees/indemnity/ becoming a surety for third party', 'mna'],

  // --- ratings: four spellings of one thing.
  ['Credit Rating', 'ratings'],
  ['Credit Rating- New', 'ratings'],
  ['Credit Rating- Revision', 'ratings'],
  ['Credit Rating- Others', 'ratings'],

  // --- capital: the share register and the money raised against it.
  ['Allotment of Securities', 'capital'],
  ['ESOP/ESOS/ESPS', 'capital'],
  ['Options to purchase securities', 'capital'],
  ['Issue of Securities', 'capital'],
  ['Preferential issue', 'capital'],
  ['Rights Issue', 'capital'],
  ['Qualified Institutional Placement', 'capital'],
  ['Offer for sale', 'capital'],
  ['Buyback', 'capital'],
  ['Closure of Buy Back', 'capital'],
  ['Post Buyback Public Announcement', 'capital'],
  ['Public Announcement - Buyback of Shares', 'capital'],
  ['Bonus', 'capital'],
  ['Stock split', 'capital'],
  ['Forfeiture', 'capital'],
  ['Conversion', 'capital'],
  ['FCCBs', 'capital'],
  ['Increase in Authorised Capital', 'capital'],
  ['Dividend', 'capital'],
  ['Record Date', 'capital'],
  ['Revised Record date', 'capital'],
  ['Utilisation of Funds', 'capital'],
  ['Monitoring Agency Report', 'capital'],

  // --- governance: who runs the company, and the certificates that say so.
  // The largest group, and the least newsworthy per filing — 1,973 of its 4,897
  // are one depositories-regulation certificate.
  ['Appointment', 'governance'],
  ['Resignation', 'governance'],
  ['Resignation of Director/KMP/SMP', 'governance'],
  ['Resignation of Statutory Auditor', 'governance'],
  ['Change in Management', 'governance'],
  ['Change in Director(s)', 'governance'],
  ['Change in Auditors', 'governance'],
  ['Change in Company Secretary/Compliance Officer', 'governance'],
  ['Cessation', 'governance'],
  ['Retirement', 'governance'],
  ['Demise', 'governance'],
  ['Shareholders meeting', 'governance'],
  ['Committee Meeting Updates', 'governance'],
  ['Amendment to AOA/MOA', 'governance'],
  ['Name Change', 'governance'],
  ['Name and Symbol Change', 'governance'],
  ['Symbol Change of company', 'governance'],
  ['Address Change', 'governance'],
  [
    'Quarterly Compliance Report on Corporate governance - within 21 days from the end of the quarter',
    'governance',
  ],
  ['Integrated Filing- Governance', 'governance'],
  ['Trading Plan under PIT', 'governance'],
  ['Registrar & Share Transfer Agent Update', 'governance'],
  [
    'Certificate under SEBI (Depositories and Participants) Regulations, 2018',
    'governance',
  ],
  ['Structural Digital Database', 'governance'],

  // --- legal: the categories `legal-block.ts` refuses to draft anything about.
  ['Action(s) taken or orders passed', 'legal'],
  ['Action(s) initiated or orders passed', 'legal'],
  [
    'Pendency of Litigation(s)/dispute(s) or the outcome impacting the Company',
    'legal',
  ],
  ['Corporate Insolvency Resolution Process', 'legal'],
  ['Initiation of Forensic Audit', 'legal'],
  ['Fraud/Default/Arrest', 'legal'],
  ['Frauds/Default by employees', 'legal'],
  ['Defaults on Payment of Interest/Principal', 'legal'],
  [
    'Delay/default in the payment of fines/penalties/dues etc. to authority',
    'legal',
  ],
  ['Suspension of Trading', 'legal'],
  ['Voluntary Delisting', 'legal'],

  // --- verification: the exchange asked and the company answered.
  ['Spurt in Volume', 'verification'],
  ['Price movement', 'verification'],
  ['News Verification', 'verification'],
  ['Rumour Verification - Regulation 30(11)', 'verification'],
  ['Corrigendum', 'verification'],

  // --- routine: structurally low-signal. NOTE that this list is NOT
  // `ROUTINE_CATEGORIES` from `taxonomy.ts` and must not be confused with it:
  // that one decides what reaches Telegram, this one decides how a row is
  // labelled. `Updates` and `General Updates` appear in both, and 98.1% of
  // `Updates` summaries are informative — which is exactly why the alerting
  // list must not be reused as a coverage filter.
  ['Copy of Newspaper Publication', 'routine'],
  ['General Updates', 'routine'],
  ['Updates', 'routine'],
  ['Trading Window', 'routine'],
  ['Trading Window-XBRL', 'routine'],
  ['Statement of deviation(s) or variation(s) under Reg. 32', 'routine'],
  ['Loss of Share Certificates', 'routine'],
  ['Issue of Duplicate Share Certificate', 'routine'],
  ['Others', 'routine'],
  [
    'Effect(s) on listed entity due to changed regulatory  framework applicable',
    'routine',
  ],
  ['Amendment(s)', 'routine'],
] as const;

/**
 * Which group a filing's category belongs to.
 *
 * NEVER THROWS and never guesses. An unrecognised category returns `other`,
 * which is a visible, countable state rather than a silent absorption into the
 * nearest-looking neighbour.
 *
 * Whitespace inside the string is collapsed as well as trimmed, because NSE
 * publishes at least one category with a double space in it — `Effect(s) on
 * listed entity due to changed regulatory  framework applicable` — and a lookup
 * that depended on reproducing that byte for byte would be one upstream tidy-up
 * away from returning `other` for a category this table does list.
 */
/**
 * The lookup key for a category: trimmed, lower-cased, whitespace collapsed.
 *
 * Collapsing INTERNAL whitespace matters because NSE really publishes a category
 * with a double space in it — `Effect(s) on listed entity due to changed
 * regulatory  framework applicable` — and a table that depended on reproducing
 * that byte for byte would be one upstream tidy-up away from returning `other`
 * for a category it lists.
 */
const lookupKey = (category: string): string =>
  category.trim().toLowerCase().replace(/\s+/g, ' ');

const GROUP_BY_LOOKUP_KEY: ReadonlyMap<string, CategoryGroup> = new Map(
  GROUP_BY_CATEGORY.map(([name, group]) => [lookupKey(name), group]),
);

export function categoryGroupFor(category: string): CategoryGroup {
  return GROUP_BY_LOOKUP_KEY.get(lookupKey(category)) ?? 'other';
}

/**
 * Every category, lower-cased, that belongs to a group.
 *
 * EXISTS SO A FILTER CAN USE THE INDEX. The dashboard's group filter has to
 * become a Mongo predicate, and the two ways to write one are a `$in` over these
 * names or an `$expr` computing the group per document. The first uses the
 * `category` index the schema already declares; the second is a collection scan
 * against a live ingest on every poll of an auto-refreshing page.
 *
 * `other` returns an empty list, and the caller must read that as "match nothing
 * by name" and invert the query — a group defined by ABSENCE from this table
 * cannot be enumerated from it.
 */
export function categoriesInGroup(group: CategoryGroup): readonly string[] {
  return GROUP_BY_CATEGORY.filter(([, value]) => value === group).map(
    ([name]) => name,
  );
}

/** Every category this table maps, so a caller can express `other` as a negation. */
export const MAPPED_GROUP_CATEGORIES: readonly string[] = GROUP_BY_CATEGORY.map(
  ([name]) => name,
);
