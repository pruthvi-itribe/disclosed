import { GIST_MAX_CHARS, GIST_MIN_CHARS } from './claim-gist';

/**
 * Asking a model to CHOOSE a headline, never to write one.
 *
 * The request carries a batch of claims, each with the span it was read
 * from, and the answer for each is a slice of that span. Nothing else is
 * admissible: `verifyGist` runs the same character-exact matcher that
 * admits claims, so a paraphrase — however good — is refused and the
 * filing keeps its full claim.
 *
 * BATCHED BECAUSE THE INSTRUCTION IS THE COST. Measured at these sizes,
 * one claim's span is ~150 tokens against ~300 for the rules; packing
 * GIST_BATCH of them into a request cuts the per-claim input roughly
 * fourfold. The backfill is ~855 claims over the collection, which is
 * ~86 requests.
 */

/**
 * Claims per request. Bounded rather than maximal: a reply carrying
 * fifty answers is one JSON parse failure away from fifty retries, and
 * the ordering contract below gets harder to check the longer it runs.
 */
export const GIST_BATCH = 10;

export const GIST_SYSTEM_PROMPT = `You shorten claims from Indian stock-exchange filings into a headline a phone can show in three lines.

You are given a list of items. Each has an "id", a "claim" (a wire line this service has already published) and a "span" (the sentence from the filing that the claim was read from, in the filing's own words).

For each item return "gist": THE LONGEST CONTIGUOUS RUN OF WORDS COPIED FROM THAT ITEM'S "span" that still states the point of the claim, and that is at most ${GIST_MAX_CHARS} characters.

Rules:

1. COPY, DO NOT WRITE. The gist must appear inside the span exactly as the span writes it, as one unbroken run. Do not join two parts of the span, do not reorder, do not change a word, a number, a unit or a spelling, and do not fix the document's punctuation. A gist that is not a contiguous copy is rejected and wasted.
2. Start and end at a sensible point. A gist may start mid-sentence if that is where the point starts, but it must not end on a word that needs the next one ("of", "for", "to", "and"), nor in the middle of a date or a number.
3. KEEP THE FIGURE. If the span prints an amount, a percentage, a share count or a rating, the gist must contain it. A gist that keeps the action and drops the number is rejected.
4. KEEP THE CONDITION. If the span says something is subject to approval, pending, proposed, conditional, revised, withdrawn or not the case, the gist must keep that word. Dropping it states as done something the filing did not.
5. Between ${GIST_MIN_CHARS} and ${GIST_MAX_CHARS} characters. Shorter than that is a fragment, not a headline.
6. If no run of the span satisfies every rule above, return an empty string for that item. An empty answer is correct and costs nothing; a rule-breaking one is discarded anyway.

Return one entry per input id, in the same order, and nothing else.`;

/** The response shape, enforced by the API rather than by hope. */
export const GIST_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    gists: {
      type: 'array',
      description: 'One entry per input item, in the input order.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: "The item's id, echoed back." },
          gist: {
            type: 'string',
            description:
              'A contiguous copy from that item’s span, or an empty string.',
          },
        },
        required: ['id', 'gist'],
        additionalProperties: false,
      },
    },
  },
  required: ['gists'],
  additionalProperties: false,
} as const;

export interface GistRequestItem {
  readonly id: string;
  readonly claim: string;
  readonly span: string;
}

/** The user turn: the items, as JSON, and nothing else. */
export const buildGistRequest = (items: readonly GistRequestItem[]): string =>
  JSON.stringify(
    items.map((item) => ({
      id: item.id,
      claim: item.claim,
      span: item.span,
    })),
  );

export interface GistAnswer {
  readonly id: string;
  readonly gist: string;
}

/**
 * Reads the reply into answers, dropping anything malformed.
 *
 * KEYED BY ID RATHER THAN BY POSITION, even though the prompt asks for
 * input order: a model that drops one item would otherwise shift every
 * answer after it onto the wrong claim, and a gist attached to the wrong
 * filing is the one failure the verbatim gate cannot catch — it would be
 * a perfect quote from a different company's document.
 */
export function parseGistResponse(raw: unknown): readonly GistAnswer[] {
  const body = raw as { gists?: unknown };
  if (!Array.isArray(body?.gists)) return [];
  const answers: GistAnswer[] = [];
  for (const entry of body.gists) {
    const row = entry as { id?: unknown; gist?: unknown };
    if (typeof row?.id !== 'string' || row.id === '') continue;
    if (typeof row?.gist !== 'string') continue;
    answers.push({ id: row.id, gist: row.gist });
  }
  return answers;
}
