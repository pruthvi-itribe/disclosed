/**
 * The category-to-action lookup: NSE's taxonomy string in, a wire verb out.
 *
 * A TABLE, NOT A MODEL. Every entry here is a hand-written mapping from a
 * category NSE controls to a phrase this project chose, and the mapping is
 * total and deterministic: the same category always yields the same phrase, no
 * document is read, nothing is inferred, and no summary text influences the
 * result. That is the whole reason it can appear in a headline about a named
 * listed company — the phrase is traceable to the stored `category` field the
 * exchange itself supplied, and to this file, and to nothing else.
 *
 * An UNMAPPED category returns null rather than a guess. The caller then falls
 * back to the exchange's own words, which is what the alert says today. That
 * fallback is the safety property: NSE renames and adds categories (the
 * measured corpus holds 111 of them), and a new one must degrade to verbatim
 * rather than be approximated by the nearest entry here.
 *
 * `noun` is the same fact in the grammatical form the derived-context line
 * needs — "3rd ORDER for PANACEABIO in 30 days". It is kept beside the phrase
 * rather than in a second table so the two can never disagree about what a
 * category is.
 */

export interface CategoryAction {
  /** Wire verb, already in the caps the headline convention uses. */
  readonly phrase: string;
  /**
   * Singular noun for the event, lower case, for the derived-context line.
   * Null when the category has no countable event — the context line is then
   * omitted rather than phrased awkwardly around it.
   */
  readonly noun: string | null;
}

/**
 * Keys are NSE `desc` values, lower-cased and whitespace-collapsed. Coverage is
 * driven by the recorded 32-day corpus (17,442 filings, 111 distinct
 * categories): everything appearing at least ~20 times is mapped, plus the
 * low-volume categories that are high-materiality when they do appear
 * (defaults, insolvency, licence actions, demerger).
 */
const ACTIONS: ReadonlyMap<string, CategoryAction> = new Map([
  // --- orders and contracts -------------------------------------------------
  [
    'bagging/receiving of orders/contracts',
    { phrase: 'BAGS ORDER', noun: 'order' },
  ],
  [
    'awarding of order(s)/contract(s)',
    { phrase: 'AWARDS CONTRACT', noun: 'contract award' },
  ],

  // --- corporate actions on the balance sheet -------------------------------
  ['acquisition', { phrase: 'ACQUISITION', noun: 'acquisition' }],
  ['sale or disposal', { phrase: 'SALE OR DISPOSAL', noun: 'disposal' }],
  ['amalgamation/merger', { phrase: 'MERGER', noun: 'merger filing' }],
  ['demerger', { phrase: 'DEMERGER', noun: 'demerger filing' }],
  [
    'scheme of arrangement',
    { phrase: 'SCHEME OF ARRANGEMENT', noun: 'scheme filing' },
  ],
  ['other restructuring', { phrase: 'RESTRUCTURING', noun: 'restructuring' }],
  [
    'diversification/disinvestment',
    { phrase: 'DIVERSIFICATION', noun: 'diversification filing' },
  ],

  // --- capital -------------------------------------------------------------
  ['dividend', { phrase: 'DIVIDEND', noun: 'dividend filing' }],
  ['buyback', { phrase: 'BUYBACK', noun: 'buyback filing' }],
  ['closure of buy back', { phrase: 'BUYBACK CLOSED', noun: null }],
  ['bonus', { phrase: 'BONUS ISSUE', noun: 'bonus filing' }],
  ['rights issue', { phrase: 'RIGHTS ISSUE', noun: 'rights issue filing' }],
  [
    'preferential issue',
    { phrase: 'PREFERENTIAL ISSUE', noun: 'preferential issue' },
  ],
  ['offer for sale', { phrase: 'OFFER FOR SALE', noun: 'offer for sale' }],
  [
    'allotment of securities',
    { phrase: 'ALLOTS SECURITIES', noun: 'allotment' },
  ],
  ['issue of securities', { phrase: 'ISSUES SECURITIES', noun: 'issue' }],
  ['esop/esos/esps', { phrase: 'ESOP', noun: 'ESOP filing' }],
  [
    'options to purchase securities',
    { phrase: 'SECURITIES OPTION', noun: null },
  ],
  ['utilisation of funds', { phrase: 'FUNDS UTILISATION', noun: null }],

  // --- credit --------------------------------------------------------------
  ['credit rating', { phrase: 'CREDIT RATING', noun: 'credit-rating action' }],
  [
    'credit rating- new',
    { phrase: 'NEW CREDIT RATING', noun: 'credit-rating action' },
  ],
  [
    'credit rating- revision',
    { phrase: 'CREDIT RATING REVISED', noun: 'credit-rating action' },
  ],
  [
    'credit rating- others',
    { phrase: 'CREDIT RATING', noun: 'credit-rating action' },
  ],
  [
    'defaults on payment of interest/principal',
    { phrase: 'PAYMENT DEFAULT', noun: 'payment default' },
  ],
  [
    'giving guarantees/indemnity/ becoming a surety for third party',
    { phrase: 'GUARANTEE GIVEN', noun: 'guarantee filing' },
  ],

  // --- commercial ----------------------------------------------------------
  ['agreements', { phrase: 'SIGNS AGREEMENT', noun: 'agreement' }],
  [
    'memorandum of understanding/agreements',
    { phrase: 'SIGNS MOU', noun: 'agreement' },
  ],
  [
    'capacity addition',
    { phrase: 'CAPACITY ADDITION', noun: 'capacity addition' },
  ],
  [
    'commencement of commercial production/operations',
    { phrase: 'COMMENCES OPERATIONS', noun: null },
  ],
  ['closure of operations', { phrase: 'CLOSES OPERATIONS', noun: null }],
  [
    'disruption of operations',
    { phrase: 'OPERATIONS DISRUPTED', noun: 'operational disruption' },
  ],
  ['product launch', { phrase: 'PRODUCT LAUNCH', noun: 'product launch' }],
  [
    'adoption of new line(s) of business',
    { phrase: 'NEW BUSINESS LINE', noun: null },
  ],
  [
    'strikes/lockouts/disturbances',
    { phrase: 'STRIKE OR LOCKOUT', noun: 'labour disruption' },
  ],

  // --- governance and people -----------------------------------------------
  [
    'outcome of board meeting',
    { phrase: 'BOARD MEETING OUTCOME', noun: 'board meeting outcome' },
  ],
  ['appointment', { phrase: 'APPOINTMENT', noun: 'appointment' }],
  ['resignation', { phrase: 'RESIGNATION', noun: 'resignation' }],
  [
    'resignation of director/kmp/smp',
    { phrase: 'RESIGNATION', noun: 'resignation' },
  ],
  [
    'resignation of statutory auditor',
    { phrase: 'AUDITOR RESIGNS', noun: 'auditor resignation' },
  ],
  ['change in director(s)', { phrase: 'BOARD CHANGE', noun: 'board change' }],
  [
    'change in management',
    { phrase: 'MANAGEMENT CHANGE', noun: 'management change' },
  ],
  ['change in auditors', { phrase: 'AUDITOR CHANGE', noun: 'auditor change' }],
  [
    'change in company secretary/compliance officer',
    { phrase: 'COMPLIANCE OFFICER CHANGE', noun: null },
  ],
  ['cessation', { phrase: 'CESSATION', noun: 'cessation' }],
  ['retirement', { phrase: 'RETIREMENT', noun: 'retirement' }],
  ['demise', { phrase: 'DEMISE', noun: null }],
  [
    'shareholders meeting',
    { phrase: 'SHAREHOLDERS MEETING', noun: 'shareholder meeting notice' },
  ],
  ['record date', { phrase: 'RECORD DATE', noun: 'record date notice' }],
  ['name change', { phrase: 'NAME CHANGE', noun: null }],
  ['amendment to aoa/moa', { phrase: 'AOA/MOA AMENDMENT', noun: null }],

  // --- regulatory and legal ------------------------------------------------
  [
    'action(s) taken or orders passed',
    { phrase: 'REGULATORY ACTION', noun: 'regulatory action' },
  ],
  [
    'action(s) initiated or orders passed',
    { phrase: 'REGULATORY ACTION', noun: 'regulatory action' },
  ],
  [
    'pendency of litigation(s)/dispute(s) or the outcome impacting the company',
    { phrase: 'LITIGATION', noun: 'litigation filing' },
  ],
  [
    'corporate insolvency resolution process',
    { phrase: 'INSOLVENCY PROCESS', noun: 'insolvency filing' },
  ],
  [
    'granting/withdrawal/surrender/cancellation/suspension of key licenses/ regulatory approvals',
    { phrase: 'LICENCE ACTION', noun: 'licence action' },
  ],
  [
    'disclosure under sebi takeover regulations',
    { phrase: 'TAKEOVER DISCLOSURE', noun: 'takeover disclosure' },
  ],
  [
    'disclosure of material issue',
    { phrase: 'MATERIAL DISCLOSURE', noun: 'material disclosure' },
  ],
  ['suspension of trading', { phrase: 'TRADING SUSPENDED', noun: null }],

  // --- exchange-initiated --------------------------------------------------
  ['spurt in volume', { phrase: 'VOLUME SPURT', noun: 'volume spurt query' }],
  [
    'price movement',
    { phrase: 'PRICE MOVEMENT', noun: 'price movement query' },
  ],
  [
    'news verification',
    { phrase: 'NEWS VERIFICATION', noun: 'news verification' },
  ],
  [
    'rumour verification - regulation 30(11)',
    { phrase: 'RUMOUR VERIFICATION', noun: 'rumour verification' },
  ],

  // --- disclosure vehicles -------------------------------------------------
  ['press release', { phrase: 'PRESS RELEASE', noun: 'press release' }],
  ['press release (revised)', { phrase: 'PRESS RELEASE REVISED', noun: null }],
  [
    'investor presentation',
    { phrase: 'INVESTOR PRESENTATION', noun: 'investor presentation' },
  ],
  [
    'monthly business updates',
    { phrase: 'MONTHLY BUSINESS UPDATE', noun: 'monthly business update' },
  ],
  ['corrigendum', { phrase: 'CORRIGENDUM', noun: null }],
]);

/**
 * Normalises a category exactly as the taxonomy module does, so a leading space
 * or a case difference in NSE's feed cannot silently drop a mapping.
 */
const normalise = (category: string): string =>
  category.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The action for a category, or null when it is not mapped.
 *
 * @returns the table entry, never a constructed or approximated one.
 */
export function actionFor(category: string): CategoryAction | null {
  return ACTIONS.get(normalise(category)) ?? null;
}

/** The wire verb for a category, or null when unmapped. */
export const actionPhraseFor = (category: string): string | null =>
  actionFor(category)?.phrase ?? null;

/** The countable-event noun for a category, or null when it has none. */
export const eventNounFor = (category: string): string | null =>
  actionFor(category)?.noun ?? null;

/** Every category this table maps. Exported so a test can walk the whole set. */
export const MAPPED_CATEGORIES: readonly string[] = [...ACTIONS.keys()];
