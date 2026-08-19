import { DIRECTION_LABEL } from '../../shared/format/vocab';
import { DirectionMark } from '../../shared/ui/DirectionMark';
import { markDays } from './company-model';
import type { FilingView } from '../../shared/types/api';

/**
 * Movement, as the filings printed it. The glyphs and labels are the feed's
 * shared vocabulary — a second copy would be a second vocabulary for one
 * thing. No count anywhere and no colour: 13 of the 45 printed decreases in
 * this collection are falling bad loans, debt, borrowing costs or emissions.
 */
export function Marks({
  items,
}: {
  readonly items: readonly FilingView[];
}): JSX.Element {
  const days = markDays(items);
  return (
    <div id="co-marks-wrap" data-ui="company-marks" hidden={days.length === 0}>
      <h2 className="bucket">Movement, as the filings printed it</h2>
      <p className="sectionnote" data-ui="company-marks-note">
        One mark for each claim whose sentence printed a direction, oldest
        first. A mark is not good or bad news — a falling number is a fall in
        bad loans as often as in profit — so there is no colour, and the words
        the document printed are in each mark&apos;s title.
      </p>
      <div id="co-marks" className="marks">
        {days.map((day) => (
          <div key={day.day} className="markday" data-ui="company-mark-day">
            <span className="markwhen">{day.day}</span>
            <span className="markrow">
              {day.claims.map((claim, i) => (
                <span
                  key={i}
                  className="dir"
                  data-ui="company-mark"
                  data-direction={claim.direction ?? ''}
                  aria-label={DIRECTION_LABEL.get(claim.direction ?? '')}
                  title={
                    claim.directionEvidence
                      ? `Printed in the document: "${claim.directionEvidence}"`
                      : undefined
                  }
                >
                  <DirectionMark direction={claim.direction ?? ''} size={13} />
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
