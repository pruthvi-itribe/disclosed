const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Filings land far outside market hours — results routinely arrive 17:00–21:00
 * IST. The window is deliberately wider than the trading session.
 */
const WINDOW_OPEN_HOUR_IST = 7;
const WINDOW_CLOSE_HOUR_IST = 23;

export function isInFilingWindow(now: Date): boolean {
  // Shift into a fresh Date and read UTC fields: this is independent of the
  // host timezone and leaves the caller's Date untouched.
  const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  return istHour >= WINDOW_OPEN_HOUR_IST && istHour < WINDOW_CLOSE_HOUR_IST;
}

export interface CadenceInput {
  /** New records ingested on the poll that just completed. */
  newCount: number;
  now: Date;
  hotIntervalMs: number;
  idleIntervalMs: number;
  /** New-record count at which the page is assumed to be filling fast. */
  burstThreshold: number;
}

/**
 * Delay before the next poll. A burst means the 20-record page is turning over
 * quickly, so we re-poll immediately rather than waiting out the interval and
 * risking a rollover.
 */
export function nextPollDelayMs({
  newCount,
  now,
  hotIntervalMs,
  idleIntervalMs,
  burstThreshold,
}: CadenceInput): number {
  if (newCount >= burstThreshold) return 0;
  return isInFilingWindow(now) ? hotIntervalMs : idleIntervalMs;
}
