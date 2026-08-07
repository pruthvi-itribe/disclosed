/**
 * The card feed: what a card shows, how many claims fit on one, how a figure
 * is marked inside a claim, and the time buckets the cards fall under.
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
export const SCRIPT_FEED = `
  // How many claims a card shows before it stops.
  //
  // TWO, AND THE NUMBER IS ABOUT THE GRID RATHER THAN THE CARD. A card is a
  // glance and TRANSRAILL's presentation yields eleven, so some cap was always
  // needed — but the cap is also the ONLY control over how tall the tallest
  // card in a row can be, and the row's height is the tallest card in it.
  //
  // Measured at 1440px over the live feed, height range and the empty space
  // left above the shortest card's footer:
  //
  //     claims shown      heights      spread   worst void
  //     three            234-330px      1.41       149px
  //     two              211-279px      1.32       104px
  //
  // Each claim dropped takes about 45px off the ceiling and the same off every
  // card that did not need it. Two is where a row stops looking like one card
  // ran out of things to say — and nothing is lost, because the claims past it
  // are one click away and the card SAYS how many there are.
  //
  // NOT SOLVED BY TRUNCATING A CLAIM INSTEAD. Clamping each line to two lines
  // was measured too and is very slightly tidier (max 266px), but it cuts
  // "...interim dividend Rs. 20/share FY end…" mid-figure with no control to
  // see the rest. This product's premise is that every claim matched its source
  // character for character; a card that silently truncates one is the wrong
  // trade for 13 pixels.
  var CARD_CLAIMS = 2;

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
    for (var i = 0; i < claims.length; i++) {
      // ECHOES ARE SKIPPED, not dropped. The server marks a claim whose fact an
      // earlier card in this same response already stated for this company —
      // DHARMAJ filed a presentation and a press release a minute apart, both
      // saying revenue grew 5% in Q1FY27, and the grid puts them side by side.
      // The claim is still in the payload with its span and still shown in the
      // detail view; it just stops being one of the card's headlines.
      if (claims[i].echo === true) continue;
      lines.push(claims[i].text);
    }
    return lines;
  }

  /**
   * A figure inside a claim, matched so it can be set apart typographically.
   *
   * WHAT THIS IS NOT: it does not compute, convert, round or compare anything.
   * It finds the characters the document already printed and marks them, which
   * is the only kind of emphasis this product is allowed to add. A percentage
   * badge derived from two other figures is a calculation, and 'results-line.ts'
   * carries the argument against those: a competitor published EBITDA MARGIN
   * 13.32% for APOLLOTYRE where the arithmetic gives 13.23%, a figure the
   * filing never printed, about a named listed company.
   *
   * Currency symbol and scale word are pulled in WITH the number, because
   * '2,535' set apart from 'crore' is a worse reading of the sentence than
   * leaving both plain. Direction words are deliberately NOT matched: 'up' is
   * the document's word, but colouring it green is this page taking a view.
   */
  //
  // EVERY BACKSLASH BELOW IS DOUBLED, and that is not a style choice. This file
  // is a TypeScript template literal, so the compiler processes escape
  // sequences before the browser ever sees them: a single backslash before a
  // letter is consumed, and the class that should match a digit arrives at the
  // page matching that letter instead. The first version of this shipped
  // exactly that, and the feed rendered "Declared interim dividend" with the
  // fourth letter in bold. The comment cannot demonstrate it either, for the
  // same reason.
  var FIGURE = /((?:₹|Rs\\.?|INR|USD|\\$)?\\s?\\d[\\d,]*(?:\\.\\d+)?\\s?(?:%|bps|crore|cr|lakh|lakhs|million|mn|billion|bn|MW|MTPA|x)?)/gi;

  /**
   * Writes a claim into a node with its figures marked.
   *
   * BUILT FROM TEXT NODES, never innerHTML. The claim is model-proposed text
   * that was matched against an exchange PDF; it reaches the DOM as data or it
   * does not reach it at all, and that rule does not bend for styling.
   */
  function writeClaim(node, text) {
    var value = String(text);
    FIGURE.lastIndex = 0;
    var at = 0;
    var match = FIGURE.exec(value);
    while (match !== null) {
      // A bare unit with no digits is not a figure; the alternation can match
      // an empty string, which would spin the loop.
      if (match[0].trim() === '' || !/\\d/.test(match[0])) {
        FIGURE.lastIndex = match.index + Math.max(1, match[0].length);
        match = FIGURE.exec(value);
        continue;
      }
      if (match.index > at) {
        node.appendChild(document.createTextNode(value.slice(at, match.index)));
      }
      var fig = document.createElement('span');
      fig.className = 'fig';
      fig.textContent = match[0];
      node.appendChild(fig);
      at = match.index + match[0].length;
      match = FIGURE.exec(value);
    }
    if (at < value.length) {
      node.appendChild(document.createTextNode(value.slice(at)));
    }
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
    // NAMED, so a person can point at it. Cards repeat, so the name is a
    // data attribute rather than an id — see the component index in page.ts.
    card.setAttribute('data-ui', 'card');
    // A STABLE IDENTITY FOR A NODE THAT IS REBUILT EVERY FOUR SECONDS. The feed
    // repaints on every poll, so "the first card with an expander" names a
    // different card before and after a click — which is a trap for a test and
    // would be one for any future deep link to a filing. The seqId is the one
    // value that identifies this card across repaints.
    card.setAttribute('data-seq', String(f.seqId));

    var head = document.createElement('header');
    head.className = 'cardhead';
    head.setAttribute('data-ui', 'card-head');

    var who = document.createElement('div');
    who.className = 'who';
    // THE WAY INTO THE COMPANY PAGE. A button rather than a styled span, so it
    // is reachable by keyboard and announced as an action — the symbol is the
    // most obvious thing on the card to click and it did nothing.
    var sym = document.createElement('button');
    sym.type = 'button';
    sym.className = 'sym';
    sym.textContent = f.symbol;
    sym.title = 'All filings from ' + f.symbol;
    sym.onclick = (function (symbol) {
      return function (event) {
        event.stopPropagation();
        openCompany(symbol);
      };
    })(f.symbol);
    who.appendChild(sym);
    var name = document.createElement('span');
    name.className = 'coname';
    name.textContent = f.companyName;
    // The name truncates in a narrow column, so the whole of it stays
    // reachable rather than being merely absent.
    name.title = f.companyName;
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
      list.setAttribute('data-ui', 'card-claims');
      for (var i = 0; i < lines.length && i < shown; i++) {
        var li = document.createElement('li');
        writeClaim(li, lines[i]);
        list.appendChild(li);
      }
      card.appendChild(list);
      if (lines.length > CARD_CLAIMS && !isOpen) {
        // EXPANDS RATHER THAN ANNOUNCES. '+ 6 more' as dead text tells a reader
        // the card is hiding something and gives them nowhere to go; the whole
        // reason the card stops at two is that eleven is a wall, and the
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
              writeClaim(extra, rest[k]);
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
      said.setAttribute('data-ui', 'card-outcome');
      said.textContent = f.outcome;
      card.appendChild(said);
    }

    var foot = document.createElement('footer');
    foot.className = 'cardfoot';
    foot.setAttribute('data-ui', 'card-foot');

    var tier = document.createElement('span');
    tier.className = 'tier tier-' + f.confidenceTier;
    tier.setAttribute('data-ui', 'card-tier');
    tier.textContent = f.confidenceTierLabel;
    tier.title = describe(TIER_TITLE, f.confidenceTier);
    foot.appendChild(tier);

    var cat = document.createElement('span');
    cat.className = 'cardcat';
    cat.setAttribute('data-ui', 'card-category');
    cat.textContent = f.category;
    // The footer is one line and this is the element that truncates in it, so
    // the whole category has to stay reachable somewhere. NSE's longest is
    // 'Analysts/Institutional Investor Meet/Con. Call Updates'.
    cat.title = f.category;
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

  /**
   * Draws a list of filings into any container.
   *
   * SHARED BY THE FEED AND THE COMPANY PAGE on purpose, and it is the largest
   * saving in the company view: the body of that page is this code, which
   * already renders results lines, claim lines, quiet cards, the expander, Copy
   * and Source, and already carries the createElement/textContent/safeHref
   * discipline. A second card renderer would be a second place for exchange
   * text to reach the DOM.
   *
   * 'chrome' is false for the company page, whose paging and counts live in its
   * own header rather than in the feed's footer.
   */
  function renderFeedInto(feed, items, meta, chrome) {
    if (!feed) return;
    feed.textContent = '';

    if (chrome) {
      var withInsight = 0;
      for (var n = 0; n < items.length; n++) {
        if (insightLines(items[n].enrichment || {}).length > 0) withInsight += 1;
      }
      setText('hero-insights', groupInt(withInsight));
    }

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
      if (chrome) {
        setText('feed-info', '');
        el('feed-more').hidden = true;
      }
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

    if (chrome) {
      var shown = meta.offset + meta.returned;
      setText('feed-info', shown + ' of ' + groupInt(meta.total));
      el('feed-more').hidden = !meta.hasMore;
    }
  }

  /** The market feed: the shared renderer, into #feed, with its own chrome. */
  function renderFeed(items, meta) {
    renderFeedInto(el('feed'), items, meta, true);
  }
`;
