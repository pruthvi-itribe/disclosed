import { BRAND } from '../brand';
import { renderDashboardPage } from '../page';
import { PAGE_STYLE } from '../page-style';
import { SCRIPT_SHARE } from './script-share';
import { SCRIPT_SHARE_IMAGE } from './script-share-image';

/**
 * `shareText`, run as the browser runs it.
 *
 * SLICED OUT OF THE SERVED DOCUMENT rather than imported from the fragment,
 * for the reason `script-feed.spec.ts` gives and CLAUDE.md records: these
 * fragments are TypeScript template literals, and a fragment that compiled is
 * not a fragment that shipped. What is asserted here is the function the page
 * actually hands a browser.
 *
 * IT IS THE ONE FUNCTION IN THE PAIR WORTH RUNNING IN JEST. It is pure, it
 * touches no DOM, and it is the whole of a rule that has no other enforcement:
 * what leaves this product in somebody's chat window. The image's blocks need a
 * canvas to measure with and its delivery needs a clipboard, so both are the
 * e2e suite's job; what the two share — which claims go in and which do not —
 * is asserted on the source below.
 */

const html = renderDashboardPage(true);
const SCRIPT = html.slice(
  html.indexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>'),
);

/**
 * The source text of one top-level function declaration, by brace matching.
 *
 * THROWS WHEN THE ANCHOR IS MISSING rather than returning an empty string: a
 * cut that matched nothing would evaluate to a harness with no function in it
 * and fail with `shareText is not defined`, which reads as a broken test rather
 * than as a renamed function.
 */
const cutFunction = (source: string, signature: string): string => {
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`"${signature}" is not in the served script.`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`"${signature}" is never closed in the served script.`);
};

/** One `var NAME = '...';` line, taken from the served script by its name. */
const cutString = (name: string): string => {
  const line = new RegExp(`var ${name} = (?:'([^']*)'|"([^"]*)");`).exec(
    SCRIPT,
  );
  if (line === null) throw new Error(`"${name}" is not in the served script.`);
  return line[1] ?? line[2];
};

type Filing = Record<string, unknown>;
type ShareText = (f: Filing) => string;

const shareText = new Function(
  `var SHARE_BRAND = ${JSON.stringify(cutString('SHARE_BRAND'))};
var SHARE_TAIL = ${JSON.stringify(cutString('SHARE_TAIL'))};
${cutFunction(SCRIPT, 'function shareText(')}
return shareText;`,
)() as ShareText;

/** One filing as `api/filings` sends it, with only what a message draws on. */
const filing = (over: Filing = {}): Filing => ({
  seqId: 106_734_488,
  symbol: 'SKIPPER',
  companyName: 'Skipper Limited',
  category: 'Financial Results',
  disseminatedAtIst: '2026-08-09 09:15:00',
  disseminatedAtIstHuman: '9 Aug 2026, 9:15 am',
  enrichment: {
    state: 'done',
    resultsLine: null,
    claims: [
      {
        text: 'Revenue from operations was 1,204.35 crore',
        span: 'THE SENTENCE THIS WAS MATCHED AGAINST',
        echo: false,
      },
      {
        text: 'Profit after tax was 61.2 crore',
        span: 'THE SENTENCE THIS WAS MATCHED AGAINST',
        periodSpan: 'FOR THE QUARTER ENDED 30 JUNE 2026',
        echo: false,
      },
    ],
  },
  ...over,
});

describe('shareText — one filing as a message', () => {
  it('opens with the company, the ticker, the category and the IST the server sent', () => {
    // A message that opens with a bare ticker is a message the reader has to
    // decode before they can decide whether they care. The asterisks are
    // WhatsApp's bold and the only markup a chat window has.
    const [name, meta] = shareText(filing()).split('\n');

    expect(name).toBe('*Skipper Limited (SKIPPER)*');
    expect(meta).toBe('Financial Results · 9 Aug 2026, 9:15 am IST');
  });

  it('reads the human spelling of the instant, not the fixed-width one', () => {
    // BOTH ARRIVE ON THE PAYLOAD and this picks the one a person reads aloud.
    // The other is the tooltip's and the diagnostic's; a chat message that
    // said `2026-08-09 09:15:00` would be a log line again, which is the thing
    // this format replaced.
    const message = shareText(filing());

    expect(message).toContain('9 Aug 2026, 9:15 am IST');
    expect(message).not.toContain('2026-08-09 09:15:00');
  });

  it('bullets each claim, verbatim, one to a line', () => {
    // WhatsApp has no list markup at all, so a bullet is two characters.
    const lines = shareText(filing()).split('\n');

    expect(lines).toContain('- Revenue from operations was 1,204.35 crore');
    expect(lines).toContain('- Profit after tax was 61.2 crore');
  });

  it('signs itself, in the words the tail and the brand hold', () => {
    // WHO DID WHICH HALF. A model proposes the sentences and the pipeline
    // matches each against a span of the document; naming the model as the
    // extractor and the filing as the thing verified against is the whole of
    // the sentence, and 'AI verified' would be a claim about the machine that
    // made the claim.
    const lines = shareText(filing()).split('\n');

    expect(lines[lines.length - 2]).toBe(
      "_AI-extracted. Every line verified against the company's filing._",
    );
    expect(lines[lines.length - 1]).toBe(BRAND);
  });

  it('puts the results line after the claims, when the filing printed one', () => {
    const withResults = filing({
      enrichment: {
        state: 'done',
        resultsLine: 'Revenue 1,204.35 cr · PAT 61.2 cr',
        claims: [{ text: 'Revenue from operations was 1,204.35 crore' }],
      },
    });
    const lines = shareText(withResults).split('\n');

    expect(lines).toContain('Revenue 1,204.35 cr · PAT 61.2 cr');
    // After the claim, and separated from it. On a card the numbers ARE the
    // event and they lead; in a chat they are what a reader scrolls back to.
    expect(lines.indexOf('Revenue 1,204.35 cr · PAT 61.2 cr')).toBeGreaterThan(
      lines.indexOf('- Revenue from operations was 1,204.35 crore'),
    );
  });

  it('says nothing about results when the filing printed none', () => {
    // "Nothing was found" and "nothing was looked for" must not render the
    // same, and here neither of them renders at all: no placeholder, no dash.
    const message = shareText(filing());

    expect(message).not.toContain('—');
    expect(message.split('\n').filter((line) => line === '')).toHaveLength(2);
  });

  it('carries the whole message when the filing carried one claim', () => {
    // The shape end to end, as a reader receives it.
    const one = filing({
      enrichment: {
        state: 'done',
        resultsLine: null,
        claims: [
          { text: 'The board declared an interim dividend of 2 per share' },
        ],
      },
    });

    expect(shareText(one)).toBe(
      [
        '*Skipper Limited (SKIPPER)*',
        'Financial Results · 9 Aug 2026, 9:15 am IST',
        '',
        '- The board declared an interim dividend of 2 per share',
        '',
        "_AI-extracted. Every line verified against the company's filing._",
        'Disclosed',
      ].join('\n'),
    );
  });

  it('sends every claim the filing carried, including the ones the card skipped', () => {
    // The feed marks a claim whose fact an earlier card in the same response
    // already stated and stops drawing it, because a scan view repeating itself
    // is noise. That is a property of that response and not of this document —
    // somebody sending one filing to one person is sending what it said.
    const echoed = filing({
      enrichment: {
        state: 'done',
        resultsLine: null,
        claims: [
          { text: 'Revenue grew 5% in Q1FY27', echo: true },
          { text: 'Profit after tax was 61.2 crore', echo: false },
        ],
      },
    });

    expect(shareText(echoed)).toContain('- Revenue grew 5% in Q1FY27');
  });

  it('never sends the quoted spans, however many the reader has open', () => {
    // The spans are the evidence and they are one tap away in the app. A filing
    // with eight claims carries eight sentences lifted out of a PDF, and that
    // is a wall of text in a chat window rather than a message.
    const message = shareText(filing());

    expect(message).not.toContain('THE SENTENCE THIS WAS MATCHED AGAINST');
    expect(message).not.toContain('FOR THE QUARTER ENDED 30 JUNE 2026');
    expect(cutFunction(SCRIPT, 'function shareText(')).not.toContain('span');
  });

  it('adds no arithmetic, no direction and no decoration of its own', () => {
    // THE VERBATIM GATE, ASSERTED ON THE FUNCTION. The only strings it may
    // introduce are the two labels and the punctuation the format is made of;
    // anything that reached for a movement glyph, a computed percentage or an
    // emoji would be publishing something no filing printed.
    const source = cutFunction(SCRIPT, 'function shareText(');

    expect(source).not.toContain('direction');
    expect(source).not.toContain('MOVE_GLYPH');
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    // NO ARITHMETIC, NAMED. The asterisks in this function are WhatsApp's bold
    // and the underscores are its italic, so scanning for punctuation would
    // prove nothing; what makes the rule checkable is that the function calls
    // nothing that could produce a figure the filing did not print.
    for (const maths of ['Math.', 'Number(', 'parseFloat', 'toFixed']) {
      expect([maths, source.includes(maths)]).toEqual([maths, false]);
    }
  });

  it('formats no timestamp of its own', () => {
    // IST is the server's, and a browser that formatted these itself would be
    // wrong by five and a half hours and look completely normal doing it. The
    // only thing this may do to `disseminatedAtIst` is append three letters.
    const source = cutFunction(SCRIPT, 'function shareText(');

    expect(source).not.toContain('Date');
    expect(source).not.toContain('toLocale');
    expect(source).toContain("' IST'");
  });
});

describe('the share fragments carry no copy that can drift silently', () => {
  it('signs the message with the one spelling of the name', () => {
    // A fragment is a string and cannot import; `brand.ts` holds the name and
    // this is what stops the copy of it here from becoming a second one.
    expect(cutString('SHARE_BRAND')).toBe(BRAND);
  });

  it("draws the picture in the stylesheet's own palette", () => {
    // An image is rendered outside the document, where `var(--bg)` resolves to
    // nothing, so these are literals for the same reason the favicon's are —
    // and a hex that has to be copied is a hex that will drift unless something
    // checks. See `logo.spec.ts`, which does this for the icon.
    expect(PAGE_STYLE).toContain(`--bg: ${cutString('SHARE_BG')};`);
    expect(PAGE_STYLE).toContain(`--line: ${cutString('SHARE_LINE')};`);
    expect(PAGE_STYLE).toContain(`--text: ${cutString('SHARE_INK')};`);
    expect(PAGE_STYLE).toContain(`--muted: ${cutString('SHARE_MUTED')};`);
    expect(PAGE_STYLE).toContain(`--accent: ${cutString('SHARE_ACCENT')};`);
  });

  it('takes the mark from the document rather than redrawing it', () => {
    // `logo.ts` holds the geometry once, and the favicon is the copy of it that
    // is written in hex rather than in custom properties — precisely because it
    // has to survive being rendered outside a document, which is this canvas's
    // situation exactly. Re-plotting the D's arcs here would be a second
    // drawing, and the two would differ the first time either changed.
    expect(SCRIPT_SHARE_IMAGE).toContain(
      'document.querySelector(\'link[rel="icon"]\')',
    );
    expect(SCRIPT_SHARE_IMAGE).not.toContain('arcTo');
    expect(SCRIPT_SHARE_IMAGE).not.toContain('bezierCurveTo');
  });

  it('reads the claims the way the message reads them', () => {
    // A picture and a message of the same filing that disagreed about what the
    // filing said would be worse than either being wrong on its own.
    for (const fragment of [SCRIPT_SHARE, SCRIPT_SHARE_IMAGE]) {
      expect(fragment).toContain('var claims = e.claims || [];');
    }
    expect(SCRIPT_SHARE_IMAGE).toContain('var SHARE_CLAIM_CAP = 8;');
    expect(SCRIPT_SHARE_IMAGE).toContain("' more in the app'");
  });

  it('puts exchange text into a file name through a whitelist', () => {
    // The download attribute is the one place on this page where a symbol
    // reaches something other than `textContent`, and a browser turns it into
    // a path.
    expect(SCRIPT_SHARE_IMAGE).toContain("replace(/[^A-Za-z0-9._-]/g, '')");
  });

  it('reports which of the two deliveries happened', () => {
    // A control that reports success for two different outcomes has taught the
    // reader to look in the wrong place.
    expect(SCRIPT_SHARE_IMAGE).toContain("shareSaid(button, 'Image copied')");
    expect(SCRIPT_SHARE_IMAGE).toContain("shareSaid(button, 'Downloaded')");
    expect(SCRIPT_SHARE_IMAGE).toContain(
      "button.setAttribute('aria-live', 'polite')",
    );
  });
});
