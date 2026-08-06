import { CATEGORY_GROUPS } from '@app/filings/logic/category-group';
import { CONFIDENCE_TIERS } from '@app/filings/logic/confidence-tier';
import { renderDashboardPage } from './page';

/**
 * A SMOKE suite, deliberately. The markup itself is not asserted line by line —
 * that would pin the design rather than the contract, and every visual tweak
 * would be a red build. What is asserted is the part that is a requirement:
 * the document is self-contained, it references nothing off-origin, and the
 * element ids the client script writes into actually exist.
 *
 * The two taxonomies are IMPORTED rather than restated, and only those two. The
 * shell hard-codes the eleven category groups and the three tiers have a style
 * each, so a group added to `libs/filings` and not to the dropdown would leave a
 * filter nobody could reach, and a fourth tier would render as an unstyled
 * badge. Importing the source of truth is what makes that a red build instead of
 * a silent gap. The pure logic modules are imported by path rather than through
 * the `@app/filings` barrel, which would pull the Mongoose schemas into a suite
 * that renders a string.
 */

const html = renderDashboardPage();

describe('renderDashboardPage — self-containment', () => {
  it('references no external host at all', () => {
    // The moment this page is most needed is the moment the network is the
    // suspect, and a third-party script here would have read access to a view
    // of an unauthenticated database.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('loads no external stylesheet, script or font', () => {
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toContain('@import');
    expect(html).not.toContain('@font-face');
  });

  it('embeds no remote asset through a CSS url()', () => {
    expect(html).not.toMatch(/url\s*\(/);
  });

  it('inlines its own stylesheet and script', () => {
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
  });

  it('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>');
  });
});

describe('renderDashboardPage — content', () => {
  const REQUIRED_IDS = [
    'alert',
    'live-dot',
    'live-text',
    'generated',
    'stat-total',
    'stat-today',
    'stat-today-note',
    'stat-lag',
    'stat-newest',
    'stat-cursor',
    'stat-amounts',
    'stat-amounts-note',
    'stat-pending',
    'stat-outcome',
    'stat-outcome-note',
    'symbol',
    'category',
    'group',
    'tier',
    'state',
    'amount',
    'refusals',
    'refusal-chip',
    'limit',
    'clear',
    'prev',
    'next',
    'page-info',
    'rows',
    'categories',
    'groups',
    'tiers',
    'reading',
    'days',
    'day-from',
    'day-to',
  ] as const;

  it.each(REQUIRED_IDS)('carries the #%s the script writes into', (id) => {
    // The script addresses these by id and would fail silently against a
    // renamed one, leaving a panel permanently blank.
    expect(html).toContain(`id="${id}"`);
  });

  it('labels every time column as IST', () => {
    expect(html).toContain('Time (IST)');
    expect(html).toContain('per IST day');
  });

  it('states that the view is read-only', () => {
    expect(html).toContain('never writes');
  });

  it('leads the filings table with the composed headline', () => {
    // The change this page exists to show: the exchange's boilerplate is no
    // longer the first thing in the row.
    expect(html).toContain('<th>Headline</th>');
    expect(html).toContain('<th>Amount</th>');
    expect(html).toContain('<th>Enrichment</th>');
  });

  it('makes the refusal reasons a visible, filterable panel', () => {
    // A refusal nobody can see is indistinguishable from a bug, and the
    // extractor's declines are what earn it its trust.
    expect(html).toContain('Why amounts were refused');
    expect(html).toContain('id="refusals"');
  });

  it('offers every enrichment state as a filter', () => {
    for (const state of ['enriched', 'pending', 'unparseable', 'failed']) {
      expect(html).toContain(`<option value="${state}">`);
    }
  });

  it('says on the page what makes a headline traceable', () => {
    expect(html).toContain('traceable');
    expect(html).toContain("degrades the headline to the exchange's own words");
  });

  it('contains no emoji', () => {
    // Project rule: no emoji anywhere, the UI included.
    expect(html).not.toMatch(
      /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u,
    );
  });

  it('is stable — two renders produce the same document', () => {
    // Nothing in the shell is time- or data-dependent; every value arrives
    // from the JSON routes at runtime.
    expect(renderDashboardPage()).toBe(html);
  });

  it('carries no filing data in the shell', () => {
    // The served document is a shell. Every value the page shows is placed by
    // the script from the JSON routes, which is what keeps exchange-supplied
    // text out of a server-side string concatenation that would have to escape
    // it by hand.
    expect(html).not.toContain('nseindia');
    expect(html).not.toContain('<td');
    expect(html).toContain('<tbody id="rows"></tbody>');
  });

  it('inlines a client script that parses as JavaScript', () => {
    // The script is a template string inside a TypeScript file, so neither the
    // compiler nor the type checker ever parses what it will become — and
    // escaping is precisely where a file of this shape historically breaks. A
    // page that serves a syntax error renders as a permanently empty table with
    // nothing in the document to say why.
    const source = html.slice(
      html.indexOf('<script>') + '<script>'.length,
      html.lastIndexOf('</script>'),
    );
    expect(source.length).toBeGreaterThan(0);
    expect(() => new Function(source)).not.toThrow();
  });
});

/**
 * The coverage change: every filing now states an outcome instead of 71% of them
 * producing an empty row, and what is NOT verified says so rather than being
 * dropped. These assert the contract that change made, not its typography.
 */
describe('renderDashboardPage — outcome, group and confidence', () => {
  it('gives the outcome and the category group first-class columns', () => {
    expect(html).toContain('<th>Outcome</th>');
    expect(html).toContain('<th>Group</th>');
  });

  it('puts the outcome ahead of the composed headline', () => {
    // For most rows the outcome is the only fact stated: the composed headline
    // beside it degrades to the exchange's own category whenever nothing was
    // verified, so leading with the headline would lead with a blank.
    expect(html.indexOf('<th>Outcome</th>')).toBeLessThan(
      html.indexOf('<th>Headline</th>'),
    );
  });

  it('spans the empty-state row across every column it renders', () => {
    // A colspan that drifts short of the real column count renders as a torn
    // row rather than as an error, so the two are asserted against each other
    // instead of both being written down twice.
    const columns = html.match(/<th>/g) ?? [];
    expect(columns.length).toBeGreaterThan(0);
    expect(html).toContain(`var COLUMN_COUNT = ${columns.length};`);
  });

  it.each(CATEGORY_GROUPS)('offers the %s group as a filter', (group) => {
    // A group the server will filter on and the shell does not offer is a slice
    // of the collection with no way to reach it.
    expect(html).toContain(`<option value="${group}">`);
  });

  it('offers exactly the two confidence tiers the server can filter on', () => {
    // THREE TIERS ARE LABELLED AND TWO ARE FILTERABLE, and that asymmetry is
    // deliberate: `verified` is a predicate over indexed fields, while telling
    // `stated` from `labelled` is a string comparison done on read so the whole
    // existing collection gained an outcome with no backfill. Offering the other
    // two as options would be offering filters the server cannot honour.
    expect(html).toContain('<option value="verified">');
    expect(html).toContain('<option value="unverified">');
    expect(html).not.toContain('<option value="stated">');
    expect(html).not.toContain('<option value="labelled">');
  });

  it.each(CONFIDENCE_TIERS)('styles the %s badge', (tier) => {
    expect(html).toContain(`.tier-${tier} {`);
  });

  it('fills only the verified badge', () => {
    // `verified` is the only tier allowed near an alert, and that boundary has
    // to survive being read from across a room — this is a wall display.
    expect(html).toMatch(/\.tier-verified \{[^}]*background:/);
    expect(html).not.toMatch(/\.tier-stated \{[^}]*background:/);
    expect(html).not.toMatch(/\.tier-labelled \{[^}]*background:/);
  });

  it('does not render the labelled tier as an error', () => {
    // AN HONEST FLOOR, NOT A FAILURE. Roughly a quarter of the collection sits
    // here, and giving it the red that marks `unparseable` and `failed` would
    // teach a reader to treat a quarter of the day's filings as broken when what
    // they are is unchecked.
    expect(html).toMatch(/\.tier-labelled \{[^}]*var\(--muted\)/);
    expect(html).not.toMatch(/\.tier-labelled \{[^}]*var\(--bad\)/);
  });

  it('badges the tier on every row rather than only in the panel', () => {
    expect(html).toContain("tier.className = 'tier tier-' + f.confidenceTier;");
    expect(html).toContain('tier.textContent = f.confidenceTierLabel;');
  });

  it.each([
    ['group', 'state.group'],
    ['tier', 'state.tier'],
  ])('sends the %s filter as a query parameter', (param, key) => {
    // Reusing the mechanism every other filter already uses: one control writes
    // one key of `state`, and `query()` serialises it. A second way to apply a
    // filter would be a second place for the control, the panel row and the
    // request to disagree about what is being shown.
    expect(html).toContain(
      `parts.push('${param}=' + encodeURIComponent(${key}))`,
    );
  });

  it.each(['group', 'tier'])('applies the %s filter on change', (id) => {
    expect(html).toContain(
      `el('${id}').addEventListener('change', applyFilters);`,
    );
  });

  it.each(['group', 'tier'])('clears the %s filter with the rest', (id) => {
    expect(html).toContain(`el('${id}').value = '';`);
  });

  it('names the parser only when it was not the ordinary one', () => {
    // A tag on every row saying `pdf-parse` is noise; the tag exists to mark
    // the exceptions, because Docling's markdown and pdf-parse's flattening
    // produce verdicts that have to be read differently.
    expect(html).toContain("var DEFAULT_PARSE_ROUTE = 'pdf-parse';");
    expect(html).toContain('e.parseRoute !== DEFAULT_PARSE_ROUTE');
  });

  it('shows a parse fallback as a warning on the row', () => {
    // THE SYMPTOM OF A DEAD DOCLING IS SILENCE: reads keep succeeding on the
    // cheap parser and results filings just quietly yield fewer figures. This
    // tag is how an operator finds out the service has been down since Tuesday.
    expect(html).toContain('e.parseFallbackReason');
    expect(html).toContain('.tag.fallback {');
    expect(html).toMatch(/\.tag\.fallback \{[^}]*var\(--warn\)/);
  });

  it('leaves the counts no filter accepts un-clickable', () => {
    // The refusal filter searches five enrichment fields and a parser is not one
    // of them. A clickable parse-route pill would apply a filter matching zero
    // documents, and an empty table is how this page says "nothing was found".
    expect(html).toContain(
      "tagGroup(box, 'parser that read the document', d.byParseRoute, null)",
    );
    expect(html).toContain(
      "tagGroup(box, 'why no model read the document', d.byCoverageSkip, pickRefusal)",
    );
  });

  it.each([
    ['stat-outcome', 'd.withOutcome'],
    ['tiers', 'd.byConfidenceTier'],
    ['groups', 'd.byCategoryGroup'],
    ['reading', 'd.parseFallbacks'],
  ])('draws #%s from the enrichment summary', (id, field) => {
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(field);
  });

  it('flags the outcome count only when it disagrees with the total', () => {
    // "Every filing produces an outcome" is the claim this change makes, and it
    // is counted rather than asserted. It equals the total by construction, so a
    // permanently red card would be noise and a permanently green one would be
    // decoration — the card speaks on the day the two diverge.
    expect(html).toContain(
      "el('stat-outcome').className = 'value' + (d.withOutcome === d.total ? '' : ' bad');",
    );
  });

  it('says on the page what a confidence tier means', () => {
    expect(html).toContain('the only tier allowed near an alert');
    expect(html).toContain('an honest floor, not a failure');
  });
});
