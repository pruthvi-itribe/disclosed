import { hasUsableTextLayer } from '../logic/enrichment-policy';
import type { DoclingConverter } from './docling-client';
import {
  routeAfterFirstRead,
  type ParseRoute,
  type ParseRouteDecision,
} from './parse-route';

/**
 * One document's text, and which parser produced it.
 *
 * ================================================================
 * THE CHEAP READ IS NEVER THROWN AWAY
 * ================================================================
 *
 * Every path through this module starts from `pdf-parse`'s output and either
 * keeps it or replaces it wholesale. Nothing is merged, and that is deliberate:
 * a document assembled from two parsers' output is a document neither of them
 * produced, and the verbatim gate downstream would then be matching spans
 * against text that exists nowhere. A span is only evidence if some single
 * reading of the document actually contains it.
 *
 * So the replacement is atomic, and the record of which parser won is stored
 * beside the text. `route` says what read it; `fallbackReason` says what was
 * wanted and did not happen. A filing read by `pdf-parse` because Docling was
 * unreachable and a filing read by `pdf-parse` because that was the right answer
 * are the same text and completely different facts about the deployment.
 */

/** A document's text with the provenance of the parser that produced it. */
export interface RoutedRead {
  readonly text: string;
  /** Which parser's output `text` actually is. */
  readonly route: ParseRoute;
  /** Why that route, in words. Always set. */
  readonly routeReason: string;
  /**
   * Why the chosen route did not run, when it did not. Null on the ordinary
   * path.
   *
   * NEVER SILENT. This is the field an operator reads to discover that the
   * optional Python service has been down since Tuesday and every results
   * filing since has been read by the parser that gets the standalone statement
   * wrong.
   */
  readonly fallbackReason: string | null;
}

export interface RoutedReadInput {
  readonly category: string;
  /** The bytes, kept so an escalation does not have to re-fetch them. */
  readonly data: Buffer;
  /** Used as the multipart filename, for the service's own logs. */
  readonly fileName: string;
  /** What `pdf-parse` produced. */
  readonly text: string;
  /** The document's own page count, from `pdf-parse`. */
  readonly pages: number;
  /** Null when no Docling service is wired, which is a supported deployment. */
  readonly converter: DoclingConverter | null;
}

/**
 * Reads a document, escalating to Docling only where it measurably pays.
 *
 * NEVER THROWS and never returns less than it was given: on every failure of
 * the expensive parser the caller gets `pdf-parse`'s text back with a reason
 * recorded. The one exception to "never less" is the scanned case, where
 * `pdf-parse`'s text was 8 characters of page furniture to begin with and
 * Docling failing leaves the filing exactly where it already was.
 *
 * A DOCLING READ THAT COMES BACK EMPTY IS REJECTED. `do_ocr=false` on a
 * document whose text layer is worse than expected can return a near-empty
 * markdown skeleton, and storing that over a perfectly good `pdf-parse` reading
 * would turn a working filing into `no-text-layer` for no reason. The same
 * `hasUsableTextLayer` the worker uses decides it, so there is one definition of
 * "this is not really text".
 */
export async function readWithRouting(
  input: RoutedReadInput,
): Promise<RoutedRead> {
  const { category, data, fileName, text, pages, converter } = input;

  const decision: ParseRouteDecision = routeAfterFirstRead({
    category,
    pages,
    text,
    hasTextLayer: hasUsableTextLayer(text),
    doclingAvailable: converter !== null && converter.isAvailable(),
  });

  if (decision.route === 'pdf-parse' || converter === null) {
    return {
      text,
      route: 'pdf-parse',
      routeReason: decision.reason,
      fallbackReason: null,
    };
  }

  const converted = await converter.convert({
    data,
    fileName,
    ocr: decision.route === 'docling-ocr',
    // Non-null on every Docling route by construction; the fallback keeps the
    // compiler honest without inventing a branch a caller could reach.
    maxPages: decision.maxPages ?? 1,
  });

  if (converted.outcome !== 'ok') {
    return {
      text,
      route: 'pdf-parse',
      routeReason: decision.reason,
      fallbackReason: `${decision.route} was chosen but did not run: ${converted.message}`,
    };
  }

  if (!hasUsableTextLayer(converted.text)) {
    return {
      text,
      route: 'pdf-parse',
      routeReason: decision.reason,
      fallbackReason:
        `${decision.route} returned ${converted.text.length} character(s), ` +
        'which is not a usable text layer',
    };
  }

  return {
    text: converted.text,
    route: decision.route,
    routeReason: decision.reason,
    fallbackReason: null,
  };
}
