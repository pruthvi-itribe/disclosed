/**
 * The same filing, drawn as a picture, for the chats that carry images better
 * than they carry text.
 *
 * A FRAGMENT, NOT A MODULE — client-side ES5 held as a string and joined into
 * one IIFE by `page-script.ts`. It runs after `script-share`, whose `shareText`
 * it does not call but whose claims-selection rule it repeats deliberately (see
 * `shareBlocks`), and before `script-focus`, which mounts the button.
 *
 * NO BACKTICK AND NO `${` MAY APPEAR BELOW — `script-fragments.spec.ts` asserts
 * it.
 */
export const SCRIPT_SHARE_IMAGE = `
  // ----------------------------------------------------- share image ----
  //
  // WHY A CANVAS AND NOT A SCREENSHOT OF THE CARD. The card is a scan object:
  // 11px footers, a truncating category, a movement mark that means something
  // only next to the legend it has in the app, and two claims of however many
  // the filing carried. Cropped out of a browser it is illegible on a phone and
  // it is missing most of the document. This draws the filing instead — at a
  // size that reads at arm's length, with every part of it labelled.
  //
  // SELF-CONTAINED, LIKE EVERYTHING ELSE ON THIS PAGE. No web font, no image
  // request, no library. The type is the system stack the stylesheet already
  // uses, and the mark is the favicon this document is already carrying.
  //
  // NOTHING IS COMPUTED INTO THE PICTURE. The claims are drawn as stored, the
  // date is the server's IST string, and the only strings here that are ours
  // are the two labels and the footer. A canvas cannot execute what it is
  // handed — 'fillText' is not a parser — but that is not why this is safe;
  // it is safe because it adds nothing.

  // THE PALETTE, COPIED FROM 'page-style.ts'. An image is rendered outside the
  // document, where 'var(--bg)' resolves to nothing and every shape would come
  // out transparent black, so these are literals for the same reason the
  // favicon's are. Copied means they can drift, and that is answered the same
  // way: 'script-share.spec.ts' asserts each is still the stylesheet's.
  var SHARE_BG = '#0d1117';
  var SHARE_LINE = '#2a323d';
  var SHARE_INK = '#e6edf3';
  var SHARE_MUTED = '#8b949e';
  var SHARE_ACCENT = '#a78bfa';

  // The two stacks from ':root', minus one name. The stylesheet's sans begins
  // system-ui and includes "Segoe UI" behind it; a canvas font is CSS shorthand
  // in a string, a quoted family means a quote inside a quote, and system-ui
  // already resolves to Segoe UI on the only platform that has it. Nothing else
  // is dropped.
  var SHARE_SANS = 'system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';
  var SHARE_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  // 1080 wide because that is what a phone shows a shared image at, and the
  // height follows the content — a filing with one claim is not padded out to
  // fill a frame it did not need.
  var SHARE_W = 1080;
  var SHARE_PAD = 64;

  // HOW MANY CLAIMS THE PICTURE HOLDS BEFORE IT SAYS SO.
  //
  // WHAT THE COLLECTION HOLDS, swept 2026-08-12: 2,543 filings carrying at
  // least one claim, 10,297 claims between them. Claims per filing — 25.1%
  // carry one, 62.5% three or fewer, 77.5% six or fewer, 85.5% EIGHT OR FEWER,
  // and the longest carries twelve. Claim text — mean 67.3 characters, p50 65,
  // p90 103, p99 118, longest 120, so at the 29px this sets them a median claim
  // is one line of the 952px column and the longest is two.
  //
  // WHAT THAT COSTS IN PIXELS, measured by running the two functions below over
  // 110 live filings in a browser rather than by estimating from the type. At
  // this cap the canvas comes out 1080 x 560 at its shortest, 850 at the
  // median, 1176 at p90 and 1344 at its tallest — every one of them portrait,
  // and the tallest 1:1.24. Uncapped, the same 110 filings give the same median
  // and a tallest of 1558: the cap changes nothing for the 85.5% and takes 214
  // pixels off the tail, which is the shape of a good bound. Twelve is not
  // worth its own case, and a picture that ran to twelve claims would be a
  // thumbnail in the chat it was sent to.
  //
  // THE REMAINDER IS STATED, NOT SWALLOWED, which is what makes a cap
  // acceptable at all: the picture prints how many claims it did not draw.
  var SHARE_CLAIM_CAP = 8;

  var SHARE_IMAGE_LABEL = 'Copy as image';
  var SHARE_FOOTER = 'Every line verified against the source document.';

  // THE MARK, TAKEN FROM THE DOCUMENT RATHER THAN REDRAWN. 'logo.ts' already
  // holds the geometry once and this page is already carrying it: the favicon
  // is an inlined 'data:' SVG in the head, which is not a request and, unlike
  // the inline wordmark's SVG, is written in hex rather than in custom
  // properties — precisely because it has to survive being rendered outside a
  // document. That is this canvas's situation exactly. Re-plotting the D's arcs
  // in canvas calls would be a second copy of a drawing, and the two would
  // differ the first time either changed.
  //
  // DECODED AT LOAD, not at the click. A picture that has to wait for an image
  // before it can be written loses the user gesture Safari requires for a
  // clipboard write, and this one has no network to wait for.
  var shareMark = null;
  var shareMarkReady = false;
  (function () {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    var img = new Image();
    img.onload = function () { shareMarkReady = true; };
    shareMark = img;
    img.src = link.href;
  })();

  /** One string broken to fit a column, by measuring it. Words are never split. */
  function shareWrap(ctx, text, width) {
    var words = String(text).split(/\\s+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      if (words[i] === '') continue;
      var next = line === '' ? words[i] : line + ' ' + words[i];
      if (line !== '' && ctx.measureText(next).width > width) {
        lines.push(line);
        line = words[i];
      } else {
        line = next;
      }
    }
    if (line !== '') lines.push(line);
    return lines;
  }

  /**
   * The picture as a list of measured blocks. NOTHING IS DRAWN HERE.
   *
   * Planning and painting are separate because the canvas has to be sized
   * before anything can be put on it and the size is not knowable until every
   * claim has been wrapped — which needs a context to measure with. So this
   * measures on a throwaway context, and 'sharePaint' walks the result.
   *
   * THE CLAIMS ARE READ THE WAY 'shareText' READS THEM: straight off the
   * enrichment, echoes included, results line separate. A picture and a message
   * of the same filing that disagreed about what the filing said would be worse
   * than either of them being wrong on its own.
   */
  function shareBlocks(ctx, f) {
    var e = f.enrichment || {};
    var claims = e.claims || [];
    var width = SHARE_W - SHARE_PAD * 2;
    var blocks = [];

    function block(font, fill, text, lineHeight, gap) {
      ctx.font = font;
      blocks.push({
        font: font,
        fill: fill,
        lineHeight: lineHeight,
        gap: gap,
        lines: shareWrap(ctx, text, width)
      });
    }

    block('600 26px ' + SHARE_SANS, SHARE_ACCENT, f.symbol, 34, 40);
    block('700 44px ' + SHARE_SANS, SHARE_INK, f.companyName, 54, 16);
    block(
      '400 24px ' + SHARE_SANS,
      SHARE_MUTED,
      f.category + ' · ' + f.disseminatedAtIst + ' IST',
      32,
      16
    );

    var shown = claims.length < SHARE_CLAIM_CAP ? claims.length : SHARE_CLAIM_CAP;
    for (var i = 0; i < shown; i++) {
      block('400 29px ' + SHARE_SANS, SHARE_INK, '— ' + claims[i].text, 42, i === 0 ? 44 : 20);
    }
    // STATED, NOT SWALLOWED. A picture that quietly stopped at eight would look
    // like the whole filing, and 'the rest are in the app' is a fact a reader
    // can act on.
    if (claims.length > shown) {
      block(
        '400 24px ' + SHARE_SANS,
        SHARE_MUTED,
        '+ ' + (claims.length - shown) + ' more in the app',
        32,
        24
      );
    }

    if (e.resultsLine) {
      block('400 24px ' + SHARE_MONO, SHARE_ACCENT, e.resultsLine, 34, 36);
    }

    return blocks;
  }

  // The header above the blocks: top padding, the mark, and the rule under it.
  // And the footer below them: rule, one line, bottom padding. Both are fixed
  // whatever the filing says, so they are two numbers rather than two more
  // blocks with nothing in them.
  var SHARE_HEAD = 156;
  var SHARE_FOOT = 126;

  /** Where the blocks end, so the canvas can be made the height they need. */
  function shareHeight(blocks) {
    var y = SHARE_HEAD;
    for (var i = 0; i < blocks.length; i++) {
      y += blocks[i].gap + blocks[i].lines.length * blocks[i].lineHeight;
    }
    return y + SHARE_FOOT;
  }

  /** The blocks onto a canvas of the right size. */
  function sharePaint(blocks, height) {
    var canvas = document.createElement('canvas');
    canvas.width = SHARE_W;
    canvas.height = height;
    var ctx = canvas.getContext('2d');

    ctx.fillStyle = SHARE_BG;
    ctx.fillRect(0, 0, SHARE_W, height);

    // The mark, then the word beside it. 'textBaseline' stays alphabetic — the
    // default — so every y below is a baseline and the blocks stack by adding.
    if (shareMarkReady) ctx.drawImage(shareMark, SHARE_PAD, 56, 60, 60);
    ctx.fillStyle = SHARE_INK;
    ctx.font = '600 34px ' + SHARE_SANS;
    var word = SHARE_PAD + 78;
    ctx.fillText(SHARE_BRAND, word, 98);
    // The accent full stop, set after the word rather than derived from it:
    // 'brand.ts' holds where the colour falls, and this measures the word to
    // find the same place.
    ctx.fillStyle = SHARE_ACCENT;
    ctx.fillText('.', word + ctx.measureText(SHARE_BRAND).width, 98);

    shareRule(ctx, SHARE_HEAD);

    var y = SHARE_HEAD;
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      ctx.font = b.font;
      ctx.fillStyle = b.fill;
      y += b.gap;
      for (var line = 0; line < b.lines.length; line++) {
        y += b.lineHeight;
        ctx.fillText(b.lines[line], SHARE_PAD, y);
      }
    }

    shareRule(ctx, y + 46);
    ctx.font = '400 22px ' + SHARE_SANS;
    ctx.fillStyle = SHARE_MUTED;
    ctx.fillText(SHARE_FOOTER, SHARE_PAD, y + 86);

    return canvas;
  }

  /** The hairline the panels use, at the page's own line colour. */
  function shareRule(ctx, y) {
    ctx.fillStyle = SHARE_LINE;
    ctx.fillRect(SHARE_PAD, y, SHARE_W - SHARE_PAD * 2, 1);
  }

  /** One filing, drawn. Plan, size, paint. */
  function shareCard(f) {
    var blocks = shareBlocks(document.createElement('canvas').getContext('2d'), f);
    return sharePaint(blocks, shareHeight(blocks));
  }

  /** Says what happened on the button itself, then gives the label back. */
  function shareSaid(button, word) {
    button.textContent = word;
    window.setTimeout(function () { button.textContent = SHARE_IMAGE_LABEL; }, 2000);
  }

  /**
   * A file name from a ticker, with everything that is not one removed.
   *
   * The symbol is exchange text and this is the one place on the page where it
   * reaches something other than 'textContent' — a download attribute, which a
   * browser turns into a path. Whitelisted rather than escaped, and named for
   * what is left when a symbol survives none of it.
   */
  function shareFileName(symbol) {
    var safe = String(symbol).replace(/[^A-Za-z0-9._-]/g, '');
    return 'disclosed-' + (safe === '' ? 'filing' : safe) + '.png';
  }

  /**
   * The picture onto the clipboard, or into the downloads folder.
   *
   * THE CLIPBOARD IS TRIED FIRST AND IS NOT EVERYWHERE. Writing an image needs
   * 'ClipboardItem', which Firefox did not have for images until recently and
   * which no browser offers on an insecure origin — the same reason the text
   * Copy is guarded. The ITEM IS BUILT AROUND A PROMISE rather than around a
   * blob that has already been produced, because Safari ends the user gesture
   * at the first await and a write started after 'toBlob' has called back is a
   * write it refuses.
   *
   * THE FALLBACK IS A FILE, and the button says which of the two happened. A
   * control that reports success for two different outcomes is a control that
   * has taught the reader to look in the wrong place.
   */
  function shareDeliver(canvas, symbol, button) {
    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      var png = new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('the canvas produced no image'));
        }, 'image/png');
      });
      navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })]).then(
        function () { shareSaid(button, 'Image copied'); },
        function () { shareDownload(canvas, symbol, button); }
      );
      return;
    }
    shareDownload(canvas, symbol, button);
  }

  /** The picture as a file. The only link on this page that is not a document. */
  function shareDownload(canvas, symbol, button) {
    canvas.toBlob(function (blob) {
      if (!blob) { shareSaid(button, 'image failed'); return; }
      // NOT THROUGH 'safeHref', AND THIS IS THE ONE EXEMPTION ON THE PAGE.
      // That function exists because 'attachmentUrl' arrives from NSE and a
      // 'javascript:' value in it would become a click-to-execute link; it
      // admits http and https and would reject this. There is no exchange text
      // in this URL: it is minted by the browser from a blob this page just
      // drew, and the element is never put in the document.
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = shareFileName(symbol);
      link.click();
      // Revoked, or the picture is held in memory for as long as the tab is.
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
      shareSaid(button, 'Downloaded');
    }, 'image/png');
  }

  /**
   * The second thing a reader can do with a filing, beside the first.
   *
   * 'aria-live' ON THE BUTTON ITSELF. The text Copy has always reported by
   * swapping its own label, which a screen reader does not announce for a
   * control the reader is already on — tolerable there, because 'Copied' and
   * 'failed' are the only two outcomes and a reader can check the clipboard.
   * Here there are three, and 'the image is in your downloads' is not something
   * anybody guesses. The attribute makes the swap that was always happening
   * audible, and adds no second element to keep in sync.
   */
  function shareImageButton(f) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.setAttribute('data-ui', 'focus-copy-image');
    button.setAttribute('aria-live', 'polite');
    button.textContent = SHARE_IMAGE_LABEL;
    button.onclick = (function (filing) {
      return function () {
        // The mark is decoded from a 'data:' URI at load and there is nothing
        // for it to be waiting on, so this is a state that should not occur —
        // which is why it is reported rather than drawn around. A picture that
        // silently arrived without the logo would look like a design choice.
        if (!shareMarkReady) { shareSaid(button, 'not ready'); return; }
        shareDeliver(shareCard(filing), filing.symbol, button);
      };
    })(f);
    return button;
  }
`;
