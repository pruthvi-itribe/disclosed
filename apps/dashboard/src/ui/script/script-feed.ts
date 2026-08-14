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
   *
   * Each line carries the movement its source sentence printed, because the
   * mark belongs to the claim and not to the card: one filing routinely says
   * revenue rose and margin fell.
   */
  function insightLines(e) {
    var lines = [];
    // The results line has no direction of its own and never will: it is a
    // table of figures the document printed, and reading a direction out of
    // two of them is the arithmetic 'results-line.ts' refuses.
    if (e.resultsLine) lines.push({ text: e.resultsLine, direction: '', evidence: '' });
    var claims = e.claims || [];
    for (var i = 0; i < claims.length; i++) {
      // ECHOES ARE SKIPPED, not dropped. The server marks a claim whose fact an
      // earlier card in this same response already stated for this company —
      // DHARMAJ filed a presentation and a press release a minute apart, both
      // saying revenue grew 5% in Q1FY27, and the grid puts them side by side.
      // The claim is still in the payload with its span and still shown in the
      // detail view; it just stops being one of the card's headlines.
      if (claims[i].echo === true) continue;
      lines.push({
        text: claims[i].text,
        direction: claims[i].direction || '',
        evidence: claims[i].directionEvidence || ''
      });
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

  // The movement the DOCUMENT printed, one glyph each. There is deliberately
  // no entry for 'unrated': three-quarters of claims are unrated, an explicit
  // badge on three-quarters of a feed is noise, and the absence of a mark
  // already means what it means — the filing printed no direction beside a
  // figure. A missing key here draws nothing, which is the same thing.
  var DIRECTION_GLYPH = { expansion: '▲', contraction: '▼', mixed: '◆' };

  // Spelled out for a reader who cannot see the glyph. The words describe the
  // DOCUMENT's act - it printed an increase - and never the company.
  var DIRECTION_LABEL = {
    expansion: 'increase printed',
    contraction: 'decrease printed',
    mixed: 'both printed'
  };

  /**
   * Writes one insight line: the movement mark, then the claim.
   *
   * NO COLOUR ON THE MARK, and this is the single most important rendering
   * decision on the page. Red and green ARE a view about the company, and the
   * collection says the view would be wrong: 13 of the 45 marked decreases are
   * falling bad loans, debt, borrowing costs or emissions - ESAF's gross NPA
   * down from 7.5% to 5.4% is a triangle pointing down and is the best news in
   * that filing. The mark follows the figure; the reader reads the claim.
   */
  function writeInsight(node, line) {
    // The direction arrives from the database and 'constructor' is a key on
    // every object literal's prototype, so an unguarded lookup would draw a
    // function as a glyph.
    if (Object.prototype.hasOwnProperty.call(DIRECTION_GLYPH, line.direction)) {
      var mark = document.createElement('span');
      mark.className = 'dir';
      mark.setAttribute('data-ui', 'claim-direction');
      mark.setAttribute('data-direction', line.direction);
      mark.textContent = DIRECTION_GLYPH[line.direction];
      mark.setAttribute('aria-label', DIRECTION_LABEL[line.direction]);
      // WHAT MAKES THE MARK ADMISSIBLE. It is derived rather than quoted, so
      // the characters it was derived from travel with it and a reader can
      // check it without opening the PDF.
      if (line.evidence) {
        mark.title = 'Printed in the document: "' + line.evidence + '"';
      }
      node.appendChild(mark);
    }
    writeClaim(node, line.text);
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
    // THE TIME THIS CARD IS SHOWING, IN THE ONLY FORM THAT SURVIVES A POLL
    // THAT RETURNED NOTHING. 'touchFeedTimes' rewrites the relative time
    // without rebuilding the card, and on a 304 there is no payload left to
    // read it from - see that function.
    card.setAttribute('data-at', f.disseminatedAt);

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
      var list = document.createElement('ul');
      list.className = 'insights';
      list.setAttribute('data-ui', 'card-claims');
      for (var i = 0; i < lines.length && i < CARD_CLAIMS; i++) {
        var li = document.createElement('li');
        writeInsight(li, lines[i]);
        list.appendChild(li);
      }
      card.appendChild(list);
      if (lines.length > CARD_CLAIMS) {
        // OPENS THE FOCUS CARD RATHER THAN GROWING THIS ONE. It used to append
        // the rest of the claims here and remove itself, which pushed every
        // other card in the grid row down and reflowed the feed under whoever
        // clicked it. It also could not show what a reader who stops on a card
        // actually wants: the sentence in the document each claim was matched
        // against.
        //
        // IT STILL SAYS HOW MANY. Silently truncating would make a partial card
        // look complete, and the count is what tells a reader the click is
        // worth making.
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'andmore';
        more.setAttribute('data-ui', 'card-more');
        more.textContent = '+ ' + (lines.length - CARD_CLAIMS) + ' more';
        more.onclick = (function (filing) {
          return function (event) {
            event.stopPropagation();
            openFocus(filing);
          };
        })(f);
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

    // THE FOUR THINGS A READER DOES WITH A CARD, in the foot rather than in the
    // head: the head is one line of identity and time and has no room. They are
    // drawings rather than words, which is what makes four of them fit on a
    // line that could not hold three — see 'script-icon.ts' for the widths.
    //
    // THE STAR IS NULL WHEN SIGNED OUT - absent rather than disabled, because a
    // control that is permanently greyed out and never explains itself reads as
    // a broken page.
    var star = watchButton(f.symbol);
    if (star) foot.appendChild(star);

    // COPY, AS TEXT AND AS A PICTURE, because the thing a reader does with a
    // line like this is send it to somebody, and the two chat windows they send
    // it to want different things. Both take the FILING and not this card's
    // lines: the card's list skips the echoes and folds the results line in
    // among the claims, and a message is one filing on its own, where both of
    // those are wrong. See 'script-share.ts'.
    //
    // The guard stays on the card's lines: a card with nothing verified on it
    // offers nothing to send.
    if (lines.length > 0) {
      foot.appendChild(shareCopyButton(f, 'card-copy'));
      foot.appendChild(shareImageButton(f, 'card-copy-image'));
    }

    // The document itself. Null when the URL fails the scheme check.
    var source = shareSourceLink(f, 'card-source');
    if (source) foot.appendChild(source);

    card.appendChild(foot);

    // THE WHOLE CARD OPENS, and the affordance is the cursor rather than a
    // control. A permanent "expand" button on every card would be chrome on the
    // densest surface in the product, and the card already carries five
    // controls of its own.
    //
    // A CLICK THAT LANDED ON ONE OF THOSE IS NOT A CLICK ON THE CARD. The
    // symbol, the star and the two copy buttons each stop propagation already;
    // the Source link does not and must not, because swallowing a click on a
    // link is how a link stops being one. So the test is on the target rather
    // than on the bubbling — which also means a control added later needs no
    // ceremony, and it is what catches a click that landed on the SVG INSIDE a
    // control rather than on the control: 'closest' is an Element method and an
    // SVG element is an Element.
    card.className += ' openable';
    // KEYBOARD REACHABLE. A div with a click handler is operable by mouse only,
    // and everything in this dialog is otherwise unreachable without one.
    // The honest cost, stated: a focusable element containing focusable
    // children is a compromise. The alternative — a fifth button on every card
    // — is chrome, and leaving it mouse-only is not an option.
    card.tabIndex = 0;
    card.setAttribute('aria-haspopup', 'dialog');
    card.setAttribute('aria-label', 'Open everything ' + f.symbol + ' filed');
    card.onclick = (function (filing) {
      return function (event) {
        if (event.target && event.target.closest &&
            event.target.closest('a, button')) return;
        openFocus(filing);
      };
    })(f);
    card.onkeydown = (function (filing) {
      return function (event) {
        // Enter only. Space scrolls a page, and stealing it from a container
        // the reader is tabbing through is worse than not handling it.
        if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
        event.preventDefault();
        openFocus(filing);
      };
    })(f);

    return card;
  }

  /**
   * Which divider a filing falls under.
   *
   * BUCKETED BY CALENDAR DAY, NOT BY ELAPSED TIME, and that is the fix. It
   * used to be pure subtraction - under 24h was 'Today', under 48h was
   * 'Yesterday' - so at 09:00 on Sunday a filing disseminated at 17:00 on
   * Saturday was sixteen hours old and printed under 'Today'. Two different
   * market days sat under one heading with nothing between them, which is the
   * founder's report: no distinction between today and yesterday.
   *
   * 'today' and 'previous' are the server's own IST day strings, from
   * 'api/summary'. The comparison is string equality against the filing's own
   * server-sent 'istDay', so this function does no date arithmetic at all -
   * required, because IST rolls at 18:30 UTC and any browser doing that sum
   * for itself would shift filings onto the wrong day for a reader outside
   * India.
   *
   * WITHIN TODAY the elapsed clock still splits the day, because 'what landed
   * while I was reading' is a genuinely different question from 'what day was
   * this' and a market day is 400+ filings under one heading otherwise. That
   * is a duration, not a date, so the browser may own it.
   *
   * OLDER DAYS ARE NAMED BY THEIR DATE rather than lumped into 'Earlier'. The
   * string is the server's, printed as sent. The company page shares this
   * renderer and shows ten months of one filer, where 'Earlier' was every row
   * but the first few.
   *
   * BEFORE THE FIRST SUMMARY LANDS both strings are null and every filing is
   * named by its date. 'api/summary' and 'api/filings' are two requests of one
   * refresh and fetch does not promise ordering, so the feed can paint first;
   * naming the day is never WRONG, only plainer, and the next paint - at most
   * one round trip later - carries the words.
   */
  function feedBucket(istDay, iso, today, previous) {
    if (istDay === today) {
      var ms = Date.now() - Date.parse(iso);
      // 'ms >= 0' rejects a filing stamped in the future rather than calling it
      // brand new: a browser clock running slow would otherwise put the whole
      // day under 'Just now'.
      if (ms >= 0 && ms < 30 * 60 * 1000) return 'Just now';
      return 'Earlier today';
    }
    if (istDay === previous) return 'Yesterday';
    return istDay;
  }

  // Why the feed is empty, in the most specific words the page can honestly
  // manage. Reads only state, so it says nothing it cannot support.
  function emptyHint() {
    var picked = state.picked;

    // NAMED FIRST BECAUSE IT IS THE NARROWEST. Only 128 of 3,466 filings carry
    // a claim of this shape, so when a search and this chip are both on it is
    // almost always this one that emptied the feed - and letting the insight
    // toggle below take the blame would send the reader to the wrong control.
    if (state.plans) {
      return 'Nothing here carries a line where the company said what it plans.'
        + ' Clear the Plans chip, or search a different company.';
    }

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
   * WHAT THIS CONTAINER WOULD DRAW, AS ONE STRING.
   *
   * 'renderBrief' already answers the four-second repaint this way and says
   * why: replacing what is under a reader costs them their place. Under the
   * deck the cost is worse than a scroll position, because the feed is text a
   * reader SELECTS - a card rebuilt mid-selection takes the selection with it,
   * along with every hover and any focus inside it. Measured on an idle
   * 25-card feed with the payload pinned, the rebuild it replaces creates
   * 28,237 nodes a minute for a screen that never changed.
   *
   * THE WHOLE ITEM, NOT A HAND-PICKED LIST OF THE FIELDS THAT RENDER. A list
   * is a second copy of what the card draws, and when the two drift the
   * failure is a card that silently stops updating - the one bug this must not
   * introduce. Measured in the browser against the live payload: 0.045 ms for
   * the feed's 25 items (122 KB) and 0.166 ms for the company page's 200 (502
   * KB), against roughly 1,880 node creations for the rebuild it skips.
   *
   * THE DAY DIVIDER IS IN IT AND THE RELATIVE TIME IS NOT, and that difference
   * is the whole design. 'feedBucket' moves a filing from 'Just now' to
   * 'Earlier today' thirty minutes in, so the heading must be able to change
   * the signature; 'relativeTime' changes on every card every minute, so
   * including it would mean never skipping at all. 'touchFeedTimes' keeps
   * those honest without rebuilding a card.
   *
   * NOT IN IT: state.watched. 'paintWatchButtons' repaints every star from
   * state the moment one is toggled, precisely so a star never needs a
   * rebuild. 'signedIn()' IS in it, because api/me can answer after the first
   * paint and the stars only exist at all once it has.
   */
  function feedSignature(items, meta, chrome) {
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      parts.push(
        feedBucket(
          items[i].istDay,
          items[i].disseminatedAt,
          state.todayIstDay,
          state.previousIstDay,
        ),
      );
      parts.push(JSON.stringify(items[i]));
    }
    var m = meta || {};
    // The state this renderer reads that is not in the payload: the empty
    // hint names the filter that emptied the feed, and the footer counts the
    // rows against the reader's own limit.
    parts.push(String(chrome));
    parts.push(String(signedIn()));
    parts.push(String(state.limit));
    parts.push(String(state.onlyInsights));
    parts.push(String(state.plans));
    parts.push(state.q);
    parts.push(state.symbol);
    parts.push(state.picked ? state.picked.head + '/' + state.picked.filings : '');
    parts.push(String(m.offset) + '/' + String(m.returned) + '/' +
      String(m.total) + '/' + String(m.hasMore));
    return parts.join('\\u0000');
  }

  /**
   * The last signature drawn into each container, keyed by its id.
   *
   * KEYED RATHER THAN A SINGLE VALUE because three containers share this
   * renderer - '#feed', '#company-feed' and '#watch-feed' - and they hold
   * different rows at the same time. All three are ided in the document; a
   * container without one would share the empty key with any other, which is
   * why the key is the id and not a guess at one.
   */
  var feedSignatures = {};

  /**
   * Empties a container and forgets what it held.
   *
   * THE STORE MUST NEVER OUTLIVE THE DOM IT DESCRIBES. 'renderWatching' clears
   * '#watch-feed' itself when the watchlist empties, and without this the
   * signature would survive that: unwatch everything and watch the same
   * company again, and the identical payload would match the stored signature
   * and skip into a container somebody else had emptied. The one way to write
   * the store is beside a draw; the one way to clear the container is here.
   */
  function emptyFeedInto(feed) {
    if (!feed) return;
    feed.textContent = '';
    delete feedSignatures[feed.id];
  }

  /**
   * The only thing on an unchanged card that is still moving.
   *
   * 'relativeTime' is read against the browser's clock, so "3 min ago" is
   * wrong a minute after it was written whether or not the filing changed.
   * Rebuilding the card to correct four characters is what this whole path
   * exists to avoid, so the text is written where it stands.
   *
   * WRITTEN ONLY WHEN IT DIFFERS. Assigning textContent replaces the text node
   * even when the string is identical, which would put a node creation per
   * card back on every tick - the thing being removed.
   *
   * READ OFF THE CARD, NOT OFF A PAYLOAD, and that is what makes it survive a
   * poll that returned nothing: 'api/filings' answers a repeat ask with 304 and
   * no body now, so the tick that needs this most is the tick with no items in
   * it. The timestamp each card renders is on the card as 'data-at'.
   *
   * Takes any root with cards under it: a container when a draw has just
   * happened, the whole document when nothing changed and every visible card is
   * equally stale.
   */
  function touchFeedTimes(root) {
    var cards = root.querySelectorAll('[data-ui="card"]');
    for (var c = 0; c < cards.length; c++) {
      var at = cards[c].getAttribute('data-at');
      if (at === null) continue;
      var when = cards[c].querySelector('.when');
      if (!when) continue;
      var text = relativeTime(at);
      if (when.textContent !== text) when.textContent = text;
    }
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
   *
   * REBUILT ONLY WHEN IT ACTUALLY CHANGED - see 'feedSignature'. The stored
   * signature is written only where the container is actually drawn, so it
   * always describes what is on screen rather than what was last fetched.
   */
  function renderFeedInto(feed, items, meta, chrome) {
    if (!feed) return;

    var signature = feedSignature(items, meta, chrome);
    if (feedSignatures[feed.id] === signature) {
      touchFeedTimes(feed);
      return;
    }
    feedSignatures[feed.id] = signature;

    feed.textContent = '';

    if (chrome) {
      // THE HERO'S SECOND NUMBER IS NOT COUNTED HERE ANY MORE.
      //
      // It used to be: this loop counted the rows on screen that carried an
      // insight and wrote the total into 'hero-insights', beside a first number
      // the SERVER had computed over the IST day. Two units, two windows, one
      // sentence — and the sentence was impossible. Measured on the live
      // collection at 10:36 IST on 2026-08-09: "8 filings today" beside "22
      // verified insights", where the 22 came from 25 rows spanning two IST
      // days after the verified filter. Pressing Load more grew it to 50, 100,
      // 200 while "filings today" stayed at 8.
      //
      // It comes from 'api/summary' now, day-windowed and counted per filing,
      // so it cannot exceed the number beside it. See 'renderSummary'.
      var marks = 0;
      for (var n = 0; n < items.length; n++) {
        var insights = insightLines(items[n].enrichment || {});
        for (var m = 0; m < insights.length; m++) {
          if (Object.prototype.hasOwnProperty.call(DIRECTION_GLYPH, insights[m].direction)) marks += 1;
        }
      }
      // THE LEGEND FOLLOWS THE MARKS. Only 23.2% of claims carry one, so a
      // permanent legend explaining glyphs nobody can see on this screen is
      // furniture; a legend that appears with the first mark is an answer to
      // the question the mark just raised. It is about what is ON SCREEN, which
      // is why this one is still counted here and the hero's is not.
      el('dir-legend').hidden = marks === 0;
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
      var label = feedBucket(f.istDay, f.disseminatedAt, state.todayIstDay, state.previousIstDay);
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
      // At the server's ceiling the button lies if it stays: there IS more,
      // and this window will not show it. Hidden, and the info line says what
      // the reader can actually do — narrow, rather than scroll.
      var atCap = state.limit >= LIMIT_MAX;
      el('feed-more').hidden = !meta.hasMore || atCap;
      if (atCap && meta.hasMore) {
        el('feed-info').textContent += ' - showing the ' + LIMIT_MAX +
          ' most recent. Narrow with search or a topic to reach the rest.';
      }
    }
  }

  /** The market feed: the shared renderer, into #feed, with its own chrome. */
  function renderFeed(items, meta) {
    renderFeedInto(el('feed'), items, meta, true);
  }
`;
