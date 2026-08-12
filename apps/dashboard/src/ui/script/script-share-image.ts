/**
 * The same filing, drawn as a picture, for the chats that carry images better
 * than they carry text.
 *
 * A FRAGMENT, NOT A MODULE — client-side ES5 held as a string and joined into
 * one IIFE by `page-script.ts`. It runs after `script-share`, whose `shareText`
 * it does not call but whose claims-selection rule it repeats deliberately (see
 * `sharePlan`), and before `script-feed` and `script-focus`, which both mount
 * the button.
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
  // NO EXTERNAL HOST, AND ONE SAME-ORIGIN REQUEST. No web font, no library, no
  // CDN: the type is the system stack the stylesheet already uses. The one
  // thing this fetches is the brand mark, from this application's own guarded
  // route ('/brand/logo.png'), because the founder's logo is a raster and the
  // page's inline SVG is a redrawing of it — see the loader below for what
  // happens when the request does not arrive.
  //
  // NOTHING IS COMPUTED INTO THE PICTURE. The claims are drawn as stored, the
  // date is the server's own IST string, and the only strings here that are
  // ours are the two labels and the footer. A canvas cannot execute what it is
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
  // The palette's own white — '--brand-ink', the colour the mark's D is drawn
  // in. It is the FIGURE colour, and the reason it is a sixth name rather than
  // a reuse of SHARE_INK is below, at SHARE_FIGURES.
  var SHARE_WHITE = '#ffffff';

  // WHAT IS BRIGHT AND WHAT IS NOT, decided once here rather than at each call.
  //
  // The picture had one text colour for almost everything, which is legible and
  // says nothing: a reader scanning a card in a chat window has no idea which
  // line is the filing and which is our chrome. Three tiers, and no more than
  // three, because a fourth stops being a hierarchy and starts being a palette:
  //
  //   SHARE_WHITE   the figures inside a claim, and inside the results line
  //   SHARE_INK     the claims themselves, and the company name
  //   SHARE_MUTED   the category, the timestamp, the remainder, the footer
  //
  // The ticker keeps SHARE_ACCENT, which it already had, and the bullets take
  // it too: one accent, on the two things that are not sentences.

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

  // THE BULLET, AND WHY THE CLAIM IS INDENTED PAST IT. A wrapped claim used to
  // begin under its own dash, so the second line of a two-line claim read as a
  // third claim that had lost its mark. Every line of a claim now starts at
  // SHARE_PAD + SHARE_HANG, and the disc sits in the space that leaves — a
  // hanging indent, which is what a list has looked like since before paper.
  //
  // A DRAWN DISC RATHER THAN A BULLET GLYPH. The character is a font's opinion:
  // it lands at a different size and a different height in each of the six
  // families the sans stack falls through, and on a canvas there is no line box
  // to align it against. An arc is 6 pixels wherever it renders.
  var SHARE_HANG = 30;
  var SHARE_DISC = 6;

  // HOW MANY CLAIMS THE PICTURE HOLDS BEFORE IT SAYS SO.
  //
  // WHAT THE COLLECTION HOLDS, swept 2026-08-12: 2,543 filings carrying at
  // least one claim, 10,297 claims between them. Claims per filing — 25.1%
  // carry one, 62.5% three or fewer, 77.5% six or fewer, 85.5% EIGHT OR FEWER,
  // and the longest carries twelve. Claim text — mean 67.3 characters, p50 65,
  // p90 103, p99 118, longest 120, so at the 29px this sets them a median claim
  // is one line of the 952px column and the longest is two.
  //
  // WHAT THAT COSTS IN PIXELS, measured by running the functions below over
  // live filings in a browser rather than by estimating from the type. Over 200
  // of them, swept 2026-08-12: the canvas comes out 1080 x 434 at its shortest,
  // 662 at the median, 1036 at p90 and 1218 at its tallest.
  //
  // THOSE NUMBERS ARE 158px SMALLER THAN THEY WERE, AND ONLY THE HEADER MOVED.
  // The same 200 filings measured 592 / 820 / 1194 / 1376 before the mark
  // became a watermark; the saving is exactly 158 on every one of them, which
  // is also the answer to what the narrower header column costs — not one of
  // the 200 company names wrapped a line it had not wrapped before. What did
  // change is the shape: 48 of the 200 were taller than they are wide and 12
  // are now.
  //
  // Uncapped, an earlier sweep of 110 filings gave the same median and a
  // tallest of 1558 against 1344 capped: the cap changes nothing for the 85.5%
  // and takes 214 pixels off the tail, which is the shape of a good bound.
  // Twelve claims is not worth its own case, and a picture that ran to twelve
  // would be a thumbnail in the chat it was sent to.
  //
  // THE REMAINDER IS STATED, NOT SWALLOWED, which is what makes a cap
  // acceptable at all: the picture prints how many claims it did not draw.
  var SHARE_CLAIM_CAP = 8;

  var SHARE_IMAGE_LABEL = 'Copy as image';

  // THE SAME SENTENCE THE MESSAGE SIGNS ITSELF WITH — 'script-share.ts' holds
  // it as SHARE_TAIL and 'script-share.spec.ts' asserts the two are one string.
  // A picture and a message of the same filing that described the pipeline
  // differently would be two products. Double-quoted for the apostrophe.
  var SHARE_FOOTER = "AI-extracted. Every line verified against the company's filing.";

  // The mark's own route: same origin, and behind the session guard like every
  // other read on this application.
  var SHARE_LOGO_URL = '/brand/logo.png';

  // WHERE THE TILE SITS INSIDE THE ARTWORK, measured by decoding
  // 'logo/disclosed-logo.png' rather than by eye: on a 1,254px square the
  // rounded tile's box is x 18..1235 and y 16..1235 — a margin of ~1.4% — and
  // its corner radius is 222 of the tile's 1,218px side, which is 18.2%.
  //
  // THE MARGIN IS NOT TRANSPARENT, and this is the whole reason these two
  // numbers exist. The file has no alpha channel and that ground is #fafafa, so
  // drawn as it is on this card's #0d1117 it is a white square with a violet
  // tile inside it and four white corners. The tile is therefore CLIPPED to its
  // own rounded rectangle. Nothing is recoloured and no artwork is lost: what
  // the clip excludes is the white the file was exported with.
  //
  // THE INSET IS 0.022 RATHER THAN THE MEASURED 0.014, which is the one number
  // here that is not the file's own. Clipping exactly at the boundary leaves the
  // antialiased edge pixel a blend of the card and the WHITE behind it: probed
  // off a rendered card, the column into the tile read 13,17,23 then 108,112,137
  // then 50,62,191. Half a percent further in and the blend is between the card
  // and the violet, which is what an edge is supposed to look like.
  var SHARE_TILE_INSET = 0.022;
  var SHARE_TILE_RADIUS = 0.182;

  // ================================================================
  // TWO MARKS, AND WHICH ONE THE PICTURE GETS
  // ================================================================
  //
  // THE REAL ONE IS A RASTER AND IT IS NOT IN THIS DOCUMENT. The founder's logo
  // is 'logo/disclosed-logo.png', a 1,254px square lockup; the SVG the page
  // draws is a REDRAWING of it, measured off that file and stated as such in
  // 'logo.ts'. The redrawing is right for a 24px header — vector, 0.9 KB, exact
  // at any size — and it is the wrong thing on a picture that leaves this
  // product, where the mark is the only part a stranger recognises. So the card
  // asks the server for the artwork itself, downscaled once to 256px.
  //
  // A SAME-ORIGIN REQUEST IS NOT AN EXTERNAL ONE. The invariant this page keeps
  // is that it reaches no host but its own — no CDN, no font, no analytics —
  // and '/brand/logo.png' is this application, behind the same session guard as
  // every read route. The document itself is unchanged: no new link element, no
  // absolute URL, nothing added to the head.
  //
  // BOTH ARE FETCHED AT LOAD, NOT AT THE CLICK. A picture that has to wait for
  // an image before it can be written loses the user gesture Safari requires
  // for a clipboard write. An Image element rather than fetch-then-blob for the
  // same reason and one more: it is four lines, it carries the session cookie
  // by itself, and there is no object URL to remember to revoke.
  //
  // AND THE FAVICON IS KEPT AS THE FALLBACK. If the raster has not arrived —
  // a slow first paint, a 401 on a session that expired between load and click
  // — the card draws the mark this document is already carrying rather than a
  // hole where a logo goes. The two marks are not the same picture and are not
  // pretending to be: the raster is the full lockup and carries the name inside
  // it, so the fallback draws the wordmark beside the tile instead.
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

  var shareLogo = null;
  (function () {
    var img = new Image();
    // Assigned only once it has decoded, so 'shareLogo !== null' is the whole
    // of the readiness test at paint time and there is no second flag to keep
    // in step. A failed request leaves it null and the favicon draws.
    img.onload = function () { shareLogo = img; };
    img.src = SHARE_LOGO_URL;
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

  // ================================================================
  // THE FIGURES INSIDE A CLAIM
  // ================================================================
  //
  // WHAT THIS IS FOR. A claim is a sentence and the number in it is the reason
  // anybody opened the message: 'Revenue from operations was 1,204.35 crore'
  // scans as a paragraph, and the same line with the amount in white scans as a
  // number with its provenance attached. So each claim is segmented and drawn
  // in two colours.
  //
  // WHAT IT MATCHES, in this order: a day-month-year date, a month-year or
  // month-day-year, a fiscal label, and a number — with an optional rupee
  // prefix and an optional unit or percent after it. The date branches come
  // first because the year in '30 June 2026' would otherwise be a lone
  // highlighted 2026 with the month left dark between two lit numbers.
  //
  // THE CURRENCY LIST AND THE SECOND DATE FORM ARE FROM THE CORPUS, not from
  // guesswork: 'INR 8,044.51 mn' and 'July 21, 2026' are both spellings this
  // collection actually prints. Over the 573 claims the feed was holding when
  // this was swept, 478 (83.4%) carry at least one figure and the pattern lights
  // 1,101 runs across them — a little under two a claim, which is a highlight
  // rather than a highlighted sentence.
  //
  // IT NEVER MATCHES EMPTY, which is what makes the loop below safe: every
  // branch requires at least one digit.
  //
  // THE BACKSLASHES ARE DOUBLED because this file is a template literal and the
  // compiler eats single ones — the served page is what has to be right, and
  // 'page.spec.ts' asserts the pattern in the document rather than here.
  var SHARE_FIGURES = /\\d{1,2}\\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s\\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s(?:\\d{1,2},\\s)?\\d{4}|(?:Q[1-4]\\s?)?FY\\s?\\d{2,4}|(?:(?:₹|Rs\\.?|INR)\\s?)?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:%|crore|crores|lakh|lakhs|cr|mn|bn|million|billion|bps))?/gi;

  /** One run of a line in one colour, and the x the next run starts at. */
  function shareRun(ctx, text, x, y, fill) {
    if (text === '') return x;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    return x + ctx.measureText(text).width;
  }

  /**
   * One line of a block, drawn — in two colours where the block asks for it.
   *
   * THE FONT DOES NOT CHANGE BETWEEN RUNS, only the fill. That is a constraint
   * rather than a preference: the line was wrapped by measuring the whole
   * string in one font, and a bold figure would be wider than the text that
   * measurement was made of, so the last word of a long claim would overhang
   * the column by however much the emphasis added. Colour costs no width.
   */
  function shareLine(ctx, block, text, x, y) {
    if (!block.figures) {
      shareRun(ctx, text, x, y, block.fill);
      return;
    }
    var at = 0;
    var cursor = x;
    var found;
    SHARE_FIGURES.lastIndex = 0;
    while ((found = SHARE_FIGURES.exec(text)) !== null) {
      cursor = shareRun(ctx, text.slice(at, found.index), cursor, y, block.fill);
      cursor = shareRun(ctx, found[0], cursor, y, SHARE_WHITE);
      at = found.index + found[0].length;
    }
    shareRun(ctx, text.slice(at), cursor, y, block.fill);
  }

  /**
   * One measured block: its text wrapped to the column it will be drawn in.
   *
   * A SPEC OBJECT RATHER THAN EIGHT POSITIONAL ARGUMENTS. Blocks differ in
   * eight ways now — font, fill, line height, the gap above them, the indent,
   * the column they wrap to, whether they carry a bullet and whether their
   * figures are lit — and 'block(font, fill, text, 42, 20, 30, true, true)' is
   * a line nobody can read back.
   */
  function shareBlock(ctx, spec) {
    ctx.font = spec.font;
    var indent = spec.indent || 0;
    return {
      font: spec.font,
      fill: spec.fill,
      lineHeight: spec.lineHeight,
      gap: spec.gap,
      indent: indent,
      bullet: spec.bullet === true,
      figures: spec.figures === true,
      lines: shareWrap(ctx, spec.text, spec.width || SHARE_W - SHARE_PAD * 2 - indent)
    };
  }

  /**
   * Who filed, and when: the ticker, the company and the line under them.
   *
   * THEY WRAP TO A NARROWER COLUMN THAN THE CLAIMS DO, and that is what keeps a
   * long company name off the mark in the corner beside them. The band reserved
   * on the right is the tile plus its gutter, and it is taken off ALL THREE
   * lines rather than only the ones level with the tile: a column whose lines
   * have two different measures is not a column, and the mark is 64px, so what
   * that costs is 96px of measure on a 1,080px canvas.
   */
  function shareHeadBlocks(ctx, f) {
    var column = SHARE_W - SHARE_PAD * 2 - SHARE_TILE - SHARE_GUTTER;
    return [
      shareBlock(ctx, {
        font: '600 26px ' + SHARE_SANS,
        fill: SHARE_ACCENT,
        text: f.symbol,
        lineHeight: 34,
        // Nothing above it. The ticker is the first thing on the card now, and
        // 'SHARE_TOP' is the whole of the space over it.
        gap: 0,
        width: column
      }),
      shareBlock(ctx, {
        font: '700 44px ' + SHARE_SANS,
        fill: SHARE_INK,
        text: f.companyName,
        lineHeight: 54,
        gap: 16,
        width: column
      }),
      // THE SERVER'S HUMAN SPELLING OF THE INSTANT — '12 Aug 2026, 8:48 am'.
      // The fixed-width sibling is a machine's string and reads as one on a
      // picture; the browser formats neither, because it is not necessarily on
      // IST. Three letters are appended and no arithmetic is done, which is the
      // same rule the message and the card's tooltip follow.
      shareBlock(ctx, {
        font: '400 24px ' + SHARE_SANS,
        fill: SHARE_MUTED,
        text: f.category + ' · ' + f.disseminatedAtIstHuman + ' IST',
        lineHeight: 32,
        gap: 16,
        width: column
      })
    ];
  }

  /** What the filing said: the claims, what was left out, and the figures. */
  function shareBodyBlocks(ctx, claims, resultsLine) {
    var blocks = [];
    var shown = claims.length < SHARE_CLAIM_CAP ? claims.length : SHARE_CLAIM_CAP;
    for (var i = 0; i < shown; i++) {
      blocks.push(shareBlock(ctx, {
        font: '400 29px ' + SHARE_SANS,
        fill: SHARE_INK,
        text: claims[i].text,
        lineHeight: 42,
        gap: i === 0 ? 44 : 20,
        indent: SHARE_HANG,
        bullet: true,
        figures: true
      }));
    }
    // STATED, NOT SWALLOWED. A picture that quietly stopped at eight would look
    // like the whole filing, and 'the rest are in the app' is a fact a reader
    // can act on.
    if (claims.length > shown) {
      blocks.push(shareBlock(ctx, {
        font: '400 24px ' + SHARE_SANS,
        fill: SHARE_MUTED,
        text: '+ ' + (claims.length - shown) + ' more in the app',
        lineHeight: 32,
        gap: 24,
        indent: SHARE_HANG
      }));
    }
    // MONO, AND LIT THE SAME WAY A CLAIM IS. It was accent end to end, which
    // made 'Revenue' as loud as the number beside it; the labels are chrome and
    // the figures are the filing.
    if (resultsLine) {
      blocks.push(shareBlock(ctx, {
        font: '400 24px ' + SHARE_MONO,
        fill: SHARE_MUTED,
        text: resultsLine,
        lineHeight: 34,
        gap: 36,
        figures: true
      }));
    }
    return blocks;
  }

  /**
   * The picture as two lists of measured blocks. NOTHING IS DRAWN HERE.
   *
   * Planning and painting are separate because the canvas has to be sized
   * before anything can be put on it and the size is not knowable until every
   * claim has been wrapped — which needs a context to measure with. So this
   * measures on a throwaway context, and 'sharePaint' walks the result.
   *
   * TWO LISTS RATHER THAN ONE, because the rule between them is no longer at a
   * fixed height: the identity is drawn ABOVE it now, so where it falls depends
   * on how many lines the company name took.
   *
   * THE CLAIMS ARE READ THE WAY 'shareText' READS THEM: straight off the
   * enrichment, echoes included, results line separate. A picture and a message
   * of the same filing that disagreed about what the filing said would be worse
   * than either of them being wrong on its own.
   */
  function sharePlan(ctx, f) {
    var e = f.enrichment || {};
    var claims = e.claims || [];
    return {
      head: shareHeadBlocks(ctx, f),
      body: shareBodyBlocks(ctx, claims, e.resultsLine)
    };
  }

  // ================================================================
  // THE HEADER, AND WHY THE MARK IS NO LONGER A BAND
  // ================================================================
  //
  // WHAT IT WAS. A 132px lockup centred in a 188px band of its own, with the
  // ticker, the company and the date set BELOW the rule under it. On a filing
  // with one claim that band was 188 of 592 pixels — 32% of the picture, and
  // about 15% of a median one — spent before the reader reached a word the
  // company filed. The content is the hero and the mark is branding.
  //
  // WHAT IT IS. The identity starts at the top-left margin and the mark is a
  // 64px tile in the opposite corner, top-aligned with the ticker beside it. It
  // adds NO height: the header is as tall as its own three lines and the rule
  // falls under them. Measured on a one-claim filing with a one-line name, the
  // picture goes from 592px to 434px — 158px, and every one of them was empty.
  //
  // THE TILE CANNOT SET THE HEIGHT, so there is no maximum of the two to take.
  // The header is always three blocks, its shortest possible bottom is
  // 36 + 34 + (16 + 54) + (16 + 32) = 188, and the tile ends at 51 + 64 = 115.
  //
  // The footer below the claims is unchanged: rule, one line, bottom padding.
  var SHARE_TOP = 36;
  var SHARE_TILE = 64;
  // The gap between the text column and the tile. It is the reserved band's
  // other half — see 'shareHeadBlocks'.
  var SHARE_GUTTER = 32;
  // Where the tile's top edge sits: on the ticker's cap. The first baseline is
  // SHARE_TOP + 34 and the cap height of 600 26px system sans is about 19.
  var SHARE_TILE_Y = 51;
  // Between the last line of the header and the rule under it.
  var SHARE_HEAD_TAIL = 34;
  var SHARE_FOOT = 126;

  /** Where a stack of blocks ends, from the baseline cursor it starts at. */
  function shareStack(blocks, y) {
    for (var i = 0; i < blocks.length; i++) {
      y += blocks[i].gap + blocks[i].lines.length * blocks[i].lineHeight;
    }
    return y;
  }

  /** Where the rule under the identity falls, which the body starts from. */
  function shareHeadBottom(head) {
    return shareStack(head, SHARE_TOP) + SHARE_HEAD_TAIL;
  }

  /** Where everything ends, so the canvas can be made the height it needs. */
  function shareHeight(plan) {
    return shareStack(plan.body, shareHeadBottom(plan.head)) + SHARE_FOOT;
  }

  /** One stack of blocks, drawn. Returns the baseline it finished on. */
  function shareDraw(ctx, blocks, y) {
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      ctx.font = b.font;
      y += b.gap;
      for (var line = 0; line < b.lines.length; line++) {
        y += b.lineHeight;
        // The disc goes beside the FIRST line only, which is the whole of what
        // a hanging indent is: one mark, and the rest of the sentence lined up
        // under the text rather than under the mark.
        if (b.bullet && line === 0) shareDisc(ctx, y);
        shareLine(ctx, b, b.lines[line], SHARE_PAD + b.indent, y);
      }
    }
    return y;
  }

  /** The plan onto a canvas of the right size. */
  function sharePaint(plan, height) {
    var canvas = document.createElement('canvas');
    // DRAWN AT 2X. Every measurement in the plan is in 1080-wide units, but
    // the pixels are doubled and the context scaled to match: a phone screen
    // shows shared images at 2-3 device pixels per CSS pixel, so a 1080px
    // render arrives soft everywhere and softest on the 64px logo tile - the
    // user's complaint. At 2x the tile is 128 physical pixels from a 256px
    // source (a clean 2:1) and every glyph doubles its pixels. The PNG grows
    // (~4x the area) but stays well under chat-app recompression thresholds.
    canvas.width = SHARE_W * 2;
    canvas.height = height * 2;
    var ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    ctx.fillStyle = SHARE_BG;
    ctx.fillRect(0, 0, SHARE_W, height);

    // 'textBaseline' stays alphabetic — the default — so every y below is a
    // baseline and the blocks stack by adding.
    shareDraw(ctx, plan.head, SHARE_TOP);
    shareWatermark(ctx);
    shareRule(ctx, shareHeadBottom(plan.head));

    var y = shareDraw(ctx, plan.body, shareHeadBottom(plan.head));

    shareRule(ctx, y + 46);
    ctx.font = '400 22px ' + SHARE_SANS;
    ctx.fillStyle = SHARE_MUTED;
    ctx.fillText(SHARE_FOOTER, SHARE_PAD, y + 86);

    return canvas;
  }

  /**
   * The mark in the corner: the founder's artwork, or the favicon and the word.
   *
   * A WATERMARK RATHER THAN A MASTHEAD. It is 64px in the top-right corner,
   * top-aligned with the ticker across the card from it, and it takes no
   * vertical space of its own — see the header section above for what that
   * replaced and what it saved. FULL COLOUR AND FULL SIZE WITHIN ITS BOX: it is
   * small, not faded, and nothing here changes its opacity or its palette.
   *
   * THE WORD IS ALWAYS CANVAS TEXT, in both branches. The first cut drew the
   * raster lockup alone and accepted that its internal name is ~10px of
   * artwork at 64px — the user read that as "unreadable", which it was. Text
   * drawn by the canvas is crisp at any size, so the name sits beside the
   * tile whichever mark is available, and the tiny name inside the artwork
   * reads as texture rather than as the label.
   *
   * 'roundRect' IS PART OF THE TEST, not an afterthought. It is what clips the
   * artwork's white margin off, and without it the raster would land on this
   * card as a white square — so a browser that lacks it gets the favicon
   * branch, which is a complete picture rather than a broken one.
   */
  function shareWatermark(ctx) {
    var x = SHARE_W - SHARE_PAD - SHARE_TILE;

    // THE WORD GOES TO THE TILE'S LEFT in both branches, because no 64px tile
    // can carry a readable name — the raster's own wordmark is ~10px of
    // artwork at this size, which the user read as "unreadable". Canvas text
    // is crisp at any size, so the name is set beside the mark and the tiny
    // one inside the artwork reads as texture. Measured and then placed, so
    // the pair ends at the right margin where the tile does.
    ctx.font = '600 28px ' + SHARE_SANS;
    // Centred on the tile: the baseline sits half a cap height below its middle,
    // and the cap height of 600 28px system sans is about 20.
    var baseline = SHARE_TILE_Y + SHARE_TILE / 2 + 10;
    var word = x - 12 - ctx.measureText(SHARE_BRAND + '.').width;
    ctx.fillStyle = SHARE_INK;
    ctx.fillText(SHARE_BRAND, word, baseline);
    // The accent full stop, set after the word rather than derived from it:
    // 'brand.ts' holds where the colour falls, and this measures the word to
    // find the same place.
    ctx.fillStyle = SHARE_ACCENT;
    ctx.fillText('.', word + ctx.measureText(SHARE_BRAND).width, baseline);

    if (shareLogo !== null && ctx.roundRect) {
      var inset = SHARE_TILE * SHARE_TILE_INSET;
      var side = SHARE_TILE - inset * 2;
      ctx.save();
      // HIGH-QUALITY RESAMPLE, stated because the default is the bug: the
      // asset is 256px and the box is 64px, and the default bilinear filter at
      // a 4x reduction is what made the mark arrive blurred. 'high' asks for
      // the better kernel; a browser without it falls back to the same default
      // and loses only sharpness, not the picture.
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      ctx.beginPath();
      ctx.roundRect(x + inset, SHARE_TILE_Y + inset, side, side, side * SHARE_TILE_RADIUS);
      ctx.clip();
      ctx.drawImage(shareLogo, x, SHARE_TILE_Y, SHARE_TILE, SHARE_TILE);
      ctx.restore();
      return;
    }

    if (shareMarkReady) ctx.drawImage(shareMark, x, SHARE_TILE_Y, SHARE_TILE, SHARE_TILE);
  }

  /**
   * The bullet: a disc in the accent, in the space the hanging indent leaves.
   *
   * PLACED OFF THE BASELINE BY EYE AT THE CLAIM'S OWN SIZE. 29px system sans
   * has an x-height of about 15px, so the middle of a lower-case letter is
   * roughly 8px above the baseline and the disc's centre sits there. Deriving
   * it from a measurement would mean 'measureText' metrics that Safari only
   * grew recently, for a number that moves when the type size does and is
   * checked by looking at the picture either way.
   */
  function shareDisc(ctx, baseline) {
    ctx.fillStyle = SHARE_ACCENT;
    ctx.beginPath();
    ctx.arc(SHARE_PAD + SHARE_DISC, baseline - 8, SHARE_DISC, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The hairline the panels use, at the page's own line colour. */
  function shareRule(ctx, y) {
    ctx.fillStyle = SHARE_LINE;
    ctx.fillRect(SHARE_PAD, y, SHARE_W - SHARE_PAD * 2, 1);
  }

  /** One filing, drawn. Plan, size, paint. */
  function shareCard(f) {
    var plan = sharePlan(document.createElement('canvas').getContext('2d'), f);
    return sharePaint(plan, shareHeight(plan));
  }

  /**
   * Says what happened on the button itself, then gives the drawing back.
   *
   * THE CONTROL HAS NO WORDS ON IT ANY MORE, so the swap that used to be its
   * label is now a mark and a clipped live line — 'iconSaid' does both from one
   * call, so the visible report and the audible one cannot disagree. Nothing
   * about WHAT it reports has changed: the same outcomes, each named.
   *
   * THE MARK IS THE CALLER'S because two of the four outcomes are failures, and
   * a check mark drawn after a clipboard that refused the write reports success
   * for a failure — which is the thing these outcomes were separated to avoid.
   */
  function shareSaid(button, mark, word) {
    iconSaid(button, mark, word);
    window.setTimeout(function () { iconSaid(button, ICON_IMAGE, ''); }, 2000);
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
        function () { shareSaid(button, ICON_DONE, 'Image copied'); },
        function () { shareDownload(canvas, symbol, button); }
      );
      return;
    }
    shareDownload(canvas, symbol, button);
  }

  /** The picture as a file. The only link on this page that is not a document. */
  function shareDownload(canvas, symbol, button) {
    canvas.toBlob(function (blob) {
      if (!blob) { shareSaid(button, ICON_FAIL, 'image failed'); return; }
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
      shareSaid(button, ICON_DONE, 'Downloaded');
    }, 'image/png');
  }

  /**
   * The second thing a reader can do with a filing, beside the first.
   *
   * 'aria-live' ON THE BUTTON ITSELF, and it is the pattern the other two
   * controls now follow. This one has always reported by swapping its own
   * label, which a screen reader does not announce for a control the reader is
   * already on — and 'the image is in your downloads' is not something anybody
   * guesses. Now that none of the three carries a word, the swap is a drawing,
   * and 'iconSaid' puts the sentence where the region can read it.
   *
   * IT IS ON THE CARD AS WELL AS IN THE DIALOG NOW. It was dialog-only because
   * the card's foot is one line and a third WORD would have pushed the category
   * out of it; four drawings take less width than the two words did. The
   * fragment already loaded on every surface — it is joined into the one script
   * before 'script-feed' — so this costs a call and no bytes.
   */
  function shareImageButton(f, ui) {
    var button = iconButton(ICON_IMAGE, SHARE_IMAGE_LABEL, ui);
    button.setAttribute('aria-live', 'polite');
    button.onclick = (function (filing) {
      return function (event) {
        // The card behind this one opens on a click that was not on a control.
        // See 'shareCopyButton', which stops it for the same reason.
        event.stopPropagation();
        // NEITHER MARK, WHICH IS A STATE THAT SHOULD NOT OCCUR. The favicon is
        // decoded from a 'data:' URI at load with nothing to wait on, and the
        // raster is a request to this same origin; a card can be drawn as soon
        // as EITHER has arrived, so this refuses only when both are missing.
        // A picture that silently arrived without a logo would look like a
        // design choice rather than a failure.
        if (!shareMarkReady && shareLogo === null) {
          shareSaid(button, ICON_FAIL, 'not ready');
          return;
        }
        shareDeliver(shareCard(filing), filing.symbol, button);
      };
    })(f);
    return button;
  }
`;
