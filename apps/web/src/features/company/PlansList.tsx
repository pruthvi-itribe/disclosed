import { planItems } from './company-model';
import type { FilingView } from '../../shared/types/api';

/**
 * Plans, in their words — quotes and dates, nothing composed, counted or
 * characterised. The deciding words ride in each item's title, the same rule
 * the movement mark follows: a derived judgement is admissible only when the
 * reader can check it without opening the PDF.
 */
export function PlansList({
  items,
}: {
  readonly items: readonly FilingView[];
}): JSX.Element {
  const found = planItems(items);
  return (
    <div id="co-plans-wrap" data-ui="company-plans" hidden={found.length === 0}>
      <h2 className="bucket">Plans, in their words</h2>
      <p className="sectionnote" data-ui="company-plans-note">
        Quoted from the filings held here, where the company itself pointed at a
        period still ahead — its own guidance, or a target it has set. Their
        words, not our forecast, and not a view on the company.
      </p>
      <ul id="co-plans" className="plans">
        {found.map((item, i) => (
          <li
            key={i}
            className="plan"
            data-ui="company-plan"
            title={`The company printed: "${item.evidence}"`}
          >
            <div className="planquote">{item.quote}</div>
            <div className="planwhen" title={`${item.filedAt} IST`}>
              {item.filedOn}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
