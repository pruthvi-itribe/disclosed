import { FIGURE } from '../format/vocab';

/** A four-digit year on its own, and the months a filing writes dates with. */
const YEAR = /^(?:19|20)\d{2}$/;
const MONTH_BEFORE =
  /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*$/i;
const MONTH_AFTER =
  /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i;

/**
 * A DATE IS NOT A FIGURE, and marking one looks like a rendering fault:
 * "Agreement dated August 13, 2026" came back with "13," and "2026" wearing
 * the emphasis a rupee amount wears, mid-headline (seen on a card,
 * 2026-08-19). The bare-number branch of FIGURE cannot tell them apart, and
 * that regex is mirrored against the server fragment, so the judgement is
 * made HERE, on the match's neighbours:
 *
 *  - a bare 1900-2099 with no unit is a year, not a quantity;
 *  - a bare 1-2 digit number is a day when a month name sits on either
 *    side of it ("August 13, 2026", "13 August 2026"), or when a year
 *    follows it across a comma.
 *
 * A number carrying any unit or currency — 2026 crore, ₹2026 — never
 * reaches here: those matches include the unit, so they are not bare.
 */
const inDate = (text: string, match: RegExpExecArray): boolean => {
  const token = match[0].trim();
  const bare = /^\d[\d,]*$/.test(token);
  if (!bare) return false;
  const digits = token.replace(/,$/, '');
  if (YEAR.test(digits)) return true;
  if (digits.length > 2) return false;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return (
    MONTH_BEFORE.test(before) ||
    MONTH_AFTER.test(after) ||
    /^,?\s*(?:19|20)\d{2}\b/.test(after)
  );
};

/**
 * A claim with its document-printed figures marked — writeClaim as a
 * component. The text is model-proposed and was matched against an exchange
 * PDF; it reaches the DOM as React text nodes or it does not reach it at
 * all, and that rule does not bend for styling. It computes, converts and
 * compares nothing.
 */
export function MarkedText({ text }: { readonly text: string }): JSX.Element {
  const value = String(text);
  // Plain strings render as text nodes, matching the old writeClaim's DOM
  // shape exactly: text, span.fig, text.
  const parts: Array<string | JSX.Element> = [];
  FIGURE.lastIndex = 0;
  let at = 0;
  let match = FIGURE.exec(value);
  while (match !== null) {
    // A bare unit with no digits is not a figure; the alternation can match
    // an empty string, which would spin the loop.
    if (
      match[0].trim() === '' ||
      !/\d/.test(match[0]) ||
      inDate(value, match)
    ) {
      FIGURE.lastIndex = match.index + Math.max(1, match[0].length);
      match = FIGURE.exec(value);
      continue;
    }
    if (match.index > at) {
      parts.push(value.slice(at, match.index));
    }
    parts.push(
      <span key={`f${match.index}`} className="fig">
        {match[0]}
      </span>,
    );
    at = match.index + match[0].length;
    match = FIGURE.exec(value);
  }
  if (at < value.length) {
    parts.push(value.slice(at));
  }
  return <>{parts}</>;
}
