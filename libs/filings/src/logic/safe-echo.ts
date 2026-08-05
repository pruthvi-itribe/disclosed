/** Cap on any untrusted value echoed into an error message or log line. */
export const MAX_ECHO_LENGTH = 32;

const CONTROL_CHARACTERS = /[\r\n\t]/g;

/**
 * Renders an untrusted value safe to embed in an error message.
 *
 * Two hazards, both from NSE-supplied strings reaching a log:
 * a newline lets a payload forge a second log line that is indistinguishable
 * from a real one, and an unbounded value floods the log. Control characters
 * become spaces and the result is truncated to `MAX_ECHO_LENGTH`.
 */
export const safeEcho = (value: string): string =>
  value.replace(CONTROL_CHARACTERS, ' ').slice(0, MAX_ECHO_LENGTH);
