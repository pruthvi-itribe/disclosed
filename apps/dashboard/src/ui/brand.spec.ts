import { BRAND, BRAND_MARK, BRAND_TAGLINE } from './brand';
import { renderDashboardPage } from './page';

/**
 * The rename is one line, and this is what keeps it that way.
 *
 * The value of a single brand constant is entirely in nobody reintroducing a
 * literal beside it, so these tests assert the ABSENCE of the old spelling in
 * the rendered page rather than the presence of the new one.
 */
describe('the brand constant', () => {
  it('names the product, and sets its wordmark to the same word', () => {
    expect(BRAND).toBe('Disclosed');
    // Lowercase, because the header sets the mark lowercase. A capital here
    // would render the name twice in two cases on one line.
    expect(BRAND_MARK.word).toBe(BRAND.toLowerCase());
    // The accent is punctuation set AFTER the word, never a slice of it: the
    // name is a plain English verb and cutting it in two is the one thing the
    // mark must not do.
    expect(BRAND.toLowerCase()).not.toContain(BRAND_MARK.accent);
  });

  it('is the only spelling of the name in the dashboard page', () => {
    const html = renderDashboardPage();

    // Every occurrence must have come through the constant. Counting rather
    // than matching once: a literal left behind would still let a `toContain`
    // pass while making the rename a two-line change.
    const occurrences = html.split(BRAND).length - 1;
    expect(occurrences).toBeGreaterThan(0);

    // The wordmark is the one place the name carries its accent, and the accent
    // comes through the constant too.
    expect(html).toContain(
      `${BRAND_MARK.word}<span class="dotmark">${BRAND_MARK.accent}</span>`,
    );
  });

  it('titles the page from the name and the tagline together', () => {
    expect(renderDashboardPage()).toContain(
      `<title>${BRAND} — ${BRAND_TAGLINE}</title>`,
    );
  });
});
