import type { AuthConfig } from '../config/auth-config';
import {
  AUTH_SCRIPT_FIREBASE,
  AUTH_SCRIPT_LOCAL,
  AUTH_SCRIPT_SHARED,
} from './auth-script';
import {
  FIREBASE_SDK_ORIGIN,
  FIREBASE_SDK_VERSION,
  jsonForScript,
  renderAuthPage,
} from './auth-page';
import { AUTH_PAGE_STYLE } from './auth-page-style';
import { LANDING_STYLE } from './landing-style';
import { BRAND_FAVICON_LINK, BRAND_LOGO } from './logo';

/**
 * The sign-in page, and mostly the BOUNDARY of the one exception this codebase
 * makes to being self-contained.
 *
 * The invariant that has to survive is not "no external host" — this page has
 * one — it is "exactly one external host, exactly on this page, exactly in this
 * mode". An invariant with an exception is only worth anything if the exception
 * has a test on its edges, so most of what follows asserts what is NOT there.
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

const UNCONFIGURED: AuthConfig = {
  mode: 'firebase',
  firebase: null,
  missing: ['FIREBASE_PROJECT_ID', 'FIREBASE_WEB_API_KEY'],
};

/** Every absolute URL the document references, deduplicated. */
const externalOrigins = (html: string): string[] => [
  ...new Set(
    [...html.matchAll(/https?:\/\/[^\s"'<>]+/g)].map(
      (match) => new URL(match[0]).origin,
    ),
  ),
];

describe('the CDN relaxation, and its edges', () => {
  it('loads the Firebase SDK from gstatic and from nowhere else', () => {
    expect(externalOrigins(renderAuthPage(FIREBASE))).toEqual([
      FIREBASE_SDK_ORIGIN,
    ]);
  });

  it('pins the SDK version rather than floating it', () => {
    // A floating version means the code this page executes changes without a
    // deploy, on the one page where somebody types a password.
    const html = renderAuthPage(FIREBASE);

    expect(FIREBASE_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(html).toContain(
      `${FIREBASE_SDK_ORIGIN}/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`,
    );
    expect(html).not.toContain('/latest/');
  });

  it('references NOTHING external in local mode', () => {
    // A host that never asked for Firebase never ships a byte of it. This is
    // what makes "one exception" true of a deployment rather than of a file.
    const html = renderAuthPage(LOCAL);

    expect(externalOrigins(html)).toEqual([]);
    expect(html).not.toContain('firebase');
  });

  it('references nothing external when firebase is asked for and unconfigured', () => {
    expect(externalOrigins(renderAuthPage(UNCONFIGURED))).toEqual([]);
  });

  it('still refuses a font, a stylesheet and a remote image', () => {
    // The exception is the SDK. It is not a general licence to fetch things.
    const html = renderAuthPage(FIREBASE);

    // ONE LINK ELEMENT, AND IT LOADS NOTHING: the favicon is an SVG carried in
    // the attribute as a `data:` URI (`logo.ts`). A second one is a stylesheet
    // or a font, which is what this assertion is for.
    expect([...html.matchAll(/<link[^>]*>/g)].map((match) => match[0])).toEqual(
      [BRAND_FAVICON_LINK],
    );
    expect(BRAND_FAVICON_LINK).toContain('href="data:image/svg+xml,');
    expect(html).not.toContain('@font-face');
    expect(html).not.toMatch(/url\s*\(/);
    expect(html).not.toContain('<img');
  });

  it('shows the shared logo above the form', () => {
    // The moment before sign-in and the moment after it are the same product,
    // so the mark on this page is the app's mark rather than a copy.
    expect(renderAuthPage(FIREBASE)).toContain(BRAND_LOGO);
    expect(renderAuthPage(LOCAL)).toContain(BRAND_LOGO);
  });

  it('draws the Google mark in CSS rather than fetching a logo', () => {
    expect(renderAuthPage(FIREBASE)).toContain('class="gmark"');
  });
});

describe('what each mode renders', () => {
  it('offers Google and a password form in firebase mode', () => {
    const html = renderAuthPage(FIREBASE);

    expect(html).toContain('Continue with Google');
    expect(html).toContain('id="auth-form"');
    expect(html).toContain('id="auth-google"');
  });

  it('offers only the password form in local mode', () => {
    const html = renderAuthPage(LOCAL);

    expect(html).toContain('id="auth-form"');
    expect(html).not.toContain('Continue with Google');
    // The route it posts to is the one the dashboard's panel already used.
    expect(html).toContain('api/auth/login');
    expect(html).toContain('api/auth/register');
  });

  it('names the missing variables, and ships no form at all', () => {
    const html = renderAuthPage(UNCONFIGURED);

    expect(html).toContain('FIREBASE_PROJECT_ID');
    expect(html).toContain('FIREBASE_WEB_API_KEY');
    expect(html).toContain('AUTH_MODE=local');
    // NO FORM. A sign-in box that cannot sign anybody in is worse than an
    // honest sentence saying so.
    expect(html).not.toContain('id="auth-form"');
    expect(html).not.toContain('<script');
  });

  it('carries the local password path only in local mode', () => {
    expect(renderAuthPage(LOCAL)).toContain(AUTH_SCRIPT_LOCAL);
    expect(renderAuthPage(FIREBASE)).not.toContain(AUTH_SCRIPT_LOCAL);
    expect(renderAuthPage(FIREBASE)).toContain(AUTH_SCRIPT_FIREBASE);
  });
});

describe('the fragments obey the template-literal rules', () => {
  const FRAGMENTS: ReadonlyArray<readonly [string, string]> = [
    ['auth-script shared', AUTH_SCRIPT_SHARED],
    ['auth-script local', AUTH_SCRIPT_LOCAL],
    ['auth-script firebase', AUTH_SCRIPT_FIREBASE],
    // THE STYLESHEETS ARE IN THIS LIST TOO, and they earned their place: the
    // first draft of `auth-page-style.ts` put a CSS comment reading
    // "min-height rather than height" in backticks, which closed the template
    // literal and turned the rest of the file into TypeScript. tsc caught that
    // one. It does not always: a backtick whose remainder still parses ships a
    // page that serves 200 and throws on load, which is the failure this whole
    // convention exists to prevent.
    ['landing-style', LANDING_STYLE],
    ['auth-page-style', AUTH_PAGE_STYLE],
  ];

  it.each(FRAGMENTS)('%s carries no backtick of its own', (_name, source) => {
    // The one that ends the fragment's template literal early, taking the rest
    // of the file into TypeScript and out of the browser.
    expect(source).not.toContain('`');
  });

  it.each(FRAGMENTS)('%s carries no interpolation', (_name, source) => {
    // Evaluated by the compiler and gone before a browser sees it. This is why
    // the Firebase keys arrive through a JSON element instead.
    expect(source).not.toContain('${');
  });

  it('parses as JavaScript once assembled', () => {
    // The failure this guards is the one that has shipped here more than once:
    // a document that serves 200, contains every id a test looks for, and
    // throws on load. The module version cannot be `new Function`-ed because of
    // its imports, so the local one stands in for the shared half.
    expect(
      () => new Function(AUTH_SCRIPT_SHARED + AUTH_SCRIPT_LOCAL),
    ).not.toThrow();
  });

  it('reaches every element it addresses', () => {
    // A fragment that calls `el('auth-ok')` on a page with no such id fails at
    // the first message rather than at load, which is the kind of break a
    // string test can catch and a smoke test cannot.
    const html = renderAuthPage(FIREBASE);
    const ids = [
      ...new Set(
        [
          ...(AUTH_SCRIPT_SHARED + AUTH_SCRIPT_FIREBASE).matchAll(
            /el\('([a-z-]+)'\)/g,
          ),
        ].map((match) => match[1]),
      ),
    ];

    expect(ids.length).toBeGreaterThan(4);
    for (const id of ids) {
      expect([id, html.includes(`id="${id}"`)]).toEqual([id, true]);
    }
  });
});

describe('the project keys in the page', () => {
  it('carries them as JSON data rather than as script source', () => {
    const html = renderAuthPage(FIREBASE);

    expect(html).toContain(
      '<script type="application/json" id="firebase-config">',
    );
    expect(html).toContain('AIza-not-a-secret');
  });

  it('escapes anything that could close the script element', () => {
    // The HTML tokeniser looks for the closing sequence; it does not parse
    // JSON, so quoting is no defence. These values come from an operator's
    // environment, so this catches a typo rather than an attacker — which is
    // exactly how every injection ships.
    expect(jsonForScript({ projectId: '</script><b>' })).not.toContain(
      '</script>',
    );
    expect(
      JSON.parse(jsonForScript({ projectId: '</script>' })) as {
        projectId: string;
      },
    ).toEqual({ projectId: '</script>' });
  });
});

describe('the same rules as every other page here', () => {
  it('uses no emoji, which the page tests reject', () => {
    expect(renderAuthPage(FIREBASE)).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
    );
  });

  it('gives the two message lines different elements', () => {
    // A refusal and a "check your inbox" are opposite outcomes, and one red box
    // for both teaches a reader to read every message as a failure.
    const html = renderAuthPage(FIREBASE);

    expect(html).toContain('id="auth-error"');
    expect(html).toContain('id="auth-ok"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="status"');
  });

  it('offers a way back to the landing page', () => {
    expect(renderAuthPage(FIREBASE)).toContain('href="/"');
  });

  it('collapses the four credential failures into one sentence', () => {
    // Firebase distinguishes user-not-found from wrong-password, which is a
    // registered-address oracle. This product's password path spends its whole
    // header refusing to build one.
    expect(AUTH_SCRIPT_FIREBASE).toContain('auth/user-not-found');
    expect(AUTH_SCRIPT_FIREBASE).toContain('auth/wrong-password');
    expect(AUTH_SCRIPT_FIREBASE).toContain(
      "return 'Email or password is incorrect.';",
    );
  });
});
