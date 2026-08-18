export const duration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** ok under two minutes, warn under thirty, bad above. */
export const lagClass = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '';
  if (ms < 120000) return 'ok';
  if (ms < 1800000) return 'warn';
  return 'bad';
};
