/** The Just-now window: "what landed while I was reading" is a different
 * question from "what day was this", and 30 minutes is the line between
 * them — a market day is 400+ filings under one heading otherwise. */
const JUST_NOW_MS = 30 * 60 * 1000;

/**
 * Which heading a filing sits under, by STRING COMPARISON against the
 * server's own day keys and nothing else. IST rolls at 18:30 UTC and the
 * server owns that fact; pure subtraction once put Saturday 17:00 under
 * "Today" at Sunday 09:00. The spec asserts this module does no date
 * arithmetic. Before the first summary lands both anchors are null and
 * every filing is named by its day — never WRONG, only plainer.
 */
export const feedBucket = (
  istDay: string,
  iso: string,
  today: string | null,
  previous: string | null,
): string => {
  if (today !== null && istDay === today) {
    const ms = Date.now() - Date.parse(iso);
    // ms >= 0 rejects a future-stamped filing, so a slow browser clock
    // cannot put the whole day under "Just now".
    if (ms >= 0 && ms < JUST_NOW_MS) return 'Just now';
    return 'Earlier today';
  }
  if (previous !== null && istDay === previous) return 'Yesterday';
  return istDay;
};
