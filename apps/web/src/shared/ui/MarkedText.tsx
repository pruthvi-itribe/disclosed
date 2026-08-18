import { FIGURE } from '../format/vocab';

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
    if (match[0].trim() === '' || !/\d/.test(match[0])) {
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
