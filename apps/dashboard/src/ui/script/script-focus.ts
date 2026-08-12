/**
 * The focus card: one filing, full size, with every claim and every span.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string
 * and concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so a name declared here is visible to every other
 * fragment and the order they are joined in is the order they execute in.
 *
 * IT RUNS AFTER `script-feed`, which is a dependency rather than a preference:
 * every claim this fragment puts on screen goes through that fragment's
 * `writeInsight`, and no other way. It runs after `script-share` and
 * `script-share-image` for the same kind of reason: the foot's two share
 * controls are `shareText` and `shareImageButton`, defined there.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the
 * composing template literal before a browser ever sees this, which is the
 * failure this file split exists to make less likely — a test asserts it.
 */
export const SCRIPT_FOCUS = `
  // ------------------------------------------------------- focus card ----
  //
  // WHAT THIS REPLACED, AND WHY. The card used to grow in place: '+ 6 more'
  // appended the remaining claims to the list and removed itself. Three things
  // were wrong with it. It pushed every other card in the grid row down, so
  // clicking one card reflowed the feed under the reader. It had to be
  // remembered in 'state.expanded' across the four-second repaint, which was
  // state kept only so a layout could survive a poll. And it still could not
  // show the thing a reader stops on a card to see — the sentence in the
  // document each claim was matched against, which lived only in the Admin
  // table's detail row, a different view for a different person.
  //
  // THE DIALOG'S CONTENT IS A SNAPSHOT, taken when it opens, and it does not
  // follow the poll. That is deliberate: a filing's claims do not change, and a
  // panel whose text moved under somebody mid-sentence would be worse than one
  // that is four seconds old.

  // Who to give focus back to. A dialog that closes and drops the reader at the
  // top of the document has lost their place in a feed of sixty cards.
  var focusReturn = null;

  // The two labels the quote's control swaps between. Written once so the
  // button that opens a quote and the test that watches it close again cannot
  // drift apart. The open label NAMES WHAT IT WILL SHOW rather than saying
  // 'more': a reader deciding whether to spend the tap is deciding whether they
  // want the sentence from the document, and 'more' does not tell them that.
  var SPAN_SHOW = 'Show source line';
  var SPAN_HIDE = 'Hide';

  /**
   * Every line the dialog shows, with the span each was matched against.
   *
   * NOT 'insightLines'. That one caps nothing but SKIPS ECHOES — a claim whose
   * fact an earlier card in the same response already stated — because the feed
   * is a scan and a repeated line there is noise. This view is the opposite: it
   * is one filing, opened on purpose, and 'everything this filing said' cannot
   * quietly omit a sentence the document contains. It also carries the span,
   * which the feed's version has no use for.
   */
  function focusLines(e) {
    var lines = [];
    var claims = e.claims || [];
    for (var i = 0; i < claims.length; i++) {
      lines.push({
        text: claims[i].text,
        direction: claims[i].direction || '',
        evidence: claims[i].directionEvidence || '',
        span: claims[i].span || '',
        periodSpan: claims[i].periodSpan || ''
      });
    }
    return lines;
  }

  /** The span under its claim, as a muted quote. Never merged with a neighbour. */
  function writeSpan(parent, label, text) {
    var box = document.createElement('div');
    box.className = 'focusspan';
    box.setAttribute('data-ui', 'focus-span');
    var name = document.createElement('span');
    name.className = 'focusspanlabel';
    name.textContent = label;
    box.appendChild(name);
    // The quotation marks are added as TEXT around text, never as markup, and
    // the whitespace is collapsed the same way the detail row collapses it: a
    // span lifted out of a PDF carries the line breaks of the page it was set
    // on, and those are not part of the sentence.
    box.appendChild(
      document.createTextNode('"' + String(text).replace(/\\s+/g, ' ').trim() + '"')
    );
    parent.appendChild(box);
  }

  /**
   * One claim's quotes, and the control that reveals them.
   *
   * WHY THEY START CLOSED. The dialog is 'everything this filing said', and it
   * was drawing every claim with its grey quote block underneath — so a filing
   * with eight claims opened as sixteen blocks of text, of which the eight a
   * reader came for were every other one. The card above it is scannable and
   * the dialog was not.
   *
   * THE EVIDENCE IS NOT OPTIONAL AND IT IS NOT GONE. It is one tap per claim,
   * beside the claim, behind a control that says what it will show. A claim
   * whose quote a reader cannot reach would fail the rule this whole product is
   * built on; a claim whose quote is folded until asked for does not.
   *
   * NOT REMEMBERED ACROSS A CLOSE, on purpose. 'closeFocus' empties the body,
   * so the next open starts folded again. Keeping the reveal would be state
   * held only so a layout could survive the dialog, which is the mistake the
   * '+ 6 more' expander this dialog replaced was making.
   */
  function writeSpans(item, line) {
    var quotes = document.createElement('div');
    quotes.className = 'focusspans';
    quotes.setAttribute('data-ui', 'focus-spans');
    quotes.hidden = true;

    writeSpan(quotes, 'matched in the document', line.span);
    // Shown BESIDE its sentence rather than merged into it. They are two quotes
    // from two places in the document, and running them together would forge a
    // sentence. Both live behind the one control: they are the same answer to
    // the same question, and two buttons on one claim is a menu.
    if (line.periodSpan) {
      writeSpan(quotes, 'period from', line.periodSpan);
    }

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'spantoggle';
    toggle.setAttribute('data-ui', 'focus-span-toggle');
    // aria-expanded is what makes this a disclosure rather than a button that
    // happens to change some text: it is how a screen reader says 'collapsed'
    // BEFORE the reader presses it, and it moves with the label or the two
    // describe different pages.
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = SPAN_SHOW;
    toggle.onclick = (function (box, button) {
      return function () {
        var opening = box.hidden;
        box.hidden = !opening;
        button.textContent = opening ? SPAN_HIDE : SPAN_SHOW;
        button.setAttribute('aria-expanded', opening ? 'true' : 'false');
      };
    })(quotes, toggle);

    // The control first, then what it controls, so a keyboard reader tabs onto
    // the button before reaching the text it just opened.
    item.appendChild(toggle);
    item.appendChild(quotes);
  }

  /** Builds the dialog's body for one filing. Everything through textContent. */
  function fillFocusBody(f, e, lines) {
    var body = el('focus-body');
    clear(body);

    // THE RESULTS LINE LEADS, for the reason the card gives: on the day a
    // company reports, its numbers ARE the event.
    if (e.resultsLine) {
      var results = document.createElement('div');
      results.className = 'focusresults';
      results.setAttribute('data-ui', 'focus-results');
      results.textContent = e.resultsLine;
      body.appendChild(results);
    }

    if (lines.length === 0) {
      // The exchange's own sentence. Not a claim and never dressed as one.
      var stated = document.createElement('p');
      stated.className = 'focusstated';
      stated.setAttribute('data-ui', 'focus-stated');
      stated.textContent = f.outcome;
      body.appendChild(stated);
      return;
    }

    var list = document.createElement('ul');
    list.className = 'insights';
    list.setAttribute('data-ui', 'focus-claims');

    for (var i = 0; i < lines.length; i++) {
      var item = document.createElement('li');
      // The SAME writer the feed uses: the movement mark, then the claim with
      // its figures marked. A second renderer would be a second place for
      // exchange text to reach the DOM.
      writeInsight(item, lines[i]);

      if (lines[i].span) {
        writeSpans(item, lines[i]);
      } else {
        // Cannot happen on a verified claim, so it is stated rather than left
        // as a gap: "no span was stored" and "no span was looked for" are
        // different facts.
        var none = document.createElement('div');
        none.className = 'focusnospan';
        none.textContent = 'No source sentence is stored for this line.';
        item.appendChild(none);
      }

      list.appendChild(item);
    }

    body.appendChild(list);
  }

  /** The tier, the category, and the two things a reader DOES with a filing. */
  function fillFocusFoot(f, lines) {
    var foot = el('focus-foot');
    clear(foot);

    var tier = document.createElement('span');
    tier.className = 'tier tier-' + f.confidenceTier;
    tier.setAttribute('data-ui', 'focus-tier');
    tier.textContent = f.confidenceTierLabel;
    tier.title = describe(TIER_TITLE, f.confidenceTier);
    foot.appendChild(tier);

    var cat = document.createElement('span');
    cat.className = 'cardcat';
    cat.setAttribute('data-ui', 'focus-category');
    cat.textContent = f.category;
    cat.title = f.category;
    foot.appendChild(cat);

    var star = watchButton(f.symbol);
    if (star) foot.appendChild(star);

    // THE TWO WAYS ONE FILING LEAVES THIS PAGE, and they are both here rather
    // than on the card because this foot wraps and the card's does not — that
    // one is a single line whose two controls are already sized never to shrink
    // (see 'page-style.ts'), and a third would push the category out of it.
    // This is also the surface where a reader has decided they care.
    if (lines.length > 0) {
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'copy';
      copy.setAttribute('data-ui', 'focus-copy');
      copy.textContent = 'Copy';
      // The same string the card copies, from the same function. What belongs
      // in a message is what the company said, not our layout — and not the
      // quoted spans either, however many of them the reader has opened above:
      // those are the evidence, they are one tap away here, and eight sentences
      // lifted out of a PDF is not a message. See 'script-share.ts'.
      copy.onclick = (function (payload, button) {
        return function () {
          if (!navigator.clipboard) { button.textContent = 'no clipboard'; return; }
          navigator.clipboard.writeText(payload).then(function () {
            button.textContent = 'Copied';
            window.setTimeout(function () { button.textContent = 'Copy'; }, 1500);
          }, function () { button.textContent = 'failed'; });
        };
      })(shareText(f), copy);
      foot.appendChild(copy);

      foot.appendChild(shareImageButton(f));
    }

    var href = safeHref(f.attachmentUrl);
    if (href) {
      var link = document.createElement('a');
      link.href = href;
      link.rel = 'noopener noreferrer nofollow';
      link.target = '_blank';
      link.className = 'srclink';
      link.setAttribute('data-ui', 'focus-source');
      link.textContent = 'Source';
      foot.appendChild(link);
    }
  }

  function openFocus(f) {
    var e = f.enrichment || {};
    var lines = focusLines(e);

    setText('focus-symbol', f.symbol);
    setText('focus-name', f.companyName);
    var when = el('focus-when');
    when.textContent = relativeTime(f.disseminatedAt);
    when.title = f.disseminatedAtIst + ' IST';

    fillFocusBody(f, e, lines);
    fillFocusFoot(f, lines);

    // Remembered BEFORE anything takes focus, or the thing we restore to is the
    // close button we are about to focus.
    focusReturn = document.activeElement;

    var back = el('focus-back');
    back.hidden = false;
    // The class lands on the NEXT frame, not this one. A transition needs the
    // element to have been laid out in its starting state first; setting hidden
    // and .open in the same tick makes the browser skip straight to the end and
    // the dialog appears with no animation at all.
    window.requestAnimationFrame(function () { back.className = 'focusback open'; });

    el('focus-close').focus();
  }

  function closeFocus() {
    var back = el('focus-back');
    if (back.hidden) return;
    back.className = 'focusback';
    back.hidden = true;
    // Emptied rather than left in the DOM. The dialog holds one filing's claims
    // and their quoted spans, and a hidden node keeps every one of them in the
    // document — invisible, and still there on a shared screen.
    clear(el('focus-body'));
    clear(el('focus-foot'));

    if (focusReturn && typeof focusReturn.focus === 'function') {
      focusReturn.focus();
    }
    focusReturn = null;
  }

  /**
   * Keeps Tab inside the dialog.
   *
   * WITHOUT THIS, aria-modal IS A CLAIM THE PAGE DOES NOT HONOUR: a keyboard
   * reader tabs out of the panel into a feed the attribute told their software
   * was inert, and nothing looks wrong on screen while they do it.
   */
  function trapFocus(event) {
    var back = el('focus-back');
    if (back.hidden || event.key !== 'Tab') return;

    var stops = back.querySelectorAll(
      'button, a[href], input, [tabindex]:not([tabindex="-1"])'
    );
    if (stops.length === 0) return;

    var first = stops[0];
    var last = stops[stops.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  el('focus-close').addEventListener('click', closeFocus);
  el('focus-back').addEventListener('click', function (event) {
    // The backdrop only. A click that started inside the panel must not close
    // it, which is what selecting a span to copy looks like.
    if (event.target === el('focus-back')) closeFocus();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeFocus();
    trapFocus(event);
  });
`;
