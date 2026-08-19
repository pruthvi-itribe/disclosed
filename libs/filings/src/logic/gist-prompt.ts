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
 * BATCHED BECAUSE THE INSTRUCTION IS THE COST. A claim is ~40 tokens
 * against ~350 for the rules, so packing GIST_BATCH of them into one
 * request turns the instruction from the dominant cost into a fifth of
 * it, and the cached prefix turns the rest into a read.
 */

/**
 * Claims per request. Bounded rather than maximal: a reply carrying
 * fifty answers is one JSON parse failure away from fifty retries, and
 * the ordering contract below gets harder to check the longer it runs.
 */
export const GIST_BATCH = 10;

export const GIST_SYSTEM_PROMPT = `You shorten claims from Indian stock-exchange filings into a headline a phone can show in three lines.

You are given a list of items. Each has an "id" and a "claim": one line this service has already published about a filing.

For each item return "gist": THE LONGEST CONTIGUOUS RUN OF WORDS COPIED FROM THAT ITEM'S "claim" that still states its point, and that is at most ${GIST_MAX_CHARS} characters.

Rules:

1. COPY, DO NOT WRITE. The gist must appear inside the claim exactly as the claim writes it, as one unbroken run. Do not join two parts, do not reorder, do not change a word, a number, a unit or a spelling. A gist that is not a contiguous copy is rejected and wasted.
2. START WHERE A SENTENCE COULD. Begin at the claim's first word, or at the first word after a semicolon, colon or full stop inside it. Never begin after a comma, and never in the middle of a phrase.
3. END WHERE THE CLAIM PRINTED A JOIN. The word after your gist must be a comma, a semicolon, a colon, a full stop, or "and"/"or"/"but" — or your gist must end the claim. Never stop in the middle of a phrase: "confirmed as final" is wrong when the claim goes on to say "dividend", and "at least 1.10 times" is wrong when it goes on to say "the entire secured obligations".
4. KEEP THE FIGURE. If the claim prints an amount, a percentage, a share count or a rating, the gist must contain it. A gist that keeps the action and drops the number is rejected.
5. KEEP THE CONDITION. If the claim says something is subject to approval, pending, proposed, conditional, revised, withdrawn or not the case, the gist must keep that word. Dropping it states as done something the filing did not.
6. Between ${GIST_MIN_CHARS} and ${GIST_MAX_CHARS} characters, and meaningfully shorter than the claim. Shorter than the floor is a fragment, not a headline.
7. NEVER CUT AT AN "and" THAT JOINS ONE PHRASE'S OBJECTS. "7.20% of paid-up equity share capital and free reserves" cut before "and" says 7.20% of the capital alone, which is a different number. Cutting at an "and" that joins two whole statements is fine.
8. KEEP THE FIGURE means keep ONE the claim printed, not all of them. Dropping a second amount, a comparison or a date that follows a join is exactly what this task is for.
9. PREFER A SHORT TRUE CLAUSE TO NOTHING. Return an empty string only when no run of the claim satisfies the rules at all — not when the best one is short, and not when it leaves out detail the claim goes on to give. Most claims have a good gist.

Worked examples:

  claim: "Interim dividend of Rs. 7.50 per equity share confirmed as final dividend for the financial year ended 31st March, 2026."
  gist:  "Interim dividend of Rs. 7.50 per equity share confirmed as final dividend"
  why:   the next word is "for", which opens a phrase the sentence does not need.

  claim: "Became standalone net debt free as of 31 March 2026, after early redemption of ₹423 crore of Non-Convertible Debentures."
  gist:  "Became standalone net debt free as of 31 March 2026"
  why:   the next character is a comma. Cutting at "₹423 crore" instead would strand the amount from what it was paid on.

  claim: "ICRA reaffirmed the facility of Rs 25.00 crore at [ICRA]A1+"
  gist:  ""
  why:   every run either drops the amount or the rating, and both are the point.

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
}

/**
 * The user turn: the items, as JSON, and nothing else.
 *
 * THE SPAN IS NOT SENT ANY MORE. It was, until a dry run showed what
 * slicing raw extracted text produces — a hyphen-split word and a table
 * row, both honest — see `claim-gist.ts`. Dropping it also halves the
 * request: the claim is a wire line, the span is a PDF paragraph.
 */
export const buildGistRequest = (items: readonly GistRequestItem[]): string =>
  JSON.stringify(items.map((item) => ({ id: item.id, claim: item.claim })));

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
