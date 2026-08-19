import { MarkedText } from '../../shared/ui/MarkedText';
import { JARGON_PATTERN, jargonFor, type Jargon } from './jargon';

/**
 * A claim, with the abbreviations in it made ASKABLE.
 *
 * The document's words are unchanged — this neither rewrites nor
 * shortens anything, because the verbatim gate does not bend for
 * readability. It only marks the terms a reader may not know and hands
 * the tap up to the card, which shows OUR one-line explanation of the
 * WORD. The reader who knows what EBITDA is sees a faint underline and
 * nothing else.
 *
 * JARGON IS SPLIT FIRST, then the remainder goes through MarkedText. It
 * has to be that order: FIGURE matches any bare number, so "FY26" was
 * being drawn as F-Y and a marked "26" — a figure the document never
 * printed as one. Taking the term out whole fixes that on the way past.
 */
export function GlossedText({
  text,
  onAsk,
}: {
  readonly text: string;
  readonly onAsk: (term: Jargon, matched: string) => void;
}): JSX.Element {
  const value = String(text);
  const parts: JSX.Element[] = [];
  JARGON_PATTERN.lastIndex = 0;
  let at = 0;
  let match = JARGON_PATTERN.exec(value);
  let key = 0;

  while (match !== null) {
    const entry = jargonFor(match[0]);
    if (entry === null) {
      JARGON_PATTERN.lastIndex = match.index + Math.max(1, match[0].length);
      match = JARGON_PATTERN.exec(value);
      continue;
    }
    if (match.index > at) {
      parts.push(
        <MarkedText key={key++} text={value.slice(at, match.index)} />,
      );
    }
    const matched = match[0];
    parts.push(
      <button
        key={key++}
        type="button"
        className="gloss"
        data-ui="brief-jargon"
        data-term={matched}
        aria-label={`What ${matched} means`}
        onClick={() => onAsk(entry, matched)}
      >
        {matched}
      </button>,
    );
    at = match.index + matched.length;
    match = JARGON_PATTERN.exec(value);
  }
  if (at < value.length) {
    parts.push(<MarkedText key={key++} text={value.slice(at)} />);
  }
  return <>{parts}</>;
}
