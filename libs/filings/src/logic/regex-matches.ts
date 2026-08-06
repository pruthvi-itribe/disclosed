/**
 * Collects every match of a global pattern, without sharing regex state.
 *
 * A module-level `/g` regex carries a mutable `lastIndex`. Reuse it across two
 * documents and the second scan starts wherever the first one stopped, so a
 * label near the top of the page silently disappears — a bug that shows up as
 * "the extractor found nothing" for one filing in a batch and cannot be
 * reproduced by testing that filing on its own. Cloning per call makes every
 * scan independent.
 *
 * Returning `RegExpExecArray` rather than `RegExpMatchArray` is deliberate:
 * its `index` is required rather than optional, so callers do not need an
 * unreachable fallback for an offset that always exists.
 */
export function matchesOf(
  text: string,
  pattern: RegExp,
): readonly RegExpExecArray[] {
  const scanner = new RegExp(pattern.source, pattern.flags);
  const matches: RegExpExecArray[] = [];
  let match = scanner.exec(text);
  while (match !== null) {
    matches.push(match);
    // A pattern that can match the empty string would otherwise spin here.
    if (match[0].length === 0) scanner.lastIndex += 1;
    match = scanner.exec(text);
  }
  return matches;
}
