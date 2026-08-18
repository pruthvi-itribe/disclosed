import { renderDashboardPage } from '../page';

/**
 * `feedBucket` and `feedSignature`, run as the browser runs them.
 *
 * SLICED OUT OF THE SERVED DOCUMENT rather than imported from the fragment,
 * for the reason in CLAUDE.md: these fragments are TypeScript template
 * literals, and a fragment that compiled is not a fragment that shipped. What
 * is asserted here is the function the page actually hands a browser.
 *
 * They are the two functions in the client script worth running in Jest: both
 * are pure and touch no DOM. `feedBucket` is the whole of a rule the server
 * owns — which IST day a filing belongs to. `feedSignature` is the whole of
 * the rule that decides whether the feed is rebuilt at all, and every one of
 * its failures is silent: too coarse and a card stops updating, too fine and
 * nothing is ever skipped. Everything else in the fragment builds nodes and is
 * the e2e suite's job.
 */

const html = renderDashboardPage(true);
const SCRIPT = html.slice(
  html.indexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>'),
);

/**
 * The source text of one top-level function declaration, by brace matching.
 *
 * THROWS WHEN THE ANCHOR IS MISSING rather than returning an empty string: a
 * cut that matched nothing would evaluate to a harness with no function in it
 * and fail with `feedBucket is not defined`, which reads as a broken test
 * rather than as a renamed function. Sound only for a function whose body
 * contains no brace inside a string or a regex, which `feedBucket` does not.
 */
const cutFunction = (source: string, signature: string): string => {
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`"${signature}" is not in the served script.`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`"${signature}" is never closed in the served script.`);
};

type FeedBucket = (
  istDay: string,
  iso: string,
  today: string | null,
  previous: string | null,
) => string;

const feedBucket = new Function(
  `${cutFunction(SCRIPT, 'function feedBucket(')}\nreturn feedBucket;`,
)() as FeedBucket;

/** 10:00 IST on Sunday 2026-08-09, which is 04:30 UTC. */
const NOW = Date.parse('2026-08-09T04:30:00.000Z');
const TODAY = '2026-08-09';
const YESTERDAY = '2026-08-08';

const ago = (ms: number): string => new Date(NOW - ms).toISOString();

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('feedBucket — the day a filing is filed under', () => {
  it('names the last half hour', () => {
    expect(feedBucket(TODAY, ago(5 * 60 * 1000), TODAY, YESTERDAY)).toBe(
      'Just now',
    );
  });

  it('puts the rest of today under one heading', () => {
    expect(feedBucket(TODAY, ago(45 * 60 * 1000), TODAY, YESTERDAY)).toBe(
      'Earlier today',
    );
    expect(feedBucket(TODAY, ago(9 * 60 * 60 * 1000), TODAY, YESTERDAY)).toBe(
      'Earlier today',
    );
  });

  it('files yesterday evening under Yesterday, however few hours ago it was', () => {
    // THE REPORTED BUG, AS A TEST. 17:00 IST on Saturday read at 10:00 IST on
    // Sunday is seventeen hours old, and the elapsed-time buckets this replaced
    // called anything under 24h 'Today'. Two market days, one heading.
    const saturdayEvening = '2026-08-08T11:30:00.000Z';
    expect(Date.now() - Date.parse(saturdayEvening)).toBeLessThan(
      24 * 60 * 60 * 1000,
    );
    expect(feedBucket(YESTERDAY, saturdayEvening, TODAY, YESTERDAY)).toBe(
      'Yesterday',
    );
  });

  it('names an older day by its date', () => {
    // 'Earlier' used to swallow every one of these, which on the company page
    // — the same renderer, ten months of one filer — was every row but three.
    expect(
      feedBucket('2026-08-07', '2026-08-07T05:00:00.000Z', TODAY, YESTERDAY),
    ).toBe('2026-08-07');
    expect(
      feedBucket('2025-11-14', '2025-11-14T05:00:00.000Z', TODAY, YESTERDAY),
    ).toBe('2025-11-14');
  });

  it('names the day when the summary has not landed yet', () => {
    // Two requests, one refresh, no ordering promise. The date is the server's
    // own string, so this is plainer than 'Today' and never wrong.
    expect(feedBucket(TODAY, ago(60 * 1000), null, null)).toBe(TODAY);
  });

  it('does not call a future timestamp brand new', () => {
    // A browser clock running slow puts every filing of the day in the future.
    // It is still today's, and it is not the last half hour.
    expect(feedBucket(TODAY, ago(-90 * 60 * 1000), TODAY, YESTERDAY)).toBe(
      'Earlier today',
    );
  });

  it('never reads the clock to decide which day it was', () => {
    // THE INVARIANT, ASSERTED ON THE SOURCE: IST rolls at 18:30 UTC, so a
    // browser that subtracted a day for itself would put the same filing under
    // different headings for readers in different zones. The only arithmetic
    // this function may do is a duration inside one day.
    const source = cutFunction(SCRIPT, 'function feedBucket(');
    expect(source).not.toContain('getDate');
    expect(source).not.toContain('getTimezoneOffset');
    expect(source).not.toContain('toISOString');
    expect(source).not.toContain('86400000');
  });
});

/**
 * The reader-visible state `feedSignature` reads that is not in the payload.
 * Only the fields it names; the real `state` carries thirty more.
 */
type FeedState = {
  todayIstDay: string | null;
  previousIstDay: string | null;
  limit: number;
  onlyInsights: boolean;
  plans: boolean;
  q: string;
  symbol: string;
  picked: { head: string; filings: number } | null;
};

type Filing = Record<string, unknown>;
type Meta = Record<string, unknown>;
type FeedSignature = (items: Filing[], meta: Meta, chrome: boolean) => string;

/**
 * `feedSignature` with its two collaborators supplied.
 *
 * `feedBucket` comes out of the same served script rather than being stubbed —
 * the day divider is part of the signature and a stub would prove the wrong
 * function. `state` and `signedIn` are injected as parameters because they are
 * the page's, and a test that reached for the real ones would be asserting
 * against whatever the last test left behind.
 */
const signatureWith = (
  state: FeedState,
  signedIn: () => boolean,
): FeedSignature =>
  new Function(
    'state',
    'signedIn',
    `${cutFunction(SCRIPT, 'function feedBucket(')}
${cutFunction(SCRIPT, 'function feedSignature(')}
return feedSignature;`,
  )(state, signedIn) as FeedSignature;

const feedState = (over: Partial<FeedState> = {}): FeedState => ({
  todayIstDay: TODAY,
  previousIstDay: YESTERDAY,
  limit: 25,
  onlyInsights: true,
  plans: false,
  q: '',
  symbol: '',
  picked: null,
  ...over,
});

/** One filing shaped as `api/filings` sends it, with only what a card draws. */
const filing = (over: Filing = {}): Filing => ({
  seqId: 106_734_488,
  symbol: 'SKIPPER',
  companyName: 'Skipper Limited',
  istDay: TODAY,
  disseminatedAt: ago(45 * 60 * 1000),
  disseminatedAtIst: '09 Aug 2026, 09:15:00',
  category: 'Financial Results',
  categoryGroup: 'results',
  categoryGroupLabel: 'Results',
  confidenceTier: 'verified',
  confidenceTierLabel: 'Verified',
  outcome: 'Results declared',
  attachmentUrl: 'https://nsearchives.test/skipper.pdf',
  enrichment: {
    state: 'done',
    claims: [{ text: 'Revenue was 1,204 crore', direction: '', echo: false }],
  },
  ...over,
});

const META: Meta = {
  offset: 0,
  returned: 1,
  total: 4_354,
  hasMore: true,
  limit: 25,
};

describe('feedSignature — whether the feed is rebuilt at all', () => {
  it('is the same string for the same screen', () => {
    // The whole point: the four-second poll usually brings back exactly what
    // is already drawn.
    const sign = signatureWith(feedState(), () => true);
    const items = [filing()];
    expect(sign(items, META, true)).toBe(sign([filing()], { ...META }, true));
  });

  it("moves when a claim's text changes", () => {
    const sign = signatureWith(feedState(), () => true);
    const before = sign([filing()], META, true);
    const after = sign(
      [
        filing({
          enrichment: {
            state: 'done',
            claims: [
              { text: 'Revenue was 1,240 crore', direction: '', echo: false },
            ],
          },
        }),
      ],
      META,
      true,
    );
    expect(after).not.toBe(before);
  });

  it('moves when a filing arrives, and when one is reordered', () => {
    const sign = signatureWith(feedState(), () => true);
    const one = filing();
    const two = filing({ seqId: 106_734_489, symbol: 'SAGILITY' });
    const before = sign([one], META, true);
    expect(sign([two, one], META, true)).not.toBe(before);
    // ORDER IS PART OF THE SCREEN. The feed is sorted newest first and two
    // filings swapping places is a different feed, not the same one.
    expect(sign([two, one], META, true)).not.toBe(sign([one, two], META, true));
  });

  it('does not move as the clock runs inside a divider', () => {
    // THE PROPERTY THE WHOLE SKIP RESTS ON. Every card's "3 min ago" is a
    // minute out of date a minute later, and if that reached the signature
    // nothing would ever be skipped. `touchFeedTimes` writes those in place.
    const sign = signatureWith(feedState(), () => true);
    const items = [filing()];
    const before = sign(items, META, true);
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 5 * 60 * 1000);
    expect(sign(items, META, true)).toBe(before);
  });

  it('moves when a filing crosses out of Just now', () => {
    // The divider above the card IS in the signature, because half an hour in
    // the heading changes and no light pass rewrites a heading.
    const sign = signatureWith(feedState(), () => true);
    const items = [filing({ disseminatedAt: ago(29 * 60 * 1000) })];
    const before = sign(items, META, true);
    expect(feedBucket(TODAY, ago(29 * 60 * 1000), TODAY, YESTERDAY)).toBe(
      'Just now',
    );
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 2 * 60 * 1000);
    expect(sign(items, META, true)).not.toBe(before);
  });

  it('moves when the counts under the feed change', () => {
    const sign = signatureWith(feedState(), () => true);
    const items = [filing()];
    const before = sign(items, META, true);
    expect(sign(items, { ...META, total: 4_355 }, true)).not.toBe(before);
    expect(sign(items, { ...META, hasMore: false }, true)).not.toBe(before);
  });

  it('moves when the reader grows the feed', () => {
    // `state.limit` decides whether Load more is drawn at the server's ceiling,
    // and it is not in the payload.
    const state = feedState();
    const sign = signatureWith(state, () => true);
    const before = sign([filing()], META, true);
    state.limit = 50;
    expect(sign([filing()], META, true)).not.toBe(before);
  });

  it('moves when api/me finally answers', () => {
    // The watch star does not exist until it does, and that answer arrives
    // after the first paint on a cold load.
    let signedIn = false;
    const sign = signatureWith(feedState(), () => signedIn);
    const before = sign([filing()], META, true);
    signedIn = true;
    expect(sign([filing()], META, true)).not.toBe(before);
  });

  it("tells an empty feed's reasons apart", () => {
    // With no rows the whole screen is the hint, and the hint is written from
    // state rather than from the payload — so two empties are two screens.
    const state = feedState({ onlyInsights: false, q: 'britannia' });
    const sign = signatureWith(state, () => true);
    const searched = sign([], { ...META, returned: 0, total: 0 }, true);
    state.q = '';
    state.plans = true;
    expect(sign([], { ...META, returned: 0, total: 0 }, true)).not.toBe(
      searched,
    );
    state.plans = false;
    state.picked = { head: 'BRITANNIA', filings: 12 };
    expect(sign([], { ...META, returned: 0, total: 0 }, true)).not.toBe(
      searched,
    );
  });

  it('keeps the feed and the company page apart', () => {
    // One renderer, two containers, and only one of them draws the footer
    // counts. The signature has to say which, or a container could inherit the
    // other's answer about whether it had changed.
    const sign = signatureWith(feedState(), () => true);
    expect(sign([filing()], META, false)).not.toBe(
      sign([filing()], META, true),
    );
  });
});

/**
 * WHAT A POLL THAT CHANGED NOTHING NOW COSTS, AND WHAT IT MUST STILL DO.
 *
 * `api/filings` answers a repeat ask with 304 and no body (the argument is on
 * the route), so `refresh` has no payload to draw and skips the render. That is
 * the saving. What it must NOT skip is the clock: `feedSignature` deliberately
 * leaves `relativeTime` out — it changes on every card every minute and
 * including it would mean never skipping a rebuild — and `touchFeedTimes` is
 * what keeps those four characters honest without rebuilding a card.
 *
 * So the time each card reads is written onto the card as `data-at`, and the
 * touch-up walks the DOM rather than a payload it no longer has. Without this
 * a tab left open through a quiet hour reads "10 min ago" for an hour.
 */
/**
 * The picked-company sentence is the one place the hint states a FACT about
 * a company — "none of them carries a matched claim" — and it can only say
 * that honestly while the insight toggle is the sole other narrowing. With
 * a group or topic ANDed in, that filter may be what emptied the feed, and
 * the sentence becomes a false claim of our own. The React client's
 * emptyHint has carried this gate since Plan 2; this runs the served one.
 */
describe('the empty-feed hint', () => {
  const hint = (state: Record<string, unknown>): string =>
    new Function(
      'state',
      'groupInt',
      `${cutFunction(SCRIPT, 'function emptyHint(')}
return emptyHint();`,
    )(state, String) as string;

  const picked = {
    plans: false,
    onlyInsights: true,
    q: '',
    symbol: 'RELIANCE',
    picked: { kind: 'company', head: 'RELIANCE', filings: 24 },
  };

  it('names the company only while the toggle is the sole narrowing', () => {
    const said = hint({ ...picked, group: '', topic: '' });
    expect(said).toContain('RELIANCE has 24 filing(s)');
  });

  it('does not claim the company has no matched claims when a chip is lit', () => {
    for (const narrowed of [
      { ...picked, group: '', topic: 'orders' },
      { ...picked, group: 'results', topic: '' },
    ]) {
      const said = hint(narrowed);
      expect(said).not.toContain('none of them carries');
      expect(said).toContain('Untick the filter above');
    }
  });
});

describe('a poll that changed nothing', () => {
  it('writes the timestamp onto the card, where the touch-up can find it', () => {
    expect(cutFunction(SCRIPT, 'function feedCard(')).toContain(
      "card.setAttribute('data-at', f.disseminatedAt)",
    );
  });

  it('reads the times off the DOM rather than off a payload', () => {
    const touch = cutFunction(SCRIPT, 'function touchFeedTimes(');

    expect(touch).toContain("getAttribute('data-at')");
    // The old signature took the items and built a seqId map out of them. A
    // 304 carries no items, so a touch-up that needs them cannot run at all.
    expect(touch).not.toContain('items');
  });

  it('refreshes the clock on the branch that skips the render', () => {
    const branch = SCRIPT.indexOf('if (b === NOT_MODIFIED)');
    expect(branch).toBeGreaterThan(-1);
    // Inside the branch, before it returns: the whole body of it is one call.
    expect(SCRIPT.slice(branch, branch + 200)).toContain(
      'touchFeedTimes(document)',
    );
  });
});
