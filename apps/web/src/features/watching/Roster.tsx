import { relativeTime } from '../../shared/format/relative-time';
import { WatchButton, type WatchControls } from '../../shared/ui/WatchButton';
import type { WatchedCompany } from '../../shared/types/account';

/**
 * The watchlist itself — every watched company, the quiet ones included,
 * in the order they were added (the server's order: activity ordering would
 * reshuffle the list under the cursor every four seconds). Rows key by
 * symbol so an unchanged poll preserves the reader's text selection.
 */
export function Roster({
  rows,
  watch,
  onOpenCompany,
}: {
  readonly rows: readonly WatchedCompany[];
  readonly watch: WatchControls | null;
  readonly onOpenCompany: (symbol: string) => void;
}): JSX.Element {
  return (
    <ul id="watch-roster" className="roster" data-ui="watching-roster">
      {rows.map((row) => (
        <li
          key={row.symbol}
          className="rosterrow"
          data-ui="watching-row"
          data-symbol={row.symbol}
        >
          <button
            type="button"
            className="sym"
            title={`All filings from ${row.symbol}`}
            onClick={() => onOpenCompany(row.symbol)}
          >
            {row.symbol}
          </button>
          <span className="rostername" title={row.companyName}>
            {row.companyName}
          </span>
          {/* Null is a real answer: "nothing yet in our window", never a
              date — this is a window on the exchange's output, not the
              whole of it. The copy does not age, so it carries no title. */}
          {row.lastFiledAt === null ? (
            <span className="rosterwhen">nothing yet in our window</span>
          ) : (
            <span className="rosterwhen" title={`${row.lastFiledAtIst} IST`}>
              {`last filed ${relativeTime(row.lastFiledAt)}`}
            </span>
          )}
          {watch !== null && (
            <WatchButton symbol={row.symbol} controls={watch} />
          )}
        </li>
      ))}
    </ul>
  );
}
