import { renderDashboardPage } from '../page';

/**
 * `feedBucket`, run as the browser runs it.
 *
 * SLICED OUT OF THE SERVED DOCUMENT rather than imported from the fragment,
 * for the reason in CLAUDE.md: these fragments are TypeScript template
 * literals, and a fragment that compiled is not a fragment that shipped. What
 * is asserted here is the function the page actually hands a browser.
 *
 * It is the one function in the client script worth running in Jest: it is
 * pure, it touches no DOM, and it is the whole of a rule the server owns —
 * which IST day a filing belongs to. Everything else in the fragment builds
 * nodes and is the e2e suite's job.
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
