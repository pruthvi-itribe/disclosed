/**
 * The admin view: the filings table, the enrichment and diagnostics panels,
 * the confidence tiers, the reading routes and the daily bars.
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
export const SCRIPT_ADMIN = `
  function renderFilings(items, meta) {
    var body = el('rows');
    clear(body);

    if (items.length === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = COLUMN_COUNT;
      td.className = 'empty-state';
      td.textContent = 'No filings match this view.';
      tr.appendChild(td);
      body.appendChild(tr);
    }

    // A row is "fresh" only when it is newer than the highest seqId this page
    // has already drawn. On the very first paint nothing is fresh - otherwise
    // opening the page would flash the whole table as if a hundred filings had
    // just landed.
    var previousHigh = state.highestSeen;
    var newHigh = previousHigh;

    for (var i = 0; i < items.length; i++) {
      var f = items[i];
      if (newHigh === null || f.seqId > newHigh) newHigh = f.seqId;

      var row = document.createElement('tr');
      if (previousHigh !== null && f.seqId > previousHigh) row.className = 'fresh';

      var when = cell(row, 'time', relativeTime(f.disseminatedAt));
      // The exact IST timestamp is one hover away rather than gone. "14m ago"
      // is what a reader scanning the day wants; "07 Aug 2026, 08:14:23" is
      // what they want the moment they are reconciling against something else.
      when.title = f.disseminatedAtIst + ' IST';

      cell(row, 'sym', f.symbol).title = f.companyName;

      var enrichment = f.enrichment || { state: 'pending', attempts: 0 };
      // WHAT THE FILING SAID, and nothing about how we came to know it. The
      // amount column, the enrichment tags, the seqId and the model summary all
      // used to sit on this row; every one of them is a fact about the pipeline
      // rather than about the company, and together they crowded out the thing
      // a reader opens this page for. They are all still here — one click down,
      // in the detail row, where somebody asking "how do you know that" finds
      // them and nobody else has to look at them.
      headlineCell(row, f);
      groupCell(row, f);

      var src = cell(row, 'src', null);
      var href = safeHref(f.attachmentUrl);
      if (href) {
        var link = document.createElement('a');
        link.href = href;
        link.rel = 'noopener noreferrer nofollow';
        link.target = '_blank';
        link.textContent = 'source';
        // The link must not also toggle the row it sits in.
        link.onclick = function (event) { event.stopPropagation(); };
        src.appendChild(link);
      } else {
        src.textContent = '—';
        src.className = 'src muted';
      }

      body.appendChild(row);
      body.appendChild(detailRow(row, f, enrichment));
    }

    state.highestSeen = newHigh;

    var from = meta.total === 0 ? 0 : meta.offset + 1;
    var to = meta.offset + meta.returned;
    setText('page-info', from + '-' + to + ' of ' + groupInt(meta.total));
    el('prev').disabled = meta.offset <= 0;
    el('next').disabled = !meta.hasMore;
  }

  function emptyPanel(box, message) {
    var none = document.createElement('div');
    none.className = 'empty-state';
    none.textContent = message;
    box.appendChild(none);
  }

  // One breakdown row: a name, a count, and a bar sized against the largest row
  // in its own panel. Shared by the category and category-group panels rather
  // than written twice, because those two are the same distribution at two
  // resolutions and a reader comparing them must not have to work out whether a
  // difference in the bars is a difference in the data.
  function meterRow(box, spec) {
    var row = document.createElement('div');
    row.className = 'row clickable' + (spec.active ? ' active' : '');
    row.title = spec.title;

    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = spec.label;
    row.appendChild(name);

    var n = document.createElement('div');
    n.className = 'n';
    n.textContent = groupInt(spec.count);
    row.appendChild(n);

    var meter = document.createElement('div');
    meter.className = 'meter';
    meter.style.width = Math.max(2, Math.round((spec.count / spec.top) * 100)) + '%';
    row.appendChild(meter);

    row.addEventListener('click', spec.onClick);
    box.appendChild(row);
  }

  // A {key, count} pill.
  //
  // 'picker' is null where NO FILTER ACCEPTS THE VALUE. The refusal filter
  // searches five enrichment fields and a parser is not one of them, so a
  // clickable parse-route tag would apply a filter matching zero documents - and
  // an empty table is how this page says "nothing was found", not "your filter
  // was meaningless". Un-clickable is the honest rendering of an un-filterable
  // count.
  function countTag(r, picker) {
    var className = picker === null
      ? 'route'
      : 'refusal' + (state.refusal === r.key ? ' active' : '');
    var node = tag(r.key, className, picker === null ? null : picker(r.key));
    var n = document.createElement('span');
    n.className = 'n';
    n.textContent = groupInt(r.count);
    node.appendChild(n);
    return node;
  }

  // A labelled group of count pills, or nothing at all when the group is empty.
  // Returns how many it drew, so a caller can tell an empty panel from a drawn
  // one without counting its own rows again.
  function tagGroup(box, label, rows, picker) {
    if (!rows || rows.length === 0) return 0;

    var heading = document.createElement('div');
    heading.className = 'reason-group';
    heading.textContent = label;
    box.appendChild(heading);

    var wrap = document.createElement('div');
    wrap.className = 'reasons';
    for (var i = 0; i < rows.length; i++) wrap.appendChild(countTag(rows[i], picker));
    box.appendChild(wrap);

    return rows.length;
  }

  function renderCategories(rows) {
    var box = el('categories');
    clear(box);

    if (rows.length === 0) {
      emptyPanel(box, 'Nothing ingested yet.');
      return;
    }

    var top = rows[0].count || 1;
    var select = el('category');
    var known = {};
    for (var j = 0; j < select.options.length; j++) known[select.options[j].value] = true;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      meterRow(box, {
        label: r.category,
        title: r.category,
        count: r.count,
        top: top,
        active: state.category === r.category,
        onClick: pickCategory(r.category)
      });

      if (!known[r.category]) {
        var option = document.createElement('option');
        option.value = r.category;
        option.textContent = r.category;
        select.appendChild(option);
        known[r.category] = true;
      }
    }
    select.value = state.category;
  }

  function pickCategory(value) {
    return function () {
      state.category = state.category === value ? '' : value;
      el('category').value = state.category;
      state.offset = 0;
      refresh(true);
    };
  }

  function pct(part, whole) {
    if (!whole) return '0%';
    return (Math.round((part / whole) * 1000) / 10) + '%';
  }

  // The refusal breakdown, which is what makes the extractor auditable: every
  // document it declined, grouped by the machine-readable reason, each one a
  // filter. A pipeline that only reported its successes would be asking to be
  // taken on trust.
  function renderEnrichment(d) {
    setText('stat-amounts', groupInt(d.withAmount));
    setText('stat-amounts-note', pct(d.withAmount, d.total) + ' of ' + groupInt(d.total) + ' filings');

    // "Every filing produces an outcome" is the claim this whole change makes,
    // and it is shown as a NUMBER rather than asserted in a comment, because a
    // claim nobody can falsify is not a claim. It equals the total by
    // construction - the outcome is derived from fields the poller always writes
    // - so the card is flagged only when the two disagree, which is the day
    // something silently stopped deriving one.
    setText('stat-outcome', groupInt(d.withOutcome));
    setText('stat-outcome-note', pct(d.withOutcome, d.total) + ' of ' + groupInt(d.total) + ' filings');
    el('stat-outcome').className = 'value' + (d.withOutcome === d.total ? '' : ' bad');

    var pending = 0;
    for (var s = 0; s < d.byState.length; s++) {
      if (d.byState[s].key === 'pending') pending = d.byState[s].count;
    }
    setText('stat-pending', groupInt(pending));

    var box = el('refusals');
    clear(box);

    // THE SAME SPLIT THE ROW MAKES, FROM THE SAME PREDICATE. Two copies of it
    // would be two chances for a reason to be demoted on the row and still loud
    // in the panel, or the reverse - and this panel is the only place the quiet
    // ones are named in full. What is refused for a readable reason leads, an
    // unreadable document follows, and the two that mean "there was no figure in
    // there to read" come last. Every group is counted and every pill in all
    // three filters: this is a demotion of prominence, not of information.
    var split = partitionRefusals(d.byRefusal);
    var drawn = tagGroup(box, 'amount refused - needs a look', split.loud, pickRefusal)
      + tagGroup(box, 'document unreadable', d.byUnparseable, pickRefusal)
      + tagGroup(box, 'no figure in the document to read', split.quiet, pickRefusal);

    if (drawn === 0) emptyPanel(box, 'Nothing refused yet.');

    renderDiagnosticsCount(d);
    renderClaims(d);
    renderResults(d);
    renderTiers(d);
    renderReading(d);
    renderGroups(d);
    renderRefusalChip();
  }

  // Splits the amount refusals into the two that mean "the document stated no
  // figure" and everything else. Local accumulators; the server's rows are read
  // and never written, so the panel cannot reorder the counts it was given.
  function partitionRefusals(rows) {
    var quiet = [];
    var loud = [];
    var all = rows || [];
    for (var i = 0; i < all.length; i++) {
      if (isQuietRefusal(all[i].key)) {
        quiet.push(all[i]);
      } else {
        loud.push(all[i]);
      }
    }
    return { quiet: quiet, loud: loud };
  }

  function sumCounts(rows) {
    var all = rows || [];
    var total = 0;
    for (var i = 0; i < all.length; i++) total += all[i].count;
    return total;
  }

  // WHAT KEEPS A COLLAPSED PANEL HONEST.
  //
  // The breakdown folds away behind a disclosure, because on this collection it
  // is a diagnostic and not a headline. The NUMBER does not fold away: it sits
  // on the summary line, so a reader who never opens Diagnostics still sees that
  // the extractor declined two thousand-odd documents, and sees that figure go
  // to zero on the day it stops running. An extractor whose refusals are
  // invisible is indistinguishable from one that is not running, and a count on
  // a closed panel is the cheapest way to keep those two apart.
  function renderDiagnosticsCount(d) {
    var total = sumCounts(d.byRefusal) + sumCounts(d.byUnparseable);
    setText('diag-count', groupInt(total) + ' refusal(s) recorded');
  }

  // The shape of what can be trusted, and the panel a reader should look at
  // before any other: it says what fraction of the collection anybody has
  // actually checked against a document.
  //
  // TWO ROWS, NOT THREE, and that is the server's honest limit rather than an
  // omission - 'verified' is a predicate over indexed fields, while telling
  // 'stated' from 'labelled' is a string comparison this application does on
  // read so that the whole existing collection gained an outcome without a
  // backfill. The three-way distinction is on every row's badge, where it costs
  // nothing; the filter cuts at 'verified' because that is the boundary with a
  // consequence attached to it.
  function renderTiers(d) {
    var box = el('tiers');
    clear(box);

    var rows = d.byConfidenceTier || [];
    var top = 0;
    for (var t = 0; t < rows.length; t++) top = Math.max(top, rows[t].count);

    if (top === 0) {
      emptyPanel(box, 'Nothing ingested yet.');
      return;
    }

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var filter = tierFilterFor(r.key);
      meterRow(box, {
        label: r.key,
        title: filter === 'verified'
          ? 'something in these survived a gate against the source document'
          : 'nothing in these was checked against the source document',
        count: r.count,
        top: top,
        active: state.tier === filter,
        onClick: pickTier(filter)
      });
    }
  }

  // HOW AN OPERATOR DISCOVERS THE DOCLING SERVICE HAS BEEN DOWN SINCE TUESDAY.
  //
  // The failure mode of an optional dependency is silence: reads keep succeeding
  // on the cheap parser, filings keep getting rows, and the only symptom is that
  // results filings quietly yield fewer figures than they did last week. A
  // fallback count that nobody plotted is a fallback count nobody noticed, so
  // the number leads the panel and turns warn-coloured the moment it is not zero.
  function renderReading(d) {
    var box = el('reading');
    clear(box);

    var fallbacks = d.parseFallbacks || 0;
    var head = document.createElement('div');
    head.className = 'reason-group' + (fallbacks > 0 ? ' flagged' : '');
    head.textContent = groupInt(fallbacks) + ' read(s) fell back from an expensive parser';
    box.appendChild(head);

    // The routes are counts, not refusals: no filter accepts one, so no pill
    // here pretends to be a filter. The coverage skips ARE filterable - the
    // refusal filter searches 'coverageSkip' - so those stay clickable, and the
    // difference in behaviour is the difference in what the server can answer.
    tagGroup(box, 'parser that read the document', d.byParseRoute, null);
    tagGroup(box, 'why no model read the document', d.byCoverageSkip, pickRefusal);
  }

  // The same distribution as the Categories panel one level up, which is the
  // level somebody actually looks at a day's flow in: NSE's 111 category
  // spellings are too fine to scan, and the eleven groups are not.
  function renderGroups(d) {
    var box = el('groups');
    clear(box);

    var rows = d.byCategoryGroup || [];
    if (rows.length === 0) {
      emptyPanel(box, 'Nothing ingested yet.');
      return;
    }

    // Largest first, from the server, so the first row is the tallest bar.
    var top = rows[0].count || 1;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      meterRow(box, {
        label: groupLabel(r.key),
        title: r.key,
        count: r.count,
        top: top,
        active: state.group === r.key,
        onClick: pickGroup(r.key)
      });
    }
  }

  // A group's reader-facing spelling, read back out of the filter's own options.
  //
  // ONE LIST OF THE ELEVEN GROUPS ON THIS PAGE, which is the point: a second copy
  // here would be a second place for 'mna' to be spelled, and the day the two
  // disagreed the panel and the dropdown would be labelling the same filter
  // differently. A key the shell has never heard of falls back to itself rather
  // than vanishing - NSE adds categories without notice and a new group has to be
  // visible, not silently unlabelled.
  function groupLabel(key) {
    var options = el('group').options;
    for (var i = 0; i < options.length; i++) {
      if (options[i].value === key) return options[i].textContent;
    }
    return key;
  }

  // The claim lane's own panel. It is separate from the amount panel because
  // the two refuse for different reasons and a reader has to be able to tell
  // "no model is configured" from "the model proposed things the gate threw
  // away" - and the second of those is the number that says whether to trust
  // any of this.
  function renderClaims(d) {
    renderReasonPanel('claims',
      groupInt(d.withClaims || 0) + ' filing(s) carry a verified claim',
      [
        { label: 'claims discarded by the gate', rows: d.byClaimDiscard || [] },
        { label: 'why a document produced no claim', rows: d.byClaimRefusal || [] }
      ]);
  }

  // The results lane's own panel, separate from the claim one for the same
  // reason that one is separate from the amount panel: the gates are different,
  // so the refusals mean different things and must be countable apart.
  function renderResults(d) {
    renderReasonPanel('results',
      groupInt(d.withResults || 0) + ' filing(s) carry a verified results line',
      [
        { label: 'figures discarded by the gate', rows: d.byResultsDiscard || [] },
        { label: 'why a document produced no results', rows: d.byResultsRefusal || [] }
      ]);
  }

  function renderReasonPanel(id, headline, groups) {
    var box = el(id);
    if (!box) return;
    clear(box);

    var head = document.createElement('div');
    head.className = 'reason-group';
    head.textContent = headline;
    box.appendChild(head);

    for (var g = 0; g < groups.length; g++) {
      tagGroup(box, groups[g].label, groups[g].rows, pickRefusal);
    }
  }

  function renderRefusalChip() {
    var chip = el('refusal-chip');
    clear(chip);
    if (!state.refusal) return;
    chip.appendChild(tag('refusal: ' + state.refusal + '  (clear)', 'refusal active', pickRefusal(state.refusal)));
  }

  // The weekday names the bar titles read out. DECLARED HERE, BESIDE ITS ONLY
  // USER: it used to live in 'script-company.ts' next to the filing strip that
  // shared it, and when that strip was deleted this panel broke at RUN time
  // with "WEEKDAY_NAME is not defined" while every string test still passed.
  // The fragments share one scope, so a name can be used from anywhere and is
  // owned by nowhere unless somebody decides — this is that decision.
  var WEEKDAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function renderDaily(rows) {
    var box = el('days');
    clear(box);
    var peak = 1;
    for (var i = 0; i < rows.length; i++) peak = Math.max(peak, rows[i].count);

    for (var j = 0; j < rows.length; j++) {
      var bar = document.createElement('div');
      var count = rows[j].count;
      // WEEKENDS ARE MARKED, and this is a correctness fix rather than
      // decoration. Measured over the 32-day corpus, a Sunday carries 26
      // filings against a Tuesday's 832 — a factor of 32 — so a bar scaled to
      // the week's peak renders an ordinary weekend as an outage, twice a
      // week, forever. An operator who learns to ignore two red bars a week
      // has learned to ignore this panel.
      //
      // getUTCDay on a YYYY-MM-DD parsed as UTC midnight is the IST weekday:
      // the key is already an IST calendar day, so no offset is applied to it
      // a second time.
      var weekday = new Date(rows[j].istDay + 'T00:00:00Z').getUTCDay();
      var weekend = weekday === 0 || weekday === 6;
      bar.className =
        'day' +
        (count === 0 ? ' empty' : '') +
        (weekend ? ' weekend' : '') +
        (j === rows.length - 1 ? ' today' : '');
      bar.style.height = (count === 0 ? 2 : Math.max(3, Math.round((count / peak) * 100))) + '%';
      bar.title =
        rows[j].istDay +
        ' IST (' +
        WEEKDAY_NAME[weekday] +
        '): ' +
        count +
        ' filing(s)' +
        (weekend ? ' — weekend, the exchange is quiet' : '');
      box.appendChild(bar);
    }

    if (rows.length > 0) {
      setText('day-from', rows[0].istDay);
      setText('day-to', rows[rows.length - 1].istDay);
    }
  }

`;
