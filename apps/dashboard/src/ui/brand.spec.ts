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
  it('names the product and its two wordmark halves', () => {
    expect(BRAND).toBe('Turret');
    // Lowercase, because the header sets the mark lowercase and colours the
    // tail. A capital here would render "Turret" with a red "Ret".
    expect(BRAND_MARK.head + BRAND_MARK.tail).toBe(BRAND.toLowerCase());
  });

  it('is the only spelling of the name in the dashboard page', () => {
    const html = renderDashboardPage();

    // Every occurrence must have come through the constant. Counting rather
    // than matching once: a literal left behind would still let a `toContain`
    // pass while making the rename a two-line change.
    const occurrences = html.split(BRAND).length - 1;
    expect(occurrences).toBeGreaterThan(0);

    // The wordmark is the one place the name is split, and it is split by the
    // constant too.
    expect(html).toContain(
      `${BRAND_MARK.head}<span class="dotmark">${BRAND_MARK.tail}</span>`,
    );
  });

  it('titles the page from the name and the tagline together', () => {
    expect(renderDashboardPage()).toContain(
      `<title>${BRAND} — ${BRAND_TAGLINE}</title>`,
    );
  });
});
