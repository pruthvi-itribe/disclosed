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
 * than a preference: both of their Copy buttons take their payload from here.
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
  //   Financial Results · 2026-08-09 09:15:00 IST
  //
  //   - Revenue was 1,204 crore
  //   - Profit after tax was 61 crore
  //
  //   Revenue 1,204 cr · PAT 61 cr
  //
  //   _Verified against the company's filing._
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
  // THE TIMESTAMP IS THE SERVER'S OWN STRING. 'disseminatedAtIst' arrives
  // formatted, and this fragment appends the three letters 'IST' to it and does
  // no arithmetic whatsoever — the same rule the card's tooltip follows. A
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
  var SHARE_TAIL = "Verified against the company's filing.";

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
    out.push(f.category + ' · ' + f.disseminatedAtIst + ' IST');

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
`;
