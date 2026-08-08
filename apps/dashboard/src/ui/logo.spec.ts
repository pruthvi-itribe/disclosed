import { BRAND, BRAND_MARK } from './brand';
import {
  BRAND_FAVICON_DATA_URI,
  BRAND_FAVICON_LINK,
  BRAND_FAVICON_SVG,
  BRAND_LOGO,
  BRAND_LOGO_STYLE,
  BRAND_LOGO_SVG,
} from './logo';

/**
 * The logo's invariants.
 *
 * A logo is the one asset a product is most tempted to fetch from somewhere, and
 * the one every page shows. So the properties held here are: it is drawn in this
 * repository, it fetches nothing, it spells the name the way the brand constant
 * spells it, and the favicon carries its own colours because a custom property
 * resolves to nothing in a browser tab.
 */

describe('the mark is drawn here, not fetched', () => {
  it('is inline SVG with no image, no font and no external host', () => {
    expect(BRAND_LOGO_SVG.startsWith('<svg')).toBe(true);
    expect(BRAND_LOGO_SVG).not.toMatch(/https?:\/\//);
    expect(BRAND_LOGO_SVG).not.toContain('<image');
    expect(BRAND_LOGO_SVG).not.toMatch(/url\s*\(/);
  });

  it('takes its non-brand colour from the text around it', () => {
    // What makes one drawing work on the dark app, the dark landing page and
    // anywhere either of them is later re-themed: the frame and the two quiet
    // lines inherit, and only the two brand colours are named.
    expect(BRAND_LOGO_SVG).toContain('currentColor');
    expect(BRAND_LOGO_SVG).toContain('var(--accent)');
    expect(BRAND_LOGO_SVG).toContain('var(--bad)');
    expect(BRAND_LOGO_SVG).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('is hidden from a screen reader, because the wordmark is text', () => {
    // An aria-label on the mark plus the word beside it is "Disclosed
    // Disclosed" read aloud.
    expect(BRAND_LOGO_SVG).toContain('aria-hidden="true"');
    expect(BRAND_LOGO_SVG).not.toContain('aria-label');
  });
});

describe('the wordmark spells the name the way the brand constant does', () => {
  it('sets the word with its capital D, from the constant', () => {
    expect(BRAND_LOGO).toContain(`>${BRAND}<span class="dotmark">`);
    expect(BRAND_LOGO).not.toContain('disclosed');
  });

  it('carries the accent as the constant holds it', () => {
    expect(BRAND_LOGO).toContain(
      `${BRAND_MARK.word}<span class="dotmark">${BRAND_MARK.accent}</span>`,
    );
  });

  it('locks the mark and the word into one element', () => {
    // One element, so a page cannot place the mark and forget the word, and so
    // the gap between them is decided in one stylesheet rather than three.
    expect(BRAND_LOGO.startsWith('<span class="logo"')).toBe(true);
    expect(BRAND_LOGO).toContain(BRAND_LOGO_SVG);
    expect(BRAND_LOGO_STYLE).toContain('.logo {');
    expect(BRAND_LOGO_STYLE).toContain('.logomark');
    expect(BRAND_LOGO_STYLE).toContain('.dotmark');
  });
});

describe('the artwork obeys the template-literal rules', () => {
  // Every one of these is concatenated into a page that is itself a template
  // literal. A backtick in a CSS comment here ends the string it lands in and
  // takes the rest of the file into TypeScript — which is the sharp edge
  // CLAUDE.md records, and which this change hit twice while it was being made.
  it.each([
    ['the mark', BRAND_LOGO_SVG],
    ['the lockup', BRAND_LOGO],
    ['the favicon', BRAND_FAVICON_SVG],
    ['the stylesheet', BRAND_LOGO_STYLE],
  ])('%s carries no backtick', (_name, source) => {
    expect(source).not.toContain('`');
  });
});

describe('the favicon', () => {
  it('names its own colours, because a tab has no stylesheet', () => {
    // THE ONE PLACE HEX IS RIGHT. `var(--accent)` resolves against the document
    // that declared it; a favicon is rendered outside every document, so the
    // same trick that makes the inline mark themeable would make this invisible.
    expect(BRAND_FAVICON_SVG).toContain('#58a6ff');
    expect(BRAND_FAVICON_SVG).toContain('#f85149');
    expect(BRAND_FAVICON_SVG).not.toContain('var(--');
  });

  it('is a data URI: the icon travels in the attribute', () => {
    expect(BRAND_FAVICON_LINK).toBe(
      `<link rel="icon" href="${BRAND_FAVICON_DATA_URI}">`,
    );
    expect(BRAND_FAVICON_DATA_URI.startsWith('data:image/svg+xml,')).toBe(true);
  });

  it('encodes the characters that would truncate or escape the attribute', () => {
    // A `#` unencoded ends the URI at the fragment and the icon renders as an
    // empty tile — which is exactly what a hand-written escape list forgets.
    for (const raw of ['#', '<', '>', '"']) {
      expect(BRAND_FAVICON_DATA_URI).not.toContain(raw);
    }
    expect(decodeURIComponent(BRAND_FAVICON_DATA_URI.slice(19))).toBe(
      BRAND_FAVICON_SVG,
    );
  });

  it('references exactly one absolute URL, and it is the XML namespace', () => {
    // STATED HERE BECAUSE THE PAGE SUITES CANNOT SEE IT. They assert their
    // rendered documents contain no `https?://`, and the encoded URI passes that
    // by construction — so the fact worth holding is this one: the only absolute
    // URL in the artwork is `xmlns`, which is an identifier a standalone SVG
    // cannot parse without and which no browser has ever fetched.
    const urls = [
      ...decodeURIComponent(BRAND_FAVICON_DATA_URI).matchAll(
        /https?:\/\/[^\s"']+/g,
      ),
    ].map((match) => match[0]);

    expect(urls).toEqual(['http://www.w3.org/2000/svg']);
  });
});
