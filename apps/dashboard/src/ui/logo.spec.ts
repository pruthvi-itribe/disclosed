import { BRAND, BRAND_MARK } from './brand';
import { LANDING_STYLE } from './landing-style';
import { PAGE_STYLE } from './page-style';
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
    // EVERY url() MUST BE A FRAGMENT. This was a flat ban on 'url(' until the
    // mark gained a gradient, which is referenced as 'url(#brandtile)' and
    // fetches nothing — the ban had been standing in for the rule rather than
    // stating it. The rule is that nothing here names a resource outside this
    // document, so what is asserted is the '#'.
    expect(BRAND_LOGO_SVG).not.toMatch(/url\(\s*[^#]/);
  });

  it('names every colour as a palette token, and none as a hex', () => {
    // WHAT REPLACED currentColor, AND WHY THE PROPERTY SURVIVED THE CHANGE.
    // The old line-and-dot mark inherited the surrounding text colour, which is
    // how one drawing worked on the app and on the landing page at once. The
    // tile carries its own ground instead, so it does not need to inherit — it
    // is legible against ANY text colour rather than against the one it copies.
    // The invariant asserted here is the one that did not change: not one hex
    // literal, so a re-theme is a change to :root and to nothing else.
    for (const token of ['--brand-1', '--brand-2', '--brand-ink', '--flash']) {
      expect(BRAND_LOGO_SVG).toContain(`var(${token})`);
    }
    expect(BRAND_LOGO_SVG).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('fills the tile and the document from one gradient in user space', () => {
    // The document reads as a hole punched through the D only while it samples
    // the SAME ramp as the tile behind it. Under the SVG default the gradient
    // restarts inside the document's own box and the hole shows a violet the
    // tile does not have two pixels away — a bug that looks like a rendering
    // artefact and is a missing attribute.
    expect(BRAND_LOGO_SVG).toContain('gradientUnits="userSpaceOnUse"');
    expect(BRAND_LOGO_SVG.match(/url\(#brandtile\)/g)).toHaveLength(2);
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
    // THE ONE PLACE HEX IS RIGHT. `var(--brand-1)` resolves against the
    // document that declared it; a favicon is rendered outside every document,
    // so the same trick that makes the inline mark themeable would make this
    // invisible.
    expect(BRAND_FAVICON_SVG).toContain('#4338ca');
    expect(BRAND_FAVICON_SVG).toContain('#7c3aed');
    expect(BRAND_FAVICON_SVG).toContain('#22d3ee');
    expect(BRAND_FAVICON_SVG).not.toContain('var(--');
  });

  it('carries the palette values, not a second set that looks like them', () => {
    // THE COST OF THE EXEMPTION ABOVE, PAID HERE. Three hexes copied out of
    // :root drift the moment somebody re-tunes the brand and greps for
    // '--brand-1' — which finds two stylesheets and not this file. So the copy
    // is checked against the original rather than trusted.
    expect(PAGE_STYLE).toContain('--brand-1: #4338ca;');
    expect(PAGE_STYLE).toContain('--brand-2: #7c3aed;');
    expect(PAGE_STYLE).toContain('--flash: #22d3ee;');
    // And the app and the landing page declare one palette, not two.
    for (const token of ['--accent', '--brand-1', '--brand-2', '--flash']) {
      const read = (sheet: string) =>
        new RegExp(`${token}: (#[0-9a-f]{6});`).exec(sheet)?.[1];
      expect(read(LANDING_STYLE)).toBe(read(PAGE_STYLE));
    }
  });

  it('drops what a 16px tile cannot hold, and keeps the silhouette', () => {
    // The document's two text lines are 1.8 units of 32 — under a pixel at tab
    // size, where they render as haze over the D. The tile, the D and the fold
    // are the identity and they all survive, so the icon is the mark rather
    // than a different drawing that shares its colours.
    expect(BRAND_FAVICON_SVG).not.toContain('stroke');
    expect(BRAND_FAVICON_SVG.match(/<path/g)).toHaveLength(3);
    expect(BRAND_LOGO_SVG.match(/<path/g)).toHaveLength(4);
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
