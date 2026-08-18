/**
 * How long ago, in the words a person uses.
 *
 * The one deliberate exception to "the server owns every time calculation".
 * IST is a fixed offset the server holds one definition of and a browser in
 * another timezone would render differently; "how long ago" is not a timezone
 * question at all — it is a difference between two instants, identical in
 * every timezone, and it has to move as the reader watches without a refetch.
 * The absolute IST string the server computed is still what the title carries.
 *
 * Falls back to the raw value rather than inventing one: an unparseable date
 * shows as itself, which is debuggable, instead of "just now", which is a lie.
 */
export const relativeTime = (iso: string | null | undefined): string => {
  if (typeof iso !== 'string' || iso === '') return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60 ? `${m % 60}m ago` : 'ago'}`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return `${Math.floor(d / 7)}w ago`;
};
