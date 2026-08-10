import { BRAND, BRAND_DOMAIN } from './brand';
import { escapeHtml, renderLandingPage } from './landing';
import { SAMPLE_CARDS } from './landing-samples';
import { BRAND_FAVICON_LINK, BRAND_LOGO } from './logo';

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

/**
 * Everything a visitor can actually read: tags stripped, entities resolved for
 * the two this page produces, whitespace collapsed.
 *
 * ATTRIBUTES ARE NOT COPY. `data-ui="claim-direction"` is a test hook and
 * `class="span"` is a stylesheet's business; neither is read by anybody. What is
 * asserted below is the text a stranger sees.
 */
const visibleText = html
  // The stylesheet's own text is not copy, and it is full of this project's
  // vocabulary in its comments. Drop the element, then the tags.
  .replace(/<style>[\s\S]*?<\/style>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ');

describe('it is written for somebody who has never read a filing', () => {
  /**
   * The words this project uses for itself, none of which a reader knows.
   *
   * Each one was on this page before: "every claim matched against a span", "the
   * verbatim gate", three numbered pipeline steps, an exhibit of a proposal the
   * gate discarded. They are the correct words INSIDE this repository and they
   * are the wrong words on the one page a stranger meets first, because every
   * one of them asks the reader to learn something before the promise means
   * anything. The guarantee is unchanged — see the copy tests below — and it is
   * now made in words nobody has to be taught.
   */
  const OURS = [
    'span',
    'spans',
    'claim',
    'claims',
    'verbatim',
    'gate',
    'gated',
    'pipeline',
    'discarded',
    'character for character',
  ];

  it.each(OURS)('does not say "%s" to a reader', (word) => {
    expect(visibleText).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });

  it('shows no numbered walk through how the system works', () => {
    // The three steps and the refused-proposal exhibit are gone, not renamed.
    expect(html).not.toContain('data-ui="how-it-works"');
    expect(html).not.toContain('data-ui="sample-discard"');
    expect(html).not.toContain('span-not-found');
  });

  it('leads with what the reader gets rather than with how it is built', () => {
    expect(html).toContain('data-ui="what-you-get"');
    expect(visibleText).toContain(
      'See what companies actually told the exchange.',
    );
  });
});

describe('the landing page is self-contained', () => {
  it('references no external host at all', () => {
    // The same assertion `page.spec.ts` makes about the dashboard. The ONE
    // relaxation on this origin is `/auth`, which is a link away — this document
    // must not reach gstatic or anywhere else itself.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('loads no stylesheet, script or font from anywhere', () => {
    // ONE LINK ELEMENT, AND IT LOADS NOTHING: the favicon is an SVG carried in
    // the attribute as a `data:` URI (`logo.ts`). A second link, or this one
    // pointing anywhere but `data:`, is a font or a stylesheet arriving from a
    // third party — on the one page served to people who have not agreed to
    // anything yet, which is what this assertion has always been for.
    expect([...html.matchAll(/<link[^>]*>/g)].map((match) => match[0])).toEqual(
      [BRAND_FAVICON_LINK],
    );
    expect(BRAND_FAVICON_LINK).toContain('href="data:image/svg+xml,');
    expect(html).not.toMatch(/<script/);
    expect(html).not.toContain('@font-face');
    // A FRAGMENT IS NOT A FETCH. The brand mark's gradient is 'url(#brandtile)'
    // and the favicon's is 'url(#f)' arriving percent-encoded as 'url(%23f)'
    // inside the data URI — both name a node in the very document that carries
    // them. The flat ban this replaces could not tell either from a CDN image
    // and would have refused all three.
    expect(html).not.toMatch(/url\(\s*(?!#|%23)/);
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
    // ANCHORS ONLY. The head carries one more `href` — the favicon's `data:`
    // URI — and it goes nowhere; the property worth holding is that every place
    // a visitor can CLICK leads to `/auth` and to nothing else.
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]*)"/g)].map(
      (m) => m[1],
    );

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

    // One per card, and no others: the worked example that carried the fourth
    // badge went with the "how it works" section it illustrated.
    expect(badges).toBe(SAMPLE_CARDS.length);
  });

  it('says a signed-out visitor is shown nothing from the records', () => {
    // The same promise the old copy made in our words ("signed-out visitors
    // read no data from this service"), in the reader's.
    expect(visibleText).toContain(
      'this page shows you nothing from our records',
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
    expect(html).toContain('numbers we work out ourselves');
    expect(html).not.toMatch(/\d[\d,]*\s+filings (held|stored|covered)/i);
    expect(html).not.toMatch(/as of \d/i);
  });

  it("makes the promise the product is built on, in the reader's words", () => {
    // THE SAME GUARANTEE THE OLD COPY MADE. It used to read "every claim
    // matched, character for character, against a span of the document it came
    // from", which is this repository talking to itself. The promise is
    // unchanged; the sentence is one a reader can repeat.
    const prose = html.replace(/\s+/g, ' ');

    expect(prose).toContain(
      'with the exact line from the document underneath. Never our opinion.',
    );
    expect(prose).toContain('Under every line is the sentence it came from');
  });
});

describe('it states the limits before anyone signs up', () => {
  it('says it publishes no rating', () => {
    expect(html).toContain('We never tell you what to buy.');
    expect(html).toContain(
      `${BRAND} shows you what a company said and where it said it.`,
    );
  });

  it('says it works no number out for you', () => {
    expect(html).toContain('We never do the maths for you.');
    expect(html).toContain('No margins, no growth rates, no ratios.');
  });

  it('carries the not-advice line and the IST note', () => {
    expect(html).toContain('Not investment advice');
    expect(html).toContain('All times are IST');
  });
});

describe('the brand comes through the constant', () => {
  it('draws the shared logo in the header', () => {
    // The same element the app's top bar and the sign-in panel draw, so the
    // three pages cannot end up with three slightly different logos.
    expect(html).toContain(BRAND_LOGO);
  });

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
      'A falling bad-loan figure points down, and that is good news.',
    );
  });
});
