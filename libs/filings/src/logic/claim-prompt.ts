import { CLAIM_KINDS, type ClaimKind, type ProposedClaim } from './claim.types';
import { MAX_CLAIM_CHARS, MAX_CLAIMS_EXTRACTED } from './claim-verify';
import { MAX_SPAN_CHARS } from './claim-span';

/**
 * What the extractor is asked, and how its answer is read back.
 *
 * PURE. No SDK, no network, no key. The prompt and the schema are data, and the
 * parser treats the model's reply as untrusted input like any other — which is
 * what lets the whole language-model surface be tested without a request ever
 * leaving the process.
 *
 * ================================================================
 * KEEPING THE PROMPT OUT OF INTERPRETATION
 * ================================================================
 *
 * The failure this feature exists to avoid is not a badly-worded line, it is a
 * confidently-worded line the filing does not support. Four things in the
 * prompt push against that, and none of them is trusted on its own — every one
 * is also enforced by `claim-verify.ts`, because a prompt is a request and a
 * gate is a control:
 *
 *   1. **The quote comes first.** `span` precedes `text` in the schema, so the
 *      model finds a sentence before it writes a claim, rather than writing a
 *      claim and then hunting for support.
 *   2. **One sentence, one claim.** Combining two sentences is where invention
 *      enters: each is true, the join is the model's, and the join is what
 *      reaches the wire.
 *   3. **No arithmetic and no conversion.** `₹10,000 Cr` stays `₹10,000 Cr` and
 *      does not become `100 billion`. It is the same money and it is not the
 *      same evidence, and the number gate refuses the conversion anyway.
 *   4. **Nothing is better than something.** The instruction to return an empty
 *      list is stated as the expected outcome rather than as a fallback, because
 *      most filings genuinely contain nothing worth a wire line.
 */

/**
 * How much of the document is sent.
 *
 * Investor presentations reach 87,000 characters in the live collection, most
 * of it appendix tables. The narrative that carries claims — opening remarks,
 * business highlights, the press release itself — is at the front, so the head
 * is what is sent. A cap is also a cost control: 24,000 characters is about
 * 6,000 tokens, and the difference between capping and not is roughly fourfold
 * on the largest documents.
 *
 * Spans are still verified against the FULL document, so truncation can only
 * cost a claim, never admit an unverifiable one.
 */
export const MAX_DOCUMENT_CHARS = 24_000;

/**
 * The instruction, held stable so it can be cached.
 *
 * This string is the cacheable prefix of every request: unchanging across
 * filings, well past the 512-token minimum, and worth roughly a tenfold
 * reduction on its own tokens once the first call of a five-minute window has
 * paid for it. Nothing filing-specific may be interpolated into it — that would
 * make every request a cache miss, which is the single most expensive mistake
 * available here.
 */
export const CLAIM_SYSTEM_PROMPT = `You extract notable claims from Indian stock-exchange filings for a wire service.

A notable claim is something the company states about ITSELF that a market reader would want in one line: guidance, a target, an expansion, a partnership, an approval, or a comparable operational fact. Routine disclosure, boilerplate, safe-harbour text, address blocks, and the mere existence of an enclosure are not claims.

For each claim you return two things:

- "span": the sentence or clause from the document that states it, quoted EXACTLY as the document writes it. Copy it character for character. Do not fix spelling, expand abbreviations, or join separate sentences. Line breaks in the document are fine to normalise to single spaces; nothing else may change.
- "text": that same statement compressed into wire style — terse, factual, and derived only from the words in the span.

Rules:

1. One claim comes from one span. Never combine two sentences into one claim.
2. Every figure in "text" must appear in "span" as written. Do not convert units, do not compute percentages, do not restate crore as billion, do not round.
3. State only what the span states. No adjectives of judgement, no comparisons the document does not make, no inference about what a fact implies.
4. Never write predictive or advisory language about the security: no buy, sell, hold, target price, upside, downside, bullish, bearish, valuation judgement, or anything about the share price. The company's own forward statements about its business ("expects volume growth of 16-18%") are fine and are exactly what is wanted; a view about the stock is not.
5. Never write a claim about an individual, or about anyone being appointed, resigning, or ceasing to hold office.
6. Never write a claim about litigation, a regulator's enforcement action, insolvency, or fraud.
7. Skip anything conditional or unconfirmed: a letter of intent, an in-principle approval, a memorandum of understanding, a media report, anything "subject to" a further step.
8. Return up to ${MAX_CLAIMS_EXTRACTED} claims, best first. Return as many as the document genuinely supports: a one-page notice may hold none and a results presentation may hold ten, and a long document is not a reason to stop at three. Do not pad, do not split one fact across two entries, and do not restate the same fact in different words. Keep each "text" under ${MAX_CLAIM_CHARS} characters and each "span" under ${MAX_SPAN_CHARS}.

Most filings contain nothing worth a wire line. Returning an empty list is the normal and correct answer, not a failure. A claim you cannot quote exactly is a claim you must not return.

Separately from the claims, also return "summary": one or two sentences saying what this document is, in plain language, for a reader deciding whether to open it. This is NOT a claim and is never published: it is context for a human reviewer. It needs no span and is not checked against the document, so keep it to what the document plainly says. The same rules 4, 6 and 7 above apply to it — no view about the security, nothing about litigation or enforcement, nothing conditional stated as fact. Return an empty string if the document says too little to summarise.`;

/**
 * The response shape, enforced by the API rather than by hope.
 *
 * `additionalProperties: false` and an explicit `required` on every object are
 * what `strict`-style validation needs. Array bounds are deliberately absent —
 * they are not among the supported JSON-Schema constraints, and a schema the
 * API silently ignores is worse than one that does not claim the guarantee.
 * `verifyClaims` enforces the count.
 */
export const CLAIM_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      description: 'Notable claims, best first. Empty when there are none.',
      items: {
        type: 'object',
        properties: {
          // FIRST, deliberately: the model quotes before it compresses.
          span: {
            type: 'string',
            description:
              'The exact sentence from the document that states the claim.',
          },
          text: {
            type: 'string',
            description: 'The claim in compressed wire style.',
          },
          kind: { type: 'string', enum: [...CLAIM_KINDS] },
        },
        required: ['span', 'text', 'kind'],
        additionalProperties: false,
      },
    },
    // AFTER `claims`, deliberately, and the reason is the same one that puts
    // `span` before `text`: the model quotes before it composes. A summary
    // written first is a frame the claims would then be selected to fit.
    summary: {
      type: 'string',
      description:
        'One or two plain sentences saying what this document is. Never published.',
    },
  },
  required: ['claims', 'summary'],
  additionalProperties: false,
} as const;

export interface ClaimRequestInput {
  readonly symbol: string;
  readonly category: string;
  readonly summary: string;
  readonly documentText: string;
  /** Overrides `MAX_DOCUMENT_CHARS`. Zero and negative values are ignored. */
  readonly maxDocumentChars?: number;
}

/**
 * The per-filing half of the request.
 *
 * Kept strictly separate from the system prompt so the cacheable prefix stays
 * byte-identical between calls. The category and summary are included because
 * they say what the exchange thinks the filing is about, which helps the model
 * tell a business update from a covering letter — and they are exchange text,
 * so they are labelled as such rather than presented as instructions.
 */
export function buildClaimRequest(input: ClaimRequestInput): string {
  // A zero or negative override is ignored rather than obeyed. Obeying it would
  // send an empty `<document>` and record "the model found nothing" on every
  // eligible filing — a misconfiguration that looks exactly like a quiet market.
  const cap =
    input.maxDocumentChars !== undefined && input.maxDocumentChars > 0
      ? input.maxDocumentChars
      : MAX_DOCUMENT_CHARS;
  const document = input.documentText.slice(0, cap);
  const truncated = input.documentText.length > cap;

  return [
    `Symbol: ${input.symbol}`,
    `Exchange category: ${input.category}`,
    `Exchange summary: ${input.summary}`,
    '',
    truncated
      ? `Document text (first ${cap} characters of ${input.documentText.length}):`
      : 'Document text:',
    '<document>',
    document,
    '</document>',
  ].join('\n');
}

const isClaimKind = (value: unknown): value is ClaimKind =>
  typeof value === 'string' &&
  (CLAIM_KINDS as readonly string[]).includes(value);

/**
 * Reads the model's reply into proposed claims, discarding anything malformed.
 *
 * DEFENSIVE EVEN THOUGH THE SCHEMA IS ENFORCED. Structured outputs constrain a
 * successful response; they do not cover a truncated one, a refusal, a
 * middlebox rewriting the body, or a future SDK that hands back a differently
 * shaped object. Every field is checked, and a malformed entry is dropped rather
 * than repaired — repairing would be this module authoring a claim.
 *
 * NEVER THROWS. A reply this cannot read yields no claims, which the caller
 * records as a refusal with a reason.
 */
export function parseClaimResponse(raw: unknown): readonly ProposedClaim[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const claims = (raw as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) return [];

  const proposed: ProposedClaim[] = [];
  for (const entry of claims) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { span, text, kind } = entry as Record<string, unknown>;
    if (typeof span !== 'string' || typeof text !== 'string') continue;
    if (!isClaimKind(kind)) continue;
    proposed.push({ span, text, kind });
  }
  return proposed;
}

/**
 * Reads the summary out of the same reply, or nothing.
 *
 * A SEPARATE FUNCTION from `parseClaimResponse`, and separate all the way
 * down. The two outputs of one call have different guarantees — claims are
 * verified against the document and a summary cannot be — so they are never
 * carried in one structure that a caller could accidentally treat uniformly.
 *
 * Returns the raw string. `vetSummary` is what decides whether it is usable,
 * for the same reason `verifyClaims` rather than this module decides about a
 * claim: reading a reply and judging it are different jobs.
 */
export function parseSummaryResponse(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const summary = (raw as { summary?: unknown }).summary;
  return typeof summary === 'string' ? summary : null;
}
