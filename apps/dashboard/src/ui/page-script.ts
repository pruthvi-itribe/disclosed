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

  var state = {
    limit: DEFAULT_LIMIT,
    offset: 0,
    symbol: '',
    category: '',
    enrichState: '',
    amount: '',
    refusal: '',
    highestSeen: null,
    ticks: 0,
    failures: 0
  };

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
      td.colSpan = 7;
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

  function renderCategories(rows) {
    var box = el('categories');
    clear(box);

    if (rows.length === 0) {
      var none = document.createElement('div');
      none.className = 'empty-state';
      none.textContent = 'Nothing ingested yet.';
      box.appendChild(none);
      return;
    }

    var top = rows[0].count || 1;
    var select = el('category');
    var known = {};
    for (var j = 0; j < select.options.length; j++) known[select.options[j].value] = true;

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var row = document.createElement('div');
      row.className = 'row clickable' + (state.category === r.category ? ' active' : '');
      row.title = r.category;

      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = r.category;
      row.appendChild(name);

      var n = document.createElement('div');
      n.className = 'n';
      n.textContent = groupInt(r.count);
      row.appendChild(n);

      var meter = document.createElement('div');
      meter.className = 'meter';
      meter.style.width = Math.max(2, Math.round((r.count / top) * 100)) + '%';
      row.appendChild(meter);

      row.addEventListener('click', pickCategory(r.category));
      box.appendChild(row);

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

    var pending = 0;
    for (var s = 0; s < d.byState.length; s++) {
      if (d.byState[s].key === 'pending') pending = d.byState[s].count;
    }
    setText('stat-pending', groupInt(pending));

    var box = el('refusals');
    clear(box);

    var groups = [
      { label: 'amount refused', rows: d.byRefusal },
      { label: 'document unreadable', rows: d.byUnparseable }
    ];

    var drawn = 0;
    for (var g = 0; g < groups.length; g++) {
      if (groups[g].rows.length === 0) continue;
      drawn += groups[g].rows.length;

      var heading = document.createElement('div');
      heading.className = 'reason-group';
      heading.textContent = groups[g].label;
      box.appendChild(heading);

      var wrap = document.createElement('div');
      wrap.className = 'reasons';
      for (var i = 0; i < groups[g].rows.length; i++) {
        var r = groups[g].rows[i];
        var node = tag(r.key, 'refusal' + (state.refusal === r.key ? ' active' : ''), pickRefusal(r.key));
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = groupInt(r.count);
        node.appendChild(n);
        wrap.appendChild(node);
      }
      box.appendChild(wrap);
    }

    if (drawn === 0) {
      var none = document.createElement('div');
      none.className = 'empty-state';
      none.textContent = 'Nothing refused yet.';
      box.appendChild(none);
    }

    renderClaims(d);
    renderResults(d);
    renderRefusalChip();
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
      if (groups[g].rows.length === 0) continue;

      var heading = document.createElement('div');
      heading.className = 'reason-group';
      heading.textContent = groups[g].label;
      box.appendChild(heading);

      var wrap = document.createElement('div');
      wrap.className = 'reasons';
      for (var i = 0; i < groups[g].rows.length; i++) {
        var r = groups[g].rows[i];
        var node = tag(r.key, 'refusal' + (state.refusal === r.key ? ' active' : ''), pickRefusal(r.key));
        var n = document.createElement('span');
        n.className = 'n';
        n.textContent = groupInt(r.count);
        node.appendChild(n);
        wrap.appendChild(node);
      }
      box.appendChild(wrap);
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
  el('state').addEventListener('change', applyFilters);
  el('amount').addEventListener('change', applyFilters);
  el('limit').addEventListener('change', applyFilters);
  el('clear').addEventListener('click', function () {
    el('symbol').value = '';
    el('category').value = '';
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
