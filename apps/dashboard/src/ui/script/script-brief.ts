/**
 * The Brief: the day as a finite, countable deck of cards.
 *
 * WHY A DECK AND NOT A DENSER FEED. The requirement is "the day's signal in
 * under a minute", and "under a minute" is a COMPLETION claim. An endless
 * scroll cannot make one: it has no end state, and its ordering problem is
 * unsolvable — 3,420 claims must be sorted by something, recency is actively
 * misleading when 43.6% of filings land in four evening hours, and every other
 * key is a materiality judgement, which is advisory. A deck of twelve has the
 * same ordering problem in a smaller form AND somewhere to print the answer:
 * a cover that states the rule and a last card that states the remainder.
 *
 * WHAT MAKES THE CARD POSSIBLE. `claim-verify.ts` caps a claim at 120
 * characters, so a verified claim is guaranteed to fit on a phone at display
 * type. Nothing else in this product has that property, and the whole design
 * rests on it.
 *
 * The measurements are in
 * `docs/superpowers/specs/2026-08-08-genz-visual-consumption-design.md`.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string
 * and concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so a name declared here is visible to every other
 * fragment and the order they are joined in is the order they execute in.
 * It is joined after `script-feed` because every string it puts on screen
 * goes through that fragment's `writeClaim`, and no other way.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the
 * composing template literal before a browser ever sees this, which is the
 * failure this file split exists to make less likely — a test asserts it.
 */
export const SCRIPT_BRIEF = `
  // ---------------------------------------------------------------- brief ----

  /**
   * How many company cards the deck holds.
   *
   * TWELVE, AND THE NUMBER IS DERIVED FROM TIME because it is a promise about
   * time. A 25px sentence plus a glance at the ticker takes about four and a
   * half seconds, so twelve cards is roughly 54 seconds and fifteen would be
   * 68 — which breaks the promise the progress rail makes on the first card.
   */
  var BRIEF_MAX_CARDS = 12;

  /**
   * Below this many candidates the rail is not drawn at all.
   *
   * A two-segment progress bar is chrome, not information: it says "you are
   * halfway through two things", which a reader can already see. The cards
   * are still drawn; only the rail goes.
   */
  var BRIEF_MIN_CARDS = 3;

  // Claims under the lede. Two, for the reason CARD_CLAIMS is two on the feed
  // card: the cap is what stops one talkative company from turning a card into
  // a wall. The rest are one tap away on the company page and the card says
  // how many there are.
  var BRIEF_REST_CLAIMS = 2;

  /**
   * How many verified filings the deck is ordered over.
   *
   * IT IS A WINDOW AND THE COVER SAYS SO. The server caps a page at 200 and a
   * verified IST day is 326 to 463 filings, so this deck cannot see a whole
   * day from one request. Stating the window is the difference between a
   * bounded claim and a false one; slice 2 replaces it with a server-side
   * aggregation over the whole IST day and the caveat goes with it.
   */
  var BRIEF_WINDOW = 200;

  /**
   * The sentence the cover carries, verbatim.
   *
   * THE CENTRAL HONESTY RISK OF THE WHOLE VIEW lives in this string. Twelve
   * cards of the ~230 companies that say something a document verified is
   * about five per cent of a day, and a reader who only ever opens the Brief
   * will believe they have seen the market. Every ordering key is a countable
   * property of OUR EVIDENCE rather than of the security — does the filing
   * carry a verified results block, how many of its claims carry a figure, how
   * many claims are there — and this is where that is admitted rather than
   * implied. Nothing in this view calls the deck a ranking, and the word
   * that would imply one appears nowhere in its copy or its code.
   */
  var BRIEF_RULE = 'Ordered by how much of what each company said could be checked against its own document — not by how much it matters. That judgement is yours.';

  // A claim carrying a figure. Not a figure PARSER: nothing here reads a
  // number out of a claim, it only counts the claims that have one, which is
  // an ordering key over what we hold rather than a statement about a company.
  // The backslash is doubled because this file is a template literal and the
  // compiler eats a single one before the browser sees it.
  var BRIEF_DIGIT = /\\d/;

  /**
   * One card's worth of a company's day, from the filings this response
   * carried.
   *
   * Grouped by symbol, because the unit of a card is a company-day and one
   * company routinely files a presentation, a press release and an outcome
   * about one event.
   */
  function briefCandidates(items) {
    var bySymbol = {};
    var order = [];
    for (var i = 0; i < items.length; i++) {
      var f = items[i];
      var key = String(f.symbol);
      // hasOwnProperty rather than a bare lookup: these keys arrive from the
      // database and 'constructor' is a key on every object literal's chain.
      if (!Object.prototype.hasOwnProperty.call(bySymbol, key)) {
        bySymbol[key] = {
          symbol: f.symbol,
          companyName: f.companyName,
          newest: f.disseminatedAt,
          hasResults: false,
          figures: 0,
          claims: []
        };
        order.push(key);
      }
      var entry = bySymbol[key];
      if (f.enrichment && f.enrichment.results) entry.hasResults = true;
      if (String(f.disseminatedAt) > String(entry.newest)) {
        entry.newest = f.disseminatedAt;
      }
      var claims = (f.enrichment && f.enrichment.claims) || [];
      for (var c = 0; c < claims.length; c++) {
        // THE CLAIM TRAVELS WITH ITS FILING, and that is not bookkeeping. The
        // card's Source link, tier badge and category all belong to the
        // document the LEDE was matched against; pointing them at the
        // company's newest filing instead would put a checkable sentence above
        // a link to a different document.
        entry.claims.push({ claim: claims[c], filing: f });
        if (BRIEF_DIGIT.test(String(claims[c].text))) entry.figures += 1;
      }
    }

    var out = [];
    for (var k = 0; k < order.length; k++) {
      var candidate = bySymbol[order[k]];
      // A company whose every claim is an echo is not a candidate: an earlier
      // card in this same response already stated those facts for it.
      if (briefLede(candidate) === null) continue;
      out.push(candidate);
    }
    return out;
  }

  /** The claim a card leads with: the first this company said that is not an echo. */
  function briefLede(entry) {
    for (var i = 0; i < entry.claims.length; i++) {
      if (entry.claims[i].claim.echo !== true) return entry.claims[i];
    }
    return null;
  }

  /**
   * A total order over candidates, from countable properties only.
   *
   * THE LAST KEY IS NOT COSMETIC. The page repaints every four seconds, and
   * two candidates equal on every other key would otherwise be free to swap
   * places under a reader's thumb — the same class of bug the topic-mix bar's
   * name tie-break already fixed once. Sorted on a copy, so the caller's array
   * is the array it passed in.
   */
  function orderBrief(candidates) {
    return candidates.slice().sort(function (a, b) {
      if (a.hasResults !== b.hasResults) return a.hasResults ? -1 : 1;
      if (a.figures !== b.figures) return b.figures - a.figures;
      if (a.claims.length !== b.claims.length) return b.claims.length - a.claims.length;
      if (a.newest !== b.newest) return a.newest < b.newest ? 1 : -1;
      return a.symbol < b.symbol ? -1 : 1;
    });
  }

  /** Ticker, company name, and when the document that carries the lede landed. */
  function briefIdent(entry, lede) {
    var ident = document.createElement('div');
    ident.className = 'bident';
    ident.setAttribute('data-ui', 'brief-ident');

    var sym = document.createElement('button');
    sym.type = 'button';
    sym.className = 'bsym';
    sym.textContent = entry.symbol;
    sym.title = 'All filings from ' + entry.symbol;
    sym.onclick = (function (symbol) {
      return function () { openCompany(symbol); };
    })(entry.symbol);
    ident.appendChild(sym);

    var meta = document.createElement('div');
    meta.className = 'bmeta';
    var name = document.createElement('span');
    name.className = 'bname';
    name.textContent = entry.companyName;
    meta.appendChild(name);

    // THE SERVER'S IST STRING, PRINTED WHOLE. The design's mock shows the time
    // of day alone; getting there from this string means slicing characters
    // out of a format this file does not own, and the page's rule is that no
    // timestamp is formatted in the browser at all. A wrong time that looks
    // right is the most repeated bug in this codebase.
    var when = document.createElement('span');
    when.className = 'bwhen';
    when.textContent = lede.filing.disseminatedAtIst + ' IST';
    meta.appendChild(when);
    ident.appendChild(meta);
    return ident;
  }

  /**
   * The claims under the lede, or null.
   *
   * NULL RATHER THAN AN EMPTY LIST, so a company with one claim has no empty
   * element in its card. "Nothing was found" and "nothing was looked for" are
   * different facts and an empty ul renders them the same.
   *
   * An echo is skipped for the LEDE and kept here, which is the rule
   * insightLines() already applies on the feed card: the claim is real
   * evidence for its own filing, it just does not get to be the headline
   * twice.
   */
  function briefRest(entry, lede) {
    var list = null;
    var shown = 0;
    for (var i = 0; i < entry.claims.length && shown < BRIEF_REST_CLAIMS; i++) {
      if (entry.claims[i] === lede) continue;
      if (list === null) {
        list = document.createElement('ul');
        list.className = 'brest';
        list.setAttribute('data-ui', 'brief-rest');
      }
      var li = document.createElement('li');
      writeClaim(li, entry.claims[i].claim.text);
      list.appendChild(li);
      shown += 1;
    }
    return list;
  }

  /**
   * What this card is not showing, and where the rest of it is.
   *
   * NEVER AN IN-CARD EXPANDER, unlike the feed card's. A card that grows is a
   * card whose height stops being one viewport, and scroll-snap on a container
   * of uneven children lands between cards.
   */
  function briefMore(symbol, count) {
    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'bmore';
    more.textContent = '+ ' + groupInt(count) + ' more from ' + symbol;
    more.onclick = (function (sym) {
      return function () { openCompany(sym); };
    })(symbol);
    return more;
  }

  /**
   * The topic dot, or nothing at all.
   *
   * DELIBERATELY DIVERGES FROM renderTopics(), which files a null topic under
   * 'other' so the bar's segments still sum to the claim count. A single card
   * has no sum to preserve, and about one claim in six carries no topic — all
   * of them on the newest day, because the classifier's backfill has not
   * reached it yet. Absence is the honest render of "not yet classified";
   * "Everything else" is a verdict nobody made.
   */
  function briefTopic(topic) {
    if (topic === null || topic === undefined) return null;
    var node = document.createElement('button');
    node.type = 'button';
    node.className = 'btopic';
    node.setAttribute('data-ui', 'brief-topic');
    node.setAttribute('data-topic', topic);
    var dot = document.createElement('span');
    dot.className = 'mixdot t-' + topic;
    node.appendChild(dot);
    var label = document.createElement('span');
    label.textContent = describe(TOPIC_LABEL, topic);
    node.appendChild(label);
    // The board's drill-in, without the board: the same topic chip the feed
    // already has, set from the card that raised the question.
    node.onclick = (function (name) {
      return function () {
        state.topic = name;
        state.offset = 0;
        syncTopics();
        showView('feed');
        refresh(true);
      };
    })(topic);
    return node;
  }

  /** What a reader sends to somebody: the claims, without our layout. */
  function briefCopy(entry) {
    var texts = [];
    for (var i = 0; i < entry.claims.length; i++) {
      texts.push(entry.claims[i].claim.text);
    }
    var copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy';
    copy.textContent = 'Copy';
    copy.onclick = (function (text, button) {
      return function () {
        // Guarded: the clipboard API is absent on an insecure origin, and a
        // dashboard served over plain http to a colleague must not throw.
        if (!navigator.clipboard) { button.textContent = 'no clipboard'; return; }
        navigator.clipboard.writeText(text).then(function () {
          button.textContent = 'Copied';
          window.setTimeout(function () { button.textContent = 'Copy'; }, 1500);
        }, function () { button.textContent = 'failed'; });
      };
    })(entry.symbol + ': ' + texts.join('\\n' + entry.symbol + ': '), copy);
    return copy;
  }

  /** Tier, category, Copy and the document itself. Every control a 44px target. */
  function briefFoot(entry, lede) {
    var f = lede.filing;
    var foot = document.createElement('footer');
    foot.className = 'bfoot';
    foot.setAttribute('data-ui', 'brief-foot');

    var tier = document.createElement('span');
    tier.className = 'tier tier-' + f.confidenceTier;
    tier.textContent = f.confidenceTierLabel;
    tier.title = describe(TIER_TITLE, f.confidenceTier);
    foot.appendChild(tier);

    var cat = document.createElement('span');
    cat.className = 'bcat';
    cat.textContent = f.category;
    // The only part of the foot allowed to truncate, so the whole of it has to
    // stay reachable somewhere.
    cat.title = f.category;
    foot.appendChild(cat);

    var spacer = document.createElement('span');
    spacer.className = 'grow';
    foot.appendChild(spacer);
    foot.appendChild(briefCopy(entry));

    // No Source button when the URL fails the scheme check. Existing
    // behaviour, unchanged: attachmentUrl comes from NSE.
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
    return foot;
  }

  /** One company's day, one viewport tall. */
  function briefCard(entry, index, total) {
    var lede = briefLede(entry);
    var card = document.createElement('article');
    card.className = 'bcard';
    card.setAttribute('data-ui', 'brief-card');
    // TWO STABLE IDENTITIES FOR A NODE THAT IS REBUILT ON A POLL. The symbol
    // names the company and the seqId names the document the lede came out of;
    // "the third card" names a different card after any repaint that changes
    // the window, which the sharp-edges list already records as a trap.
    card.setAttribute('data-symbol', entry.symbol);
    card.setAttribute('data-seq', String(lede.filing.seqId));
    // Read by the rail's observer. Kept on the node rather than in a closure so
    // a card rebuilt out of order still reports where it is.
    card.setAttribute('data-index', String(index));
    card.setAttribute('role', 'group');
    card.setAttribute(
      'aria-label',
      'Card ' + (index + 1) + ' of ' + total + ', ' + entry.symbol
    );
    card.tabIndex = -1;

    card.appendChild(briefIdent(entry, lede));

    var lead = document.createElement('p');
    lead.className = 'blede';
    lead.setAttribute('data-ui', 'brief-lede');
    // THE ONE PATH FOR EXCHANGE TEXT. writeClaim builds text nodes and marks
    // the figures the document printed; it computes, converts and compares
    // nothing.
    writeClaim(lead, lede.claim.text);
    card.appendChild(lead);

    var rest = briefRest(entry, lede);
    if (rest !== null) card.appendChild(rest);

    var over = entry.claims.length - 1 - BRIEF_REST_CLAIMS;
    if (over > 0) card.appendChild(briefMore(entry.symbol, over));

    var topic = briefTopic(lede.claim.topic);
    if (topic !== null) card.appendChild(topic);

    card.appendChild(briefFoot(entry, lede));
    return card;
  }

  /** One segment per card, or no rail at all. */
  function renderBriefRail(count) {
    var rail = el('brief-rail');
    if (!rail) return;
    rail.textContent = '';
    rail.hidden = count < BRIEF_MIN_CARDS;
    if (rail.hidden) return;
    for (var i = 0; i < count; i++) {
      var seg = document.createElement('span');
      seg.className = 'brailseg';
      seg.setAttribute('data-ui', 'brief-rail-seg');
      rail.appendChild(seg);
    }
  }

  /** Fills the rail up to the card the reader is on. */
  function fillBriefRail(at) {
    var rail = el('brief-rail');
    if (!rail) return;
    var segs = rail.childNodes;
    for (var i = 0; i < segs.length; i++) {
      segs[i].className = 'brailseg' + (i <= at ? ' on' : '');
    }
  }

  var briefState = { signature: '', observer: null };

  /**
   * THE RAIL IS DERIVED FROM SCROLL, NOT FROM A COUNTER. A counter incremented
   * on each swipe drifts the moment a reader flicks past two cards at once, and
   * a rail that disagrees with the screen is worse than no rail.
   */
  function observeBrief(deck) {
    if (briefState.observer !== null) {
      briefState.observer.disconnect();
      briefState.observer = null;
    }
    // Guarded rather than assumed. A browser without IntersectionObserver
    // still gets every card; it gets a rail that does not move. Throwing here
    // would take the page down for a progress bar.
    if (typeof window.IntersectionObserver !== 'function') return;
    var observer = new window.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue;
        fillBriefRail(Number(entries[i].target.getAttribute('data-index')));
      }
    }, { root: deck, threshold: 0.6 });
    var cards = deck.querySelectorAll('[data-ui="brief-card"]');
    for (var c = 0; c < cards.length; c++) observer.observe(cards[c]);
    briefState.observer = observer;
  }

  /**
   * WHICH WAY THIS DECK PAGES, ASKED OF THE STYLESHEET.
   *
   * The phone deck is a row that snaps on x and the desktop deck is a column
   * that snaps on y; the media query that decides is in the stylesheet, and
   * this reads its answer off the resolved style rather than re-deciding it
   * with a width the script would then have to keep in step. One breakpoint,
   * in one place.
   *
   * NOT MEASURED FROM scrollWidth. A deck of one card overflows on neither
   * axis, so a measurement would call it vertical and the tap zones would go
   * missing on exactly the deck where a reader most needs to be told there is
   * nothing more.
   */
  function deckPagesAcross(deck) {
    var snap = window.getComputedStyle(deck).scrollSnapType || '';
    return snap.indexOf('x') === 0;
  }

  /** Where a card starts along the axis the deck pages on. */
  function cardStart(card, across) {
    return across ? card.offsetLeft : card.offsetTop;
  }

  /**
   * One card per press, per tap, per click.
   *
   * WITHOUT THIS A KEYBOARD READER CANNOT MOVE AT ALL: scroll-snap-type
   * mandatory pulls the 40px an arrow key scrolls straight back to the card it
   * started on. Compared against the card's own offset rather than counted,
   * for the reason the rail is: the deck's scroll position is the truth about
   * where a reader is, and anything else is a second copy of it that can be
   * wrong.
   *
   * ONE STEPPER FOR BOTH AXES. The tap zones, the pager and the four arrow
   * keys all arrive here, and the only thing the axis changes is which offset
   * is read. A second stepper would be a second definition of 'the next card'.
   */
  function briefStep(deck, forward) {
    var cards = deck.getElementsByClassName('bcard');
    var across = deckPagesAcross(deck);
    var at = across ? deck.scrollLeft : deck.scrollTop;
    var target = null;
    if (forward) {
      for (var i = 0; i < cards.length; i++) {
        if (cardStart(cards[i], across) > at + 4) { target = cards[i]; break; }
      }
    } else {
      for (var j = cards.length - 1; j >= 0; j--) {
        if (cardStart(cards[j], across) < at - 4) { target = cards[j]; break; }
      }
    }
    if (target === null) return;
    // 'nearest' on the cross axis, so bringing a card into view never also
    // moves something else on the page. Smoothness is the stylesheet's, which
    // is how prefers-reduced-motion turns it into an instant jump without this
    // function knowing anything about it.
    target.scrollIntoView(
      across ? { block: 'nearest', inline: 'start' } : { block: 'start' }
    );
    // Focus follows the card, so a screen reader announces the one that
    // arrived rather than leaving the reader on the card they left.
    if (target.focus) target.focus({ preventScroll: true });
  }

  /**
   * Card 0: the day, at phone scale.
   *
   * Drawn from the summary the page already polls, so it costs no request. The
   * group bar is the same markup and the same colours the day bar uses — the
   * one summary on this page that covers every filing and always will, since a
   * category is required on all of them.
   */
  function renderBriefCover(d) {
    setText('brief-day', d.todayIstDay + ' IST');
    var bar = el('brief-mix');
    if (bar) {
      bar.textContent = '';
      var byGroup = d.todayByGroup || {};
      var groups = Object.keys(byGroup).sort(function (a, b) {
        // Ties broken by name, so a repaint cannot reorder two equal segments
        // and make the bar appear to move on its own.
        if (byGroup[b] !== byGroup[a]) return byGroup[b] - byGroup[a];
        return a < b ? -1 : 1;
      });
      for (var i = 0; i < groups.length; i++) {
        if (byGroup[groups[i]] === 0) continue;
        var seg = document.createElement('div');
        seg.className = 'mixseg g-' + groups[i];
        seg.style.flexGrow = String(byGroup[groups[i]]);
        seg.title = groups[i] + ': ' + byGroup[groups[i]];
        bar.appendChild(seg);
      }
    }
    setText(
      'brief-cover-line',
      d.todayCount === 0
        ? 'No filings yet today. The deck below is drawn from the window the cover states.'
        : groupInt(d.todayCount) + ' filings arrived today; ' +
            groupInt(d.todayVerified) + ' carry something a document verified.'
    );
  }

  /** What the deck holds, as one string, so a repaint that changed nothing costs nothing. */
  function briefSignature(cards) {
    var parts = [];
    for (var i = 0; i < cards.length; i++) {
      parts.push(cards[i].symbol + ':' + briefLede(cards[i]).filing.seqId);
    }
    return parts.join('|');
  }

  /**
   * The deck.
   *
   * REBUILT ONLY WHEN IT ACTUALLY CHANGED. The page repaints every four
   * seconds; replacing twelve full-viewport cards under a reader's thumb costs
   * them their scroll position and re-registers every observer, for a deck that
   * is usually identical to the one already on screen. The counts above the
   * cards are cheap and are written every time.
   */
  function renderBrief(items, meta) {
    var deck = el('brief-deck');
    var empty = el('brief-empty');
    if (!deck || !empty) return;

    var candidates = orderBrief(briefCandidates(items));
    var seen = meta && meta.returned ? meta.returned : items.length;

    if (candidates.length === 0) {
      // NOT AN EMPTY DECK. "Nothing was found" and "nothing was looked for"
      // are different facts, and the real N is what tells them apart.
      setText(
        'brief-empty',
        'Nothing in the last ' + groupInt(seen) +
          ' filings carried a claim matched against its source document. Here is the feed.'
      );
      empty.hidden = false;
      deck.hidden = true;
      briefState.signature = '';
      renderBriefRail(0);
      return;
    }
    empty.hidden = true;
    deck.hidden = false;

    var shown = candidates.slice(0, BRIEF_MAX_CARDS);
    var rest = candidates.length - shown.length;
    setText(
      'brief-cover-rule',
      'Drawn from the ' + groupInt(seen) + ' most recent verified filings, from ' +
        groupInt(candidates.length) + ' companies. ' + BRIEF_RULE
    );
    setText(
      'brief-end-line',
      rest === 0
        ? groupInt(shown.length) + ' of the ' + groupInt(candidates.length) +
            ' companies in this window said something a document verified, and every one of them is in this deck.'
        : groupInt(shown.length) + ' of the ' + groupInt(candidates.length) +
            ' companies in this window said something a document verified. The rest are in the feed: ' +
            groupInt(rest) + ' more.'
    );

    var signature = briefSignature(shown);
    if (signature === briefState.signature) return;
    briefState.signature = signature;

    var old = deck.querySelectorAll('[data-ui="brief-card"]');
    for (var i = 0; i < old.length; i++) deck.removeChild(old[i]);
    var end = el('brief-end');
    for (var j = 0; j < shown.length; j++) {
      deck.insertBefore(briefCard(shown[j], j, shown.length), end);
    }
    renderBriefRail(shown.length);
    fillBriefRail(0);
    observeBrief(deck);
    // The deck was just rebuilt, so its scroll height changed and the pager's
    // ends moved with it.
    syncBriefPager();
  }

  /**
   * THE PAGER'S STATE COMES FROM THE SCROLL POSITION, for the reason the rail's
   * does: the deck's scrollTop is the truth about where a reader is, and a
   * counter beside it is a second copy that can be wrong.
   *
   * NOT FROM THE RAIL. The rail indexes COMPANY cards; the deck also holds the
   * cover and the end card, so a rail index of 0 is the second card of the deck
   * and the last segment is not the last card. The two ends this asks about are
   * the deck's, which is what the buttons move.
   */
  function syncBriefPager() {
    var deck = el('brief-deck');
    var prev = el('brief-prev');
    var next = el('brief-next');
    if (!deck || !prev || !next) return;
    var across = deckPagesAcross(deck);
    var at = across ? deck.scrollLeft : deck.scrollTop;
    var span = across ? deck.clientWidth : deck.clientHeight;
    var total = across ? deck.scrollWidth : deck.scrollHeight;
    prev.disabled = at <= 1;
    // A pixel of tolerance: a snapped offset plus the deck's own span lands a
    // fraction short of the total on a fractional-density display, and a Next
    // that stays live on the last card is the page claiming a card it does not
    // have.
    next.disabled = at + span >= total - 2;
  }

  function briefPage(forward) {
    var deck = el('brief-deck');
    if (!deck) return;
    briefStep(deck, forward);
    // The scroll is smooth, so the position this reads is the one BEFORE it
    // lands. The deck's own scroll handler below is what settles the buttons;
    // this call is only so a click at an end disables its button immediately.
    syncBriefPager();
  }

  el('brief-prev').addEventListener('click', function () { briefPage(false); });
  el('brief-next').addEventListener('click', function () { briefPage(true); });
  el('brief-deck').addEventListener('scroll', syncBriefPager);

  /**
   * THE TAP ZONES, AND THEY ARE THE PHONE'S SECOND GESTURE.
   *
   * A swipe moves a card and so does a tap on the third of the screen nearest
   * the direction of travel - right for the next card, left for the previous,
   * the way every story deck a reader has met behaves. The middle third does
   * NOTHING on purpose: it is where the claim is, it is where a reader's thumb
   * rests while reading, and a deck that advances under a resting thumb has
   * taken the card away mid-sentence.
   *
   * STILL NO AUTOPLAY. Every one of these is a thing the reader did.
   *
   * ACROSS ONLY. Above 900px the pager is the pointer's affordance and a click
   * on the right of a card would fight the reader selecting the text on it.
   */
  var BRIEF_TAP_ZONE = 1 / 3;
  el('brief-deck').addEventListener('click', function (event) {
    var deck = el('brief-deck');
    if (!deckPagesAcross(deck)) return;
    // EVERY CONTROL ON A CARD STAYS A CONTROL. The ticker opens the company,
    // Copy copies, Source is the only link to the document the claim was
    // matched against, and the topic dot filters the feed - all of them inside
    // one of the two live thirds. A tap that reached one of them has already
    // been answered.
    if (event.target && event.target.closest &&
        event.target.closest('a, button, input, select, textarea, summary')) return;
    // A tap that finished a text selection is not a tap. Claim text is the
    // point of this view and a reader who highlighted a figure to copy it must
    // not lose the card doing so.
    var selection = window.getSelection ? window.getSelection() : null;
    if (selection && String(selection).length > 0) return;
    var box = deck.getBoundingClientRect();
    if (box.width <= 0) return;
    var across = (event.clientX - box.left) / box.width;
    if (across >= 1 - BRIEF_TAP_ZONE) briefStep(deck, true);
    else if (across <= BRIEF_TAP_ZONE) briefStep(deck, false);
  });

  el('brief-deck').addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var key = event.key;
    // BOTH AXES, WHICHEVER WAY THE DECK IS LAID OUT. The keyboard is the one
    // way in that is not a gesture, and a reader on a phone-width window with
    // a keyboard attached should not have to work out that this deck moved
    // sideways. 'briefStep' resolves the axis; these only say forward or back.
    if (key === 'ArrowDown' || key === 'ArrowRight' || key === 'PageDown' || key === ' ') {
      event.preventDefault();
      briefStep(el('brief-deck'), true);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft' || key === 'PageUp') {
      event.preventDefault();
      briefStep(el('brief-deck'), false);
    }
  });

  // The one way out of the deck that is not a tab. The end card is where the
  // remainder is stated, so it is also where the route to the remainder goes.
  el('brief-to-feed').addEventListener('click', function () {
    showView('feed');
    refresh(true);
  });
`;
