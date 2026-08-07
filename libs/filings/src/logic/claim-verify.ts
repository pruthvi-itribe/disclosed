import { hasAmbiguityKeyword } from './ambiguity';
import { advisoryHitIn, individualHitIn } from './claim-advisory';
import { unsupportedNumbers } from './claim-numbers';
import { PERIOD_CONTEXT_CHARS, supportPeriods } from './claim-period';
import { findVerbatimSpan, MIN_SPAN_CHARS } from './claim-span';
import {
  CLAIM_KIND_RANK,
  type ClaimDiscard,
  type ClaimDiscardReason,
  type ProposedClaim,
  type VerifiedClaim,
} from './claim.types';
import { LEGAL_BLOCK_PATTERNS } from './legal-block';

/**
 * The gate. Nothing reaches the wire that does not pass every check here.
 *
 * ================================================================
 * THE GOVERNING RULE, INHERITED FROM THE AMOUNT EXTRACTOR
 * ================================================================
 *
 * Refusing is a success and being wrong is a failure. Every ambiguity below is
 * resolved by discarding, and a discard is recorded with a reason rather than
 * silently dropped, because an extractor whose refusals are invisible is
 * indistinguishable from one that is not running.
 *
 * The claims arriving here were written by a language model. That is the entire
 * threat model: a model asked to compress a filing will eventually produce a
 * fluent, plausible, entirely invented corporate statement, and nothing
 * downstream can tell it from a real one. So this module assumes every claim is
 * invented until the document says otherwise, and the thing that makes the
 * document able to say so is the verbatim span.
 *
 * ================================================================
 * THE ORDER OF THE CHECKS IS PART OF THE DESIGN
 * ================================================================
 *
 * Cheap and categorical first, evidential last. A claim that is advisory or
 * about a person is refused whether or not its span is real, so those are
 * settled before the document is searched — and the recorded reason is then the
 * one a reviewer needs, rather than whichever check happened to run first.
 * `over-limit` is last of all, so a claim that would have been dropped for the
 * line being full is never reported as a claim that failed verification.
 */

/**
 * The most claims verification will keep for one filing.
 *
 * NOT THE SAME QUANTITY AS THE WIRE LINE'S, and conflating the two cost us most
 * of what the documents were saying. `MAX_CLAIMS_ON_WIRE` is a presentation
 * bound — a Telegram line a human reads in one glance — and it was being used
 * as the EXTRACTION bound as well, which meant the prompt asked a 40-slide
 * investor deck and a one-page notice for the same three facts.
 *
 * The live collection shows exactly what that cost: 803 of 1,096 filings
 * proposed precisely three claims, and 76 of 103 investor presentations
 * finished on three. Those are not documents that ran out of things to say;
 * they are documents that hit the number in the prompt. LUPIN filed a deck and
 * a press release covering the same quarter and we published one line from the
 * deck.
 *
 * Twelve, and the number is a ceiling on a tail rather than a target. It is
 * four times the wire line so a dense deck is read for everything it states,
 * and it is small enough that a model looping on near-duplicate sentences is
 * still bounded. What is stored is what the document supports; what is
 * published is `MAX_CLAIMS_ON_WIRE` of it.
 */
export const MAX_CLAIMS_EXTRACTED = 12;

/** The longest a single claim may be. */
export const MAX_CLAIM_CHARS = 120;

/** The shortest string that can be a claim rather than a fragment. */
export const MIN_CLAIM_CHARS = 10;

export interface ClaimVerificationInput {
  /** The document the spans must be found in. */
  readonly documentText: string;
  readonly proposed: readonly ProposedClaim[];
  readonly maxClaims?: number;
}

export interface ClaimVerification {
  readonly claims: readonly VerifiedClaim[];
  readonly discards: readonly ClaimDiscard[];
}

/** How much of a rejected claim is kept, and how much of the reason. */
export const MAX_DISCARDED_CLAIM_CHARS = 80;
export const MAX_DISCARD_DETAIL_CHARS = 200;

const CONTROL_CHARACTERS = /[\r\n\t]/g;

/**
 * Bounds and de-fangs a string on its way into a stored record.
 *
 * NOT `safeEcho`, and the difference is the audience. `safeEcho`'s 32-character
 * limit is right for a value embedded in a log line, where the surrounding
 * message carries the meaning. These strings ARE the meaning — the discard
 * reason is the whole product of a refusal — and truncating "the quoted source
 * is not in the document" to "the quoted source is not in the " turns a review
 * aid into a riddle. The newline strip is kept for the same reason `safeEcho`
 * has one: this is model output, and a newline forges a log line.
 */
const bounded = (value: string, limit: number): string =>
  value.replace(CONTROL_CHARACTERS, ' ').trim().slice(0, limit);

const discard = (
  reason: ClaimDiscardReason,
  claim: string,
  detail: string,
): ClaimDiscard => ({
  reason,
  claim: bounded(claim, MAX_DISCARDED_CLAIM_CHARS),
  detail: bounded(detail, MAX_DISCARD_DETAIL_CHARS),
});

/** Collapses whitespace so two spellings of the same claim compare equal. */
const key = (text: string): string =>
  text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Checks one claim against the document, or says which rule refused it.
 *
 * Returns the verified claim carrying the DOCUMENT'S span rather than the
 * extractor's, so what is stored and shown is the source's own bytes.
 */
function checkOne(
  claim: ProposedClaim,
  documentText: string,
): VerifiedClaim | ClaimDiscard {
  const text = claim.text.replace(/\s+/g, ' ').trim();

  if (text.length < MIN_CLAIM_CHARS) {
    return discard(
      'empty-claim',
      claim.text,
      'the claim is empty or a fragment',
    );
  }
  if (text.length > MAX_CLAIM_CHARS) {
    return discard(
      'too-long',
      text,
      `${text.length} characters exceeds the ${MAX_CLAIM_CHARS} a wire line may carry`,
    );
  }

  // Advisory framing is refused whether or not the span is real. A sentence
  // that tells a reader what to do with a security is not made publishable by
  // being genuinely present in a filing.
  const advisory = advisoryHitIn(text);
  if (advisory !== null) {
    return discard('advisory-language', text, advisory);
  }

  // Checked against the span as well as the claim: a claim can be about a
  // person without naming one, and the sentence it was read from is the tell.
  const individual = individualHitIn(text) ?? individualHitIn(claim.span);
  if (individual !== null) {
    return discard('names-an-individual', text, individual);
  }

  // The filing-level legal block already ran before the extractor was called.
  // This is the second half: a claim that is ITSELF about litigation,
  // enforcement, insolvency or fraud, drawn out of a filing whose category and
  // summary said nothing about any of it.
  const legal = LEGAL_BLOCK_PATTERNS.find(
    (pattern) => pattern.test(text) || pattern.test(claim.span),
  );
  if (legal !== undefined) {
    return discard(
      'legally-blocked',
      text,
      'the claim or its source sentence carries legal exposure',
    );
  }

  // The amount extractor's own conditional-language discipline, applied to the
  // sentence rather than the document. A document-wide test would refuse
  // everything — "subject to" is in the boilerplate of nearly every filing —
  // while a sentence-scoped one catches exactly the case that matters: a claim
  // read out of "we have received a letter of intent, subject to...".
  if (hasAmbiguityKeyword(claim.span)) {
    return discard(
      'conditional-language',
      text,
      'the source sentence is conditional or reports a rumour',
    );
  }

  if (claim.span.replace(/\s+/g, ' ').trim().length < MIN_SPAN_CHARS) {
    return discard(
      'span-too-short',
      text,
      `the quoted source is shorter than ${MIN_SPAN_CHARS} characters`,
    );
  }

  // THE HALLUCINATION CATCH. Everything above is about what a claim says;
  // this is the only check about whether the document said it.
  const match = findVerbatimSpan(documentText, claim.span);
  if (match === null) {
    return discard(
      'span-not-found',
      text,
      `the quoted source is not in the document: "${claim.span}"`,
    );
  }

  const unsupported = unsupportedNumbers(text, match.evidence);
  if (unsupported.length > 0) {
    return discard(
      'number-not-in-span',
      text,
      `states ${unsupported.join(', ')}, which the quoted source does not`,
    );
  }

  // THE PERIOD, neighbourhood-scoped. A figure must be in the sentence; the
  // quarter that sentence belongs to is stated by the slide header above it, so
  // demanding it inside the sentence refuses the shape almost every investor
  // presentation is written in. `claim-period.ts` argues the bound and the
  // measurements, and the check is on the LABEL rather than on its digits,
  // which is strictly stronger than the rule it replaces.
  const period = supportPeriods({
    claimText: text,
    span: match.evidence,
    spanOffset: match.offset,
    documentText,
  });
  if (period.missing.length > 0) {
    return discard(
      'period-not-in-context',
      text,
      `states ${period.missing.join(', ')}, which the quoted source and its ` +
        `surrounding ${PERIOD_CONTEXT_CHARS} characters do not`,
    );
  }

  return {
    text,
    span: match.evidence,
    kind: claim.kind,
    periodSpan: period.evidence,
  };
}

const isDiscard = (
  result: VerifiedClaim | ClaimDiscard,
): result is ClaimDiscard => 'reason' in result;

/**
 * Verifies every proposed claim and returns what may be published.
 *
 * NEVER THROWS and never partially accepts. A claim is whole or it is gone.
 *
 * Accepted claims are ordered by `CLAIM_KIND_RANK` and then by the order the
 * extractor proposed them, so the line leads with quantified guidance when the
 * document offered some. The sort is STABLE over the surviving claims only —
 * ranking before verification would let a discarded guidance claim push a real
 * expansion claim off the end of the line.
 */
export function verifyClaims(input: ClaimVerificationInput): ClaimVerification {
  const limit = input.maxClaims ?? MAX_CLAIMS_EXTRACTED;
  const accepted: VerifiedClaim[] = [];
  const discards: ClaimDiscard[] = [];
  const seen = new Set<string>();

  for (const proposal of input.proposed) {
    const result = checkOne(proposal, input.documentText);
    if (isDiscard(result)) {
      discards.push(result);
      continue;
    }
    if (seen.has(key(result.text))) {
      discards.push(
        discard(
          'duplicate',
          result.text,
          'the same claim was already accepted',
        ),
      );
      continue;
    }
    seen.add(key(result.text));
    accepted.push(result);
  }

  const ranked = [...accepted].sort(
    (left, right) => CLAIM_KIND_RANK[left.kind] - CLAIM_KIND_RANK[right.kind],
  );

  return {
    claims: ranked.slice(0, limit),
    discards: [
      ...discards,
      ...ranked
        .slice(limit)
        .map((claim) =>
          discard(
            'over-limit',
            claim.text,
            `the line already carries ${limit} claim(s)`,
          ),
        ),
    ],
  };
}
