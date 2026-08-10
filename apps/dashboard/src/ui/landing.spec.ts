import type { AuthConfig } from '../config/auth-config';
import { AUTH_SCRIPT_FIREBASE } from './auth-script';
import { BRAND, BRAND_DOMAIN } from './brand';
import { FIREBASE_SDK_ORIGIN, FIREBASE_SDK_VERSION } from './firebase-sdk';
import { escapeHtml, renderLandingPage } from './landing';
import { SAMPLE_CARDS } from './landing-samples';
import { LANDING_SCRIPT_FIREBASE } from './landing-script';
import { BRAND_FAVICON_LINK, BRAND_LOGO } from './logo';

/**
 * The landing page's invariants, which are mostly about what it does NOT do.
 *
 * This is the only page on the origin served to somebody who has not signed in,
 * so the properties worth holding are: it reads nothing, it references nothing
 * off-origin but the pinned SDK that signs people in, it runs nothing else, and
 * no visitor can mistake an example for a filing. Every one of those is a
 * property a well-meaning edit could remove without anything else noticing.
 *
 * TWO DOCUMENTS, AND MOST ASSERTIONS BELONG TO BOTH. `html` is what a `local`
 * host serves — no script, no external anything, which is what this file
 * asserted about every host before the sign-in popup existed. `firebaseHtml` is
 * the same document plus the two script elements that open Google's popup in
 * place, and the pair of tests on the copy proves that "plus" is the whole
 * difference.
 */

const FIREBASE: AuthConfig = {
  mode: 'firebase',
  firebase: {
    projectId: 'disclosed-live',
    webApiKey: 'AIza-not-a-secret',
    authDomain: 'disclosed-live.firebaseapp.com',
  },
  missing: [],
};

const LOCAL: AuthConfig = { mode: 'local', firebase: null, missing: [] };

/** Firebase asked for, keys not arrived: no SDK, because there is no project. */
const UNCONFIGURED: AuthConfig = {
  mode: 'firebase',
  firebase: null,
  missing: ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY'],
};

const html = renderLandingPage(LOCAL);
const firebaseHtml = renderLandingPage(FIREBASE);

/** Every absolute URL the document references, deduplicated. */
const externalOrigins = (document: string): string[] => [
  ...new Set(
    [...document.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(
      (match) => new URL(match[0]).origin,
    ),
  ),
];

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
  it('references NOTHING external without live Firebase keys', () => {
    // A host that never asked for Firebase never ships a byte of it, and
    // neither does one whose keys have not arrived. This is what makes "one
    // relaxation, two pages, one mode" true of a deployment rather than of a
    // file — the same pair `auth-page.spec.ts` makes about the sign-in page.
    expect(externalOrigins(html)).toEqual([]);
    expect(html).not.toContain('firebase');
    expect(externalOrigins(renderLandingPage(UNCONFIGURED))).toEqual([]);
  });

  it('loads the Firebase SDK from gstatic and from nowhere else', () => {
    // THE EDGE OF THE EXCEPTION. Not "no external host" — this document has one
    // in this mode — but "exactly one external host, exactly in this mode".
    expect(externalOrigins(firebaseHtml)).toEqual([FIREBASE_SDK_ORIGIN]);
  });

  it('pins the SDK version rather than floating it', () => {
    // A floating version means the code this page executes changes without a
    // deploy, on the most-served page on the origin.
    expect(firebaseHtml).toContain(
      `${FIREBASE_SDK_ORIGIN}/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`,
    );
    expect(firebaseHtml).not.toContain('/latest/');
  });

  it('loads no stylesheet, script or font from anywhere', () => {
    // ONE LINK ELEMENT, AND IT LOADS NOTHING: the favicon is an SVG carried in
    // the attribute as a `data:` URI (`logo.ts`). A second link, or this one
    // pointing anywhere but `data:`, is a font or a stylesheet arriving from a
    // third party — on the one page served to people who have not agreed to
    // anything yet, which is what this assertion has always been for.
    for (const document of [html, firebaseHtml]) {
      expect(
        [...document.matchAll(/<link[^>]*>/g)].map((match) => match[0]),
      ).toEqual([BRAND_FAVICON_LINK]);
      expect(document).not.toContain('@font-face');
      // A FRAGMENT IS NOT A FETCH. The brand mark's gradient is
      // 'url(#brandtile)' and the favicon's is 'url(#f)' arriving
      // percent-encoded as 'url(%23f)' inside the data URI — both name a node
      // in the very document that carries them. The flat ban this replaces
      // could not tell either from a CDN image and would have refused all three.
      expect(document).not.toMatch(/url\(\s*(?!#|%23)/);
      expect(document).not.toContain('<img');
    }
    expect(BRAND_FAVICON_LINK).toContain('href="data:image/svg+xml,');
  });

  it('carries no script element at all without live Firebase keys', () => {
    // NOT AN OVERSIGHT — see the header. Without a Firebase project there is
    // nothing for a script to do here: the buttons are links, and a link needs
    // no JavaScript.
    for (const document of [html, renderLandingPage(UNCONFIGURED)]) {
      expect(document).not.toContain('</script>');
    }
  });

  it('wires the popup through addEventListener, never through markup', () => {
    // NO INLINE HANDLER, IN EITHER MODE. An `onclick=` attribute is the shape
    // every other page here refuses, and the one that would make this page's
    // single script element an argument about what else may go in an attribute.
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(firebaseHtml).not.toMatch(/\son[a-z]+\s*=/i);
    expect(LANDING_SCRIPT_FIREBASE).toContain('addEventListener');
  });

  it('inlines its stylesheet', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('--bg: #0d1117');
  });
});

describe('it performs no read', () => {
  it('holds no request state: two renders of a mode are the same bytes', () => {
    // A landing page that varied with the REQUEST would be a landing page with
    // request state to get wrong. It takes the server's own auth configuration
    // and nothing else, so every signed-out visitor to a host gets one document.
    expect(renderLandingPage(LOCAL)).toBe(html);
    expect(renderLandingPage(FIREBASE)).toBe(firebaseHtml);
  });

  it('names no API route without live Firebase keys', () => {
    // There is nothing for it to call. If a fetch ever appears here it will be
    // the one unauthenticated route returning filing data, added for a
    // screenshot — which is the hole the whole gate exists to not have.
    expect(html).not.toContain('api/');
    expect(html).not.toContain('fetch(');
  });

  it('names exactly one API route in firebase mode, and it is a write', () => {
    // THE READ ROUTES ARE THE POINT. The sign-in exchange posts an ID token and
    // gets a session cookie back; it returns no filing and reads no collection.
    // A second path appearing in this list is the hole the gate exists to not
    // have, whatever it is called.
    const paths = [
      ...new Set(
        [...firebaseHtml.matchAll(/api\/[a-z/-]+/g)].map((match) => match[0]),
      ),
    ];

    expect(paths).toEqual(['api/auth/firebase']);
  });

  it('links only to the sign-in page, in both modes', () => {
    // ANCHORS ONLY. The head carries one more `href` — the favicon's `data:`
    // URI — and it goes nowhere; the property worth holding is that every place
    // a visitor can CLICK leads to `/auth` and to nothing else.
    //
    // TRUE IN FIREBASE MODE TOO, and that is not an accident: the popup is an
    // intercepted click on the same anchor, so a broken or blocked script
    // leaves every button on this page the working link it was.
    for (const document of [html, firebaseHtml]) {
      const hrefs = [...document.matchAll(/<a [^>]*href="([^"]*)"/g)].map(
        (m) => m[1],
      );

      expect(hrefs.length).toBeGreaterThan(0);
      expect([...new Set(hrefs)]).toEqual(['/auth']);
    }
  });
});

describe('the sign-in popup, in firebase mode only', () => {
  it('adds the popup and its lines, and changes not one word of the copy', () => {
    // THE STRONGEST THING THIS FILE SAYS ABOUT THE RELAXATION, and it says it
    // by subtraction: everything firebase mode adds to this document is the two
    // script elements and, around each sign-in anchor, the slot and the empty
    // line it speaks into. Take those away and the byte-for-byte `local`
    // document is what remains — so no copy, no card, no disclaimer, no link
    // and no anchor attribute differs between a host with a Firebase project
    // and one without.
    const withoutPopup = firebaseHtml
      .replace(/\n<script[\s\S]*?<\/script>/g, '')
      .replace(
        /<span class="ctaslot">([\s\S]*?)<span class="ctaerr"[^>]*><\/span><\/span>/g,
        '$1',
      );

    expect(withoutPopup).toBe(html);
    expect(firebaseHtml).toContain(
      '<script type="application/json" id="firebase-config">',
    );
    expect(firebaseHtml).toContain('AIza-not-a-secret');
  });

  it('gives every call to action a line to speak into', () => {
    // ONE SLOT PER BUTTON, because the message has to appear under the button
    // that was pressed — a marketing page's three calls to action are metres
    // apart and a single shared error line would report the failure somewhere
    // the reader is not looking.
    const slots = firebaseHtml.split('class="ctaslot"').length - 1;

    expect(slots).toBe(3);
    expect(firebaseHtml).toContain('data-ui="signin-error-hero"');
    expect(firebaseHtml).toContain('role="alert"');
    // AND NO SUCH ELEMENT on a host with no popup to fail. The two RULES ship
    // in both modes because there is one stylesheet — the same way `/auth`
    // carries `.gmark` on a host that draws no Google button — but a hidden
    // element with no script to fill it would be furniture.
    expect(html).not.toContain('class="ctaslot"');
    expect(html).not.toContain('class="ctaerr"');
  });

  it('answers a blocked popup by going to the page that does not need one', () => {
    // THE FALLBACK IS THE HREF, ARRIVED AT THE LONG WAY. `/auth` signs people
    // in exactly as it did before this existed, so a browser that refuses
    // popups loses nothing but a page load.
    expect(LANDING_SCRIPT_FIREBASE).toContain("'auth/popup-blocked'");
    expect(LANDING_SCRIPT_FIREBASE).toContain(
      "'auth/operation-not-supported-in-this-environment'",
    );
    expect(LANDING_SCRIPT_FIREBASE).toContain(
      "window.location.assign('/auth')",
    );
  });

  it('says nothing when the reader closes the window, or presses again', () => {
    // Both are decisions rather than failures. The second one is why there is
    // no "one popup at a time" latch: Firebase took a measured 10.0s to notice
    // a closed window, and a latch held that long is a button that does nothing
    // for ten seconds after somebody changes their mind. See `landing-script.ts`.
    expect(LANDING_SCRIPT_FIREBASE).toContain("'auth/popup-closed-by-user'");
    expect(LANDING_SCRIPT_FIREBASE).toContain("'auth/cancelled-popup-request'");
    expect(LANDING_SCRIPT_FIREBASE).toContain(
      'if (Object.prototype.hasOwnProperty.call(SILENT, code)) return;',
    );
  });

  it('shows the sentences the sign-in page shows, and no others', () => {
    // THE TWO PAGES MUST NOT DISAGREE about what a failure means. These are
    // `auth-script.ts`'s own lines for the codes a popup can still produce once
    // it has opened, and its fallback sentence for everything unmapped.
    for (const line of [
      'Could not reach the sign-in service. Check your connection.',
      'Too many attempts. Wait a few minutes and try again.',
      'That sign-in did not work. Try again.',
    ]) {
      expect([line, AUTH_SCRIPT_FIREBASE.includes(line)]).toEqual([line, true]);
      expect([line, LANDING_SCRIPT_FIREBASE.includes(line)]).toEqual([
        line,
        true,
      ]);
    }
  });

  it('ships no password call and no verification lane', () => {
    // The verification mail is `/auth`'s job — Google asserts the address, so a
    // copy of that lane here would be a branch nobody reaches maintained on the
    // marketing page. An unverified record is handed over instead.
    for (const gone of [
      'sendEmailVerification',
      'signInWithEmailAndPassword',
      'createUserWithEmailAndPassword',
      'password',
    ]) {
      expect([gone, firebaseHtml.includes(gone)]).toEqual([gone, false]);
    }
    expect(LANDING_SCRIPT_FIREBASE).toContain('emailVerified');
  });

  it('drops the Firebase session the moment our cookie exists', () => {
    // Our opaque cookie is the session from there. Nothing in `localStorage`,
    // and no Google session left alive behind a signed-out reader on a shared
    // machine — the same exchange `auth-script.ts` performs.
    expect(LANDING_SCRIPT_FIREBASE).toContain('signOut(auth)');
    expect(LANDING_SCRIPT_FIREBASE).toContain("window.location.replace('/')");
  });
});

describe('the landing fragment obeys the template-literal rules', () => {
  // THE SAME GUARD `script-fragments.spec.ts` PUTS ON THE DASHBOARD'S TEN and
  // `auth-page.spec.ts` puts on the sign-in page's three. It is here rather
  // than in either of those because this fragment belongs to this page: those
  // files import their own page's modules and a fragment guarded somewhere else
  // is a guard the next person deletes with the import.
  it('carries no backtick of its own', () => {
    // The one that ends the fragment's template literal early, taking the rest
    // of the file into TypeScript and out of the browser.
    expect(LANDING_SCRIPT_FIREBASE).not.toContain('`');
  });

  it('carries no interpolation', () => {
    // Evaluated by the compiler and gone before a browser sees it. This is why
    // the Firebase keys arrive through a JSON element instead.
    expect(LANDING_SCRIPT_FIREBASE).not.toContain('${');
  });

  it('parses as JavaScript', () => {
    // The failure this guards is the one that has shipped here more than once:
    // a document that serves 200, contains every id a test looks for, and
    // throws on load. The SDK imports are free identifiers to `new Function`,
    // which is fine — it compiles the body, it does not resolve names.
    expect(() => new Function(LANDING_SCRIPT_FIREBASE)).not.toThrow();
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
