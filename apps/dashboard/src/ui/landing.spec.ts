import { BRAND, BRAND_DOMAIN } from './brand';
import { escapeHtml, renderLandingPage } from './landing';
import { SAMPLE_CARDS, SAMPLE_DISCARD } from './landing-samples';

/**
 * The landing page's invariants, which are mostly about what it does NOT do.
 *
 * This is the only page on the origin served to somebody who has not signed in,
 * so the properties worth holding are: it reads nothing, it references nothing
 * off-origin, it runs nothing, and no visitor can mistake an example for a
 * filing. Every one of those is a property a well-meaning edit could remove
 * without anything else noticing.
 */

const html = renderLandingPage();

describe('the landing page is self-contained', () => {
  it('references no external host at all', () => {
    // The same assertion `page.spec.ts` makes about the dashboard. The ONE
    // relaxation on this origin is `/auth`, which is a link away — this document
    // must not reach gstatic or anywhere else itself.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('loads no stylesheet, script or font from anywhere', () => {
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/<script/);
    expect(html).not.toContain('@font-face');
    expect(html).not.toMatch(/url\s*\(/);
  });

  it('carries no script element of any kind', () => {
    // NOT AN OVERSIGHT — see the header. The page has one interaction and a
    // link needs no JavaScript, so the least-authenticated page on the origin
    // is also the one with no client code on it.
    expect(html).not.toContain('</script>');
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('inlines its stylesheet', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('--bg: #0d1117');
  });
});

describe('it performs no read', () => {
  it('is a constant: two renders are the same bytes', () => {
    // A landing page that varied with request state would be a landing page
    // with request state to get wrong. It takes no arguments and holds none.
    expect(renderLandingPage()).toBe(html);
  });

  it('names no API route', () => {
    // There is nothing for it to call. If a fetch ever appears here it will be
    // the one unauthenticated route returning filing data, added for a
    // screenshot — which is the hole the whole gate exists to not have.
    expect(html).not.toContain('api/');
    expect(html).not.toContain('fetch(');
  });

  it('links only to the sign-in page', () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

    expect(hrefs.length).toBeGreaterThan(0);
    expect([...new Set(hrefs)]).toEqual(['/auth']);
  });
});

describe('nobody can mistake an example for a filing', () => {
  it('labels the sample block before the first ticker appears', () => {
    // ORDER MATTERS, not merely presence. A visitor must not reach a ticker
    // without having passed the word.
    const notice = html.indexOf('These are examples, not filings.');
    const firstTicker = html.indexOf(SAMPLE_CARDS[0].symbol);

    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(firstTicker);
  });

  it('badges every sample card individually', () => {
    // So a screenshot of ONE card still carries its own disclaimer.
    const badges = html.split('class="exbadge"').length - 1;

    // Three cards plus the worked example in the proof section.
    expect(badges).toBe(SAMPLE_CARDS.length + 1);
  });

  it('says signed-out visitors read no data', () => {
    expect(html).toContain(
      'Signed-out visitors read no data from this service',
    );
  });

  it('names no company that could be a listed scrip', () => {
    // `landing-samples.ts` carries the argument: a plausible figure beside a
    // real ticker on a marketing page is `results-line.ts`'s APOLLOTYRE failure
    // with none of the pipeline's defences in front of it. This is the cheap
    // half of that — the near-misses somebody might reach for.
    const forbidden = [
      'RELIANCE',
      'INFY',
      'TCS',
      'HDFC',
      'APOLLOTYRE',
      'ITC',
      'SBIN',
    ];

    for (const ticker of forbidden) {
      expect(html).not.toContain(ticker);
    }
  });
});

describe('the three numbers are invariants, not measurements', () => {
  it('quotes no count of filings, companies or days', () => {
    // A landing page quoting a figure from a database pass months ago is a
    // stale number a visitor cannot check — the company-page spec found one
    // wrong by a factor of 7.6. These three are properties of how the system is
    // built, true on every day it runs.
    expect(html).toContain('NSE + BSE');
    expect(html).toContain('figures calculated by us');
    expect(html).not.toMatch(/\d[\d,]*\s+filings (held|stored|covered)/i);
    expect(html).not.toMatch(/as of \d/i);
  });

  it('states the verbatim gate as the headline claim', () => {
    expect(html.replace(/\s+/g, ' ')).toContain(
      'every claim matched, character for character, against a span of the document it came from',
    );
  });
});

describe('it states the limits before anyone signs up', () => {
  it('says it publishes no rating', () => {
    expect(html).toContain('No ratings, targets or recommendations.');
    expect(html).toContain(
      `${BRAND} reports what documents say and shows you where they say it.`,
    );
  });

  it('shows a claim the gate threw away, with the reason', () => {
    // THE DENOMINATOR. Three verified cards and nothing else hides that a
    // fourth was proposed and refused, and the precision claim means nothing
    // without it.
    expect(html).toContain(escapeHtml(SAMPLE_DISCARD.text));
    expect(html).toContain(SAMPLE_DISCARD.reason);
  });

  it('carries the not-advice line and the IST note', () => {
    expect(html).toContain('Not investment advice');
    expect(html).toContain('All times are IST');
  });
});

describe('the brand comes through the constant', () => {
  it('titles the page and signs the footer with it', () => {
    expect(html).toContain(`<title>${BRAND} —`);
    expect(html).toContain(BRAND_DOMAIN);
  });

  it('prints the domain as text rather than as a link', () => {
    // BRAND_DOMAIN is copy. Nothing in the request path may read it, and a
    // hard-coded absolute link here would be the first place that changed.
    expect(html).not.toContain(`//${BRAND_DOMAIN}`);
  });
});

describe('escapeHtml', () => {
  it('neutralises the five characters that change meaning in HTML', () => {
    expect(escapeHtml(`<b>&"'`)).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });

  it('escapes the ampersand first, so nothing is double-encoded', () => {
    // `&` last would turn the `&lt;` this function just produced into
    // `&amp;lt;`, and the page would render its own escaping.
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('is applied to every sample value the page prints', () => {
    // Nothing here is untrusted today. The rule has no exception because an
    // exception is what the next person copies.
    for (const card of SAMPLE_CARDS) {
      expect(html).toContain(escapeHtml(card.companyName));
      for (const claim of card.claims) {
        expect(html).toContain(escapeHtml(claim.span));
      }
    }
  });
});

describe('the marks follow the figure, never the company', () => {
  it('draws the three direction glyphs and no fourth', () => {
    // The same three `script-feed.ts` draws, and outside the emoji range the
    // page tests reject.
    expect(html).toContain('▼');
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('includes a decrease that is good news', () => {
    // A falling default rate points down. It is the fastest way to explain that
    // the mark follows the figure, so the sample set is chosen to contain one.
    const falling = SAMPLE_CARDS.flatMap((card) => card.claims).find(
      (claim) => claim.direction === 'contraction',
    );

    expect(falling?.text).toContain('declined');
    expect(html).toContain(
      'A falling default rate points down and is good news',
    );
  });
});
