const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Formats a Date as the `dd-mm-yyyy` parameter NSE's date-range endpoint expects,
 * using the IST calendar day. A UTC-day formatting would silently shift filings
 * between 18:30 and 00:00 UTC onto the wrong day.
 */
export function toNseDateParam(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${pad(ist.getUTCDate())}-${pad(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()}`;
}
