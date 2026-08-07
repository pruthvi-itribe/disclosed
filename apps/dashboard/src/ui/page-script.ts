/**
 * The dashboard's client script, inlined into the page.
 *
 * Three rules hold this file together, and all three are about the same thing:
 * this page renders EXCHANGE-SUPPLIED TEXT that reached it through an
 * unauthenticated database.
 *
 *   1. Nothing is built with `innerHTML`. Every value goes into the document
 *      through `textContent` or `createElement`, so a company name containing
 *      markup is a company name containing markup, not markup.
 *   2. A link is only ever created after `safeHref` has parsed the URL and
 *      confirmed its scheme. `attachmentUrl` comes from NSE; a `javascript:`
 *      value in that field would otherwise become a click-to-execute link.
 *   3. No timestamp is formatted here. The server sends IST text because the
 *      server is the process that owns the one IST definition; a browser on
 *      UTC formatting these itself would be wrong by five and a half hours and
 *      look completely normal doing it.
 *
 * Written as ES5-flavoured concatenation rather than template literals so the
 * whole thing can live inside a TypeScript template string without every `${`
 * needing an escape — the escaping being exactly where this kind of file
 * historically breaks.
 *
 * NO URL APPEARS IN THIS FILE. Every request is same-origin and path-relative.
 */
export const PAGE_SCRIPT = `
(function () {
  'use strict';

  var FAST_MS = 4000;
  var SLOW_EVERY = 5;
  var DEFAULT_LIMIT = 25;

  // Columns in the filings table. Named because the empty-state row AND the
  // per-row detail row both have to span all of them, and a colspan that
  // silently drifts short of the real count renders as a torn row rather than
  // as an error. Asserted against the rendered header-cell count in
  // page.spec.ts, so the two cannot drift apart silently.
  var COLUMN_COUNT = 5;

  // The ordinary parser. A route equal to this is not worth a tag - it is what
  // reading a PDF normally means - and the tag exists to mark the exceptions.
  var DEFAULT_PARSE_ROUTE = 'pdf-parse';

  // THE AMOUNT-PATH REFUSALS THAT ARE NOT A PROBLEM.
  //
  // Both of these say the same thing about a filing: the document was read and
  // it stated no figure worth taking. That is the ORDINARY case - a board
  // meeting notice, a trading window closure, an investor presentation - and it
  // was true of 95% of the collection, so rendering each one as a warn-coloured
  // pill made a diagnostic about one lane the loudest thing on almost every row.
  // It no longer decides whether the row says anything either: every filing
  // states an outcome composed from the exchange's own summary, whatever the
  // amount extractor did with the attachment.
  //
  // AN ALLOWLIST OF THE QUIET, NOT A DENYLIST OF THE LOUD, and that direction is
  // the safety property. A refusal reason this file has never heard of renders
  // loud, so the failure mode of forgetting to update this list is noise rather
  // than silence. 'multiple-candidates' (the document stated two different
  // numbers), 'range-only' (a band, not a figure), 'unit-scaled-header' and
  // 'verbatim-mismatch' all mean something needs a look and stay where they
  // were, as does every unparseableReason - a document nothing could read is a
  // filing nobody has looked inside, not an extractor exercising judgement.
  //
  // DEMOTED IS NOT DELETED. The quiet two keep a control on their own row, keep
  // their count and their filter in the Diagnostics panel, and keep the chip in
  // the filter bar. An extractor whose refusals are invisible is
  // indistinguishable from one that is not running.
  var QUIET_AMOUNT_REFUSALS = { 'no-candidate': true, 'ambiguity-keyword': true };

  // hasOwnProperty rather than a bare lookup, for the reason 'describe' below
  // gives: these keys arrive from the database and 'constructor' is a key on
  // every object literal's prototype chain.
  function isQuietRefusal(reason) {
    return Object.prototype.hasOwnProperty.call(QUIET_AMOUNT_REFUSALS, reason);
  }

  // What each tier permits, in the words of libs/filings/src/logic/confidence
  // -tier.ts. Carried as tooltips rather than as visible prose because the badge
  // appears on every row and three explanatory sentences per row is a wall.
  var TIER_TITLE = {
    verified: 'a span of the source document was matched character for character, and the period, basis, column and scale were checked against the document. The only tier allowed near an alert.',
    stated: 'the exchange said this in its own summary line. Strong provenance, but nobody has checked it against the attached document.',
    labelled: 'all that is known is what kind of filing this is. An honest floor, not a failure - an investor presentation nobody verified is still an investor presentation.'
  };

  // Whose words the outcome line is. Worth showing even next to the tier: on a
  // verified row the tier says a document was checked and says nothing about
  // where the OUTCOME sentence itself came from, which is the one place these
  // two do not overlap.
  var SOURCE_TITLE = {
    'exchange-summary': "the exchange's own summary line, which said something its category does not",
    category: 'the summary restated the category and nothing more, so the outcome is the category'
  };

  // How long the box waits after the last keystroke before asking.
  //
  // 140ms, which is under the ~200ms a fluent typist spends per character, so a
  // reader typing 'britannia' straight through issues ONE request rather than
  // nine. It is also short enough to be invisible: a suggestion list that
  // appears 140ms after you stop typing reads as instant, and one that appears
  // after 400ms reads as slow. The server is not what this protects - a
  // suggestion costs it no database read at all - it is the request per
  // character that a shared loopback box does not need.
  var SUGGEST_DEBOUNCE_MS = 140;

  // Shortest query that is asked about at all. The server applies the same
  // floor and would answer an empty list anyway; this is the round trip that
  // does not have to happen. Measured there: one character matches 87 of 954
  // companies on average, which is a list rather than a suggestion.
  var SUGGEST_MIN = 2;

  var state = {
    limit: DEFAULT_LIMIT,
    offset: 0,
    // The two halves of the search box, and they are NOT the same filter.
    // 'symbol' is exact and is set only when a reader PICKS a company from the
    // list; 'q' is free text and is what they typed when they did not. A reader
    // who chose BRITANNIA wants Britannia, not every filing that mentions it.
    q: '',
    symbol: '',
    // The suggestion currently applied, so editing the box can undo exactly
    // what picking it did and nothing else. Without this, typing after picking
    // a category would either leave the category filter stuck on or clear a
    // category the reader had set from the Admin panel instead.
    picked: null,
    category: '',
    group: '',
    tier: '',
    enrichState: '',
    amount: '',
    refusal: '',
    highestSeen: null,
    ticks: 0,
    failures: 0,
    // 'feed' is the product, 'admin' is the instrument panel. Which one is
    // showing changes nothing about what is fetched — both views read the same
    // rows from the same request, so switching tabs costs no round trip and a
    // filter set in one is honoured by the other.
    view: 'feed',
    // ON BY DEFAULT, and it is the single most consequential default on the
    // page. Roughly three filings in five say nothing a reader would want —
    // a notice of a board meeting, a newspaper publication, a change of
    // registered office — and a feed that opens on all of them reads as noise
    // no matter how well each row is drawn. This maps to the 'verified' tier,
    // which is exactly "a span of the source document was matched", so the
    // default is not a guess about what is interesting: it is the set the
    // pipeline can stand behind.
    onlyInsights: true,
    // Which cards a reader has opened, by seqId.
    //
    // KEPT IN STATE BECAUSE THE FEED REPAINTS EVERY FOUR SECONDS. The first
    // version held the expansion in the DOM, which meant opening a card and
    // watching it close itself on the next poll — worse than a card that never
    // opened, because the reader loses their place and cannot tell whether they
    // misclicked. Anything a reader does to this page has to outlive the
    // refresh that is the whole reason the page is live.
    expanded: {}
  };

  // A lookup that cannot be walked into the prototype chain. The keys come from
  // the server and are a closed set, but 'constructor' is a key too and an
  // unguarded lookup would put a function's source text in a tooltip.
  function describe(table, key) {
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  }

  function el(id) { return document.getElementById(id); }

  function setText(id, value) {
    var node = el(id);
    if (node) node.textContent = value;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function cell(row, className, value) {
    var td = document.createElement('td');
    td.className = className;
    if (value !== null && value !== undefined) td.textContent = String(value);
    row.appendChild(td);
    return td;
  }

  function groupInt(value) {
    if (value === null || value === undefined) return '—';
    return String(value).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  }

  function duration(ms) {
    if (ms === null || ms === undefined) return '—';
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }

  // How long ago, in the words a person uses.
  //
  // READ AGAINST THE BROWSER'S CLOCK, which is the one exception to this page's
  // rule that the server owns every time calculation. The rule exists because
  // IST is a fixed offset the server holds one definition of and a browser in
  // another timezone would render differently; "how long ago" is not a timezone
  // question at all — it is a difference between two instants, identical in
  // every timezone, and it has to move as the reader watches without a refetch.
  // The absolute IST string the server computed is still what the title carries.
  //
  // Falls back to the raw value rather than inventing one: an unparseable date
  // shows as itself, which is debuggable, instead of "just now", which is a lie.
  function relativeTime(iso) {
    if (typeof iso !== 'string' || iso === '') return '—';
    var then = Date.parse(iso);
    if (isNaN(then)) return iso;
    var s = Math.round((Date.now() - then) / 1000);
    if (s < 0) return 'just now';
    if (s < 45) return 'just now';
    if (s < 90) return 'a minute ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60 ? (m % 60) + 'm ago' : 'ago');
    var d = Math.floor(h / 24);
    if (d === 1) return 'yesterday';
    if (d < 7) return d + ' days ago';
    return Math.floor(d / 7) + 'w ago';
  }

  // Only http(s) links are ever rendered. Anything else - including the
  // 'javascript' scheme - returns null and the cell stays plain text.
  function safeHref(raw) {
    if (typeof raw !== 'string' || raw === '') return null;
    try {
      var parsed = new URL(raw, window.location.href);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
      return null;
    } catch (err) {
      return null;
    }
  }

  function showError(message) {
    var box = el('alert');
    box.textContent = message;
    box.hidden = false;
  }

  function clearError() {
    var box = el('alert');
    box.hidden = true;
    box.textContent = '';
  }

  function setLive(kind, label) {
    var dot = el('live-dot');
    dot.className = 'dot ' + kind;
    setText('live-text', label);
  }

  // Every response is an envelope. A body that is not one is a proxy, an error
  // page or a version mismatch, and is reported rather than rendered as empty.
  function getJson(path) {
    return fetch(path, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            throw new Error(path + ' returned ' + res.status + ': ' + body.slice(0, 200));
          });
        }
        return res.json();
      })
      .then(function (body) {
        if (!body || body.success !== true) {
          throw new Error(path + ' returned a body that is not a success envelope');
        }
        return body;
      });
  }

  function lagClass(ms) {
    if (ms === null || ms === undefined) return '';
    if (ms < 120000) return 'ok';
    if (ms < 1800000) return 'warn';
    return 'bad';
  }

  function renderSummary(d) {
    setText('stat-total', groupInt(d.totalFilings));
    setText('stat-today', groupInt(d.todayCount));
    setText('stat-today-note', d.todayIstDay + ' IST');
    setText('stat-cursor', groupInt(d.maxSeqId));
    setText('stat-newest', d.newestDisseminatedAtIst || '—');
    var lag = el('stat-lag');
    lag.textContent = duration(d.feedLagMs);
    lag.className = 'value ' + lagClass(d.feedLagMs);
    setText('generated', 'updated ' + d.generatedAtIst + ' IST');

    // The feed's three numbers, which are NOT the eight above them. Admin asks
    // "is the pipeline healthy"; the feed asks "is there anything to read". So
    // the cursor, the stored total and the parse backlog stay in Admin, and
    // what surfaces here is how much arrived, how much of it said something,
    // and how long since the last one — the last of those being the only
    // honest way to tell a quiet market from a stopped pipeline.
    setText('hero-today', groupInt(d.todayCount));
    var heroLag = el('hero-lag');
    if (heroLag) {
      heroLag.textContent = duration(d.feedLagMs);
      heroLag.className = 'herovalue ' + lagClass(d.feedLagMs);
    }
  }

  // Every one of these builds its nodes with createElement and textContent.
  // The headline is composed from a symbol and a counterparty name that both
  // originate outside this process, and the evidence string is raw text lifted
  // out of a PDF - the single least trustworthy value on the page.
  function tag(text, className, onClick) {
    var node = document.createElement('span');
    node.className = 'tag ' + className + (onClick ? ' clickable' : '');
    node.textContent = text;
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function pickRefusal(reason) {
    return function () {
      state.refusal = state.refusal === reason ? '' : reason;
      state.offset = 0;
      // This filter is applied from three places - a row's 'why' control, a pill
      // in the Diagnostics panel and the chip in the filter bar - and only one
      // of the three is inside the disclosure. Opening it on the way in is what
      // stops a filter applied from a row leaving its own active tag folded away
      // behind a closed triangle, which would read as the filter not having
      // been applied. Opened rather than toggled: clearing the filter leaves the
      // panel as the reader left it.
      if (state.refusal) openDiagnostics();
      refresh(true);
    };
  }

  function openDiagnostics() {
    var box = el('diagnostics');
    if (box) box.open = true;
  }

  // THE QUIET AFFORDANCE: a refusal demoted from a label to a control.
  //
  // A BUTTON RATHER THAN A SPAN, unlike every other clickable thing on this
  // page, and deliberately so. This one REPLACES something a reader could
  // previously see at a glance, so it has to be operable by everyone the pill
  // was operable by - a span with a click handler is not reachable without a
  // mouse. The reason and its detail ride in the title and in the accessible
  // name, so nothing the pill carried is gone: it costs one hover instead of
  // zero, at a fraction of the visual weight, on 95% of the rows on this page.
  function whyControl(reason, detail) {
    var node = document.createElement('button');
    node.type = 'button';
    node.className = 'why' + (state.refusal === reason ? ' active' : '');
    node.textContent = 'why';
    node.title = 'no amount was read: ' + reason
      + (detail ? ' - ' + detail : '')
      + '. Click to filter to this reason.';
    node.setAttribute('aria-label',
      'no amount was read: ' + reason + '. Filter the table to this reason.');
    node.addEventListener('click', pickRefusal(reason));
    return node;
  }

  // The group and tier pickers are the same shape as pickCategory and
  // pickRefusal, and deliberately so: every filter on this page is one control
  // writing one key of 'state', which 'query()' then serialises. A second
  // mechanism - a link that reloads with a query string, say - would be a second
  // place for a filter to be applied and a second place for the select, the
  // panel row and the request to disagree about what is being shown.
  function pickGroup(value) {
    return function () {
      state.group = state.group === value ? '' : value;
      el('group').value = state.group;
      state.offset = 0;
      refresh(true);
    };
  }

  function pickTier(value) {
    return function () {
      state.tier = state.tier === value ? '' : value;
      el('tier').value = state.tier;
      state.offset = 0;
      refresh(true);
    };
  }

  // Which tier filter a breakdown row applies. The server counts three tiers and
  // filters on two, because 'verified' is decidable from stored fields while
  // telling 'stated' from 'labelled' is a string comparison done on read - see
  // TIER_FILTERS in filing-query.service.ts. So the panel's second row filters to
  // 'unverified', which is exactly the set it counts.
  function tierFilterFor(key) {
    return key === 'verified' ? 'verified' : 'unverified';
  }

  // THE OUTCOME CELL, and it is the only cell on the row that is never blank.
  //
  // That is the change it exists to show. The pipeline used to gate on a category
  // allowlist and 71% of filings produced nothing at all - no headline, no claim,
  // an empty row that read exactly like a filing nobody had looked at yet. The
  // outcome is derived on read from the category and the summary, two fields the
  // poller writes for every filing on the hot path, so it is present for a filing
  // the worker never reached, one whose PDF is a raster scan and one whose model
  // call failed.
  //
  // The tier sits under the line rather than beside it because it qualifies the
  // line, and a reader who takes the outcome must take its tier with it.
  function outcomeCell(row, f) {
    var cell = document.createElement('td');
    cell.className = 'out';

    var line = document.createElement('div');
    line.className = 'outcome';
    line.textContent = f.outcome;
    cell.appendChild(line);

    // The class is built from a server value, which is safe here for the same
    // reason everything else on this page is: it is set through className on an
    // element built by createElement, never through innerHTML. The state tag
    // below does the same with 'state-'.
    var tier = document.createElement('span');
    tier.className = 'tier tier-' + f.confidenceTier;
    tier.textContent = f.confidenceTierLabel;
    tier.title = describe(TIER_TITLE, f.confidenceTier);
    cell.appendChild(tier);

    var source = document.createElement('span');
    source.className = 'outcome-source';
    source.textContent = f.outcomeSource;
    source.title = describe(SOURCE_TITLE, f.outcomeSource);
    cell.appendChild(source);

    row.appendChild(cell);
  }

  // One labelled fact in the detail row. Returns nothing when there is nothing
  // to say, so an absent field costs no line rather than printing a dash.
  function detailItem(box, label, value, className) {
    if (value === null || value === undefined || value === '') return;
    var item = document.createElement('div');
    item.className = 'ditem' + (className ? ' ' + className : '');
    var name = document.createElement('span');
    name.className = 'dlabel';
    name.textContent = label;
    item.appendChild(name);
    var body = document.createElement('span');
    body.className = 'dvalue';
    body.textContent = String(value);
    item.appendChild(body);
    box.appendChild(item);
  }

  // THE ROW BEHIND THE ROW.
  //
  // Everything here was on the main table until it stopped being readable: the
  // amount and its refusal, the enrichment state and its tags, the parse route,
  // the model summary, the seqId, the exchange's own words. None of it is
  // wrong and none of it is what the page is for. A reader scanning the day
  // wants what the companies said; a reader who has stopped on one row wants to
  // know how we know it, and that is a different question asked at a different
  // moment.
  //
  // Collapsed by default and built eagerly. Building on expand would be less
  // work on first paint and would make the row's content depend on when it was
  // opened, which is the kind of difference that turns into a bug report about
  // a value that "changed on its own" during a poll.
  function detailRow(parent, f, e) {
    var tr = document.createElement('tr');
    tr.className = 'detail';
    tr.hidden = true;

    var td = document.createElement('td');
    td.colSpan = COLUMN_COUNT;

    var box = document.createElement('div');
    box.className = 'detailbox';

    detailItem(box, 'Exchange said', f.summary);
    detailItem(box, 'Category', f.category);
    detailItem(box, 'Outcome', f.outcome);
    detailItem(box, 'Confidence', f.confidenceTierLabel + ' · ' + f.outcomeSource);

    // The model summary keeps its warning here. Moving it off the main table
    // does not make it verified, and it is the one line in this box that no
    // span was matched against.
    if (e.documentSummary) {
      detailItem(box, 'Model summary — NOT verified', e.documentSummary, 'unverified');
    }

    if (e.amountRupees !== null && e.amountRupees !== undefined) {
      detailItem(box, 'Amount', groupInt(e.amountRupees) + (e.amountLabel ? ' · ' + e.amountLabel : ''));
    } else if (e.amountRefusalReason) {
      detailItem(box, 'No amount read', e.amountRefusalReason);
    }

    detailItem(box, 'Counterparty', e.counterparty);
    detailItem(box, 'Read by', e.parseRoute ? e.parseRoute + (e.documentChars ? ' · ' + groupInt(e.documentChars) + ' chars' : '') : null);
    detailItem(box, 'Files', e.documentSource);
    detailItem(box, 'Enrichment', e.state + (e.unparseableReason ? ' · ' + e.unparseableReason : ''));
    detailItem(box, 'Context', e.contextLine);
    detailItem(box, 'Disseminated', f.disseminatedAtIst + ' IST · ingested +' + duration(f.pipelineLagMs));
    detailItem(box, 'Sequence', f.seqId);

    // THE EVIDENCE, which used to sit under the claim line on the row itself.
    //
    // Each accepted claim's source sentence, so the line can be checked against
    // the document without leaving the page. The period heading is shown BESIDE
    // its sentence rather than merged into it: they are two quotes from two
    // places in the document, and running them together would forge a sentence.
    var accepted = e.claims || [];
    for (var ci = 0; ci < accepted.length; ci++) {
      detailItem(
        box,
        accepted[ci].kind,
        '"' + String(accepted[ci].span).replace(/\\s+/g, ' ').trim() + '"',
        'quote',
      );
      if (accepted[ci].periodSpan) {
        detailItem(
          box,
          'period from',
          '"' +
            String(accepted[ci].periodSpan).replace(/\\s+/g, ' ').trim() +
            '"',
          'quote',
        );
      }
    }

    // The two quotes a results line rests on: the statement heading that fixed
    // consolidated against standalone, and the column dates that made the
    // comparison year-on-year. A reader who cannot see those two cannot check
    // the line — the figures are cells, and a cell means nothing without them.
    if (e.results) {
      detailItem(
        box,
        'results basis',
        '"' + String(e.results.basisSpan).replace(/\\s+/g, ' ').trim() + '"',
        'quote',
      );
      detailItem(
        box,
        e.results.period + ' vs ' + e.results.priorPeriod,
        '"' + String(e.results.columnsSpan).replace(/\\s+/g, ' ').trim() + '"',
        'quote',
      );
      var figures = e.results.figures || [];
      for (var fi = 0; fi < figures.length; fi++) {
        detailItem(
          box,
          figures[fi].metric,
          '"' + String(figures[fi].span).replace(/\\s+/g, ' ').trim() + '"',
          'quote',
        );
      }
    }

    var resultsDropped = e.resultsDiscards || [];
    if (resultsDropped.length) {
      var rcounts = {};
      for (var rr = 0; rr < resultsDropped.length; rr++) {
        var rreason = resultsDropped[rr].reason;
        rcounts[rreason] = (rcounts[rreason] || 0) + 1;
      }
      var rparts = [];
      for (var rk in rcounts) {
        if (Object.prototype.hasOwnProperty.call(rcounts, rk)) {
          rparts.push(rcounts[rk] + ' × ' + rk);
        }
      }
      detailItem(box, 'Results refused', rparts.join(', '), 'refused');
    }

    // What the gate threw away, and why. This is the honest half of the
    // precision claim: a row showing three verified claims and nothing else
    // hides that nine were proposed.
    var discards = e.claimDiscards;
    if (discards && discards.length) {
      var counts = {};
      for (var d = 0; d < discards.length; d++) {
        var reason = discards[d].reason;
        counts[reason] = (counts[reason] || 0) + 1;
      }
      var parts = [];
      for (var key in counts) {
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
          parts.push(counts[key] + ' × ' + key);
        }
      }
      detailItem(box, 'Refused by the gate', parts.join(', '), 'refused');
    }

    td.appendChild(box);
    tr.appendChild(td);

    parent.className += ' clickable';
    parent.onclick = function () {
      tr.hidden = !tr.hidden;
      parent.className = tr.hidden
        ? parent.className.replace(' open', '')
        : parent.className + ' open';
    };

    return tr;
  }

  // The group, compact, because it says what KIND of filing this is rather than
  // anything about this one. It is a filter for the same reason the category is:
  // NSE's 111 categories are too fine to scan and the eleven groups are the
  // resolution somebody actually looks at the day's flow in.
  function groupCell(row, f) {
    var cell = document.createElement('td');
    cell.className = 'grp';
    var active = state.group === f.categoryGroup ? ' active' : '';
    cell.appendChild(tag(f.categoryGroupLabel, 'group' + active, pickGroup(f.categoryGroup)));
    row.appendChild(cell);
  }

  // The headline cell: the composed line, the derived-context line beneath it,
  // and the exchange's own summary demoted to third. That order is the change -
  // the boilerplate used to lead.
  function headlineCell(row, f) {
    var cell = document.createElement('td');
    cell.className = 'sum';
    var e = f.enrichment || {};

    // THE RESULTS LINE LEADS. On the day a company reports, its numbers are the
    // event and the composed headline degrades to the exchange's own category.
    // Rendered in its own class rather than as a headline, because it was
    // admitted by a different gate and a reader has to be able to tell which.
    if (e.resultsLine) {
      var res = document.createElement('div');
      res.className = 'headline enriched resultsline';
      res.textContent = e.resultsLine;
      cell.appendChild(res);
    }

    var head = document.createElement('div');
    head.className = 'headline ' + (e.amountRupees !== null && e.amountRupees !== undefined ? 'enriched' : 'verbatim');
    head.textContent = e.headline || (String(f.symbol).toUpperCase() + ' — ' + String(f.category).toUpperCase());
    cell.appendChild(head);

    // The claim line sits directly under the headline, because on most filings
    // it is the only thing said - the headline degrades to the exchange's own
    // category whenever no amount was verified, and most notable statements
    // carry no figure at all.
    if (e.claimLine) {
      var claim = document.createElement('div');
      claim.className = 'claimline';
      claim.textContent = e.claimLine;
      cell.appendChild(claim);
    }

    // EVERY QUOTE, EVERY FIGURE ROW AND EVERY DISCARD MOVED TO THE DETAIL ROW.
    //
    // They were all here, stacked under the claim line, and on a filing with
    // nine accepted claims that is nine source sentences, their period
    // headings, the results basis, the column dates, a row per figure and two
    // lists of refusal tags — in one table cell. IGPL's investor presentation
    // rendered as a wall of quoted PDF text with the three-claim wire line
    // buried at the top of it.
    //
    // The evidence is not less important for moving. It is what makes a claim
    // checkable, and it is one click away rather than gone. But it answers
    // "how do I verify this", which is asked about ONE filing after stopping
    // on it, and putting it in the scan view meant the scan view could not be
    // scanned.

    // THE MODEL SUMMARY, THE FILE LIST, THE DERIVED CONTEXT, THE EXCHANGE'S OWN
    // SENTENCE AND THE LAG ALL MOVED TO THE DETAIL ROW.
    //
    // Not deleted — every one of them is still rendered, one click down. The
    // reason they left this cell is that they are all statements about the
    // pipeline, and stacking five of them under each verified claim meant the
    // verified claim was the smallest thing in its own column. The model
    // summary in particular was the loudest line on a row whose whole point is
    // that everything else on it was checked against the document, and it is
    // the one line that never was; it keeps its NOT-verified label downstairs.
    //
    // What stays here is what the filing said and the evidence for it.

    // When nothing was verified, the exchange's own sentence is what this
    // filing said, and a blank cell would be a worse answer than a quiet one.
    if (!e.resultsLine && !e.claimLine && !e.headline) {
      var fallback = document.createElement('div');
      fallback.className = 'summary-line';
      fallback.textContent = f.summary;
      cell.appendChild(fallback);
    }

    row.appendChild(cell);
  }

  // The figure, or the dash - and where the extractor declined quietly, a 'why'
  // beside the dash.
  //
  // THE DASH IS WHERE THE QUESTION IS ASKED. "Why is this blank" is a question
  // about the amount column, so the answer belongs in the amount column and not
  // over in the enrichment one among the tags that mean something went wrong.
  // One rule, no exceptions: this cell shows the figure, or a dash, and the dash
  // carries a 'why' whenever the extractor declined for a reason that means the
  // document simply had no figure to read.
  function amountCell(row, e) {
    var cell = document.createElement('td');
    cell.className = 'amt';

    if (e.amountDisplay) {
      var value = document.createElement('span');
      value.className = 'value';
      value.textContent = e.amountDisplay;
      cell.appendChild(value);
      if (e.counterparty) {
        var party = document.createElement('span');
        party.className = 'party';
        party.textContent = e.counterparty;
        cell.appendChild(party);
      }
    } else {
      cell.appendChild(document.createTextNode('—'));
      var quiet = e.amountRefusalReason;
      if (quiet && isQuietRefusal(quiet)) {
        cell.appendChild(whyControl(quiet, e.amountRefusalDetail));
      }
    }

    row.appendChild(cell);
  }

  // WHAT WENT WRONG, and only what went wrong.
  //
  // This column used to carry 'amountRefusalReason || unparseableReason' on
  // every row as one warn pill, which meant the two commonest amount refusals -
  // both of them the extractor correctly reporting that a notice of a board
  // meeting states no rupee figure - shouted from 95% of the rows in the table.
  // They now sit in the amount column as a muted control, and this column is
  // left to the refusals a reader has to act on. The reason is still the tag,
  // the detail is still its tooltip, and the tag still filters the table.
  function enrichmentCell(row, e) {
    var cell = document.createElement('td');
    cell.className = 'enr';

    var stateTag = tag(e.state, 'state-' + e.state, null);
    if (e.attemptedAtIst) stateTag.title = 'attempt ' + e.attempts + ' at ' + e.attemptedAtIst + ' IST';
    cell.appendChild(stateTag);

    // A DOCUMENT NOTHING COULD READ AT ALL IS A REAL PROBLEM, and it is a
    // different class of fact from "the document was read and stated no figure".
    // A raster scan, a zip of images, an attachment NSE served as HTML: none of
    // those is the extractor exercising judgement, they are filings nobody has
    // looked inside. Rendered unconditionally now rather than losing a coin toss
    // to whichever amount refusal happened to be stored beside it.
    var unreadable = e.unparseableReason;
    if (unreadable) {
      var unreadableTag = tag(unreadable, 'refusal' + (state.refusal === unreadable ? ' active' : ''), pickRefusal(unreadable));
      unreadableTag.title = e.lastError || unreadable;
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(unreadableTag);
    }

    // And the amount refusals that mean something went wrong, which is every one
    // outside QUIET_AMOUNT_REFUSALS: the document stated two different numbers,
    // or published a band rather than a figure, or re-denominated its own table.
    // Those are facts about the FILING and a reader wants them at a glance.
    var amountRefusal = e.amountRefusalReason;
    if (amountRefusal && !isQuietRefusal(amountRefusal)) {
      var reasonTag = tag(amountRefusal, 'refusal' + (state.refusal === amountRefusal ? ' active' : ''), pickRefusal(amountRefusal));
      reasonTag.title = e.amountRefusalDetail || amountRefusal;
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(reasonTag);
    }

    // WHICH PARSER READ THE DOCUMENT, shown only when it was not the ordinary
    // one. A stored verdict has to be read differently depending on this:
    // Docling's markdown carries row-aligned table cells and puts a statement
    // heading before its own table, and pdf-parse's flattening does neither.
    if (e.parseRoute && e.parseRoute !== DEFAULT_PARSE_ROUTE) {
      var route = tag(e.parseRoute, 'route', null);
      route.title = 'read by ' + e.parseRoute;
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(route);
    }

    // THE FIELD THAT MAKES AN OPTIONAL DEPENDENCY HONEST, and the reason it is
    // on the row and not only in the panel. A results filing read by pdf-parse
    // because a Python service has been down since Tuesday yields fewer figures
    // and, without this tag, looks exactly like a filing that had fewer figures.
    // The symptom of a dead Docling is silence, so the absence has to be named.
    if (e.parseFallbackReason) {
      var fallback = tag(e.parseFallbackReason, 'fallback', null);
      fallback.title = 'an expensive parser was wanted and could not be used: ' + e.parseFallbackReason;
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(fallback);
    }

    // NEITHER OF THOSE TWO IS CLICKABLE, and this one is. The refusal filter
    // searches amountRefusalReason, unparseableReason, claimRefusalReason,
    // claimDiscards.reason and coverageSkip - and nothing else. A clickable
    // parse-route tag would apply a filter matching zero documents, which on a
    // page whose whole job is showing what was found is indistinguishable from
    // nothing having been found.
    if (e.coverageSkip) {
      var skipActive = state.refusal === e.coverageSkip ? ' active' : '';
      var skip = tag(e.coverageSkip, 'refusal' + skipActive, pickRefusal(e.coverageSkip));
      skip.title = 'no model read this document: ' + e.coverageSkip;
      cell.appendChild(document.createTextNode(' '));
      cell.appendChild(skip);
    }

    if (e.amountEvidence) {
      var evidence = document.createElement('span');
      evidence.className = 'evidence';
      evidence.textContent = '"' + e.amountEvidence.replace(/\\s+/g, ' ').trim() + '"';
      if (e.amountAnchor) evidence.title = 'read from: ' + e.amountAnchor;
      cell.appendChild(evidence);
    }

    row.appendChild(cell);
  }

  // How many claims a card shows before it stops. Four, because a card is a
  // glance and TRANSRAILL's presentation yields eleven — printing all of them
  // rebuilds the wall of text the feed exists to replace. The rest are one
  // click away, and the count is stated so nothing looks complete when it is
  // not.
  var CARD_CLAIMS = 4;

  /**
   * The lines a card leads with, best first.
   *
   * RESULTS BEAT CLAIMS. On the day a company reports, its numbers ARE the
   * event and everything else it said that morning is context.
   */
  function insightLines(e) {
    var lines = [];
    if (e.resultsLine) lines.push(e.resultsLine);
    var claims = e.claims || [];
    for (var i = 0; i < claims.length; i++) lines.push(claims[i].text);
    return lines;
  }

  function feedCard(f) {
    var e = f.enrichment || {};
    var lines = insightLines(e);

    var card = document.createElement('article');
    // A filing that said nothing verifiable is drawn quieter rather than
    // dropped. The toggle above decides whether it is here at all; once it is,
    // pretending it is as substantial as a results card would be a lie told in
    // CSS.
    card.className = 'card' + (lines.length === 0 ? ' quiet' : '');
    // A STABLE IDENTITY FOR A NODE THAT IS REBUILT EVERY FOUR SECONDS. The feed
    // repaints on every poll, so "the first card with an expander" names a
    // different card before and after a click — which is a trap for a test and
    // would be one for any future deep link to a filing. The seqId is the one
    // value that identifies this card across repaints.
    card.setAttribute('data-seq', String(f.seqId));

    var head = document.createElement('header');
    head.className = 'cardhead';

    var who = document.createElement('div');
    who.className = 'who';
    var sym = document.createElement('span');
    sym.className = 'sym';
    sym.textContent = f.symbol;
    who.appendChild(sym);
    var name = document.createElement('span');
    name.className = 'coname';
    name.textContent = f.companyName;
    who.appendChild(name);
    head.appendChild(who);

    var meta = document.createElement('div');
    meta.className = 'cardmeta';
    var when = document.createElement('span');
    when.className = 'when';
    when.textContent = relativeTime(f.disseminatedAt);
    when.title = f.disseminatedAtIst + ' IST';
    meta.appendChild(when);
    meta.appendChild(tag(f.categoryGroupLabel, 'group ' + f.categoryGroup, pickGroup(f.categoryGroup)));
    head.appendChild(meta);
    card.appendChild(head);

    if (lines.length > 0) {
      var isOpen = Object.prototype.hasOwnProperty.call(
        state.expanded,
        String(f.seqId),
      );
      var shown = isOpen ? lines.length : CARD_CLAIMS;
      var list = document.createElement('ul');
      list.className = 'insights';
      for (var i = 0; i < lines.length && i < shown; i++) {
        var li = document.createElement('li');
        li.textContent = lines[i];
        list.appendChild(li);
      }
      card.appendChild(list);
      if (lines.length > CARD_CLAIMS && !isOpen) {
        // EXPANDS RATHER THAN ANNOUNCES. '+ 6 more' as dead text tells a reader
        // the card is hiding something and gives them nowhere to go; the whole
        // reason the card stops at four is that eleven is a wall, and the
        // reason it says so is that silently truncating would make a partial
        // card look complete.
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'andmore';
        more.textContent = '+ ' + (lines.length - CARD_CLAIMS) + ' more';
        more.onclick = (function (seqId, rest, list, button) {
          return function (event) {
            event.stopPropagation();
            // Recorded in state FIRST, so the repaint four seconds from now
            // draws the card open rather than undoing this.
            state.expanded[String(seqId)] = true;
            for (var k = 0; k < rest.length; k++) {
              var extra = document.createElement('li');
              extra.textContent = rest[k];
              list.appendChild(extra);
            }
            button.remove();
          };
        })(f.seqId, lines.slice(CARD_CLAIMS), list, more);
        card.appendChild(more);
      }
    } else {
      // The exchange's own sentence. Not a claim and never dressed as one.
      var said = document.createElement('p');
      said.className = 'stated';
      said.textContent = f.outcome;
      card.appendChild(said);
    }

    var foot = document.createElement('footer');
    foot.className = 'cardfoot';

    var tier = document.createElement('span');
    tier.className = 'tier tier-' + f.confidenceTier;
    tier.textContent = f.confidenceTierLabel;
    tier.title = describe(TIER_TITLE, f.confidenceTier);
    foot.appendChild(tier);

    var cat = document.createElement('span');
    cat.className = 'cardcat';
    cat.textContent = f.category;
    foot.appendChild(cat);

    var spacer = document.createElement('span');
    spacer.className = 'grow';
    foot.appendChild(spacer);

    // COPY, because the thing a reader does with a line like this is send it to
    // somebody. Writing the claims rather than the rendered card: what belongs
    // in a message is what the company said, not our layout.
    if (lines.length > 0) {
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'copy';
      copy.textContent = 'Copy';
      copy.onclick = (function (text, button) {
        return function (event) {
          event.stopPropagation();
          // Guarded: the clipboard API is absent on an insecure origin, and a
          // dashboard served over plain http to a colleague must not throw.
          if (!navigator.clipboard) { button.textContent = 'no clipboard'; return; }
          navigator.clipboard.writeText(text).then(function () {
            button.textContent = 'Copied';
            window.setTimeout(function () { button.textContent = 'Copy'; }, 1500);
          }, function () { button.textContent = 'failed'; });
        };
      })(f.symbol + ': ' + lines.join('\\n' + f.symbol + ': '), copy);
      foot.appendChild(copy);
    }

    var href = safeHref(f.attachmentUrl);
    if (href) {
      var link = document.createElement('a');
      link.href = href;
      link.rel = 'noopener noreferrer nofollow';
      link.target = '_blank';
      link.className = 'srclink';
      link.textContent = 'Source';
      foot.appendChild(link);
    }

    card.appendChild(foot);
    return card;
  }

  /**
   * The feed.
   *
   * Grouped by how long ago, because a reader scanning a market day thinks in
   * "what just happened" and "what I have already seen", not in timestamps.
   */
  function feedBucket(iso) {
    var ms = Date.now() - Date.parse(iso);
    if (isNaN(ms)) return 'Earlier';
    if (ms < 30 * 60 * 1000) return 'Just now';
    if (ms < 4 * 60 * 60 * 1000) return 'Earlier today';
    if (ms < 24 * 60 * 60 * 1000) return 'Today';
    if (ms < 48 * 60 * 60 * 1000) return 'Yesterday';
    return 'Earlier';
  }

  // Why the feed is empty, in the most specific words the page can honestly
  // manage. Reads only state, so it says nothing it cannot support.
  function emptyHint() {
    var picked = state.picked;

    if (state.onlyInsights) {
      if (picked && picked.kind === 'company') {
        return picked.head + ' has ' + groupInt(picked.filings)
          + ' filing(s), and none of them carries a claim matched against the source document.'
          + ' Untick the filter above to see them.';
      }
      return 'Only filings with a claim matched against the source document are shown.'
        + ' Untick the filter above to see everything that arrived.';
    }

    if (state.q) return 'Nothing said ' + state.q + '. Try fewer words, or clear the search.';
    if (state.symbol) return 'Nothing stored for ' + state.symbol + ' under these filters.';
    return 'Try a different group, or clear the search.';
  }

  function renderFeed(items, meta) {
    var feed = el('feed');
    if (!feed) return;
    feed.textContent = '';

    var withInsight = 0;
    for (var n = 0; n < items.length; n++) {
      if (insightLines(items[n].enrichment || {}).length > 0) withInsight += 1;
    }
    setText('hero-insights', groupInt(withInsight));

    if (items.length === 0) {
      var none = document.createElement('div');
      none.className = 'emptyfeed';
      var title = document.createElement('div');
      title.className = 'emptytitle';
      title.textContent = state.onlyInsights
        ? 'Nothing verifiable yet'
        : 'No filings match';
      none.appendChild(title);
      var hint = document.createElement('div');
      hint.className = 'emptyhint';
      // Names the filter that is hiding things rather than leaving a reader to
      // wonder whether the market is quiet or the page is broken.
      // NAMES THE FILTER THAT IS HIDING THINGS, and where it can, names the
      // number too.
      //
      // A reader who picked a company out of the suggestion list - so they KNOW
      // it exists, they were just looking at its filing count - and then got an
      // empty feed has to be able to tell "this company has said nothing
      // verifiable" from "the box does not work". With the insight filter on by
      // default the first is much the commoner, and the suggestion they picked
      // already told us how many filings there are, so the page can say it
      // rather than leaving them to work it out.
      hint.textContent = emptyHint();
      none.appendChild(hint);
      feed.appendChild(none);
      setText('feed-info', '');
      el('feed-more').hidden = true;
      return;
    }

    var bucket = null;
    for (var i = 0; i < items.length; i++) {
      var f = items[i];
      var label = feedBucket(f.disseminatedAt);
      if (label !== bucket) {
        bucket = label;
        var head = document.createElement('h2');
        head.className = 'bucket';
        head.textContent = label;
        feed.appendChild(head);
      }
      feed.appendChild(feedCard(f));
    }

    var shown = meta.offset + meta.returned;
    setText('feed-info', shown + ' of ' + groupInt(meta.total));
    el('feed-more').hidden = !meta.hasMore;
  }

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

  function renderDaily(rows) {
    var box = el('days');
    clear(box);
    var peak = 1;
    for (var i = 0; i < rows.length; i++) peak = Math.max(peak, rows[i].count);

    for (var j = 0; j < rows.length; j++) {
      var bar = document.createElement('div');
      var count = rows[j].count;
      bar.className = 'day' + (count === 0 ? ' empty' : '') + (j === rows.length - 1 ? ' today' : '');
      bar.style.height = (count === 0 ? 2 : Math.max(3, Math.round((count / peak) * 100))) + '%';
      bar.title = rows[j].istDay + ' IST: ' + count + ' filing(s)';
      box.appendChild(bar);
    }

    if (rows.length > 0) {
      setText('day-from', rows[0].istDay);
      setText('day-to', rows[rows.length - 1].istDay);
    }
  }

  function query() {
    var parts = ['limit=' + state.limit, 'offset=' + state.offset];
    // The feed's "said something" toggle IS the verified tier. Expressed here
    // rather than as a separate parameter because the server already filters on
    // exactly this set, and inventing a second name for it would be two ways to
    // ask one question — which is how the two views start disagreeing.
    if (state.onlyInsights && !state.tier) parts.push('tier=verified');
    // BOTH ARE SENT, and they are not the same question. 'q' is ranked free
    // text over the text index; 'symbol' is an exact match. Only one is ever
    // set at a time - picking a company clears the query and typing clears the
    // pick - but the server ANDs them if both arrive, which is the harmless
    // reading of a state this page does not produce.
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.symbol) parts.push('symbol=' + encodeURIComponent(state.symbol));
    if (state.category) parts.push('category=' + encodeURIComponent(state.category));
    if (state.group) parts.push('group=' + encodeURIComponent(state.group));
    if (state.tier) parts.push('tier=' + encodeURIComponent(state.tier));
    if (state.enrichState) parts.push('state=' + encodeURIComponent(state.enrichState));
    if (state.amount) parts.push('amount=' + encodeURIComponent(state.amount));
    if (state.refusal) parts.push('refusal=' + encodeURIComponent(state.refusal));
    return 'api/filings?' + parts.join('&');
  }

  function refresh(force) {
    var slow = force === true || state.ticks % SLOW_EVERY === 0;
    var jobs = [
      getJson('api/summary').then(function (b) { renderSummary(b.data); }),
      getJson(query()).then(function (b) {
        // BOTH VIEWS, FROM ONE REQUEST. Rendering only the visible one would
        // save a few milliseconds of DOM work and cost a tab switch a round
        // trip — and the two would then be able to disagree, which is the one
        // thing a page showing the same rows twice must never do.
        renderFeed(b.data, b.meta);
        renderFilings(b.data, b.meta);
      })
    ];
    if (slow) {
      jobs.push(getJson('api/categories').then(function (b) { renderCategories(b.data); }));
      jobs.push(getJson('api/daily').then(function (b) { renderDaily(b.data); }));
      // Seven grouped aggregations, so it rides the slow cycle rather than the
      // four-second one. It is a shape, not a live number.
      jobs.push(getJson('api/enrichment').then(function (b) { renderEnrichment(b.data); }));
    }

    return Promise.all(jobs).then(function () {
      state.failures = 0;
      clearError();
      setLive('live', 'live');
    }).catch(function (err) {
      state.failures += 1;
      // Never swallowed. A dashboard that silently stops updating is worse
      // than one that says it stopped, because the stale numbers still read
      // as current.
      setLive(state.failures > 2 ? 'down' : 'stale', 'refresh failed');
      showError('Refresh failed (' + state.failures + ' in a row): ' + (err && err.message ? err.message : String(err)));
    });
  }

  function loop() {
    // Paused while the tab is hidden: an unattended tab polling every four
    // seconds for a week is load on the same database the poller is writing to.
    if (!document.hidden) {
      state.ticks += 1;
      refresh(false);
    }
    window.setTimeout(loop, FAST_MS);
  }

  function applyFilters() {
    // DELIBERATELY DOES NOT READ '#symbol'. It used to, and that was the whole
    // search: the box's text was the exact-symbol filter. It now drives two
    // different filters depending on whether a suggestion was picked, so it has
    // its own handlers - and a stray read here would overwrite 'state.symbol'
    // with the display text of a category every time a select changed.
    state.category = el('category').value;
    state.group = el('group').value;
    state.tier = el('tier').value;
    state.enrichState = el('state').value;
    state.amount = el('amount').value;
    state.limit = Number(el('limit').value) || DEFAULT_LIMIT;
    state.offset = 0;
    // Admin's select and the feed's chips are two controls over one filter.
    // Whichever moved, both must show the same answer afterwards.
    syncChips();
    refresh(true);
  }

  el('category').addEventListener('change', applyFilters);
  el('group').addEventListener('change', applyFilters);
  el('tier').addEventListener('change', applyFilters);
  el('state').addEventListener('change', applyFilters);
  el('amount').addEventListener('change', applyFilters);
  el('limit').addEventListener('change', applyFilters);
  el('clear').addEventListener('click', function () {
    el('symbol').value = '';
    el('category').value = '';
    el('group').value = '';
    el('tier').value = '';
    el('state').value = '';
    el('amount').value = '';
    // Cleared through the same three fields the search box owns, rather than
    // by emptying the input and hoping: 'symbol' and 'q' are state, not markup,
    // and a Clear that left one of them set would leave the feed filtered by a
    // control that now looks empty.
    state.symbol = '';
    state.q = '';
    state.picked = null;
    state.refusal = '';
    closeSuggest();
    renderSearchNote();
    renderRefusalChip();
    applyFilters();
  });
  el('prev').addEventListener('click', function () {
    state.offset = Math.max(0, state.offset - state.limit);
    refresh(true);
  });
  el('next').addEventListener('click', function () {
    state.offset = state.offset + state.limit;
    refresh(true);
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh(true);
  });

  // ---------------------------------------------------------- type-ahead ----
  //
  // A combobox over 'api/suggest'. Three things make it safe to fire while
  // somebody is typing, and all three are here rather than on the server:
  //
  //   1. It is DEBOUNCED, so a word is one request and not nine.
  //   2. Every response carries the sequence number of the request that asked
  //      for it, and a stale one is dropped. fetch does not promise ordering.
  //   3. Every node is built with createElement and textContent. A company
  //      name is exchange-supplied text that reached this page through an
  //      unauthenticated database, and this list renders more of it, closer
  //      together, than anything else on the page.

  var suggestState = {
    // What is currently in the list, in the order it is drawn, so the arrow
    // keys and a click both resolve to the same thing by index.
    items: [],
    active: -1,
    open: false,
    timer: null,
    // Monotonic, and this is the bug it exists for: responses do not arrive in
    // the order the requests were sent. Typing 'brit' and then 'britannia' can
    // land 'brit''s slower answer last and leave the reader looking at
    // suggestions for a word they have already typed past - which reads as the
    // box being wrong rather than late.
    seq: 0
  };

  function closeSuggest() {
    var box = el('suggest');
    if (box) box.hidden = true;
    suggestState.open = false;
    suggestState.active = -1;
    var input = el('symbol');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  // THE ONE HIGHLIGHT, for the mouse and the keyboard alike.
  //
  // Deliberately not a ':hover' rule. The arrow keys move a highlight without
  // moving the pointer, so a hover rule would light up whichever row the mouse
  // is resting over AS WELL as the one Enter would pick - two highlighted rows,
  // one of them lying about what the next keypress does.
  //
  // 'aria-activedescendant' is what makes this announceable: DOM focus never
  // leaves the input (it must not - the reader is still typing), so the
  // highlight is only a colour unless the input names the option it is on.
  function highlight(index) {
    var options = el('suggest').getElementsByClassName('sopt');
    for (var i = 0; i < options.length; i++) {
      var mine = i === index;
      options[i].className = 'sopt' + (mine ? ' active' : '');
      options[i].setAttribute('aria-selected', mine ? 'true' : 'false');
    }
    suggestState.active = index;

    var input = el('symbol');
    if (index < 0 || !options[index]) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    input.setAttribute('aria-activedescendant', options[index].id);
    // A list can be taller than its own box. A reader arrowing past the bottom
    // must not be highlighting a row they cannot see.
    if (options[index].scrollIntoView) {
      options[index].scrollIntoView({ block: 'nearest' });
    }
  }

  // Wraps at both ends, because the list is at most eleven rows: walking off
  // the bottom round to the top is faster than reversing, and there is never
  // enough of it to get lost in.
  function moveActive(delta) {
    var n = suggestState.items.length;
    if (!suggestState.open || n === 0) return;
    var next = suggestState.active + delta;
    if (next < 0) next = n - 1;
    if (next >= n) next = 0;
    highlight(next);
  }

  function suggestHeading(box, label) {
    var li = document.createElement('li');
    li.className = 'sgroup';
    // Presentational, so it is not one of the options the arrow keys walk. A
    // listbox whose headings are arrowable makes Enter do nothing on a third
    // of its rows.
    li.setAttribute('role', 'presentation');
    li.textContent = label;
    box.appendChild(li);
  }

  function suggestOption(box, index, item) {
    var li = document.createElement('li');
    li.className = 'sopt';
    li.id = 'suggest-opt-' + index;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.setAttribute('data-index', String(index));

    var head = document.createElement('span');
    head.className = 'ssym';
    head.textContent = item.head;
    li.appendChild(head);

    if (item.name) {
      var name = document.createElement('span');
      name.className = 'sname';
      name.textContent = item.name;
      li.appendChild(name);
    }

    // How many filings there are behind this row. It is the cheapest possible
    // answer to "is this the one I meant" when two companies both complete
    // what the reader typed.
    var n = document.createElement('span');
    n.className = 'scount';
    n.textContent = groupInt(item.filings);
    li.appendChild(n);

    box.appendChild(li);
  }

  function pushSuggestions(box, items, label, rows, build) {
    if (!rows || rows.length === 0) return;
    suggestHeading(box, label);
    for (var i = 0; i < rows.length; i++) {
      var item = build(rows[i]);
      items.push(item);
      suggestOption(box, items.length - 1, item);
    }
  }

  function renderSuggest(data) {
    var box = el('suggest');
    clear(box);

    var items = [];

    // THE ORDER IS THE SERVER'S RANKING, not a preference expressed twice.
    // Companies lead because a company is what the box is for; groups come
    // last because there are eleven of them and a row of chips for them sits
    // directly underneath.
    pushSuggestions(box, items, 'Companies', data.companies, function (row) {
      return {
        kind: 'company',
        value: row.symbol,
        head: row.symbol,
        name: row.companyName,
        filings: row.filings
      };
    });
    pushSuggestions(box, items, 'Categories', data.categories, function (row) {
      return {
        kind: 'category',
        value: row.category,
        head: row.category,
        name: '',
        filings: row.filings
      };
    });
    pushSuggestions(box, items, 'Groups', data.groups, function (row) {
      return {
        kind: 'group',
        value: row.group,
        head: row.label,
        name: '',
        filings: row.filings
      };
    });

    suggestState.items = items;

    if (items.length === 0) {
      // Hidden rather than showing "no matches". The box also searches free
      // text, so a query with no company behind it is an ordinary thing to be
      // typing - saying "nothing found" mid-word would be wrong as often as it
      // was right.
      closeSuggest();
      return;
    }

    box.hidden = false;
    suggestState.open = true;
    el('symbol').setAttribute('aria-expanded', 'true');
    // NOTHING IS HIGHLIGHTED until the reader presses a key. Pre-selecting the
    // first row is how a search box quietly applies a filter nobody chose: the
    // reader types a phrase, presses Enter to search for it, and gets one
    // company instead. Enter with no highlight searches what was typed.
    highlight(-1);
  }

  function requestSuggestions() {
    var typed = el('symbol').value.trim();
    if (typed.length < SUGGEST_MIN) {
      closeSuggest();
      return;
    }

    suggestState.seq += 1;
    var mine = suggestState.seq;

    getJson('api/suggest?q=' + encodeURIComponent(typed))
      .then(function (body) {
        if (mine !== suggestState.seq) return;
        renderSuggest(body.data);
      })
      .catch(function () {
        // DELIBERATELY SILENT, unlike every other fetch on this page.
        //
        // A failed suggestion costs the reader nothing - the box still searches
        // on Enter and the feed is unaffected - and the alternative is a red
        // banner over the feed because a keystroke raced a restart. That would
        // be the page reporting its own timing as a fault. The live dot and the
        // four-second poll are what say the server is down, and they say it
        // whether anybody is typing or not.
        if (mine === suggestState.seq) closeSuggest();
      });
  }

  function scheduleSuggestions() {
    if (suggestState.timer !== null) window.clearTimeout(suggestState.timer);
    suggestState.timer = window.setTimeout(function () {
      suggestState.timer = null;
      requestSuggestions();
    }, SUGGEST_DEBOUNCE_MS);
  }

  // Undoes exactly what picking a suggestion did, and nothing else. A blanket
  // reset here would clear a category the reader had chosen from the Admin
  // panel, which the search box has no business touching.
  function undoPicked() {
    var picked = state.picked;
    if (!picked) return;
    if (picked.kind === 'company') state.symbol = '';
    if (picked.kind === 'category') {
      state.category = '';
      el('category').value = '';
    }
    if (picked.kind === 'group') {
      state.group = '';
      syncChips();
    }
    state.picked = null;
  }

  function applySuggestion(index) {
    var item = suggestState.items[index];
    if (!item) return;

    undoPicked();
    // Each kind applies the EXACT filter it names, never a better-ranked fuzzy
    // one. That is the whole reason the list distinguishes three kinds: picking
    // "Stock split" from it is 'category=Stock split', not a text search for
    // two common words that also matches every broking company.
    if (item.kind === 'company') {
      state.symbol = item.value;
    } else if (item.kind === 'category') {
      state.category = item.value;
      el('category').value = item.value;
    } else {
      state.group = item.value;
      syncChips();
    }

    state.picked = item;
    state.q = '';
    state.offset = 0;
    el('symbol').value = item.head;
    closeSuggest();
    renderSearchNote();
    refresh(true);
  }

  // Enter with nothing highlighted: search what was typed.
  function submitSearch() {
    undoPicked();
    state.q = el('symbol').value.trim();
    state.offset = 0;
    closeSuggest();
    renderSearchNote();
    refresh(true);
  }

  function clearSearch() {
    undoPicked();
    state.q = '';
    state.offset = 0;
    el('symbol').value = '';
    closeSuggest();
    renderSearchNote();
    refresh(true);
  }

  // WHAT THE BOX IS CURRENTLY DOING, in words, with a way out.
  //
  // Picking BRITANNIA puts 'BRITANNIA' in the box, which looks identical to
  // having typed it - and the two do different things. This line is what tells
  // a reader which of them is in force, and it is the only affordance for
  // undoing a pick without deleting the text by hand.
  function renderSearchNote() {
    var note = el('search-note');
    if (!note) return;
    clear(note);

    var picked = state.picked;
    var label = null;
    if (picked && picked.kind === 'company') {
      label = 'Every filing by ' + picked.value;
    } else if (picked && picked.kind === 'category') {
      label = 'Category: ' + picked.value;
    } else if (picked && picked.kind === 'group') {
      label = 'Group: ' + picked.head;
    } else if (state.q) {
      label = 'Searching for ' + state.q;
    }

    if (label === null) {
      note.hidden = true;
      return;
    }

    // textContent, like everything else: a category is NSE's text and the query
    // is the reader's, and neither is markup.
    note.appendChild(document.createTextNode(label));
    var undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'clearq';
    undo.textContent = 'clear';
    undo.addEventListener('click', clearSearch);
    note.appendChild(undo);
    note.hidden = false;
  }

  el('symbol').addEventListener('input', function () {
    // Typing invalidates a pick. A reader editing 'BRITANNIA' back down to
    // 'BRIT' has stopped asking for Britannia specifically, and leaving the
    // exact symbol filter on would show them Britannia's filings for a word
    // that no longer says Britannia.
    if (state.picked) {
      undoPicked();
      renderSearchNote();
    }
    scheduleSuggestions();
  });

  el('symbol').addEventListener('keydown', function (event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      // Reopens a list the reader dismissed, rather than doing nothing. Escape
      // is for getting the list out of the way; ArrowDown is for asking it back.
      if (!suggestState.open) requestSuggestions();
      else moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Escape') {
      // preventDefault ONLY while the list is open. A type=search input clears
      // itself on Escape in some browsers, and that is the right behaviour for
      // an empty-handed Escape - it just must not also happen on the press that
      // was meant to dismiss the list.
      if (suggestState.open) {
        event.preventDefault();
        closeSuggest();
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestState.open && suggestState.active >= 0) {
        applySuggestion(suggestState.active);
      } else {
        submitSearch();
      }
      return;
    }
    if (event.key === 'Tab') closeSuggest();
  });

  // Closing on blur is what makes a click anywhere else dismiss the list. The
  // mousedown handler below is what stops it dismissing the list before a click
  // ON the list has landed.
  el('symbol').addEventListener('blur', closeSuggest);

  function optionIndexAt(node, root) {
    while (node && node !== root) {
      if (node.getAttribute && node.getAttribute('data-index') !== null) {
        return Number(node.getAttribute('data-index'));
      }
      node = node.parentNode;
    }
    return -1;
  }

  el('suggest').addEventListener('mousedown', function (event) {
    // Without this the input blurs first, the blur handler closes the list, and
    // the click lands on nothing. A suggestion you can see and cannot click is
    // worse than no suggestion.
    event.preventDefault();
  });

  el('suggest').addEventListener('click', function (event) {
    var index = optionIndexAt(event.target, event.currentTarget);
    if (index >= 0) applySuggestion(index);
  });

  // The pointer moves the SAME highlight the arrow keys move, so there is only
  // ever one row claiming to be what Enter will pick.
  el('suggest').addEventListener('mouseover', function (event) {
    var index = optionIndexAt(event.target, event.currentTarget);
    if (index >= 0 && index !== suggestState.active) highlight(index);
  });

  // ---------------------------------------------------------------- tabs ----
  function showView(name) {
    state.view = name;
    el('view-feed').hidden = name !== 'feed';
    el('view-admin').hidden = name !== 'admin';
    el('tab-feed').className = 'tab' + (name === 'feed' ? ' active' : '');
    el('tab-admin').className = 'tab' + (name === 'admin' ? ' active' : '');
    el('tab-feed').setAttribute('aria-selected', String(name === 'feed'));
    el('tab-admin').setAttribute('aria-selected', String(name === 'admin'));
  }
  el('tab-feed').addEventListener('click', function () { showView('feed'); });
  el('tab-admin').addEventListener('click', function () { showView('admin'); });

  // --------------------------------------------------------------- chips ----
  // The group filter, twice: chips in the feed and a select in Admin. They
  // write the SAME state and re-read each other, so a group picked in one is
  // reflected in the other — two controls for one filter that disagreed would
  // be worse than one control in the wrong place.
  function syncChips() {
    var chips = el('chips').getElementsByClassName('chip');
    for (var i = 0; i < chips.length; i++) {
      var mine = chips[i].getAttribute('data-group') === state.group;
      chips[i].className = 'chip' + (mine ? ' active' : '');
    }
    el('group').value = state.group;
  }
  el('chips').addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var group = target.getAttribute('data-group');
    if (group === null) return;
    state.group = group;
    state.offset = 0;
    syncChips();
    refresh(true);
  });

  el('only-insights').addEventListener('change', function (event) {
    state.onlyInsights = event.target.checked;
    state.offset = 0;
    refresh(true);
  });

  // The feed pages by GROWING rather than replacing, because a feed a reader is
  // part-way down must not jump to the top to show them more.
  el('feed-more').addEventListener('click', function () {
    state.limit = Math.min(200, state.limit + 25);
    el('limit').value = String(state.limit);
    refresh(true);
  });

  // '/' focuses the search from anywhere, unless something is already being
  // typed into.
  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
    var active = document.activeElement;
    var tag = active && active.tagName ? active.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    event.preventDefault();
    el('symbol').focus();
  });

  setLive('', 'connecting');
  refresh(true);
  window.setTimeout(loop, FAST_MS);
})();
`;
