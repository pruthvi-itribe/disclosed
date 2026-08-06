import { decideAttachment } from './attachment';
import type { UnparseableReason } from './enrichment.types';

/**
 * Whether a filing already ruled `unparseable` deserves to be asked again,
 * because THIS PIPELINE changed its mind about the reason — not because the
 * document might have.
 *
 * ================================================================
 * THE PROBLEM THIS EXISTS FOR
 * ================================================================
 *
 * `unparseable` is terminal by design, and that design is load-bearing: without
 * it, 3.3% of NSE's PDFs and one entire 213-filing-a-month category are an
 * infinite retry loop aimed at the exchange. `enrichment.types.ts` argues it and
 * nothing here disputes it.
 *
 * But terminal means "no further attempt can produce a different answer", and
 * that is a statement about THE CODE THAT REACHED THE VERDICT as much as about
 * the document. Two deployments ago a `.zip` attachment recorded `not-a-pdf`
 * without ever being opened, and a 26 MB document recorded `oversized` against a
 * cap set 4% below it. Both verdicts were correct when they were written and
 * are simply wrong now — and because the state is terminal, the filings carry
 * them forever. 21 live filings are sitting on verdicts this pipeline no longer
 * agrees with.
 *
 * So the remedy is a deliberate, argued sweep run by an operator after a
 * deployment that changed how a reason is handled, and the thing that makes it
 * safe rather than reckless is that it is an ALLOWLIST. Resetting every
 * terminal filing would re-fetch 77 documents to re-derive 56 verdicts that
 * have not moved a millimetre, which is 56 archive requests spent to learn
 * nothing and 56 chances to make the collection worse.
 *
 * ================================================================
 * WHAT IS ADMITTED, AND WHY EACH ONE
 * ================================================================
 *
 * **`oversized` — the cap moved, and it moved because it was measured wrong.**
 * `MAX_ATTACHMENT_BYTES` went from 25 MiB to 64 MiB after the 8 refused
 * documents were re-fetched by HEAD and five of the six distinct files turned
 * out to have missed by 4-12%: a cap sitting inside the distribution rather
 * than beyond it. The parse budget the byte cap was pretending to be is now
 * `MAX_PDF_PAGES`, applied separately. All 8 were then verified to fetch AND
 * parse under the new bounds. This is not a hope that a re-fetch might behave
 * differently; it is a re-fetch under a different rule, measured on the exact
 * documents in question.
 *
 * **`not-a-pdf`, but only when the URL really is a ZIP.** ZIP archives are now
 * opened (`zip-text.ts`, `yauzl-reader.ts`) and 11 of 11 live archives were
 * verified to yield usable text — from 1,082 to 20,876 characters each.
 *
 * THE REASON ALONE IS NOT SHARP ENOUGH TO ACT ON, and this is the one place
 * this module does real work rather than consulting a set. `not-a-pdf` is the
 * fail-closed verdict for EVERY extension this pipeline does not read: `.xml`,
 * `.xlsx`, and a URL with no extension at all. Nothing changed for those, and
 * re-queuing them would spend an NSE request per filing to arrive back at the
 * identical string. So the URL is put through `decideAttachment` — the same
 * function the worker itself will use on the next attempt, never a private
 * copy of its rules — and only a `kind: 'zip'` answer is admitted. Asking the
 * real classifier is what keeps this module honest when the classifier changes
 * again: the day `.xlsx` becomes readable, this policy follows without being
 * edited.
 *
 * ================================================================
 * WHAT IS REFUSED, AND WHY EACH ONE IS STILL RIGHT
 * ================================================================
 *
 * Every remaining reason has an entry in `UNCHANGED_HANDLING` carrying its own
 * argument, so a refusal is as explainable as an admission and the operator
 * reads a sentence rather than a silence. The two that most look like they
 * ought to qualify, and do not:
 *
 *   - **`truncated-at-origin` / `unreadable-pdf`.** These ARE retryable — the
 *     LICHSGFIN filing proved this pipeline had lost a document to NSE's own
 *     upload race — and that retry already exists. `parse-retry.ts` landed in an
 *     EARLIER task and gave every one of them three attempts inside a one-hour
 *     window measured from `disseminatedAt`. The 11 live filings in this state
 *     have spent that budget already, against bytes that a fourth fetch would
 *     return byte-for-byte identical. Re-queuing them re-runs a decided
 *     experiment. Note what the window does to them anyway: every candidate a
 *     sweep like this touches is hours or days past dissemination, so
 *     `decideParseFailure` rules them terminal on the age test before it reads
 *     the counter. The re-queue would be a no-op that costs a request.
 *   - **`no-text-layer`.** The document parsed. It is a raster scan, the
 *     characters-per-page distribution separating it from a real document is
 *     bimodal with a gap two orders of magnitude wide, and OCR is the only
 *     remedy. THIS ONE CHANGED: there is now an OCR parser behind `DOCLING_URL`,
 *     measured recovering 20 of 20 of this exact population. So it is admitted
 *     when the deployment running the sweep has one, and still refused when it
 *     does not — see `RequeueInput.ocrAvailable`.
 *
 * ================================================================
 * WHAT THIS POLICY CANNOT SEE, STATED RATHER THAN HIDDEN
 * ================================================================
 *
 * It is a pure function of a reason and a URL, so it cannot tell a verdict
 * written by the OLD build from one the NEW build reached on the merits. A ZIP
 * that the current code opened and refused — a traversal name, a bomb ratio —
 * records `not-a-pdf` against a `.zip` URL and is indistinguishable here from
 * one that was never opened. This module will admit it, and the sweep will
 * spend one request to re-derive the same refusal.
 *
 * That is a deliberate division of labour rather than an oversight. Whether a
 * verdict predates a deployment is a fact about the RECORD, not about the
 * handling, and it belongs to the caller that can see the record — which is why
 * `requeue-terminal.ts` bounds repeated sweeps with the filing's own `attempts`
 * budget instead of asking this function to guess.
 */

/**
 * Reasons whose handling changed FOR EVERY DEPLOYMENT, subject to the
 * per-reason checks below.
 *
 * A SET AND NOT A PREDICATE, so `decideRequeue` cannot be the only place the
 * membership is written down and a test can pin the whole allowlist against
 * literals. Widening it must be a decision somebody argues in this file.
 *
 * `no-text-layer` is deliberately NOT here even though its handling changed,
 * because it changed CONDITIONALLY: a deployment with no `DOCLING_URL` has no
 * OCR parser and must still refuse those filings. Putting it in an
 * unconditional set would make the sweep re-fetch 21 raster scans on a machine
 * that cannot read them. `RequeueInput.ocrAvailable` carries that condition.
 */
export const REHANDLED_REASONS: ReadonlySet<UnparseableReason> = new Set([
  'not-a-pdf',
  'oversized',
]);

/**
 * Why every other reason is still the right answer.
 *
 * Total over the reasons `REHANDLED_REASONS` does not contain, enforced by the
 * `Exclude` rather than by a default arm: a fallback string would be a branch
 * no input reaches and a place for a new `UnparseableReason` to arrive
 * unexamined. Adding one to the union breaks this object until somebody writes
 * down what re-queuing it would and would not achieve.
 */
const UNCHANGED_HANDLING: Readonly<
  Record<Exclude<UnparseableReason, 'not-a-pdf' | 'oversized'>, string>
> = {
  'no-attachment':
    'the filing carries no attachment url — NSE sent the "-" sentinel, an ' +
    'empty field or a value that is not a url — so there is nothing to fetch, ' +
    'at any cap and with any reader',
  'untrusted-host':
    'the url points off the NSE archive hosts, and the allowlist that refused ' +
    'it is a server-side-request-forgery control rather than a capability gap',
  'truncated-at-origin':
    'a re-fetch of these bytes is already implemented: parse-retry.ts grants ' +
    'three attempts inside an hour of dissemination, this filing has spent ' +
    'them, and it is now far outside the window that made them meaningful',
  'unreadable-pdf':
    'same budget, same window, same spent allowance as truncated-at-origin — ' +
    'and the parser that could not read the document has not been replaced',
  // Reached only when this deployment has NO OCR parser configured; with one,
  // `decideRequeue` answers before it consults this table.
  'no-text-layer':
    'the document parsed and carries no text: it is a raster scan, and this ' +
    'deployment has no OCR parser configured (DOCLING_URL is unset), so a ' +
    're-read measures the same zero characters',
  'not-found':
    'the exchange answered about the request with a 404 or 410, which is a ' +
    'statement about what it holds and not about what this pipeline can read',
  rejected:
    'the exchange refused the request in a way a retry cannot fix; nothing ' +
    'about how this pipeline asks has changed',
};

export interface RequeueInput {
  /** The verdict currently stored on the filing. */
  readonly reason: UnparseableReason;
  /** The filing's `attachmentUrl`, exactly as NSE sent it. */
  readonly attachmentUrl: string | null;
  /**
   * Whether this deployment has a parser that can read a raster scan.
   *
   * THE ONE THING THAT CHANGES A `no-text-layer` VERDICT, and it is an input
   * rather than an assumption because it is a property of the DEPLOYMENT rather
   * than of the filing. `DOCLING_URL` ships unset, so a sweep run against a
   * pipeline with no Docling service must still refuse these — re-fetching 21
   * raster scans to re-measure zero characters is exactly the wasted archive
   * request this module exists to prevent.
   *
   * Defaults to false, so every existing caller keeps the answer it had.
   */
  readonly ocrAvailable?: boolean;
}

export type RequeueDecision =
  /** Ask again. The handling of this filing's verdict has changed. */
  | { readonly outcome: 'requeue'; readonly explanation: string }
  /** Leave it terminal. Asking again would reach the same answer. */
  | { readonly outcome: 'keep'; readonly explanation: string };

const requeue = (explanation: string): RequeueDecision => ({
  outcome: 'requeue',
  explanation,
});

const keep = (explanation: string): RequeueDecision => ({
  outcome: 'keep',
  explanation,
});

/**
 * Decides whether re-queuing a terminal filing can produce a different answer.
 *
 * DEFAULTS TO KEEP, the same way `decideParseFailure` defaults to terminal and
 * for a sharper version of the same reason: the cost of a wrong `keep` is a
 * filing that stays as invisible as it already is until the next sweep, and the
 * cost of a wrong `requeue` is an archive request spent on a third party that
 * has never been asked to tolerate this pipeline's mistakes. Every clause has
 * to argue its way OUT of keep.
 *
 * Both outcomes carry a sentence, because a sweep that prints only what it
 * touched is unauditable — the interesting question after a run like this is
 * usually why a filing the operator expected to move did not.
 */
export function decideRequeue(input: RequeueInput): RequeueDecision {
  const { reason, attachmentUrl } = input;

  if (reason === 'no-text-layer' && input.ocrAvailable === true) {
    // THE ONE CLAUSE THIS WORK ADDED, and it is the only reason on the list
    // whose "nothing has changed" argument stopped being true. The old text
    // said "there is no OCR in this pipeline"; there is now, behind
    // `DOCLING_URL`, and it was measured recovering 20 of 20 of exactly this
    // population with 25 of 25 ground-truth digits verbatim.
    return requeue(
      'the document is a raster scan and this deployment now has an OCR ' +
        'parser: Docling recovered 20 of 20 of these documents in the parsing ' +
        'spike, against the 2 to 97 characters pdf-parse returns for them',
    );
  }

  if (reason === 'oversized') {
    // No URL check. An `oversized` verdict is itself proof that the url passed
    // `decideAttachment`, because the cap is only consulted once a fetch has
    // begun — and the classifier has only ever widened, never narrowed, so a
    // url that was fetchable then is fetchable now.
    return requeue(
      'the download cap was raised from 25 MiB to 64 MiB and the parse is now ' +
        'bounded by its own page budget, so the size that refused this ' +
        'document is no longer the size that refuses one',
    );
  }

  if (reason === 'not-a-pdf') {
    const decision = decideAttachment(attachmentUrl);

    if (decision.outcome === 'skip') {
      return keep(
        `the url is still refused before any fetch, as ${decision.reason}; ` +
          'the ZIP work did not widen what this pipeline will open',
      );
    }

    if (decision.kind === 'zip') {
      return requeue(
        'the attachment is a ZIP archive, and archives are now opened and ' +
          'their PDF entries read rather than refused unexamined',
      );
    }

    // A `.pdf` url carrying a `not-a-pdf` verdict. The current worker cannot
    // produce that pairing — bytes that will not parse become `unreadable-pdf`
    // or `truncated-at-origin` — so it means the record predates a
    // classification this pipeline no longer performs. Re-queuing on a guess
    // about what an older build meant is exactly the blanket reset this module
    // exists to refuse.
    return keep(
      'the url resolves to a PDF, so this verdict was not reached by the ' +
        'extension check the ZIP work changed and there is nothing here to undo',
    );
  }

  return keep(UNCHANGED_HANDLING[reason]);
}
