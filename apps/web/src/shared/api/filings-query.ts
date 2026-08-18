import type { FilterState } from '../../app/filter-state';

export type ViewName = 'brief' | 'feed' | 'company' | 'watching';

/**
 * The Brief's window: the server caps a page at 200, and a verified IST day
 * is 326 to 463 filings — the deck cannot see a whole day from one request,
 * which is why the cover states the window it was drawn from.
 */
export const BRIEF_WINDOW = 200;

/** "Roughly ten months of the heaviest measured filer." */
const COMPANY_WINDOW = 200;

/**
 * The one place a filings URL is built, ported from the old client's
 * query() with its priority order intact: an open company ignores every
 * feed filter deliberately, the Brief asks its own fixed question, and only
 * the feed serialises the filter state. The admin parameters (category,
 * group, tier picks, enrichment state, amount, refusal) do not exist in
 * this client and are left behind on purpose.
 */
export const filingsQuery = (
  filters: FilterState,
  view: ViewName,
  company: string | null,
): string => {
  if (company !== null) {
    return `/api/filings?limit=${COMPANY_WINDOW}&offset=0&symbol=${encodeURIComponent(company)}`;
  }
  if (view === 'brief') {
    return `/api/filings?tier=verified&offset=0&limit=${BRIEF_WINDOW}`;
  }
  const parts = [`limit=${filters.limit}`, `offset=${filters.offset}`];
  if (filters.onlyInsights) parts.push('tier=verified');
  if (filters.q) parts.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters.symbol)
    parts.push(`symbol=${encodeURIComponent(filters.symbol)}`);
  if (filters.group) parts.push(`group=${encodeURIComponent(filters.group)}`);
  if (filters.topic) parts.push(`topic=${encodeURIComponent(filters.topic)}`);
  // The literal single value the server accepts; anything else answers 400.
  if (filters.plans) parts.push('plans=only');
  return `/api/filings?${parts.join('&')}`;
};
