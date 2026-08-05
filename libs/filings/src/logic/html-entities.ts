/**
 * NSE returns announcement text HTML-escaped: `&#8377;` where it meant `₹`,
 * `&amp;` inside company names. Stored raw, that escaping reaches every
 * downstream consumer of `Filing.summary` — an alert would render
 * "PAT of &#8377;76 Mn" to a user, and amount extraction would have to know
 * about entity forms to read a figure.
 *
 * Deliberately small rather than a dependency: NSE emits numeric references
 * plus a handful of named ones, and a full HTML5 entity table is 2,000+ names
 * of which this corpus uses six.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Explicit escape: this is U+00A0, not a plain space. It is the correct decode,
  // it trims away like any whitespace, and \s in the amount patterns matches it.
  nbsp: '\u00A0',
};

/** Highest valid Unicode code point. */
const MAX_CODE_POINT = 0x10ffff;
/** Surrogate range; decoding one yields a lone surrogate that breaks UTF-8. */
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;

/** One pass, so "&amp;#8377;" decodes to the literal "&#8377;", not to "₹". */
const ENTITY_PATTERN = /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi;

/**
 * NSE text is untrusted, so an out-of-range reference must yield the original
 * text rather than the RangeError `String.fromCodePoint` throws.
 */
function fromCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code < 0 || code > MAX_CODE_POINT) return null;
  if (code >= SURROGATE_START && code <= SURROGATE_END) return null;
  return String.fromCodePoint(code);
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(
    ENTITY_PATTERN,
    (match: string, decimal?: string, hex?: string, name?: string): string => {
      if (decimal !== undefined) {
        return fromCodePoint(Number.parseInt(decimal, 10)) ?? match;
      }
      if (hex !== undefined) {
        return fromCodePoint(Number.parseInt(hex, 16)) ?? match;
      }
      if (name !== undefined) {
        return NAMED_ENTITIES[name.toLowerCase()] ?? match;
      }
      return match;
    },
  );
}
