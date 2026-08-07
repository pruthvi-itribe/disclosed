/**
 * Whether a document's text layer carries WORDS, as opposed to merely carrying
 * characters.
 *
 * ================================================================
 * THE DEFECT A CHARACTER COUNT CANNOT SEE
 * ================================================================
 *
 * `hasUsableTextLayer` counts non-space characters. That test finds a raster
 * scan, where there is nothing to count, and it is blind to the failure that
 * costs more: a PDF whose embedded font subset carries a broken `ToUnicode`
 * map. Such a file emits one character per glyph — the right NUMBER of
 * characters, in the right places, with the right line breaks — and every one of
 * them is the wrong character.
 *
 * MSWIL's newspaper disclosure (seqId 106726228) is the measured case. Its text
 * layer is 9,226 non-space characters, which clears the 100-character bound by
 * 92x, and past the covering letter it reads:
 *
 *     1DWLRQDO6WRFN([FKDQJHRI,QGLD/LPLWHG
 *     6XEMHFW3XEOLFDWLRQRIXQDXGLWHG)LQDQFLDO5HVXOWV
 *
 * which is `NationalStockExchangeofIndiaLimited` and `Subject: Publication of
 * unaudited Financial Results` with every code point displaced by three. The
 * document was routed to `pdf-parse`, stored, and produced a single claim off
 * the one clean paragraph at the top.
 *
 * ================================================================
 * WHY A VOWEL RATE, AND WHY IT IS NOT A LANGUAGE TEST
 * ================================================================
 *
 * The obvious readability test is a dictionary, and that is what MEASURED this
 * one: `/usr/share/dict/words` over 66,941 windows of 590 live documents is the
 * label the threshold below was fitted against. A dictionary cannot ship — 236k
 * words is not a constant, an Indian filing's proper nouns are absent from it,
 * and a Regulation 33 statement is mostly row labels and digits.
 *
 * The share of vowels among Latin letters reproduces the dictionary's verdict
 * at the one place the routing needs it, and it does so because of HOW the
 * defect works rather than by coincidence. A constant code-point displacement
 * maps the vowels English leans on onto consonants — a→d, e→h, i→l, o→r, u→x at
 * the +3 shift above — so the vowel share collapses. Measured over those 66,941
 * windows: windows the dictionary calls readable sit at 0.35-0.43 with a first
 * percentile of 0.339, and windows it calls garbage have a median of 0.285.
 *
 * IT IS NOT A TEST FOR ENGLISH, and must not be read as one. A Marathi AGM
 * notice set in a legacy font scores low here and is not corrupt in any sense
 * this pipeline can act on. That is why the verdict is a FRACTION of the
 * document rather than a property of it: a filing is only refused when almost
 * nothing in it reads, which is the single case re-reading the pixels can fix.
 */

/**
 * Characters per window.
 *
 * A WHOLE-DOCUMENT AVERAGE IS THE WRONG UNIT and 600 is the smallest size that
 * stops being one. Every NSE filing is a composite — a covering letter in the
 * filer's own font, then an attachment produced by somebody else's software —
 * and averaging readability across the join reports a number that describes
 * neither half. MSWIL's 500 clean characters over 8,726 corrupt ones average to
 * something unremarkable; windowed, 18 of its 19 windows are unreadable and one
 * is perfect.
 *
 * 600 is about a paragraph. Smaller windows put a table's column headers in a
 * window of their own, where there are too few letters to judge anything;
 * larger ones start averaging across the join again.
 */
export const QUALITY_WINDOW_CHARS = 600;

/**
 * Latin letters a window needs before its vowel share means anything.
 *
 * A window holding `| 497.99 | 737.08 | 455.69 |` is a row of a results table
 * and says nothing about whether the font is intact. Below this count the
 * window is not evidence, and this module treats absence of evidence as
 * innocence — see `readableWindowFraction`.
 */
export const MIN_WINDOW_LETTERS = 60;

/**
 * Vowel share among a window's Latin letters, below which it does not read.
 *
 * 0.30, and it sits in a measured trough rather than on a slope. Bucketing all
 * 66,941 windows by hundredths of vowel share gives a mass of 15,684 windows at
 * 0.38 and a floor of 98 windows at 0.30 — the sparsest bucket between the two
 * populations. It is also where they cross: at 0.30 a window is as likely to be
 * dictionary-garbage as dictionary-readable (42.9% readable), at 0.33 it is
 * 90.9% readable, and at 0.27 it is 11.0%.
 *
 * The consequence of being wrong here is deliberately asymmetric, and the
 * asymmetry is why the floor sits at the crossover rather than above it. A
 * window wrongly called unreadable costs a fraction of one document's score,
 * and the document-level bound absorbs it. A window wrongly called readable on
 * a document where every window is garbage would keep a filing pointed at a
 * parser that cannot read it, which is the failure this module exists to end.
 */
export const MIN_WINDOW_VOWEL_RATE = 0.3;

const LATIN_LETTER = /[A-Za-z]/g;
const LATIN_VOWEL = /[AEIOUaeiou]/g;

const countOf = (text: string, pattern: RegExp): number =>
  (text.match(pattern) ?? []).length;

/**
 * Whether one window's Latin letters are distributed like words.
 *
 * Returns null when the window carries too few letters to be evidence either
 * way, which the caller must not confuse with `false`.
 */
export function windowReads(window: string): boolean | null {
  const letters = countOf(window, LATIN_LETTER);
  if (letters < MIN_WINDOW_LETTERS) return null;
  return countOf(window, LATIN_VOWEL) / letters >= MIN_WINDOW_VOWEL_RATE;
}

/**
 * The share of a document that reads as text, between 0 and 1.
 *
 * UNJUDGEABLE WINDOWS COUNT AS READABLE, and that is the conservative
 * direction rather than a convenience. A window of pure digits is what a
 * results table looks like, and a document is not corrupt for containing one;
 * scoring silence as guilt would send the cleanest documents this pipeline
 * handles — a page of figures with a two-line heading — to an OCR pass they do
 * not need.
 *
 * A document with no text at all returns 1, not 0. "There is nothing here" is
 * already `hasUsableTextLayer`'s answer to give, and returning 0 would have this
 * module quietly restate a verdict that belongs to the character count, in a
 * place where a caller reading a fraction would not expect to find it.
 */
export function readableWindowFraction(documentText: string): number {
  let judged = 0;
  let readable = 0;

  for (let at = 0; at < documentText.length; at += QUALITY_WINDOW_CHARS) {
    const verdict = windowReads(
      documentText.slice(at, at + QUALITY_WINDOW_CHARS),
    );
    if (verdict === null) continue;
    judged += 1;
    if (verdict) readable += 1;
  }

  return judged === 0 ? 1 : readable / judged;
}
