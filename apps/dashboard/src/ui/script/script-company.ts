/**
 * The company page: the day bar, the figures a filing printed, what the company
 * has dated ahead of it, the movement its documents printed, and the floor
 * below which a per-company distribution is not drawn at all.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string
 * and concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so a name declared here is visible to every other
 * fragment and the order they are joined in is the order they execute in.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the
 * composing template literal before a browser ever sees this, which is the
 * failure this file split exists to make less likely — a test asserts it.
 */
export const SCRIPT_COMPANY = `

  // How a metric is spelled for a reader. The stored keys are wire values —
  // 'net-profit', 'ebitda-margin' — and printing those raw beside a number is
  // the database talking to the reader.
  //
  // MIRRORS 'RESULTS_METRIC_LABEL' in 'libs/filings/src/logic/results.types.ts',
  // which is the source of truth and spells the same six for the alert wire.
  // The pattern is DIRECTION_LABEL's and TOPIC_LABEL's; a key missing here
  // falls through 'describe' and prints the wire value rather than nothing.
  //
  // ITS ABSENCE WAS A BROKEN PAGE, not a missing word. This table was READ
  // before it was written: 'METRIC_LABEL is not defined' threw inside the poll
  // on every company page carrying a results table, and because the fragments
  // share one scope the throw took every later repaint with it. The banner is
  // the only place it showed, which is why 'openCompany' asserts on it.
  var METRIC_LABEL = {
    revenue: 'Revenue',
    'total-income': 'Total income',
    'net-profit': 'Net profit',
    ebitda: 'EBITDA',
    'ebitda-margin': 'EBITDA margin',
    eps: 'EPS'
  };

  /**
   * The numbers a company's filings printed, as they printed them.
   *
   * NOTHING IS COMPUTED, and this is the section where that rule costs the
   * most. A reader wants the change and the margin; the document printed
   * neither, and 'results-line.ts' records what happens to a pipeline that
   * supplies them anyway — a competitor's rescaled line stated an EBITDA margin
   * of 13.32% where its own two figures give 13.23%. So this shows the current
   * token, the year-ago token, and the period each belongs to. The subtraction
   * is the reader's, over two numbers they can find in the PDF.
   *
   * THE VALUES ARE RENDERED BY THE SERVER. 'currentDisplay' carries the
   * document's own currency mark and scale word; the browser never assembles
   * one, for the reason 'amountDisplay' exists.
   *
   * NEWEST FIRST, AND AN IDENTICAL TABLE IS SHOWN ONCE. A company files its
   * quarter as a results statement and again as a press release the same
   * morning, and both carry the same table: measured 2026-08-08, three of the
   * fifteen companies with figures did exactly that, and the page drew the same
   * four numbers twice under the same date, which reads as a bug.
   *
   * THE KEY IS THE CONTENT, NOT THE QUARTER, and that difference is the whole
   * care taken here. Collapsing on period and basis alone would hide a
   * RESTATEMENT — the same quarter filed again with a different number is the
   * single most newsworthy thing this section could show. VIJAYA is the live
   * case: two filings, one quarter, and one of them prints EPS the other does
   * not, so it keeps both blocks.
   */
  function renderFigures(box, items) {
    box.textContent = '';
    var drawn = 0;
    var seen = {};

    for (var i = 0; i < items.length; i++) {
      var filing = items[i];
      var results = filing.enrichment && filing.enrichment.results;
      var figures = (results && results.figures) || [];
      if (figures.length === 0) continue;

      // Every published token, in order, so two blocks collapse only when a
      // reader would see the same characters twice.
      var signature = results.period + '|' + results.basis;
      for (var s = 0; s < figures.length; s++) {
        signature +=
          '|' +
          figures[s].metric +
          ':' +
          figures[s].current +
          ':' +
          figures[s].prior +
          ':' +
          figures[s].unit;
      }
      // 'hasOwnProperty' rather than a bare lookup: the key is built from
      // document text and 'constructor' is on every object's prototype.
      if (Object.prototype.hasOwnProperty.call(seen, signature)) continue;
      seen[signature] = true;

      var block = document.createElement('section');
      block.className = 'figblock';
      block.setAttribute('data-ui', 'company-figure-block');

      var head = document.createElement('div');
      head.className = 'fighead';

      var period = document.createElement('span');
      period.className = 'figperiod';
      period.textContent = results.period;
      head.appendChild(period);

      var basis = document.createElement('span');
      basis.className = 'figbasis';
      // NEVER ABBREVIATED, and the evidence for it travels with it: the
      // consolidated and standalone statements in one filing differ by tens of
      // per cent, and the heading that fixed which one this is was quoted from
      // the document for exactly this moment.
      basis.textContent = results.basis;
      if (results.basisSpan) {
        basis.title = 'The document printed: "' + results.basisSpan + '"';
      }
      head.appendChild(basis);

      var when = document.createElement('span');
      when.className = 'figwhen';
      // THE SERVER'S IST DAY, printed rather than formatted.
      when.textContent = filing.istDay;
      when.title = filing.disseminatedAtIst + ' IST';
      head.appendChild(when);
      block.appendChild(head);

      var rows = document.createElement('ul');
      rows.className = 'figrows';
      for (var f = 0; f < figures.length; f++) {
        var figure = figures[f];
        var row = document.createElement('li');
        row.className = 'figrow';
        row.setAttribute('data-ui', 'company-figure');
        // THE TABLE ROW THE FIGURE WAS READ FROM. A reader can search the PDF
        // for these characters and find the same line, which is the whole
        // reason a figure may be shown outside the document it came from.
        row.title = 'The document printed: "' + figure.span + '"';

        var metric = document.createElement('span');
        metric.className = 'figmetric';
        metric.textContent = describe(METRIC_LABEL, figure.metric);
        row.appendChild(metric);

        var current = document.createElement('span');
        current.className = 'figvalue';
        current.textContent = figure.currentDisplay;
        row.appendChild(current);

        var prior = document.createElement('span');
        prior.className = 'figprior';
        // The word is 'vs' and never an arrow, a sign or a percentage: the
        // relation between the two numbers is the reader's to read.
        prior.textContent =
          'vs ' + figure.priorDisplay + ' · ' + results.priorPeriod;
        row.appendChild(prior);

        rows.appendChild(row);
      }
      block.appendChild(rows);
      box.appendChild(block);
      drawn += 1;
    }

    return drawn > 0;
  }

  /**
   * What the company has dated ahead of it.
   *
   * SELECTED ON 'claim.commitments' AND ON NOTHING ELSE. The browser holds no
   * list of scheduling words, no list of date shapes and no idea what today is:
   * the server answers with the days themselves, using 'claim-commitment.ts',
   * because "still ahead" rolls at 18:30 UTC and a browser deciding it locally
   * would show yesterday's record date as upcoming all evening. Two rules would
   * be two answers to one question.
   *
   * SOONEST FIRST, which is the one ordering this section can have — a list of
   * appointments is read forwards.
   *
   * ONE ENTRY PER DATE AND WORD. A company files the same AGM date in four
   * documents in a week; measured 2026-08-08, HGS's 25 September AGM is in four
   * of them. The plans list leans on the server's 'echo' mark for this, which
   * is about a repeated FACT; here the repeat is exact and visible — the same
   * day under the same word — so it is collapsed on what a reader would see
   * twice rather than on a second notion of sameness.
   */
  function renderNext(list, items) {
    list.textContent = '';

    var seen = {};
    var found = [];
    for (var i = 0; i < items.length; i++) {
      var filing = items[i];
      var claims = (filing.enrichment && filing.enrichment.claims) || [];
      for (var c = 0; c < claims.length; c++) {
        var dates = claims[c].commitments || [];
        for (var d = 0; d < dates.length; d++) {
          var one = dates[d];
          var key = one.date + '|' + one.evidence.toLowerCase();
          // 'hasOwnProperty' rather than a bare lookup: the key is built from
          // document text and 'constructor' is on every object's prototype.
          if (Object.prototype.hasOwnProperty.call(seen, key)) continue;
          seen[key] = true;
          found.push({
            date: one.date,
            what: one.evidence,
            span: claims[c].span,
            filedOn: filing.istDay,
            filedAt: filing.disseminatedAtIst
          });
        }
      }
    }

    found.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Ties broken by the word, so a repaint four seconds from now cannot
      // reorder two appointments on one day and make the list appear to move.
      return a.what < b.what ? -1 : 1;
    });

    for (var n = 0; n < found.length; n++) {
      var entry = found[n];
      var item = document.createElement('li');
      item.className = 'plan';
      item.setAttribute('data-ui', 'company-next-item');

      var day = document.createElement('div');
      day.className = 'nextwhen';
      // The server's day key, printed. Nothing here parses or formats a date.
      day.textContent = entry.date;
      item.appendChild(day);

      var what = document.createElement('div');
      what.className = 'nextwhat';
      // The document's own word for the appointment, which is also the evidence
      // that it is one — the same discipline the movement mark follows.
      what.textContent = entry.what;
      item.appendChild(what);

      var quote = document.createElement('div');
      quote.className = 'planquote';
      // The whitespace is collapsed the way the plans list collapses it: a span
      // lifted out of a PDF carries the line breaks of the page it was set on.
      quote.textContent = entry.span
        ? '"' + String(entry.span).replace(/\\s+/g, ' ').trim() + '"'
        : 'No source sentence is stored for this line.';
      item.appendChild(quote);

      var filed = document.createElement('div');
      filed.className = 'planwhen';
      filed.textContent = 'filed ' + entry.filedOn;
      filed.title = entry.filedAt + ' IST';
      item.appendChild(filed);

      list.appendChild(item);
    }

    return found.length > 0;
  }

  /**
   * The movement the documents printed, in the order they printed it.
   *
   * IN PLACE OF THE CATEGORY BAR, and answering a question the bar could not:
   * that one said what share of a company's filings NSE files under
   * 'Governance', which is a fact about NSE's category list. This says which
   * way the company's own sentences pointed, and every mark carries the
   * characters that decided it.
   *
   * NO COUNT, ANYWHERE. "Four increases and one decrease" is a verdict on a
   * company and this page issues none — and the collection says such a tally
   * would be wrong as often as right: 13 of the 45 printed decreases are
   * falling bad loans, debt, borrowing costs or emissions.
   *
   * ONE ROW PER IST DAY, NOT PER FILING, and the difference is visible rather
   * than academic: SONATSOFTW filed five marked documents on 2026-08-06, and
   * the per-filing version drew five rows all stamped with the same date. A
   * reader reads that as five days. The day is the unit a reader has, so it is
   * the unit the row is.
   *
   * OLDEST FIRST, so the rows read down the way time does. The response arrives
   * newest first, so this walks it backwards.
   *
   * THE GLYPHS AND THE LABELS ARE THE FEED'S. 'DIRECTION_GLYPH' and
   * 'DIRECTION_LABEL' are declared in 'script-feed.ts' and every fragment
   * shares one scope; a second copy here would be a second vocabulary for one
   * thing, and the two would drift. That sharing is also a hazard — see the
   * 'WEEKDAY_NAME' note in 'script-admin.ts' — so a name is used where it is
   * declared beside its user, never left orphaned by a deletion elsewhere.
   */
  function renderMarks(box, items) {
    box.textContent = '';

    // Days in the order they are first met walking oldest-first, so the output
    // order comes out of the walk rather than out of a second sort.
    var order = [];
    var byDay = {};
    for (var i = items.length - 1; i >= 0; i--) {
      var filing = items[i];
      var claims = (filing.enrichment && filing.enrichment.claims) || [];
      for (var c = 0; c < claims.length; c++) {
        // The direction arrives from the database and 'constructor' is a key on
        // every object literal's prototype, so an unguarded lookup would draw a
        // function as a glyph. There is no entry for 'unrated' and none for
        // null: a mark that means nothing is not drawn.
        if (
          !Object.prototype.hasOwnProperty.call(
            DIRECTION_GLYPH,
            claims[c].direction,
          )
        ) {
          continue;
        }
        var key = filing.istDay;
        if (!Object.prototype.hasOwnProperty.call(byDay, key)) {
          byDay[key] = [];
          order.push(key);
        }
        byDay[key].push(claims[c]);
      }
    }

    for (var d = 0; d < order.length; d++) {
      var day = document.createElement('div');
      day.className = 'markday';
      day.setAttribute('data-ui', 'company-mark-day');

      var when = document.createElement('span');
      when.className = 'markwhen';
      // The server's IST day, printed. Nothing here formats a date.
      when.textContent = order[d];
      day.appendChild(when);

      var row = document.createElement('span');
      row.className = 'markrow';
      var marked = byDay[order[d]];
      for (var m = 0; m < marked.length; m++) {
        var claim = marked[m];
        var mark = document.createElement('span');
        mark.className = 'dir';
        mark.setAttribute('data-ui', 'company-mark');
        mark.setAttribute('data-direction', claim.direction);
        mark.textContent = DIRECTION_GLYPH[claim.direction];
        mark.setAttribute('aria-label', DIRECTION_LABEL[claim.direction]);
        // WHAT MAKES THE MARK ADMISSIBLE, and the only reason a derived glyph
        // may appear on this page: the characters it was derived from travel
        // with it, so a reader checks it without opening the PDF.
        if (claim.directionEvidence) {
          mark.title = 'Printed in the document: "' + claim.directionEvidence + '"';
        }
        row.appendChild(mark);
      }
      day.appendChild(row);
      box.appendChild(day);
    }

    return order.length > 0;
  }

  // The reader-facing name for each topic, and the same words the filter chips
  // use. A company page that called it "acquisition" beside a chip that says
  // "Deals" would be two names for one thing on one screen.
  var TOPIC_LABEL = {
    financial: 'Financials',
    dividend: 'Dividends',
    orders: 'Order wins',
    acquisition: 'Deals',
    capacity: 'Capacity',
    product: 'Product',
    ratings: 'Ratings',
    governance: 'Governance',
    other: 'Everything else'
  };

  /**
   * Claims below which a company's topic mix is not drawn.
   *
   * FOUR CLAIMS, NOT FOUR FILINGS, and the different unit is the point rather
   * than an oversight. This bar's observations are CLAIMS, and a company's
   * claim count and filing count are only loosely related — CAPACITE has 23
   * claims across 2 filings and would be suppressed by a filing floor while
   * having more to say than almost anyone. (The group-mix bar that once sat
   * above this one carried the filing-counted floor, MIN_DISTRIBUTION_FILINGS
   * = 5; it drew for 128 companies where this one draws for 257, and it was
   * deleted for saying nothing about the company either way.)
   *
   * THE ONLY FLOOR LEFT ON THIS PAGE. The three sections above it have none,
   * because none of them is a distribution - see 'renderCompany'.
   *
   * Measured over the 547 companies holding at least one claim:
   *
   *     floor   companies drawn   of those, showing 2+ topics
   *       1           547                  64%
   *       2           466                  75%
   *       3           368                  84%
   *       4           257                  90%
   *       5           222                  92%
   *
   * Four is where the curve flattens: 3 to 4 buys six points and 4 to 5 buys
   * two.
   *
   * A SINGLE-COLOUR BAR IS NOT THE FAILURE HERE, which is why the floor sits on
   * count and not on diversity. "Every one of these nine claims is financial"
   * is a true and useful thing to learn about a company. "This company's one
   * claim was financial" is not a distribution at all.
   */
  var MIN_TOPIC_CLAIMS = 4;

  /**
   * What a company actually said, as one bar.
   *
   * The same shape as renderMix one axis over, and deliberately not shared
   * with it: that one counts filings by a field on the filing, this one counts
   * claims by a field on each claim, and a parameterised version would take a
   * getter, a labeller and a class prefix to save eleven lines.
   */
  function renderTopics(bar, legend, items) {
    bar.textContent = '';
    legend.textContent = '';

    var counts = {};
    var order = [];
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      var claims = (items[i].enrichment && items[i].enrichment.claims) || [];
      for (var c = 0; c < claims.length; c++) {
        // A claim stored before the classifier existed carries no topic. It is
        // counted under the topic that means "nothing in particular" rather
        // than dropped, so the bar's segments still add up to the claim count
        // the rest of the page shows.
        var topic = claims[c].topic || 'other';
        if (!Object.prototype.hasOwnProperty.call(counts, topic)) {
          counts[topic] = 0;
          order.push(topic);
        }
        counts[topic] += 1;
        total += 1;
      }
    }
    if (total < MIN_TOPIC_CLAIMS) return false;

    order.sort(function (a, b) {
      // Ties broken by name, so a repaint four seconds from now cannot reorder
      // two equal segments and make the bar appear to move on its own.
      if (counts[b] !== counts[a]) return counts[b] - counts[a];
      return a < b ? -1 : 1;
    });

    for (var j = 0; j < order.length; j++) {
      var name = order[j];
      var label = describe(TOPIC_LABEL, name);
      var seg = document.createElement('div');
      seg.className = 'mixseg t-' + name;
      seg.style.flexGrow = String(counts[name]);
      seg.title = label + ': ' + counts[name] + ' claim(s)';
      bar.appendChild(seg);

      // EVERY segment is named, not the first three. The titles above are
      // hover tooltips and a phone has no hover, so a fourth colour was a
      // stripe a reader could not decode - asked about on 2026-08-19.
      var item = document.createElement('span');
      item.className = 'mixitem';
      var swatch = document.createElement('span');
      swatch.className = 'mixdot t-' + name;
      item.appendChild(swatch);
      var text = document.createElement('span');
      text.textContent = label + ' ' + counts[name];
      item.appendChild(text);
      legend.appendChild(item);
    }
    return true;
  }

  /**
   * What the company says it plans, in its own printed words.
   *
   * QUOTES THE SPAN, NEVER THE CLAIM TEXT. The span is the document's own bytes
   * at the matched position; the text is the extractor's compression of them,
   * and a section headed "in their words" may only ever show the first. That
   * also makes every line checkable against the PDF by a reader with no tools,
   * which is the only reason a forward-looking sentence may appear on this page
   * at all — see the section comment in page.ts.
   *
   * SELECTED ON 'planEvidence' AND ON NOTHING ELSE. The browser holds no list
   * of kinds and no list of forward-looking words: the server answers whether
   * this sentence is one of these, using 'claim-plan.ts', which is the same
   * rule the feed's Plans chip filters on. Two rules would be two answers to
   * one question. The evidence itself goes in the item's title, so a reader can
   * see which of the document's words put the line here.
   *
   * NOTHING IS COMPUTED. No count, no comparison between one filing's guidance
   * and the next, no sentence composed across two quotes. Two guidance
   * statements six weeks apart are two dated quotes, and what changed between
   * them is the reader's to read.
   *
   * NEWEST FIRST, which costs nothing: the response arrives newest first and
   * this walks it in order. Uncapped, because the busiest company measured on
   * 2026-08-08 held 7 quotable plans and a list of 7 dated quotes is a list.
   */
  function renderPlans(list, items) {
    list.textContent = '';
    var drawn = 0;

    for (var i = 0; i < items.length; i++) {
      var filing = items[i];
      var claims = (filing.enrichment && filing.enrichment.claims) || [];
      for (var c = 0; c < claims.length; c++) {
        var claim = claims[c];
        if (!claim.planEvidence) continue;
        // ECHOES ARE SKIPPED, the same way the feed's headlines skip them and
        // for the same reason: a company files its guidance in a press release
        // and in a presentation the same morning, and this list would show one
        // sentence twice under two dates. The server has already decided what
        // counts as a repeat; inventing a second notion of sameness here would
        // be two answers to one question.
        if (claim.echo === true) continue;

        var item = document.createElement('li');
        item.className = 'plan';
        item.setAttribute('data-ui', 'company-plan');
        // WHY THIS LINE IS HERE, in the document's own words. The section
        // quotes a sentence because the filing pointed forward in it, and the
        // words that decided so travel with it — the same rule the movement
        // mark follows: a derived judgement is admissible only when the reader
        // can check it without opening the PDF.
        item.title = 'The company printed: "' + claim.planEvidence + '"';

        var quote = document.createElement('div');
        quote.className = 'planquote';
        // The quotation marks are TEXT around text, never markup, and the
        // whitespace is collapsed the way the focus card collapses it: a span
        // lifted out of a PDF carries the line breaks of the page it was set on
        // and those are not part of the sentence.
        //
        // A verified claim always carries a span. If one ever does not, this
        // says so rather than drawing empty quotation marks — "no words were
        // stored" and "the company said nothing" are different facts.
        quote.textContent = claim.span
          ? '"' + String(claim.span).replace(/\\s+/g, ' ').trim() + '"'
          : 'No source sentence is stored for this line.';
        item.appendChild(quote);

        var when = document.createElement('div');
        when.className = 'planwhen';
        // THE SERVER'S IST DAY, printed rather than formatted. A browser set to
        // UTC would date a 9am Mumbai filing to the previous evening.
        when.textContent = filing.istDay;
        when.title = filing.disseminatedAtIst + ' IST';
        item.appendChild(when);

        list.appendChild(item);
        drawn += 1;
      }
    }

    return drawn > 0;
  }

  function renderCompany(items, meta) {
    if (state.company === null) return;

    setText('co-symbol', state.company);
    setText('co-name', items.length > 0 ? items[0].companyName : '');

    // Industry appears ONLY when it is known, and it still often is not: NSE
    // printed one for 522 of the 1,289 companies held, BSE's scrip header
    // covers a further 357, and 410 have neither. So it can never be a
    // structural element — a page whose third line reads "Industry: —" on three
    // companies in ten looks broken rather than honest.
    //
    // AND IT SAYS WHOSE CLASSIFICATION IT IS. The two exchanges use different
    // vocabularies for the same company, so a BSE-sourced value carries a mark;
    // an unmarked chip is NSE's own string, which is what every chip on this
    // page was before the BSE lookup existed.
    var industry = items.length > 0 ? items[0].industry : null;
    var industrySource = items.length > 0 ? items[0].industrySource : null;
    var industryTag = el('co-industry');
    industryTag.hidden = !industry;
    clear(industryTag);
    if (industry) {
      industryTag.appendChild(document.createTextNode(industry));
      industryTag.title =
        'Industry as classified by ' +
        (industrySource === 'bse' ? 'BSE' : 'NSE');
      if (industrySource === 'bse') {
        var from = document.createElement('span');
        from.className = 'tagfrom';
        from.setAttribute('data-ui', 'co-industry-source');
        from.textContent = 'BSE';
        industryTag.appendChild(from);
      }
    }

    // The watch control, hidden exactly the way the industry tag above it is.
    // Absent when signed out for the same reason the card's star is: a
    // permanently disabled control explains nothing.
    var watch = el('co-watch');
    watch.hidden = !signedIn();
    if (!watch.hidden) setWatchLabel(watch, state.company);

    var verified = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].confidenceTier === 'verified') verified += 1;
    }
    setText('co-filings', groupInt(meta.total));
    setText('co-verified', groupInt(verified));
    // The timestamp is written onto the stat the way every card carries its
    // 'data-at', so 'touchFeedTimes' can keep it aging on the 304 ticks that
    // skip this render - without it the cards below said "34 min ago" under
    // a header still saying "3 min ago" after half an hour on a quiet page.
    var lastEl = el('co-last');
    if (items.length > 0) {
      lastEl.setAttribute('data-at', items[0].disseminatedAt);
      lastEl.textContent = relativeTime(items[0].disseminatedAt);
    } else {
      lastEl.removeAttribute('data-at');
      lastEl.textContent = '—';
    }

    // THE COVERAGE LINE, and it is the first thing that tells a reader whether
    // anything below it means anything. It is also the ONLY thing left on this
    // page about the shape of our holdings rather than about the company: the
    // filing strip drew one square per filing across a calendar and told a
    // reader how many Tuesdays we had, which is a picture of the pipeline.
    var days = {};
    for (var d = 0; d < items.length; d++) {
      if (items[d].istDay) days[items[d].istDay] = true;
    }
    var dayKeys = Object.keys(days).sort();
    setText(
      'co-coverage',
      dayKeys.length === 0
        ? ''
        : groupInt(meta.total) +
            ' filings held across ' +
            dayKeys.length +
            (dayKeys.length === 1 ? ' IST day · ' : ' IST days · ') +
            dayKeys[0] +
            ' to ' +
            dayKeys[dayKeys.length - 1],
    );

    // DRAWN FIRST AND HIDDEN AFTER, all three of them, for the reason the two
    // sections below already work this way: only the renderer can see whether
    // anything qualified, and writing the condition twice is writing it in two
    // places that can disagree.
    //
    // NO FLOOR ON ANY OF THEM, unlike the topic bar. A floor guards a bar
    // drawn over too few observations, because one observation drawn as a bar
    // is a single colour claiming to be a distribution. None of these three is
    // a distribution: one printed table is one printed table, one dated
    // appointment is one dated appointment, and one movement mark is one
    // sentence with its evidence attached.
    el('co-figures-wrap').hidden = !renderFigures(el('co-figures'), items);
    el('co-next-wrap').hidden = !renderNext(el('co-next'), items);
    el('co-marks-wrap').hidden = !renderMarks(el('co-marks'), items);

    // DRAWN FIRST, HIDDEN AFTER, because only the renderer can count the claims
    // — they are nested inside the filings and the floor is on their total, not
    // on anything renderCompany already holds. It returns whether it drew
    // anything rather than having the floor written down in two places.
    var topicsWrap = el('co-topics-wrap');
    var drewTopics = renderTopics(
      el('co-topics'),
      el('co-topics-legend'),
      items,
    );
    topicsWrap.hidden = !drewTopics;

    // DRAWN FIRST AND HIDDEN AFTER, like the bar above it, because only the
    // renderer can see whether any claim qualified. The condition is the ONLY
    // one: there is no floor here, and that difference from the two widgets
    // above is deliberate — one quoted sentence says exactly as much as it
    // says, while one observation drawn as a bar is a single colour claiming to
    // be a distribution.
    var plansWrap = el('co-plans-wrap');
    plansWrap.hidden = !renderPlans(el('co-plans'), items);

    renderFeedInto(el('company-feed'), items, meta, false);
  }

`;
