/**
 * The summary header and the admin table's cells. Everything that turns one
 * stored field into one piece of table furniture — the tier and group chips,
 * the refusal explanations, the amount and enrichment columns.
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
export const SCRIPT_CELLS = `
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
    renderDayBar(d.todayByGroup || {}, d.todayCount, d.todayVerified || 0);
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

`;
