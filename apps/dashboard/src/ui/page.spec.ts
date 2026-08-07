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
  ] as const;

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

  it('states that the view is read-only', () => {
    expect(html).toContain('never writes');
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
