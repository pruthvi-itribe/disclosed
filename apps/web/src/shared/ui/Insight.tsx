import { DIRECTION_GLYPH, DIRECTION_LABEL } from '../format/vocab';
import { MarkedText } from './MarkedText';

/**
 * One insight line: the movement mark, then the claim — writeInsight as a
 * component, shared because the card and the focus dialog both draw it and
 * two copies would be two vocabularies.
 *
 * NO COLOUR ON THE MARK — the single most important rendering decision on
 * the page. Red and green ARE a view about the company, and the collection
 * says the view would be wrong: 13 of the 45 marked decreases are falling
 * bad loans, debt, borrowing costs or emissions. The mark is admissible
 * because it is derived, so the characters it was derived from travel with
 * it in the title for a reader to check without opening the PDF. A direction
 * with no glyph entry (unrated, never classified) draws nothing, which
 * already means what it means.
 */
export function Insight({
  text,
  direction,
  evidence,
}: {
  readonly text: string;
  readonly direction: string;
  readonly evidence: string;
}): JSX.Element {
  const glyph = DIRECTION_GLYPH.get(direction);
  return (
    <>
      {glyph !== undefined && (
        <span
          className="dir"
          data-ui="claim-direction"
          data-direction={direction}
          aria-label={DIRECTION_LABEL.get(direction)}
          title={
            evidence ? `Printed in the document: "${evidence}"` : undefined
          }
        >
          {glyph}
        </span>
      )}
      <MarkedText text={text} />
    </>
  );
}
