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

  // Columns in the filings table. Named because the empty-state row has to span
  // all of them, and a colspan that silently drifts short of the real count
  // renders as a torn row rather than as an error.
  var COLUMN_COUNT = 9;

  // The ordinary parser. A route equal to this is not worth a tag - it is what
  // reading a PDF normally means - and the tag exists to mark the exceptions.
  var DEFAULT_PARSE_ROUTE = 'pdf-parse';

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

  var state = {
    limit: DEFAULT_LIMIT,
    offset: 0,
    symbol: '',
    category: '',
    group: '',
    tier: '',
    enrichState: '',
    amount: '',
    refusal: '',
    highestSeen: null,
    ticks: 0,
    failures: 0
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
      refresh(true);
    };
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

    // Each accepted claim's source sentence, so the line can be checked against
    // the document without leaving the row.
    var claims = e.claims || [];
    for (var c = 0; c < claims.length; c++) {
      var quote = document.createElement('div');
      quote.className = 'claimspan';
      quote.textContent = '"' + String(claims[c].span).replace(/\s+/g, ' ').trim() + '"';
      quote.title = claims[c].kind;
      cell.appendChild(quote);
      // The heading the claim's quarter was read from, when it came from
      // outside the sentence. Shown BESIDE the sentence rather than merged into
      // it, because they are two separate quotes from two places in the
      // document and running them together would forge a sentence.
      if (claims[c].periodSpan) {
        var period = document.createElement('div');
        period.className = 'claimspan periodspan';
        period.textContent = 'period: "' + String(claims[c].periodSpan).replace(/\s+/g, ' ').trim() + '"';
        cell.appendChild(period);
      }
    }

    // The two quotes a results line rests on: the statement heading that fixed
    // consolidated against standalone, and the column dates that made the
    // comparison year-on-year. Shown because a reader who cannot see those two
    // cannot check the line - the figures themselves are cells, and a cell
    // means nothing without them.
    if (e.results) {
      var basis = document.createElement('div');
      basis.className = 'claimspan periodspan';
      basis.textContent = 'basis: "' + String(e.results.basisSpan).replace(/\s+/g, ' ').trim() + '"';
      cell.appendChild(basis);
      var cols = document.createElement('div');
      cols.className = 'claimspan periodspan';
      cols.textContent = e.results.period + ' vs ' + e.results.priorPeriod + ': "' + String(e.results.columnsSpan).replace(/\s+/g, ' ').trim() + '"';
      cell.appendChild(cols);
      var figs = e.results.figures || [];
      for (var rf = 0; rf < figs.length; rf++) {
        var frow = document.createElement('div');
        frow.className = 'claimspan';
        frow.textContent = '"' + String(figs[rf].span).replace(/\s+/g, ' ').trim() + '"';
        frow.title = figs[rf].metric;
        cell.appendChild(frow);
      }
    }

    var rdropped = e.resultsDiscards || [];
    if (rdropped.length > 0) {
      var rbox = document.createElement('div');
      rbox.className = 'discards';
      for (var rd = 0; rd < rdropped.length; rd++) {
        var rt = tag(rdropped[rd].reason, 'refusal' + (state.refusal === rdropped[rd].reason ? ' active' : ''), pickRefusal(rdropped[rd].reason));
        rt.title = rdropped[rd].detail + ' - ' + rdropped[rd].metric;
        rbox.appendChild(rt);
        rbox.appendChild(document.createTextNode(' '));
      }
      cell.appendChild(rbox);
    }

    // A refusal is a value, never a blank. This is the row that says a model
    // proposed something and the gate threw it away, and what it threw away.
    var dropped = e.claimDiscards || [];
    if (dropped.length > 0) {
      var box = document.createElement('div');
      box.className = 'discards';
      for (var d = 0; d < dropped.length; d++) {
        var t = tag(dropped[d].reason, 'refusal' + (state.refusal === dropped[d].reason ? ' active' : ''), pickRefusal(dropped[d].reason));
        t.title = dropped[d].detail + ' - "' + dropped[d].claim + '"';
        box.appendChild(t);
        box.appendChild(document.createTextNode(' '));
      }
      cell.appendChild(box);
    }

    // THE MODEL SUMMARY, and it is deliberately unlike everything above it.
    // Every claim in this cell carries a sentence matched against the source;
    // this carries nothing. It is labelled, dashed and muted so a reader
    // scanning the column can tell at a glance which line nothing verified,
    // and it is never sent to Telegram.
    if (e.documentSummary) {
      var summary = document.createElement('div');
      summary.className = 'modelsummary';
      var label = document.createElement('span');
      label.className = 'tagm';
      label.textContent = 'model summary - not verified';
      summary.appendChild(label);
      summary.appendChild(document.createTextNode(String(e.documentSummary)));
      cell.appendChild(summary);
    }

    // Which archived files the text came from. Shown because a filing whose
    // text is three concatenated documents is a different object from one
    // whose text is a document, and a span has to be traceable to a file.
    if (e.documentSource) {
      var source = document.createElement('div');
      source.className = 'claimspan periodspan';
      source.textContent = e.documentSource;
      cell.appendChild(source);
    }

    if (e.contextLine) {
      var ctx = document.createElement('div');
      ctx.className = 'context';
      ctx.textContent = e.contextLine;
      cell.appendChild(ctx);
    }

    var summary = document.createElement('div');
    summary.className = 'summary-line';
    summary.textContent = f.summary;
    cell.appendChild(summary);

    var lag = document.createElement('div');
    lag.className = 'lag';
    lag.textContent = f.category + ' · ingested +' + duration(f.pipelineLagMs);
    cell.appendChild(lag);

    row.appendChild(cell);
  }

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
    }

    row.appendChild(cell);
  }

  // A refusal is rendered as a value, never as a blank. The reason is the tag,
  // the detail is its tooltip, and the tag filters the table - which is how the
  // extractor's declines become inspectable rather than merely absent.
  function enrichmentCell(row, e) {
    var cell = document.createElement('td');
    cell.className = 'enr';

    var stateTag = tag(e.state, 'state-' + e.state, null);
    if (e.attemptedAtIst) stateTag.title = 'attempt ' + e.attempts + ' at ' + e.attemptedAtIst + ' IST';
    cell.appendChild(stateTag);

    var reason = e.amountRefusalReason || e.unparseableReason;
    if (reason) {
      var reasonTag = tag(reason, 'refusal' + (state.refusal === reason ? ' active' : ''), pickRefusal(reason));
      reasonTag.title = e.amountRefusalDetail || e.lastError || reason;
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

      cell(row, 'time', f.disseminatedAtIst);
      cell(row, 'sym', f.symbol).title = f.companyName;

      var enrichment = f.enrichment || { state: 'pending', attempts: 0 };
      // The outcome leads the prose columns because for most rows it is the only
      // fact stated: the composed headline beside it degrades to the exchange's
      // own category whenever nothing was verified.
      outcomeCell(row, f);
      groupCell(row, f);
      headlineCell(row, f);
      amountCell(row, enrichment);
      enrichmentCell(row, enrichment);

      var src = cell(row, 'src', null);
      var href = safeHref(f.attachmentUrl);
      if (href) {
        var link = document.createElement('a');
        link.href = href;
        link.rel = 'noopener noreferrer nofollow';
        link.target = '_blank';
        link.textContent = 'source';
        src.appendChild(link);
      } else {
        src.textContent = '—';
        src.className = 'src muted';
      }

      cell(row, 'seq', f.seqId);
      body.appendChild(row);
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

    var drawn = tagGroup(box, 'amount refused', d.byRefusal, pickRefusal)
      + tagGroup(box, 'document unreadable', d.byUnparseable, pickRefusal);

    if (drawn === 0) emptyPanel(box, 'Nothing refused yet.');

    renderClaims(d);
    renderResults(d);
    renderTiers(d);
    renderReading(d);
    renderGroups(d);
    renderRefusalChip();
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
      getJson(query()).then(function (b) { renderFilings(b.data, b.meta); })
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
    state.symbol = el('symbol').value.trim();
    state.category = el('category').value;
    state.group = el('group').value;
    state.tier = el('tier').value;
    state.enrichState = el('state').value;
    state.amount = el('amount').value;
    state.limit = Number(el('limit').value) || DEFAULT_LIMIT;
    state.offset = 0;
    refresh(true);
  }

  el('symbol').addEventListener('change', applyFilters);
  el('symbol').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') applyFilters();
  });
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
    state.refusal = '';
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

  setLive('', 'connecting');
  refresh(true);
  window.setTimeout(loop, FAST_MS);
})();
`;
