import { CATEGORY_GROUPS } from '@app/filings/logic/category-group';
import { planEvidence } from '@app/filings/logic/claim-plan';
import { PLAN_CLAIM_KINDS } from '@app/filings/logic/claim.types';
import { CONFIDENCE_TIERS } from '@app/filings/logic/confidence-tier';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BRAND } from './brand';
import { renderDashboardPage } from './page';
import { PAGE_STYLE } from './page-style';
import { PAGE_STYLE_BRIEF } from './page-style-brief';
import { PAGE_STYLE_FOCUS } from './page-style-focus';
import { SCRIPT_ACCOUNT } from './script/script-account';
import { SCRIPT_BASE } from './script/script-base';
import { SCRIPT_BRIEF } from './script/script-brief';
import { SCRIPT_COMPANY } from './script/script-company';
import { SCRIPT_FEED } from './script/script-feed';
import { SCRIPT_FOCUS } from './script/script-focus';
import { SCRIPT_POLL } from './script/script-poll';

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
    'suggest',
    'search-note',
    'category',
    'group',
    'tier',
    'state',
    'amount',
    'refusals',
    'diagnostics',
    'diag-count',
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
    'view-brief',
    'tab-brief',
    'brief-cover',
    'brief-day',
    'brief-mix',
    'brief-cover-line',
    'brief-cover-rule',
    'brief-deck',
    'brief-rail',
    'brief-end',
    'brief-end-line',
    'brief-to-feed',
    'brief-empty',
    'signout',
    'tab-watching',
    'tab-watching-count',
    'view-watching',
    'watch-count',
    'watch-empty',
    'watch-feed',
    'co-watch',
    'co-plans-wrap',
    'co-plans',
    // The focus card's shell. Filled by the script; empty in the markup.
    'focus-back',
    'focus',
    'focus-symbol',
    'focus-name',
    'focus-when',
    'focus-close',
    'focus-body',
    'focus-foot',
  ] as const;

  it('carries no sign-in panel of its own', () => {
    // REMOVED, NOT HIDDEN. The front door serves a signed-out browser the
    // landing page, so a modal inside this document was unreachable code kept
    // green by this very list. The sign-in surface is `/auth`; two sign-in
    // forms on one origin is two places for auth UI to drift.
    for (const gone of ['auth-back', 'auth-form', 'auth-email', 'signin']) {
      expect(html).not.toContain(`id="${gone}"`);
    }
  });

  it.each(REQUIRED_IDS)('carries the #%s the script writes into', (id) => {
    // The script addresses these by id and would fail silently against a
    // renamed one, leaving a panel permanently blank.
    expect(html).toContain(`id="${id}"`);
  });

  it('keeps IST the stated basis for every absolute time', () => {
    // The row's own time column reads "14 min ago" now, because that is what a
    // reader scanning the day wants. The exact IST instant did not go away — it
    // is the cell's title and a line in the detail row — and the footer still
    // states the basis, because a page of times with no timezone on it is a
    // page of times somebody will read in their own.
    expect(html).toContain('per IST day');
    expect(html).toContain('All times are IST');
  });

  it('states that the view never writes a filing', () => {
    // The first two words used to be "Read-only." and they had to go: this
    // process now writes `users`, `sessions` and `watchlists`. What did not
    // change is the claim the narrowed `FilingReadModel` actually enforces, and
    // it is the one the sentence still makes.
    expect(html).toContain('never writes');
    expect(html).not.toContain('Read-only. This view');
  });

  it('gives the row to what was said, not to how we read it', () => {
    // The table is five columns and every one of them is about the filing.
    // Amount, enrichment state and seqId were columns until they crowded out
    // the thing the page is for; they are in the detail row now, which is why
    // the header advertises that a row opens.
    expect(html).toContain('<th>What was said</th>');
    expect(html).toContain('click a row for the detail');
  });

  it.each(['<th>Amount</th>', '<th>Enrichment</th>', '<th>Seq</th>'])(
    'no longer spends a column on %s',
    (column) => {
      // Asserted as absence rather than left to the column count, so putting one
      // back is a decision somebody makes against this line rather than a
      // regression that still adds up.
      expect(html).not.toContain(column);
    },
  );

  it('keeps the refusal reasons a reachable, filterable panel', () => {
    // A refusal nobody can reach is indistinguishable from a bug, and the
    // extractor's declines are what earn it its trust. The panel moved under a
    // disclosure — see the demotion suite below — but it did not lose a reason,
    // a count or a filter, and the words are still on the page.
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

  it('survives the template literal with its escape sequences intact', () => {
    // THE BUG THIS EXISTS FOR, which shipped. page-script.ts is a template
    // literal, so TypeScript consumes escape sequences before the browser sees
    // them: a digit class written with one backslash arrives as a letter class.
    // The figure-emphasis regex did exactly that and the feed rendered
    // "Declared interim dividend" with the fourth letter in bold, because the
    // pattern was matching the letter instead of a digit.
    //
    // Asserted against the SERVED document rather than the source, because the
    // source is correct in both the working and the broken version — the
    // difference only exists after the compiler has run.
    const script = html.slice(
      html.indexOf('<script>') + '<script>'.length,
      html.lastIndexOf('</script>'),
    );
    const figure = /var FIGURE = (\/.*?\/[a-z]*);/.exec(script);
    expect(figure).not.toBeNull();

    const source = String(figure?.[1]);
    expect(source).toContain(String.fromCharCode(92) + 'd');
    expect(source).toContain(String.fromCharCode(92) + 's');

    // And it behaves: a digit is a figure, a letter never is.
    const pattern = new RegExp(source.slice(1, source.lastIndexOf('/')), 'gi');
    expect('Declared interim dividend'.replace(pattern, '#')).toBe(
      'Declared interim dividend',
    );
    expect('revenue up 19% YoY'.match(pattern)?.join('')).toContain('19');
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
  it('keeps the category group a first-class column', () => {
    // The group survives on the row where the outcome did not, and the reason
    // is what each answers. The group says what KIND of filing this is, which
    // is how somebody scans a day's flow and what they filter on. The outcome
    // is a sentence about this one filing, and the claim line above it says the
    // same thing with evidence whenever there is any — so it reads as the
    // fallback it is, in the detail row.
    expect(html).toContain('<th>Group</th>');
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

/**
 * THE MOVEMENT MARK, AND THE DECISION NOT TO COLOUR IT.
 *
 * A mark appears on a claim only where the document printed both a direction
 * word and the size of the move. 803 of 3,461 stored claims (23.2%) carry one,
 * so this is a sometimes-marker on a minority of cards rather than a rating on
 * every update.
 *
 * THE COLOUR TEST IS THE POINT OF THIS SUITE. Red and green ARE the sentiment
 * claim, smuggled back in through CSS, and the corpus says they would be wrong:
 * 13 of the 45 marked decreases are falling bad loans, debt, borrowing costs or
 * emissions. Somebody will ask for colour; this is where the answer lives.
 */
describe('renderDashboardPage — the movement mark', () => {
  const script = html.slice(
    html.indexOf('<script>') + '<script>'.length,
    html.lastIndexOf('</script>'),
  );

  it('draws one glyph per printed direction, and none for unrated', () => {
    // An explicit "unrated" badge on three-quarters of claims is noise, and its
    // absence already means what it means: the filing printed no movement.
    const glyphs = /var DIRECTION_GLYPH = \{([^}]*)\};/.exec(script);
    expect(glyphs).not.toBeNull();

    const keys = (glyphs?.[1] ?? '').match(/(\w+):/g) ?? [];
    expect(keys.map((key) => key.replace(':', ''))).toEqual([
      'expansion',
      'contraction',
      'mixed',
    ]);
    expect(glyphs?.[1]).not.toContain('unrated');
  });

  it('never colours the mark', () => {
    // THE REGRESSION LOCK. `color: inherit` and nothing else: the mark is the
    // same weight and the same colour as the sentence it sits in.
    const rule = /\.insights \.dir \{([^}]*)\}/.exec(html);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain('color: inherit');
    expect(rule?.[1]).not.toMatch(/var\(--(?:bad|warn|accent|claim|ok|good)\)/);
    expect(rule?.[1]).not.toMatch(/#[0-9a-f]{3}|\brgb|\bgreen\b|\bred\b/i);
  });

  it('styles no rule off the direction value, so none can be coloured later', () => {
    // Asserted as an absence rather than left to the rule above, because the
    // cheapest way to colour a mark is a second selector somewhere else in the
    // stylesheet. There is no `[data-direction=...]` rule and there must not be.
    expect(html).not.toMatch(
      /\[data-direction="?(?:expansion|contraction|mixed)/,
    );
  });

  it('puts the document’s own words in the mark’s title', () => {
    // What makes a derived tag admissible here at all: the reader can check it
    // against the source without leaving the page.
    expect(script).toContain(
      "mark.title = 'Printed in the document: \"' + line.evidence + '\"';",
    );
  });

  it('spells the mark out for a screen reader', () => {
    expect(script).toContain('var DIRECTION_LABEL = {');
    expect(script).toContain('increase printed');
    expect(script).toContain('decrease printed');
    expect(script).toContain('both printed');
    expect(script).toContain("mark.setAttribute('aria-label',");
  });

  it('carries a legend that is shown only when a marked card is', () => {
    expect(html).toContain('id="dir-legend"');
    expect(html).toContain('mark movement the document itself printed');
    // One line of standing copy; the long form is the title attribute.
    expect(html).toContain('not a view on the company or its shares');
    expect(script).toContain("el('dir-legend').hidden = marks === 0;");
  });

  it('says in the footer that a fall is not bad news', () => {
    // The page's own account of itself. A mark a reader misreads as a rating is
    // worse than no mark, and this paragraph is the whole mitigation.
    const prose = html.replace(/\s+/g, ' ');
    expect(prose).toContain(
      'A fall is not bad news and a rise is not good news',
    );
    expect(prose).toContain(
      '13 of 45 marked decreases are falling bad loans, debt, borrowing costs or emissions',
    );
    expect(prose).toContain(`${BRAND} does not rate companies or securities`);
    expect(prose).toContain('an absent mark means the filing was silent');
  });

  it('uses none of the sentiment vocabulary anywhere on the page', () => {
    // `expansion` and `contraction` are terms about a figure's movement;
    // `positive` and `negative` are terms about an entity, and
    // `claim-advisory.ts` blocks the second pair on the way to the wire. The
    // page does not get to reintroduce them.
    const prose = html.replace(/\s+/g, ' ');
    expect(prose).not.toMatch(
      /\bpositive for\b|\bnegative for\b|\bbullish\b|\bbearish\b/i,
    );
  });
});

/**
 * WHAT THE COMPANY SAYS IT PLANS, AS A FEED FILTER.
 *
 * 811 stored claims are `guidance` or `target` — the company's own printed
 * statements about its own future, already through the verbatim gate — spread
 * over 331 filings. The chip narrows the feed to those filings.
 *
 * IT IS A DIFFERENT AXIS FROM THE CHIPS BESIDE IT and shares their row anyway:
 * the topic chips ask what a claim is ABOUT and this asks what SHAPE it is, but
 * a reader uses both the same way — one lens at a time — and a second row
 * holding one chip is furniture. What that costs is the rule asserted here:
 * picking either clears the other, so exactly one chip is ever lit.
 */
describe('renderDashboardPage — the plans filter', () => {
  const script = html.slice(
    html.indexOf('<script>') + '<script>'.length,
    html.lastIndexOf('</script>'),
  );

  const topicRow = /<div id="topics"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];

  it('puts Plans in the one chip row the feed already has', () => {
    expect(topicRow).toBeDefined();
    expect(topicRow).toContain('data-plans="only"');
    expect(topicRow).toContain('>Plans<');
  });

  it('asks the server for the pair, never for one kind of it', () => {
    // `guidance` alone is 746 of the 811, so a chip that sent it would answer
    // the reader's question 8% short while looking like it worked. The server
    // answers `plans=guidance` with a 400 for the same reason.
    expect(script).toContain("parts.push('plans=only')");
    expect(script).not.toContain('kind=guidance');
  });

  it('lights exactly one chip, whichever axis it belongs to', () => {
    // The two axes share a row, so the row has to behave like one control:
    // picking Plans clears the topic and picking a topic clears Plans.
    expect(script).toContain("var plans = target.getAttribute('data-plans');");
    expect(script).toContain('state.plans = plans !== null;');
    expect(script).toContain("state.topic = topic === null ? '' : topic;");
    expect(script).toContain("chips[i].getAttribute('data-plans') !== null");
  });

  it('lets Clear reach the plans chip too', () => {
    // A Clear that left this chip lit would leave the feed narrowed by a
    // control the reader believes they just reset.
    const clear = /el\('clear'\)\.addEventListener\([\s\S]*?\}\);/.exec(script);
    expect(clear?.[0]).toContain('state.plans = false;');
    expect(clear?.[0]).toContain('syncTopics();');
  });

  it('names the plans chip when it is the filter that emptied the feed', () => {
    // "Nothing was found" and "nothing was looked for" must not read the same,
    // and the insight toggle would otherwise take the blame for this filter.
    expect(script).toContain('if (state.plans)');
    expect(script).toContain('said what it plans');
  });
});

/**
 * PLANS, IN THEIR WORDS — the company page's section of quoted spans.
 *
 * It publishes the DOCUMENT'S OWN BYTES and nothing else: the model's
 * compressed `text` is not shown here, no count is computed over the quotes,
 * and no sentence about the company is composed from them. That is what makes
 * the section admissible where "how can it improve" was not — every line in it
 * was already matched character for character against the source filing, so the
 * page is quoting rather than assessing.
 *
 * 257 of the 1,219 companies held carry at least one such claim, and 93 of
 * those 257 carry exactly one.
 */
describe('renderDashboardPage — plans, in their words', () => {
  const plans = /function renderPlans\([\s\S]*?\n  \}/.exec(
    SCRIPT_COMPANY,
  )?.[0];

  it('is a section of the company page, with a heading a person can say', () => {
    expect(html).toContain('data-ui="company-plans"');
    expect(html).toContain('Plans, in their words');
  });

  it('selects on the server’s verdict, holding no vocabulary of its own', () => {
    // THE BROWSER KNOWS NEITHER LIST. Restating the kinds or the forward-looking
    // words here would be a second rule, and the chip in the feed and this
    // section would show different sets under one name the moment either moved.
    expect(plans).toContain('claim.planEvidence');
    expect(plans).not.toContain('claim.kind');
    for (const kind of PLAN_CLAIM_KINDS) {
      // The word may appear in the fragment's prose; what must not appear is a
      // value the browser tests a claim against.
      expect(SCRIPT_COMPANY).not.toContain(`'${kind}'`);
    }
  });

  it('carries the words that put each line here', () => {
    // The rule the movement mark already follows: a derived judgement is
    // admissible only where a reader can check it without opening the PDF.
    expect(plans).toContain('claim.planEvidence + ');
    expect(plans).toContain('The company printed:');
  });

  it('quotes a sentence only where the document pointed forward', () => {
    // 634 of the 813 claims stored under the two plan kinds are last quarter's
    // figures, a declared dividend or an AGM date. The heading would be wrong
    // about two lines in three if the kind alone decided this.
    expect(
      planEvidence('guidance', 'Q1 FY27 revenue at Rs 3,637 million'),
    ).toBeNull();
    expect(
      planEvidence(
        'guidance',
        'we expect our organic growth in FY27 to be better',
      ),
    ).toBe('expect');
  });

  it('quotes the document, never the model’s version of it', () => {
    // `span` is the document's own bytes at the matched position; `text` is the
    // extractor's compression of them. A section headed "in their words" may
    // only ever show the first.
    expect(plans).toContain('claim.span');
    expect(plans).not.toContain('claim.text');
  });

  it('collapses the PDF’s line breaks and adds the quotation marks as text', () => {
    // A span lifted out of a PDF carries the line breaks of the page it was set
    // on, and those are not part of the sentence. Asserted on the SERVED page
    // as well, because a fragment's doubled backslash is what reaches it.
    expect(plans).toContain('.replace(');
    expect(html).toContain("replace(/\\s+/g, ' ')");
    expect(SCRIPT_COMPANY).not.toContain('innerHTML');
  });

  it('says so rather than drawing empty quotation marks', () => {
    // A verified claim always carries a span. If one ever does not, "no words
    // were stored" must not render as a company that said nothing.
    expect(plans).toContain('No source sentence is stored for this line.');
  });

  it('dates each quote from the server’s IST, formatting none of it', () => {
    // The browser showing this page is not necessarily set to IST, and a laptop
    // on UTC would date a 9am filing to the previous day.
    expect(plans).toContain('istDay');
    expect(plans).not.toContain('toLocale');
    expect(plans).not.toContain('new Date(');
  });

  it('draws at one quote, where the two bars above it refuse to', () => {
    // THE DIFFERENT FLOOR IS THE POINT. A stacked bar over one observation is a
    // single colour claiming to be a distribution, so those widgets suppress
    // themselves; one quoted sentence is one quoted sentence and says exactly
    // as much as it says. 93 of the 257 companies holding a plan hold exactly
    // one, so a floor of two would silence 36% of them for nothing.
    expect(plans).not.toMatch(/MIN_[A-Z_]+/);
    expect(SCRIPT_COMPANY).toContain(
      "plansWrap.hidden = !renderPlans(el('co-plans'), items);",
    );
  });

  it('skips a plan an earlier filing in the same response already stated', () => {
    // The company page is one response, and a company files its guidance in a
    // press release and a presentation the same morning. The server already
    // marks the repeat; the section reads that mark rather than inventing a
    // second notion of sameness.
    expect(plans).toContain('echo === true');
  });

  it('counts nothing, so it needs no note about what a count would mean', () => {
    // `2026-08-08-update-signal-design.md` §3.6: a tally over verified claims
    // describes what companies chose to print rather than how they performed,
    // and any count shown has to say so. This section shows quotes and no
    // number, which is the version of that rule that needs no paragraph.
    const section =
      /<div id="co-plans-wrap"[\s\S]*?<\/ul>\s*<\/div>/.exec(html)?.[0] ?? '';
    expect(section).not.toBe('');
    // The tags carry an `h2` and the class names; what must hold no number is
    // what a reader sees.
    expect(section.replace(/<[^>]*>/g, ' ')).not.toMatch(/\d/);
  });
});

/**
 * THE AMOUNT-PATH REFUSALS, DEMOTED FROM LABELS TO DIAGNOSTICS.
 *
 * `no-candidate` and `ambiguity-keyword` between them covered 95% of the
 * collection, and each rendered as a warn-coloured pill on its own row — which
 * made a diagnostic about the amount lane the loudest thing on a page whose
 * every row now states an outcome composed from the exchange's own summary,
 * whatever the amount extractor did with the attachment.
 *
 * WHAT THESE ASSERT IS THAT THE DEMOTION IS A DEMOTION. "We removed the noise"
 * and "we removed the evidence" have to stay distinguishable, because an
 * extractor whose refusals are invisible is indistinguishable from one that is
 * not running. So: every reason is still counted, every reason is still a
 * filter, the quiet two are still on their own row as a control rather than as
 * a label, and the refusals that mean something actually went wrong did not
 * move at all.
 */
describe('renderDashboardPage — amount refusals demoted to diagnostics', () => {
  /** The two the requirement names, and the only two. */
  const QUIET_REFUSALS = ['no-candidate', 'ambiguity-keyword'] as const;

  /**
   * The rest of `AmountRefusalReason`, restated rather than imported because it
   * is a union type with no runtime value to import. Every one of these means
   * the document said something the extractor could not safely reduce to a
   * figure — two disagreeing numbers, a band, a re-denominating header — which
   * is a fact about the filing and stays on the row.
   */
  const LOUD_REFUSALS = [
    'multiple-candidates',
    'range-only',
    'unit-scaled-header',
    'verbatim-mismatch',
  ] as const;

  const script = html.slice(
    html.indexOf('<script>') + '<script>'.length,
    html.lastIndexOf('</script>'),
  );

  describe('the quiet set is closed, and closed in the safe direction', () => {
    it('names exactly the two reasons the requirement names', () => {
      // AN ALLOWLIST OF THE QUIET, NOT A DENYLIST OF THE LOUD. Parsed out of the
      // literal rather than merely searched for, so a third reason quietly added
      // to it is a red build: demoting a reason is a decision about what an
      // operator stops seeing, and it must never happen by accident.
      const literal = script.match(/var QUIET_AMOUNT_REFUSALS = \{([^}]*)\};/);
      expect(literal).not.toBeNull();

      const keys = (literal?.[1] ?? '').match(/'[^']+'/g) ?? [];
      expect(keys.map((key) => key.replace(/'/g, ''))).toEqual([
        ...QUIET_REFUSALS,
      ]);
    });

    it.each(LOUD_REFUSALS)('does not put %s on the quiet list', (reason) => {
      expect(script).not.toContain(`'${reason}': true`);
    });

    it('looks the list up without walking the prototype chain', () => {
      // The keys arrive from the database and `constructor` is a key on every
      // object literal's prototype, so an unguarded lookup would report a
      // function as a quiet refusal and silence a real one.
      expect(script).toContain(
        'Object.prototype.hasOwnProperty.call(QUIET_AMOUNT_REFUSALS, reason)',
      );
    });
  });

  describe('the row', () => {
    it('no longer renders every refusal as one loud tag', () => {
      // The line this replaces. It put `amountRefusalReason || unparseableReason`
      // on EVERY row as a warn pill, which is what made 95% of rows shout.
      expect(script).not.toContain(
        'var reason = e.amountRefusalReason || e.unparseableReason;',
      );
    });

    it('tags an amount refusal only when it is not on the quiet list', () => {
      expect(script).toContain(
        'if (amountRefusal && !isQuietRefusal(amountRefusal)) {',
      );
    });

    it('keeps an unreadable document loud and unconditional', () => {
      // A document nothing could read at all is a real problem and a different
      // class of fact from "the document was read and stated no figure". It is
      // no longer suppressed by an amount refusal happening to be present too.
      expect(script).toContain('var unreadable = e.unparseableReason;');
      expect(script).toContain(
        "tag(unreadable, 'refusal' + (state.refusal === unreadable ? ' active' : ''), pickRefusal(unreadable))",
      );
    });

    it('gives a quiet refusal a muted control beside the dash instead', () => {
      // The dash in the Amount column is where the question "why is this blank"
      // is actually asked, so that is where the answer lives.
      expect(script).toContain('if (quiet && isQuietRefusal(quiet)) {');
      expect(script).toContain(
        'cell.appendChild(whyControl(quiet, e.amountRefusalDetail));',
      );
    });

    it('keeps the reason and its detail one hover away', () => {
      // Demoted, not deleted: the pill's whole payload still reaches the reader,
      // it just costs an interaction instead of shouting.
      expect(script).toContain("node.title = 'no amount was read: ' + reason");
      expect(script).toContain("(detail ? ' - ' + detail : '')");
    });

    it('keeps the reason one click away from filtering the table', () => {
      expect(script).toContain(
        "node.addEventListener('click', pickRefusal(reason));",
      );
    });

    it('makes the control keyboard-reachable and gives it an accessible name', () => {
      // A span with a click handler is not reachable without a mouse. This one
      // replaces something a reader could previously see at a glance, so it has
      // to be operable by everyone the pill was operable by.
      expect(script).toContain("var node = document.createElement('button');");
      expect(script).toContain("node.type = 'button';");
      expect(script).toContain("node.setAttribute('aria-label',");
    });

    it('renders the control muted rather than as a warning', () => {
      // The point of the change. `.tag.refusal` is warn-coloured; this must not
      // be, or nothing has been demoted.
      expect(html).toMatch(/\.why \{[^}]*var\(--muted\)/);
      expect(html).not.toMatch(/\.why \{[^}]*var\(--warn\)/);
      expect(html).not.toMatch(/\.why \{[^}]*var\(--bad\)/);
    });
  });

  describe('the panel', () => {
    it('is no longer the first thing in the sidebar', () => {
      // It was. A collection whose rows all state an outcome does not lead with
      // the amount extractor's diagnostics.
      for (const id of ['claims', 'results', 'tiers', 'groups']) {
        expect(html.indexOf(`id="${id}"`)).toBeLessThan(
          html.indexOf('id="refusals"'),
        );
      }
    });

    it('sits under a disclosure that starts closed', () => {
      expect(html).toContain(
        '<details class="panel diagnostics" id="diagnostics">',
      );
      expect(html).not.toMatch(/<details[^>]*\sopen/);
      expect(html.indexOf('id="diagnostics"')).toBeLessThan(
        html.indexOf('id="refusals"'),
      );
    });

    it('carries the refusal total on the closed summary', () => {
      // WHAT KEEPS A COLLAPSED PANEL HONEST. The breakdown folds away; the
      // number does not, so a reader who never opens it still sees that the
      // extractor declined two thousand documents — and sees it go to zero on
      // the day the extractor stops running.
      expect(html).toContain('id="diag-count"');
      expect(html).toContain(
        "setText('diag-count', groupInt(total) + ' refusal(s) recorded');",
      );
      expect(html).toContain(
        'var total = sumCounts(d.byRefusal) + sumCounts(d.byUnparseable);',
      );
    });

    it('still lists every reason, quiet ones included, each one a filter', () => {
      // NOTHING WAS DELETED. Three labelled groups, all three drawn from the
      // same server counts as before, all three clickable.
      expect(html).toContain(
        "tagGroup(box, 'amount refused - needs a look', split.loud, pickRefusal)",
      );
      expect(html).toContain(
        "tagGroup(box, 'document unreadable', d.byUnparseable, pickRefusal)",
      );
      expect(html).toContain(
        "tagGroup(box, 'no figure in the document to read', split.quiet, pickRefusal)",
      );
    });

    it('splits the panel on the same predicate the row splits on', () => {
      // One predicate, two call sites. Two copies would be two chances for a
      // reason to be demoted on the row and still loud in the panel, or the
      // reverse — and the panel is the only place the quiet ones are named.
      expect(html).toContain('var split = partitionRefusals(d.byRefusal);');
      expect(html).toContain('if (isQuietRefusal(all[i].key))');
    });

    it('opens itself when a refusal filter is applied from outside it', () => {
      // The filter is applied from three places and only one of them is inside
      // the disclosure. A filter applied from a row must not leave its own
      // active tag hidden behind a closed triangle.
      expect(html).toContain('if (state.refusal) openDiagnostics();');
      expect(html).toContain('if (box) box.open = true;');
    });
  });

  describe('the filter', () => {
    it('still sends the refusal as a query parameter', () => {
      expect(html).toContain(
        "parts.push('refusal=' + encodeURIComponent(state.refusal))",
      );
    });

    it('still round-trips a quiet reason end to end', () => {
      // The whole path for `no-candidate`: a control writes `state.refusal`,
      // `query()` serialises it, and the chip in the filter bar shows what is
      // applied and clears it. Demoting the label must not narrow the filter.
      expect(html).toContain('state.refusal = state.refusal === reason');
      expect(html).toContain(
        "chip.appendChild(tag('refusal: ' + state.refusal",
      );
      expect(html).toContain('id="refusal-chip"');
    });

    it('offers a third path to the filter that survives the disclosure', () => {
      // Row control, panel pill, filter-bar chip. Closing Diagnostics removes
      // one of the three, which is why there are three.
      expect(html).toContain('function renderRefusalChip()');
      expect(html).toContain("state.refusal = '';");
    });
  });

  it('says on the page what was demoted and why', () => {
    // The footer is the page's own account of itself. A change to what a reader
    // sees that the footer does not mention is a page lying about its own rules.
    //
    // Asserted against whitespace-collapsed prose, so that hard-wrapping a
    // paragraph is a reflow rather than a red build. What is pinned is the
    // sentence, not where it breaks.
    const prose = html.replace(/\s+/g, ' ');

    expect(prose).toContain(
      'Amount-path refusals are diagnostics, not headlines',
    );
    expect(prose).toContain('no-candidate and ambiguity-keyword');
    expect(prose).toContain(
      'still counted and still filterable under Diagnostics',
    );
    expect(prose).toContain(
      'an extractor whose refusals are invisible is indistinguishable from one that is not running',
    );
  });
});

/**
 * THE BRIEF: the day as a finite, countable deck.
 *
 * A string suite can prove three things about it and cannot prove the fourth.
 * It can prove the shell carries every element the deck writes into, that the
 * cover prints the ordering rule rather than implying it, that the deck adds no
 * second path for exchange text into the DOM, and that the design's explicit
 * exclusions are absent. It cannot prove the thing scroll-snap is for — that a
 * card fills a phone and the next one starts below it — which is `e2e/brief.
 * spec.ts` at 430x900.
 *
 * The measurements behind the numbers asserted here are in
 * `docs/superpowers/specs/2026-08-08-genz-visual-consumption-design.md`.
 */
describe('renderDashboardPage — the Brief', () => {
  const script = html.slice(
    html.indexOf('<script>') + '<script>'.length,
    html.lastIndexOf('</script>'),
  );

  describe('where it lives', () => {
    it('puts its tab first, before Feed and Admin', () => {
      // A phone reader lands here; the tab order is the reading order.
      expect(html.indexOf('id="tab-brief"')).toBeLessThan(
        html.indexOf('id="tab-feed"'),
      );
      expect(html.indexOf('id="tab-feed"')).toBeLessThan(
        html.indexOf('id="tab-admin"'),
      );
    });

    it('is a fourth view the tabs switch between', () => {
      expect(script).toContain("el('view-brief').hidden = name !== 'brief';");
      expect(script).toContain(
        "el('tab-brief').className = 'tab' + (name === 'brief' ? ' active' : '');",
      );
    });

    it('lands on the deck at 430px and on the feed above it', () => {
      // The feed's card grid is a desktop object — a 3-column grid whose card
      // is 400px of text — and the deck is a phone object. Each is default
      // where it is right, and the tab is on both so neither reader is trapped.
      expect(script).toContain("window.matchMedia('(max-width: 430px)')");
    });

    it('rides the request the page already makes, with no new route', () => {
      // MAX_LIMIT is 200 and a verified day is 326-463 filings, so the deck is
      // ordered over a window and the cover says so.
      expect(script).toContain('var BRIEF_WINDOW = 200;');
      expect(script).toContain(
        "return 'api/filings?tier=verified&offset=0&limit=' + BRIEF_WINDOW;",
      );
      expect(script).not.toContain('api/brief');
    });
  });

  describe('the ordering, and what it admits to', () => {
    it('prints the rule on the cover, in the design’s own words', () => {
      // Risk 1 of the design: 12 cards of 214 companies could read as the whole
      // day. The mitigation lives in copy, which is the weakest place to put a
      // guarantee — so the copy is pinned.
      expect(script).toContain(
        'Ordered by how much of what each company said could be checked against its own document',
      );
      expect(script).toContain(
        'not by how much it matters. That judgement is yours.',
      );
    });

    it('never calls the deck a top anything', () => {
      // "Top 12 by evidence density" is a SELECTION, and a selection is only
      // honest with a stated cut and a stated remainder. The deck has both, and
      // it does not get to also imply a ranking it cannot support.
      expect(SCRIPT_BRIEF).not.toMatch(/\btop\b/i);
      expect(SCRIPT_BRIEF).not.toMatch(/\bmost important\b/i);
      expect(SCRIPT_BRIEF).not.toMatch(/\bbiggest\b|\bmovers\b/i);
    });

    it('caps the deck at a number derived from a minute', () => {
      // 12 cards at the ~4.5s a 25px sentence plus a glance at the ticker takes
      // is 54 seconds. 15 would be 68 and break the promise the rail makes.
      expect(script).toContain('var BRIEF_MAX_CARDS = 12;');
      expect(script).toContain('var BRIEF_MIN_CARDS = 3;');
    });

    it('breaks every tie, so a repaint cannot reshuffle the deck', () => {
      // The page repaints every four seconds. Two candidates equal on every
      // countable key must not swap under a reader's thumb, which is the bug
      // the topic bar's name tie-break already fixed once.
      expect(script).toContain('return a.symbol < b.symbol ? -1 : 1;');
    });

    it('ranks on countable properties of the evidence only', () => {
      expect(script).toContain('if (a.hasResults !== b.hasResults)');
      expect(script).toContain('return b.figures - a.figures;');
      expect(script).toContain('return b.claims.length - a.claims.length;');
    });
  });

  describe('what the design excludes, asserted as absence', () => {
    it('lifts no delta out of a claim', () => {
      // 823 claims carry a printed delta and 71 carry two or more. A regex that
      // lifts the first and shows it as THE number of the card is a
      // summarisation, not a marking. Slice 4 does it in the pipeline instead.
      expect(SCRIPT_BRIEF).not.toContain('%');
    });

    it('computes no number at all', () => {
      // The verbatim gate: nothing reaches a reader that was not string-matched
      // against the source document, and no arithmetic the filing did not
      // print. These three are how a derived figure gets made — a ratio
      // rounded, a percentage fixed to one place, a string turned into a
      // number to divide it. Every number the deck shows is a substring of a
      // claim that `writeClaim` marked and did not touch.
      expect(SCRIPT_BRIEF).not.toContain('parseFloat');
      expect(SCRIPT_BRIEF).not.toContain('toFixed');
      expect(SCRIPT_BRIEF).not.toContain('Math.');
    });

    it('draws no comparison bar in this slice', () => {
      // The pair-bar card is slice 3: 18 filings, 0.52% of the corpus, and it
      // needs `renderResultsValue`'s output on the wire first so there is one
      // definition of how a figure is spelled.
      expect(html).not.toContain('brief-pair');
    });

    it('never colours a claim by its direction', () => {
      // `writeClaim` already recorded the rule: "up" is the document's word,
      // but colouring it green is this page taking a view.
      expect(SCRIPT_BRIEF).not.toContain('DIRECTION_GLYPH');
      expect(SCRIPT_BRIEF).not.toContain('data-direction');
    });
  });

  describe('exchange text reaches the deck the way it reaches everything else', () => {
    it('opens no second path into the DOM', () => {
      expect(SCRIPT_BRIEF).not.toContain('innerHTML');
      expect(SCRIPT_BRIEF).not.toContain('outerHTML');
      expect(SCRIPT_BRIEF).not.toContain('insertAdjacentHTML');
      expect(SCRIPT_BRIEF).not.toContain('document.write');
    });

    it('writes a claim through writeClaim and a link through safeHref', () => {
      expect(SCRIPT_BRIEF).toContain('writeClaim(');
      expect(SCRIPT_BRIEF).toContain('safeHref(');
    });

    it('looks a topic label up without walking the prototype chain', () => {
      // The topic arrives from the database and `constructor` is a key on every
      // object literal's prototype.
      expect(SCRIPT_BRIEF).toContain('describe(TOPIC_LABEL,');
    });
  });

  describe('the mechanics the stylesheet owns', () => {
    it('scrolls by snapping, with no timer and no hijack', () => {
      // scroll-snap is the entire mechanism. A deck that plays itself is a
      // video, and a reader who looks away must not lose their place.
      expect(html).toContain('scroll-snap-type: y mandatory');
      expect(html).toContain('scroll-snap-align: start');
      expect(html).toContain('overscroll-behavior-y: contain');
      // No card advances itself. The only timer the deck is allowed is the one
      // that puts the word "Copy" back on the Copy button.
      expect(SCRIPT_BRIEF).not.toContain('setInterval');
      expect(SCRIPT_BRIEF).not.toContain('requestAnimationFrame');
    });

    it('measures the viewport in dvh, never vh', () => {
      // iOS Safari's collapsing URL bar makes `100vh` taller than the visible
      // viewport, which puts the footer of every card under the chrome.
      expect(PAGE_STYLE_BRIEF).toContain('100dvh');
      expect(PAGE_STYLE_BRIEF).not.toContain('100vh');
    });

    it('clears the home indicator with the safe-area inset', () => {
      expect(PAGE_STYLE_BRIEF).toContain('env(safe-area-inset-bottom)');
    });

    it('stops animating for a reader who asked it to', () => {
      expect(PAGE_STYLE_BRIEF).toContain(
        '@media (prefers-reduced-motion: reduce)',
      );
    });

    it('carries no backtick and no interpolation of its own', () => {
      // THE SAME GUARD `script-fragments.spec.ts` PUTS ON THE FRAGMENTS, for
      // the same reason and against the same failure: this file is a
      // TypeScript template literal, and it cost a broken build the first time
      // a CSS comment quoted a property name. An ESCAPED backtick compiles
      // fine and lands in the served stylesheet, which is the version of this
      // bug the compiler cannot catch.
      expect(PAGE_STYLE_BRIEF).not.toContain('`');
      expect(PAGE_STYLE_BRIEF).not.toContain('${');
    });

    it('is served by the page', () => {
      // A stylesheet module nothing concatenates is 140 lines of dead file and
      // a deck with no layout at all.
      expect(html).toContain(PAGE_STYLE_BRIEF);
    });

    it('costs `page-style.ts` nothing — it is already at the ceiling', () => {
      // CLAUDE.md's file ceiling is 800 lines and `page-style.ts` is past it.
      expect(PAGE_STYLE_BRIEF.length).toBeGreaterThan(0);
      expect(PAGE_STYLE).not.toContain('brief-deck');
    });
  });

  describe('the names', () => {
    /** Every repeated part of the deck, as `docs/ui-components.md` spells it. */
    const REPEATED = [
      'brief-card',
      'brief-rail-seg',
      'brief-ident',
      'brief-lede',
      'brief-rest',
      'brief-topic',
      'brief-foot',
    ] as const;

    const index = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'docs', 'ui-components.md'),
      'utf8',
    );

    it.each(REPEATED)('draws %s as a data-ui name', (name) => {
      // Repeated elements cannot share an id: a duplicate one silently breaks
      // getElementById for everybody.
      expect(html).toContain(`'${name}'`);
      expect(html).not.toContain(`id="${name}"`);
    });

    it.each(REPEATED)('documents %s in the component index', (name) => {
      // The file's whole premise is that every part of the page has a name you
      // can say out loud. A name in the code and not in the index is a part
      // nobody can point at.
      expect(index).toContain(name);
    });

    it.each([
      'view-brief',
      'brief-cover',
      'brief-deck',
      'brief-rail',
      'brief-end',
      'brief-empty',
    ])('documents the #%s the page draws once', (id) => {
      expect(index).toContain(id);
    });

    it('pins a card by its symbol and its seqId, never by position', () => {
      // Playwright locators re-resolve on the four-second repaint, and the
      // sharp-edges list already records what that costs.
      expect(SCRIPT_BRIEF).toContain("card.setAttribute('data-symbol'");
      expect(SCRIPT_BRIEF).toContain("card.setAttribute('data-seq'");
    });
  });

  describe('the states that are not the happy one', () => {
    it('says nothing qualified rather than drawing an empty deck', () => {
      // "Nothing was found" and "nothing was looked for" are different facts
      // and must not render the same.
      expect(SCRIPT_BRIEF).toContain(
        'carried a claim matched against its source document',
      );
    });

    it('states the remainder on the end card', () => {
      // The deck is 5.6% of the day. The end card is where that is admitted.
      expect(SCRIPT_BRIEF).toContain('brief-end-line');
      expect(SCRIPT_BRIEF).toContain('The rest are in the feed');
    });

    it('suppresses the rail below three cards', () => {
      // A two-segment progress bar is chrome, not information.
      expect(SCRIPT_BRIEF).toContain('count < BRIEF_MIN_CARDS');
    });

    it('hides the topic rather than filing a null claim under Everything else', () => {
      // 15.4% of claims carry no topic, all of them on the newest day. A card
      // has no sum to preserve, so absence is the honest render — this
      // deliberately diverges from renderTopics(), which counts null as `other`
      // so its segments add up to the claim count.
      expect(SCRIPT_BRIEF).toContain('topic === null || topic === undefined');
    });
  });
});

/**
 * The account controls, the star and the Watching view.
 *
 * Asserted against the RENDERED page and the fragment sources, because the
 * failures these guard against are all invisible in review: an ARIA violation
 * in the header, a star typed as a character the emoji test rejects, and a
 * watched state kept in a DOM that is thrown away every four seconds.
 */
describe('renderDashboardPage — the account', () => {
  describe('where the controls live', () => {
    it('puts the account outside the tablist, not inside it', () => {
      // A non-tab child of role="tablist" is an ARIA violation. The buttons
      // share the tab's styling by CLASS and take none of its role.
      const tablist = html.slice(
        html.indexOf('<nav class="tabs"'),
        html.indexOf('</nav>'),
      );
      expect(tablist).not.toContain('id="signout"');
      expect(html).toContain('<div class="account" data-ui="account">');
    });

    it('starts the sign-out button hidden, so the header cannot flicker', () => {
      // Until api/me answers, the page does not know the address to put on it,
      // and a header that fills in on the first poll is quieter than one that
      // changes under the reader.
      expect(html).toMatch(/id="signout"[^>]*hidden/);
    });

    it('starts the Watching tab hidden, since it is meaningless signed out', () => {
      expect(html).toMatch(/id="tab-watching"[^>]*hidden/);
    });

    it('puts the company page control after the industry tag, inside .coident', () => {
      const ident = html.slice(
        html.indexOf('<div class="coident">'),
        html.indexOf('id="co-coverage"'),
      );
      expect(ident.indexOf('id="co-industry"')).toBeLessThan(
        ident.indexOf('id="co-watch"'),
      );
    });
  });

  describe('the star', () => {
    it('is drawn in CSS rather than typed as a character', () => {
      // `page.spec.ts` already rejects U+2600-U+27BF anywhere on the page, and
      // that range holds both star glyphs. This asserts the replacement is a
      // shape rather than the star simply being absent.
      expect(html).toContain('clip-path: polygon(');
      expect(html).toContain('.watch::before');
    });

    it('carries a text label as well as the shape', () => {
      // A clip-path is invisible to a screen reader: there is no glyph and no
      // image to describe.
      expect(SCRIPT_ACCOUNT).toContain("'aria-label'");
      expect(SCRIPT_ACCOUNT).toContain(
        "text.textContent = on ? 'Watching' : 'Watch'",
      );
    });

    it('is absent when signed out rather than disabled', () => {
      // A control that is permanently greyed out and never explains itself
      // reads as a broken page rather than as a feature behind a sign-in.
      expect(SCRIPT_ACCOUNT).toContain('if (!signedIn()) return null;');
    });

    it('keeps the watched set in state, not in the DOM', () => {
      // The feed repaints every four seconds and no node survives a poll, so a
      // star that lived in the DOM would un-fill itself under the cursor. The
      // same rule `state.expanded` follows.
      expect(SCRIPT_BASE).toContain('watched: {}');
      expect(SCRIPT_ACCOUNT).toContain('state.watched[symbol] = true');
    });

    it('keys the watched set by symbol rather than by seqId', () => {
      // One company files repeatedly; the star belongs to the company.
      expect(SCRIPT_ACCOUNT).toContain('data-symbol');
      expect(SCRIPT_ACCOUNT).not.toContain('state.watched[seqId]');
    });
  });

  describe('signing out', () => {
    it('reloads rather than repainting this document as signed out', () => {
      // Every read here is behind the session, so a signed-out reader left on
      // this page watches every poll fail. The server answers the front door
      // with the landing page, so the honest thing to do with a session that
      // just ended is ask it again.
      expect(SCRIPT_ACCOUNT).toContain('window.location.reload()');
    });

    it('latches the reload, so a dead session cannot loop the page', () => {
      // Several polls fail at the same instant when a session expires. Without
      // the latch each of them calls reload() and the reader watches the page
      // restart repeatedly — the one failure worse than a stale page.
      expect(SCRIPT_BASE).toContain('signedOut: false');
      expect(SCRIPT_ACCOUNT).toContain('if (!state.signedOut)');
      expect(SCRIPT_POLL).toContain('err.status === 401 && !state.signedOut');
    });

    it('has no sign-in form of its own left to drift', () => {
      // The panel that used to be here posted to api/auth from inside this
      // document. `/auth` owns that now, and `auth-page.spec.ts` holds the
      // password-manager attributes, the no-native-submit rule and the reset
      // note that used to be asserted here.
      expect(SCRIPT_ACCOUNT).not.toContain('auth-form');
      expect(SCRIPT_ACCOUNT).not.toContain('openAuth');
      expect(SCRIPT_ACCOUNT).not.toContain('innerHTML');
    });
  });

  describe('the Watching view', () => {
    it('reuses the feed renderer rather than drawing its own cards', () => {
      // The largest saving in the design, and the reason exchange text still
      // has exactly one path to the DOM.
      expect(SCRIPT_ACCOUNT).toContain(
        'renderFeedInto(feed, items, meta, false)',
      );
    });

    it('says out loud that an in-app view is not a push channel', () => {
      // A product-messaging obligation, not just an engineering note: the
      // latency promise returns with a real push channel and not before.
      expect(html).toContain('is NOT a push channel');
    });

    it('distinguishes "watching nothing" from "they have filed nothing"', () => {
      expect(SCRIPT_ACCOUNT).toContain('You are not watching anything yet');
      expect(SCRIPT_ACCOUNT).toContain('Nothing yet from the ');
    });

    it('polls with a session only while its own tab is open', () => {
      expect(SCRIPT_POLL).toContain(
        "state.view === 'watching' ? refreshWatching(fresh)",
      );
    });

    it('treats a session that ended as a sign-out rather than a page error', () => {
      // A red banner every four seconds is not a useful answer to "your
      // session expired".
      expect(SCRIPT_ACCOUNT).toContain('err.status === 401');
    });

    it('hides the unread badge at zero rather than drawing a 0', () => {
      expect(SCRIPT_ACCOUNT).toContain('badge.hidden = n === 0');
    });
  });

  describe('the writes the page makes', () => {
    it('sends a JSON body only to the auth routes', () => {
      // Watchlist mutations carry their parameter in the path or the query
      // string, which is what keeps body parsing mounted on one prefix.
      expect(SCRIPT_ACCOUNT).toContain(
        "postJson(path, on ? 'DELETE' : 'POST', undefined)",
      );
      expect(SCRIPT_ACCOUNT).toContain(
        "'api/watchlist?symbol=' + encodeURIComponent(symbol)",
      );
    });

    it('states the credentials mode rather than relying on the default', () => {
      expect(SCRIPT_BASE).toContain("credentials: 'same-origin'");
    });

    it('surfaces the failure envelope message instead of a generic string', () => {
      expect(SCRIPT_BASE).toContain('parsed.error.message');
    });

    it('builds every path relative, since no URL appears in the client', () => {
      expect(SCRIPT_ACCOUNT).not.toMatch(/https?:\/\//);
    });
  });
});

/**
 * The focus card.
 *
 * What can be asserted against a rendered string is the shell, the ARIA and the
 * discipline of the fragment that fills it. That the dialog actually opens,
 * animates and gives focus back is `e2e/focus.spec.ts`, because a string test
 * cannot execute JavaScript — the same division `page.spec.ts`'s own header
 * draws.
 */
describe('the focus card', () => {
  const html = renderDashboardPage();

  it('ships an empty dialog shell, outside the feed', () => {
    // OUTSIDE `#feed` ON PURPOSE. The feed rebuilds every four seconds and no
    // node inside it survives a poll, so a dialog rendered into the card it
    // came from would close itself under a reader mid-read.
    const feedAt = html.indexOf('<div id="feed" class="feed"');
    const dialogAt = html.indexOf('id="focus-back"');

    expect(dialogAt).toBeGreaterThan(-1);
    expect(dialogAt).toBeGreaterThan(feedAt);
    // Empty in the markup: every claim, name and span in it is exchange-derived
    // text and reaches the DOM through createElement/textContent or not at all.
    expect(html).toContain('<div id="focus-body" class="focusbody"></div>');
    expect(html).toContain(
      '<footer id="focus-foot" class="focusfoot"></footer>',
    );
  });

  it('is a real dialog, with a labelled close button', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="focus-symbol"');
    // A bare glyph is unreachable to a screen reader and unhittable with a
    // thumb, so the X is a button with an accessible name of its own.
    expect(html).toContain('id="focus-close"');
    expect(html).toContain('aria-label="Close"');
  });

  it('honours prefers-reduced-motion by removing the motion, not shortening it', () => {
    const reduced = PAGE_STYLE_FOCUS.slice(
      PAGE_STYLE_FOCUS.indexOf('prefers-reduced-motion'),
    );

    expect(reduced).toContain('transition: none');
    expect(reduced).toContain('transform: none');
  });

  it('blurs the backdrop with both spellings, so Safari gets it too', () => {
    expect(PAGE_STYLE_FOCUS).toContain('-webkit-backdrop-filter: blur(');
    expect(PAGE_STYLE_FOCUS).toContain('backdrop-filter: blur(');
  });

  it('replaced the in-place expansion rather than adding to it', () => {
    // The card no longer grows: `state.expanded` is gone, and with it the only
    // reason the page held layout state across a poll.
    expect(SCRIPT_BASE).not.toContain('expanded: {}');
    expect(SCRIPT_FEED).not.toContain('state.expanded');
    // The count survives, because silently truncating would make a partial card
    // look complete.
    expect(SCRIPT_FEED).toContain(
      "'+ ' + (lines.length - CARD_CLAIMS) + ' more'",
    );
    expect(SCRIPT_FEED).toContain('openFocus(filing)');
  });

  it('does not swallow a click that landed on a link or a button', () => {
    // Swallowing a click on a link is how a link stops being one. The test is
    // on the event target rather than on bubbling, so a control added to the
    // card later needs no ceremony.
    expect(SCRIPT_FEED).toContain("closest('a, button')");
  });

  it('shows every claim, including the echoes the feed skips', () => {
    // The feed skips a claim an earlier card already stated, because a scan
    // view repeating itself is noise. This view is one filing opened on
    // purpose, and "everything this filing said" cannot quietly omit a sentence
    // the document contains.
    expect(SCRIPT_FOCUS).toContain('function focusLines(e)');
    expect(SCRIPT_FOCUS).not.toContain('echo');
  });

  it('quotes each span through textContent, with whitespace collapsed', () => {
    // A span lifted out of a PDF carries the line breaks of the page it was set
    // on, and those are not part of the sentence.
    expect(SCRIPT_FOCUS).toContain('createTextNode');
    // ASSERTED ON THE SERVED PAGE, NOT ON THE FRAGMENT SOURCE. Every backslash
    // in a fragment is doubled because the template literal eats one, so the
    // source says `\\s` and the browser receives `\s` — and it is the second
    // that has to be a digit class. CLAUDE.md records this as a sharp edge
    // because the wrong one has shipped.
    expect(html).toContain("replace(/\\s+/g, ' ')");
    expect(SCRIPT_FOCUS).not.toContain('innerHTML');
  });

  it('empties the dialog on close rather than merely hiding it', () => {
    // A hidden node keeps every claim and quoted span in the document —
    // invisible, and still there on a shared screen.
    expect(SCRIPT_FOCUS).toContain("clear(el('focus-body'))");
    expect(SCRIPT_FOCUS).toContain("clear(el('focus-foot'))");
  });

  it('keeps Tab inside the dialog, so aria-modal is not a claim it breaks', () => {
    expect(SCRIPT_FOCUS).toContain('function trapFocus(event)');
    expect(SCRIPT_FOCUS).toContain('focusReturn.focus()');
  });

  it('links the source only through safeHref', () => {
    expect(SCRIPT_FOCUS).toContain('safeHref(f.attachmentUrl)');
    expect(SCRIPT_FOCUS).toContain("rel = 'noopener noreferrer nofollow'");
  });
});
