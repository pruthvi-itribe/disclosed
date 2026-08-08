import { BRAND_MARK } from './brand';

/**
 * The logo: one mark, one wordmark, one favicon, drawn here and nowhere else.
 *
 * ================================================================
 * WHAT THE MARK IS A PICTURE OF
 * ================================================================
 *
 * A document with one line running out of it, and that line ends in the full
 * stop the wordmark ends in. It is the product drawn rather than decorated: a
 * company files a document, one line in it is the thing worth reading, and this
 * service publishes that line and the document it came out of. The opening in
 * the document's right edge is deliberate — the line leaves through a gap rather
 * than crossing the border, so it reads as taken out rather than struck through.
 *
 * The dot is the same dot as the wordmark's, in the same colour, so the mark and
 * the word are one thing seen twice rather than two marks that happen to sit
 * together.
 *
 * ================================================================
 * DRAWN, NOT FETCHED
 * ================================================================
 *
 * Inline SVG, in this repository, with no external file, no icon font and no
 * image request — the same rule the stylesheets follow, for the same reason: the
 * landing page is served to people who have not agreed to anything yet, and a
 * logo pulled from a CDN hands that CDN a request log of every one of them.
 *
 * THE COLOURS COME FROM THE PALETTE, not from hex literals: the frame and the
 * two quiet lines are `currentColor` at reduced opacity, so the mark inherits
 * whatever colour the text around it has, and only the two brand colours —
 * `--accent` for the line, `--bad` for the full stop — are named. That is what
 * makes it dark-friendly without a second copy of the artwork.
 *
 * ================================================================
 * ONE MODULE, THREE PAGES
 * ================================================================
 *
 * `landing.ts`, `page.ts` and `auth-page.ts` all take the markup and the CSS
 * from here. Three hand-written copies of a wordmark is how a product ends up
 * with two logos, and this file exists so the next change to the mark is one
 * edit rather than three.
 */

/**
 * The mark, at 26 × 24, as the pages embed it.
 *
 * SIZED IN `em` BY THE STYLESHEET, not by these attributes — the `width` and
 * `height` here are the fallback a browser uses before any CSS applies, which
 * matters for nothing except never rendering the SVG default of 300 × 150.
 *
 * `aria-hidden`, because the wordmark beside it says the name in text. An
 * `aria-label` here would make a screen reader announce "Disclosed Disclosed".
 */
export const BRAND_LOGO_SVG = `<svg class="logomark" viewBox="0 0 26 24" width="26" height="24" fill="none" aria-hidden="true" focusable="false"><path d="M5.9 3H14.1A3.4 3.4 0 0 1 17.5 6.4V9.6" stroke="currentColor" stroke-opacity=".5" stroke-width="1.7" stroke-linecap="round"/><path d="M17.5 14.4V17.6A3.4 3.4 0 0 1 14.1 21H5.9A3.4 3.4 0 0 1 2.5 17.6V6.4A3.4 3.4 0 0 1 5.9 3" stroke="currentColor" stroke-opacity=".5" stroke-width="1.7" stroke-linecap="round"/><path d="M6.6 8H12.4" stroke="currentColor" stroke-opacity=".32" stroke-width="1.7" stroke-linecap="round"/><path d="M6.6 16H10.6" stroke="currentColor" stroke-opacity=".32" stroke-width="1.7" stroke-linecap="round"/><path d="M6.6 12H21.1" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round"/><circle cx="23.7" cy="12" r="1.6" fill="var(--bad)"/></svg>`;

/**
 * The mark and the wordmark, locked together.
 *
 * A CAPITAL D. The word is a proper noun and a sentence — *Disclosed.* — and
 * lowercasing it made the header read like a file name. `brand.ts` now holds the
 * cased spelling, so the one place the case could differ is the one place it is
 * decided.
 */
export const BRAND_LOGO = `<span class="logo" data-ui="brand-logo">${BRAND_LOGO_SVG}<span class="logotype">${BRAND_MARK.word}<span class="dotmark">${BRAND_MARK.accent}</span></span></span>`;

/**
 * The mark alone, at favicon size, with the frame and the quiet lines dropped.
 *
 * A DIFFERENT DRAWING ON PURPOSE. The full mark has five elements inside 24
 * units; at 16 physical pixels those become four grey smudges. What survives at
 * that size is a shape, one bright bar and one dot, so the tab icon is the tile,
 * the line and the full stop — the same three ideas, with everything that only
 * reads at 20px taken out.
 *
 * HEX RATHER THAN CUSTOM PROPERTIES, unlike the inline mark: a favicon is
 * rendered outside the document, where `var(--accent)` resolves to nothing and
 * the icon would be invisible. The tile is the application's own background, so
 * the icon is a solid chip on a light or a dark tab strip either way.
 */
export const BRAND_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0d1117"/><rect x=".75" y=".75" width="30.5" height="30.5" rx="6.25" fill="none" stroke="#2a323d" stroke-width="1.5"/><path d="M8 16H20" stroke="#58a6ff" stroke-width="4" stroke-linecap="round"/><circle cx="25" cy="16" r="2.6" fill="#f85149"/></svg>`;

/**
 * The favicon as a `data:` URI, encoded the boring way.
 *
 * `encodeURIComponent` rather than a hand-written set of replacements: a data
 * URI carrying a `#` unencoded is truncated at the fragment, and the list of
 * characters that need escaping in an attribute value is exactly the list this
 * function already knows. It over-encodes — the slashes and colons in the XML
 * namespace come out as `%2F` and `%3A` — which costs a few bytes and removes a
 * class of bug nobody should have to think about again.
 *
 * ABOUT THAT NAMESPACE: `xmlns` is the one absolute URL anywhere in this
 * product's markup, and it is an identifier rather than an address. A standalone
 * SVG will not parse without it, and no browser has ever fetched it. The page
 * suites assert their documents contain no `https?://` and continue to pass
 * here, so `logo.spec.ts` states the fact directly instead: the decoded icon
 * contains exactly one absolute URL, and it is the namespace.
 */
export const BRAND_FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(
  BRAND_FAVICON_SVG,
)}`;

/**
 * The `<link>` the three pages put in their heads.
 *
 * THE ONLY `<link>` ELEMENT IN THIS PRODUCT, and it loads nothing: the icon
 * travels in the attribute. `landing.spec.ts`, `page.spec.ts` and
 * `auth-page.spec.ts` each assert that every link element on their page is this
 * one — a stylesheet or a font arriving as a second `<link>` is the thing those
 * tests were written to catch, and they still catch it.
 */
export const BRAND_FAVICON_LINK = `<link rel="icon" href="${BRAND_FAVICON_DATA_URI}">`;

/**
 * The logo's own rules, concatenated into each page's single style element.
 *
 * SIZED IN `em` FROM `.logo`, so a page that wants a bigger logo sets one
 * font-size on one element rather than restating the geometry. The sign-in panel
 * is the only caller that does.
 */
export const BRAND_LOGO_STYLE = `
/* ---------------------------------------------------------------- logo --- */
/* A TIGHT GAP, MEASURED BY EYE AT FOUR SIZES. The mark already ends in a line
   and a dot that reach toward the word, so the usual half-em reads as a hole
   with an arrow pointing across it; .18em lets the line point INTO the word,
   which is the join the drawing was for. */
.logo {
  display: inline-flex; align-items: center; gap: .18em;
  font-size: 21px; line-height: 1;
}
/* 'block' removes the inline descender gap that would push the wordmark up by
   a couple of pixels against the mark. */
.logomark { display: block; flex: 0 0 auto; height: 1.15em; width: auto; }
.logotype {
  font-weight: 650; letter-spacing: -0.035em; color: var(--text);
  white-space: nowrap;
}
/* The full stop, in the accent colour, set slightly large and pulled tight so
   it reads as a mark rather than as punctuation somebody forgot to delete. */
.dotmark { color: var(--bad); font-size: 1.15em; margin-left: -0.02em; }
`;
