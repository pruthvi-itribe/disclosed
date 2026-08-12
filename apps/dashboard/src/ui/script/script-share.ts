/**
 * One filing, written as a message somebody sends.
 *
 * A FRAGMENT, NOT A MODULE. This is client-side ES5 source held as a string and
 * concatenated into one IIFE by `page-script.ts`; the pieces share that
 * function's scope, so `shareText` is visible to every fragment joined after
 * this one — which is how the feed card, the company page's cards and the focus
 * card all copy the same thing.
 *
 * IT RUNS BEFORE `script-feed` and `script-focus`, which is a dependency rather
 * than a preference: both of their feet MOUNT the two controls defined at the
 * bottom of this file. They used to build a copy of each instead, and the
 * copies had already drifted — see `shareCopyButton`.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW. Both are consumed by the composing
 * template literal before a browser ever sees this — `script-fragments.spec.ts`
 * asserts it.
 */
export const SCRIPT_SHARE = `
  // ------------------------------------------------------ share text ----
  //
  // WHAT THIS REPLACED, AND WHY. Copy used to produce one line per claim, each
  // prefixed with the ticker:
  //
  //   SKIPPER: Revenue was 1,204 crore
  //   SKIPPER: Profit after tax was 61 crore
  //
  // That is a log line, and where it actually lands is a WhatsApp thread. It
  // repeats the ticker on every line, never says which company that ticker is,
  // never says what was filed or when, and arrives in a chat as an unattributed
  // block of sentences somebody has to be told the provenance of separately.
  //
  // WHAT THE FORMAT IS. WhatsApp renders *asterisks* as bold and _underscores_
  // as italic, and has no list markup at all, so a bullet is the two characters
  // '- '. The shape:
  //
  //   *Skipper Limited (SKIPPER)*
  //   Financial Results · 9 Aug 2026, 9:15 am IST
  //
  //   - Revenue was 1,204 crore
  //   - Profit after tax was 61 crore
  //
  //   Revenue 1,204 cr · PAT 61 cr
  //
  //   _AI-extracted. Every line verified against the company's filing._
  //   Disclosed
  //
  // WHAT IT REFUSES TO ADD, and this is the whole of it: nothing. Every claim
  // goes in as stored, character for character, because a claim is a span that
  // was matched against the document and a message that reworded one would be
  // publishing something no filing printed. No emoji. No computed change, no
  // margin, no growth rate. No direction word that the filing did not print —
  // the feed draws a movement mark beside a claim and that mark is OURS, a
  // rendering of a stored direction, so it does not travel. And no source
  // quote: the spans are the evidence and they are one tap away in the app, but
  // a filing with eight claims carries eight quoted sentences from a PDF and
  // that is a wall of text in a chat window, not a message.
  //
  // THE TIMESTAMP IS THE SERVER'S OWN STRING, AND IT IS THE READABLE ONE.
  // 'disseminatedAtIstHuman' arrives spelled '9 Aug 2026, 9:15 am', which is
  // what a person reads in a chat window; the fixed-width sibling stays where
  // it belongs, on the card's tooltip and in a diagnostic. This fragment
  // appends the three letters 'IST' and does no arithmetic whatsoever — a
  // browser on any other zone would be wrong by five and a half hours and look
  // completely normal doing it.

  // The product's name, as the message signs itself.
  //
  // A LITERAL RATHER THAN AN IMPORT, because there is nothing here to import
  // into: this file is a string, and an interpolation reaching out to 'brand.ts'
  // is the one construct that may not appear in it — the compiler evaluates it
  // and the browser never sees a fragment that carried one. So the name is
  // copied, and copied means it can drift, which is exactly the situation
  // 'logo.ts' is in with the favicon's four hex literals and is answered the
  // same way: 'script-share.spec.ts' asserts this equals BRAND.
  var SHARE_BRAND = 'Disclosed';

  // The line above the name. Italic in the message, which is why it carries no
  // underscore of its own.
  //
  // WHO DID WHICH HALF, AND THE ORDER MATTERS. A model reads the document and
  // proposes the sentences; the pipeline then matches each one character for
  // character against a span of that document and drops what does not match.
  // So the model is named as the EXTRACTOR and never as the verifier — 'AI
  // verified' would be a claim about the machine that made the claim, which is
  // the one sentence this product cannot afford to print.
  var SHARE_TAIL = "AI-extracted. Every line verified against the company's filing.";

  /**
   * One filing as a message, from the payload and nothing else.
   *
   * PURE, AND TAKES THE FILING RATHER THAN THE RENDERED LINES. Both callers
   * already hold a list of lines, and neither list is the right one. The feed's
   * 'feedLines' SKIPS ECHOES — a claim whose fact an earlier card in the same
   * response already stated — which is a property of that response and not of
   * this document; somebody sending one filing to one person is sending what
   * the filing said. And 'feedLines' folds the results line in among the
   * claims, which is right for a card and wrong here, where it is a separate
   * paragraph. Reading 'f.enrichment' directly is one loop and leaves one
   * definition of what a shared filing contains.
   *
   * Tested in 'script-share.spec.ts', cut out of the served document.
   */
  function shareText(f) {
    var e = f.enrichment || {};
    var claims = e.claims || [];
    var out = [];

    // The company first and the ticker in the same breath: a message that opens
    // with a bare ticker is a message the reader has to decode before they can
    // decide whether they care.
    out.push('*' + f.companyName + ' (' + f.symbol + ')*');
    out.push(f.category + ' · ' + f.disseminatedAtIstHuman + ' IST');

    out.push('');
    for (var i = 0; i < claims.length; i++) {
      out.push('- ' + claims[i].text);
    }

    // Last of the content, not first as the card sets it. On a card the numbers
    // ARE the event and they lead; in a chat the claims are the sentences a
    // person reads and the figures are the thing they scroll back to.
    if (e.resultsLine) {
      out.push('');
      out.push(e.resultsLine);
    }

    out.push('');
    out.push('_' + SHARE_TAIL + '_');
    out.push(SHARE_BRAND);

    return out.join('\\n');
  }

  // What the control is for, now that it has no room to say so on its face.
  // 'Copy' was enough beside a word; a drawing has to name the alternative it
  // is not — the picture beside it.
  var SHARE_COPY_LABEL = 'Copy as text';

  /**
   * The control that puts the message on the clipboard.
   *
   * ONE DEFINITION, THREE FEET. The card, the company page's cards and the
   * dialog all mount this; they used to hold a copy of it each, and the copies
   * had already drifted once — the card's stopped propagation and the dialog's
   * did not, which is why the argument for that line is here rather than in
   * either caller. A click on a control inside a card must not also open the
   * card behind it.
   *
   * THE GUARD IS NOT DECORATION. 'navigator.clipboard' is absent on an insecure
   * origin, and a dashboard served over plain http to a colleague must say so
   * rather than throw.
   */
  function shareCopyButton(f, ui) {
    var button = iconButton(ICON_COPY, SHARE_COPY_LABEL, ui);
    // The same reason 'shareImageButton' carries one: a control with no words
    // on it reports by swapping a drawing, and a drawing is silent.
    button.setAttribute('aria-live', 'polite');
    button.onclick = (function (text) {
      return function (event) {
        event.stopPropagation();
        if (!navigator.clipboard) {
          iconSaid(button, ICON_FAIL, 'no clipboard');
          return;
        }
        navigator.clipboard.writeText(text).then(function () {
          iconSaid(button, ICON_DONE, 'Copied');
          window.setTimeout(function () { iconSaid(button, ICON_COPY, ''); }, 1500);
        }, function () { iconSaid(button, ICON_FAIL, 'failed'); });
      };
    })(shareText(f));
    return button;
  }

  /**
   * The document itself, which is the third thing a reader does with a filing.
   *
   * NULL WHEN THE URL FAILS THE SCHEME CHECK, and the caller draws nothing.
   * 'attachmentUrl' arrives from NSE; a 'javascript:' value in it would
   * otherwise become a click-to-execute link, which is the whole of why
   * 'safeHref' exists. Rendered as a real anchor and never as a button that
   * navigates: a link that cannot be middle-clicked or copied is not a link.
   */
  function shareSourceLink(f, ui) {
    var href = safeHref(f.attachmentUrl);
    if (!href) return null;
    var link = document.createElement('a');
    link.href = href;
    link.rel = 'noopener noreferrer nofollow';
    link.target = '_blank';
    link.className = 'iconbtn';
    link.setAttribute('data-ui', ui);
    link.setAttribute('aria-label', SOURCE_LABEL);
    link.title = SOURCE_LABEL;
    link.appendChild(iconSvg(ICON_SOURCE));
    return link;
  }
`;
