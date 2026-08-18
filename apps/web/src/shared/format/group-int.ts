/**
 * Plain thousands grouping, not lakh/crore — the same choice the old client
 * made, kept for parity.
 */
export const groupInt = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
