import { nextItems } from './company-model';
import type { FilingView } from '../../shared/types/api';

/**
 * What's next — the only forward-looking thing on this page that is a DATE.
 * The server decides "still ahead" (IST rolls at 18:30 UTC); the browser
 * holds no scheduling words and no calendar.
 */
export function NextUp({
  items,
}: {
  readonly items: readonly FilingView[];
}): JSX.Element {
  const found = nextItems(items);
  return (
    <div id="co-next-wrap" data-ui="company-next" hidden={found.length === 0}>
      <h2 className="bucket">What&apos;s next</h2>
      <p className="sectionnote" data-ui="company-next-note">
        Dates this company&apos;s own filings printed and that have not passed
        yet, with the sentence each was read from. Their calendar, not our
        forecast.
      </p>
      <ul id="co-next" className="plans">
        {found.map((entry) => (
          <li
            key={`${entry.date}|${entry.what}`}
            className="plan"
            data-ui="company-next-item"
          >
            <div className="nextwhen">{entry.date}</div>
            {/* The document's own word for the appointment, which is also
                the evidence that it is one. */}
            <div className="nextwhat">{entry.what}</div>
            <div className="planquote">
              {entry.span
                ? `"${String(entry.span).replace(/\s+/g, ' ').trim()}"`
                : 'No source sentence is stored for this line.'}
            </div>
            <div className="planwhen" title={`${entry.filedAt} IST`}>
              {`filed ${entry.filedOn}`}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
