import { BRAND_MARK } from './brand';

/**
 * The logo: one mark, one wordmark, one favicon, drawn here and nowhere else.
 *
 * ================================================================
 * WHAT THE MARK IS A PICTURE OF
 * ================================================================
 *
 * The founder's mark, redrawn: a rounded tile carrying an indigo-to-violet
 * gradient, a white D, and inside the D's counter a document whose top-right
 * corner is folded back to show a cyan flap. It is the product drawn rather
 * than decorated — a company files a document, and the fold is the corner
 * somebody turned to read it.
 *
 * REDRAWN FROM THE PNG, NOT EMBEDDED. logo/disclosed-logo.png stays the
 * canonical external asset; the geometry below was measured off it — the D is
 * 15.41 x 17.22 units of a 32-unit tile with a 3.0-unit white ring around the
 * document, the corner cut is 3.7 units, and the flap sits 0.67 units inside
 * the cut. Everything is that measurement scaled by 1.2776 (see the next
 * paragraph) and rounded to a tenth.
 *
 * THE TILE HAS NO WORDMARK IN IT, and that is the one deliberate departure.
 * The PNG is a full lockup: tile, D, "Disclosed" and ".live" stacked inside one
 * square, which is right for an app icon and wrong beside a wordmark. Here the
 * word is HTML text next to the tile, so the D is re-centred and scaled up by
 * 1.2776 to fill the square the two text lines used to occupy. Both are the
 * same mark; one of them has the name twice.
 *
 * TWO UNFAITHFUL NUMBERS, both for legibility at the size this actually
 * renders. The tile is ~24px in a header, where the document's two text lines
 * measure 1.0 units — 0.75 of a physical pixel, which antialiases to a smudge.
 * They are drawn at 1.8 instead. And the favicon drops them entirely (below).
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
 * AND NOT THE PNG EITHER, which is the newer temptation: a 1.03 MB image
 * base64s to ~1.4 MB of data URI on every one of the three pages, and it is a
 * raster — the mark is drawn at 24px in a header and 34px on the sign-in panel,
 * and it would be resampled at both and blurred on every retina screen. Vector
 * costs 0.9 KB and is exact at any size.
 *
 * THE COLOURS COME FROM THE PALETTE, not from hex literals — `--brand-1` and
 * `--brand-2` for the gradient, `--brand-ink` for the D and its two lines,
 * `--flash` for the fold. What changed from the older mark is that this one no
 * longer inherits `currentColor`: it carries its own ground now, so instead of
 * taking the colour of the text around it, it is legible against any text
 * colour at all. Same property, held a different way.
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
 * The mark, as a 32 × 32 tile, as the pages embed it.
 *
 * SIZED IN `em` BY THE STYLESHEET, not by these attributes — the `width` and
 * `height` here are the fallback a browser uses before any CSS applies, which
 * matters for nothing except never rendering the SVG default of 300 × 150.
 *
 * `gradientUnits="userSpaceOnUse"` IS LOAD-BEARING, and it is the one thing in
 * this drawing that is not obvious. The document is filled with the SAME
 * gradient as the tile so that it reads as a hole punched through the white D.
 * Under the SVG default (`objectBoundingBox`) the ramp would restart inside the
 * document's own 12 × 14.5 box, and the "hole" would show a different violet
 * from the tile two pixels away. Pinned to user space, both shapes sample one
 * ramp across the whole tile and the seam disappears.
 *
 * `aria-hidden`, because the wordmark beside it says the name in text. An
 * `aria-label` here would make a screen reader announce "Disclosed Disclosed".
 */
export const BRAND_LOGO_SVG = `<svg class="logomark" viewBox="0 0 32 32" width="32" height="32" fill="none" aria-hidden="true" focusable="false"><defs><linearGradient id="brandtile" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="32" y2="32"><stop offset="0" stop-color="var(--brand-1)"/><stop offset="1" stop-color="var(--brand-2)"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="url(#brandtile)"/><path d="M9 5H14.8A11 11 0 0 1 14.8 27H9A2.8 2.8 0 0 1 6.2 24.2V7.8A2.8 2.8 0 0 1 9 5Z" fill="var(--brand-ink)"/><path d="M12 8.7H17.3L22 13.4V21.2A2 2 0 0 1 20 23.2H12A2 2 0 0 1 10 21.2V10.7A2 2 0 0 1 12 8.7Z" fill="url(#brandtile)"/><path d="M17.3 9.8V13.7H21.2Z" fill="var(--flash)"/><path d="M12.7 16.9H18M12.7 19.7H15.7" stroke="var(--brand-ink)" stroke-width="1.8" stroke-linecap="round"/></svg>`;

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
 * The mark at favicon size, with the document's two text lines dropped.
 *
 * THE SAME FOUR SHAPES, MINUS ONE. The tile, the D and the fold are the
 * identity and they survive the shrink; the two lines inside the document are
 * 1.8 units of a 32-unit tile, which at 16 physical pixels is 0.9 of a pixel
 * and renders as a grey haze over the one shape that has to stay clean. What is
 * left is a violet chip, a white D and a cyan spark — legible at 16px, and the
 * same picture as the mark beside the wordmark.
 *
 * HEX RATHER THAN CUSTOM PROPERTIES, unlike the inline mark: a favicon is
 * rendered outside the document, where `var(--brand-1)` resolves to nothing and
 * the icon would be invisible. The four literals below are the palette's own
 * values, and `logo.spec.ts` asserts they are still the stylesheet's — a hex
 * that has to be copied is a hex that will drift unless something checks.
 *
 * THE TILE IS ITS OWN GROUND, which the previous icon's `--bg` fill was not:
 * that one was a near-black chip that vanished into a dark tab strip. Indigo
 * sits on a light and a dark strip equally.
 */
export const BRAND_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="f" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="32" y2="32"><stop offset="0" stop-color="#4338ca"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="url(#f)"/><path d="M9 5H14.8A11 11 0 0 1 14.8 27H9A2.8 2.8 0 0 1 6.2 24.2V7.8A2.8 2.8 0 0 1 9 5Z" fill="#ffffff"/><path d="M12 8.7H17.3L22 13.4V21.2A2 2 0 0 1 20 23.2H12A2 2 0 0 1 10 21.2V10.7A2 2 0 0 1 12 8.7Z" fill="url(#f)"/><path d="M17.3 9.8V13.7H21.2Z" fill="#22d3ee"/></svg>`;

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
/* THE GAP GREW WITH THE MARK, and the old number was right for the old
   drawing. The line-and-dot mark ended in a stroke pointing at the word, so
   .18em let it point INTO it. A filled tile has no such arrow: at .18em it
   collided with the D of the wordmark and read as one crowded object. .34em is
   the tile's own corner radius at this size, which is the distance the eye
   already expects between a chip and the text it labels. */
.logo {
  display: inline-flex; align-items: center; gap: .34em;
  font-size: 21px; line-height: 1;
}
/* 'block' removes the inline descender gap that would push the wordmark up by
   a couple of pixels against the mark. 1.28em rather than the old 1.15: a tile
   is read by its area and an outline by its extent, so the same nominal height
   makes a filled mark look smaller than the drawn one it replaced. */
.logomark { display: block; flex: 0 0 auto; height: 1.28em; width: auto; }
.logotype {
  font-weight: 650; letter-spacing: -0.035em; color: var(--text);
  white-space: nowrap;
}
/* The full stop, in the flash colour, set slightly large and pulled tight so it
   reads as a mark rather than as punctuation somebody forgot to delete. IT IS
   THE SAME CYAN AS THE FOLD in the tile beside it — the founder's artwork puts
   that cyan on the dot of the i and on ".live", so the wordmark's own dot is
   where it belongs here. It was --bad, which was a red full stop carrying no
   failure: a semantic colour spent on decoration. */
.dotmark { color: var(--flash); font-size: 1.15em; margin-left: -0.02em; }
`;
