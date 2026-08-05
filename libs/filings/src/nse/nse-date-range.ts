import { IST_OFFSET_MS, pad2 } from '@app/common';

/**
 * Formats a Date as the `dd-mm-yyyy` parameter NSE's date-range endpoint expects,
 * using the IST calendar day. A UTC-day formatting would silently shift filings
 * between 18:30 and 00:00 UTC onto the wrong day.
 */
export function toNseDateParam(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${pad2(ist.getUTCDate())}-${pad2(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()}`;
}
