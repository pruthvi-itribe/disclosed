# A shared post that says what happened — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shared filing carries the figure and the second claim it already
verified, instead of throwing both away between storage and the reader.

**Architecture:** Four independent changes against the approved spec
`docs/superpowers/specs/2026-08-13-share-post-substance-design.md`. Two raise
constants whose current values enforce a wire-line constraint as a storage
gate; one tightens a guard that let a sentence through where a company name
belongs; one puts an already-verified figure onto the two share surfaces. No
verification rule weakens: every claim these changes recover was already
string-matched against its source document and discarded afterwards, on length
alone.

**Tech Stack:** TypeScript, NestJS monorepo, Jest, Playwright.

## Global Constraints

Every task's requirements implicitly include this section.

- **The verbatim gate does not move.** Nothing may reach a reader that was not
  string-matched against the source document. No task adds derived arithmetic,
  and no task relaxes `MIN_CLAIM_CHARS`, `MAX_CLAIMS_EXTRACTED` or
  `MAX_CLAIMS_ON_WIRE`.
- **`apps/dashboard/src/ui/script/*.ts` are TypeScript template literals.** A
  backtick or `${` anywhere in those files — INCLUDING INSIDE A COMMENT — is
  consumed by the compiler and breaks the page while still serving 200.
  `script-fragments.spec.ts` guards this and must stay green.
- **Client-script regexes need doubled backslashes** (`\\d`, `\\n`), because
  the template literal eats single ones. The served page is what must be
  asserted, not the source.
- **Comments cite measurements.** A threshold carries the sweep that placed it.
  Where a number changes, the comment's arithmetic is updated with it rather
  than left stale.
- **One logical change per commit**, conventional format, evidence in the body.
- **Gates, all four:** `npm test` (5,583 tests, ~18s), `npx tsc --noEmit -p
  tsconfig.json`, `npm run lint`, and `npx playwright test` against a local
  `AUTH_MODE=local` stack on `:7717`.
- **Branch:** `fix/share-post-substance`, already created off `main`.

**The measured sweep every task refers to** (production corpus, 2,763 filings,
2026-08-13):

```
kept claims (5,095)   p50  66   p75  85   p90 102   p95 110   p99 118   max 120  <- clipped by the cap
too-long discards     154 total, 92 carrying a digit,
                      39 that left the filing with ZERO claims, 36 with one
discarded lengths     min 121   p25 123   p50 128   p75 133   p90 143   max 203
recovered by bound    <=140 86%   <=160 95%   <=180 99%   <=200 99%   <=240 100%
share post            of 1,193 filings holding a claim, 33 have a verified
                      amount and NO claim containing a single digit
counterparty          9 exist corpus-wide, 1 is a sentence rather than a name
```

---

## File Structure

| File | Change |
|---|---|
| `libs/filings/src/logic/claim-verify.ts` | `MAX_CLAIM_CHARS` 120 → 200, comment rewritten to the sweep |
| `libs/filings/src/logic/claim-verify.spec.ts` | boundary tests move to the new number |
| `libs/filings/src/logic/claim-line.ts` | `MAX_CLAIM_LINE_CHARS` 400 → 640, arithmetic in the comment updated |
| `libs/filings/src/logic/claim-line.spec.ts` | a three-claim line at the new maximum still fits |
| `libs/filings/src/logic/counterparty.ts` | new `VERB_OPENER` guard + `'phrase-not-name'` refusal reason |
| `libs/filings/src/logic/counterparty.spec.ts` | the malformed value is refused; the documented ones still are |
| `apps/dashboard/src/ui/script/script-share.ts` | the amount enters the WhatsApp text |
| `apps/dashboard/src/ui/script/script-share-image.ts` | the amount enters the picture |
| `apps/dashboard/src/ui/script/script-share.spec.ts` | both surfaces asserted together |

---

### Task 1: The claim cap becomes a storage bound

**Files:**
- Modify: `libs/filings/src/logic/claim-verify.ts:72-73`
- Test: `libs/filings/src/logic/claim-verify.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MAX_CLAIM_CHARS = 200`, exported from
  `libs/filings/src/logic/claim-verify.ts`. Task 2 depends on this value for
  its arithmetic.

- [ ] **Step 1: Write the failing test**

Add to `libs/filings/src/logic/claim-verify.spec.ts`. Build the claim text so
the span is genuinely present in the document — this suite verifies against a
real document string, and a claim that is not in the document is discarded for
`span-not-found` long before length is considered.

```ts
describe('the storage bound on a claim', () => {
  // 200 exactly, made of the document's own words so only LENGTH is under test.
  const claimOf = (n: number): string => 'A'.repeat(n);

  it('accepts a claim of exactly MAX_CLAIM_CHARS', () => {
    const text = claimOf(MAX_CLAIM_CHARS);
    const result = verifyClaims(
      { documentText: `The filer stated: ${text}`, proposed: [{ text }] },
    );

    expect(MAX_CLAIM_CHARS).toBe(200);
    expect(result.discards.filter((d) => d.reason === 'too-long')).toHaveLength(0);
  });

  it('discards one character past it, and records the true length', () => {
    const text = claimOf(MAX_CLAIM_CHARS + 1);
    const result = verifyClaims(
      { documentText: `The filer stated: ${text}`, proposed: [{ text }] },
    );

    const tooLong = result.discards.filter((d) => d.reason === 'too-long');
    expect(tooLong).toHaveLength(1);
    expect(tooLong[0].detail).toContain('201 characters');
    expect(tooLong[0].detail).toContain('200');
  });
});
```

Import `MAX_CLAIM_CHARS` alongside the existing imports at the top of the file
if it is not already imported.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx jest libs/filings/src/logic/claim-verify.spec.ts -t 'storage bound'
```

Expected: FAIL. `expect(MAX_CLAIM_CHARS).toBe(200)` receives `120`, and the
121-to-200-character claim is discarded as `too-long` when the first test
expects it kept.

- [ ] **Step 3: Raise the constant and rewrite its comment**

Replace lines 72-73 of `libs/filings/src/logic/claim-verify.ts`:

```ts
/** The longest a single claim may be. */
export const MAX_CLAIM_CHARS = 120;
```

with:

```ts
/**
 * The longest a single claim may be, IN STORAGE.
 *
 * RAISED FROM 120 ON 2026-08-13, because 120 was a wire-line constraint being
 * enforced as a storage gate. `claim-line.ts` sized its own backstop from it
 * — three claims plus separators plus the longest NSE symbol — and that is a
 * fact about the Telegram one-liner, which is one of five surfaces. The card
 * wraps, the picture wraps, the company page wraps.
 *
 * The codebase already draws this distinction one level up and says so:
 * twelve claims stored, `MAX_CLAIMS_ON_WIRE` published. Length had not been
 * given the same treatment, so a presentation limit was deleting verified
 * data. Every claim it discarded had ALREADY been matched
 * character-for-character against the source document; `too-long` was the
 * fifth most common discard reason of ten and the only one not about truth.
 *
 * Measured over the 2,763-filing production corpus at 120:
 *
 *   154 too-long discards, 92 of them carrying a digit
 *    39 left the filing with ZERO claims, 36 with exactly one
 *   discarded lengths: min 121, p50 128, p90 143, max 203
 *   accepted lengths:  p50 66, p90 102, p99 118 (max 120, clipped by the cap)
 *
 * The median discard was 128 — EIGHT characters over the line — and what it
 * bought for them was a second figure.
 *
 * 200 IS HEADROOM, NOT A FIT. It recovers 153 of the 154, which is exactly
 * what 180 recovers; the one it misses is 203 characters and 240 would be
 * needed for all of them. It sits above the observed p90 of 143 with room for
 * the tail to move. Do not read 200 as optimised against the data — re-sweep
 * before changing it.
 */
export const MAX_CLAIM_CHARS = 200;
```

- [ ] **Step 4: Run the new test and the whole suite**

```bash
npx jest libs/filings/src/logic/claim-verify.spec.ts
npm test
```

Expected: the new tests PASS. The whole suite PASSES — the existing `too-long`
assertion at `claim-verify.spec.ts:431` asserts the discard *reason* for a
claim built past the cap, so confirm it still exceeds 200; if that fixture was
built at a fixed length between 121 and 200, lengthen it past 200 rather than
deleting the test, since what it guards is that the reason is reported.

- [ ] **Step 5: Commit**

```bash
git add libs/filings/src/logic/claim-verify.ts libs/filings/src/logic/claim-verify.spec.ts
git commit -m "fix: a wire-line limit stops deleting verified claims

MAX_CLAIM_CHARS discarded a claim AFTER verifying it, on length alone. The
number came from claim-line.ts's backstop arithmetic, which is a fact about
the Telegram one-liner — one of five surfaces, and the only one that cannot
wrap.

Measured over the 2,763-filing production corpus: 154 too-long discards, 92
carrying a digit, 39 that left the filing with zero claims. Discarded lengths
cluster just past the line (p50 128, eight over) while accepted ones sit well
below it (p99 118).

200 is headroom above the observed p90 of 143, not a fit: it recovers the
same 153 of 154 that 180 would, and the comment says so."
```

---

### Task 2: The wire backstop stays a backstop

**Files:**
- Modify: `libs/filings/src/logic/claim-line.ts:46-59`
- Test: `libs/filings/src/logic/claim-line.spec.ts`

**Interfaces:**
- Consumes: `MAX_CLAIM_CHARS = 200` from Task 1.
- Produces: `MAX_CLAIM_LINE_CHARS = 640`, exported from
  `libs/filings/src/logic/claim-line.ts`.

- [ ] **Step 1: Write the failing test**

Add to `libs/filings/src/logic/claim-line.spec.ts`. This asserts the property
the constant's comment claims — that it never fires on claims `verifyClaims`
has already accepted.

```ts
it('never fires on three claims of the new maximum length', () => {
  // The worst case the storage bound now permits: MAX_CLAIMS_ON_WIRE claims,
  // each exactly MAX_CLAIM_CHARS, plus separators plus the longest NSE symbol.
  const claims = Array.from({ length: MAX_CLAIMS_ON_WIRE }, () => ({
    text: 'A'.repeat(MAX_CLAIM_CHARS),
  }));

  const line = claimLine('SYMBOLONGEST', claims);

  expect(line).not.toBeNull();
  expect((line ?? '').split(CLAIM_SEPARATOR)).toHaveLength(MAX_CLAIMS_ON_WIRE);
  expect((line ?? '').length).toBeLessThanOrEqual(MAX_CLAIM_LINE_CHARS);
});
```

Import `MAX_CLAIM_CHARS` from `./claim-verify` at the top of the spec. Match
the existing call signature of `claimLine` in this file — read the tests above
it and use the same argument shape rather than the one written here if they
differ.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx jest libs/filings/src/logic/claim-line.spec.ts -t 'never fires'
```

Expected: FAIL. Three 200-character claims plus separators exceed 400, so the
composer breaks early and the line carries fewer than `MAX_CLAIMS_ON_WIRE`
claims.

- [ ] **Step 3: Raise the backstop and correct its arithmetic**

In `libs/filings/src/logic/claim-line.ts`, replace this comment and constant:

```ts
/**
 * The longest line that may be composed.
 *
 * A BACKSTOP RATHER THAN A WORKING CONSTRAINT, and sized so it stays one. Three
 * claims of 120 characters, two separators and the longest NSE symbol come to
 * 382, so a line assembled from claims `verifyClaims` has already accepted
 * always fits and this bound never fires in production. It exists because the
 * composer is also reachable with claims that did not come through that path,
 * and because a message a Telegram client refuses to render is a filing lost.
 *
 * When it does fire it DROPS the tail rather than truncating: half a claim is a
 * different claim.
 */
export const MAX_CLAIM_LINE_CHARS = 400;
```

with:

```ts
/**
 * The longest line that may be composed.
 *
 * A BACKSTOP RATHER THAN A WORKING CONSTRAINT, and sized so it stays one.
 * Three claims of `MAX_CLAIM_CHARS`, two separators and the longest NSE
 * symbol come to about 622, so a line assembled from claims `verifyClaims`
 * has already accepted always fits and this bound never fires in production.
 * It exists because the composer is also reachable with claims that did not
 * come through that path, and because a message a Telegram client refuses to
 * render is a filing lost.
 *
 * RAISED FROM 400 ON 2026-08-13, WITH the storage bound it is derived from.
 * At 120 the same arithmetic gave 382 and 400 held; leaving 400 in place
 * while `MAX_CLAIM_CHARS` moved to 200 would have made this a WORKING
 * constraint, quietly publishing two claims where three were verified — the
 * exact failure the first paragraph exists to prevent. Telegram's own message
 * limit is 4,096, so 640 is not close to anything that matters.
 *
 * When it does fire it DROPS the tail rather than truncating: half a claim is
 * a different claim.
 */
export const MAX_CLAIM_LINE_CHARS = 640;
```

If `MAX_CLAIM_CHARS` is not already imported into this file, import it from
`./claim-verify` so the comment's reference resolves for a reader.

- [ ] **Step 4: Run the tests**

```bash
npx jest libs/filings/src/logic/claim-line.spec.ts
npm test
```

Expected: PASS, including the existing test at `claim-line.spec.ts:91` that
asserts a composed line never exceeds the bound, and the drop-the-tail test —
confirm that one still constructs a line long enough to fire at 640, and
lengthen its fixture if it was sized against 400.

- [ ] **Step 5: Commit**

```bash
git add libs/filings/src/logic/claim-line.ts libs/filings/src/logic/claim-line.spec.ts
git commit -m "fix: move the wire backstop with the bound it is derived from

MAX_CLAIM_LINE_CHARS was 400 because three claims of 120, two separators and
the longest NSE symbol come to 382. With the storage bound at 200 that
arithmetic gives 622, so leaving 400 would have turned a backstop into a
working constraint — publishing two claims where three were verified, which
is precisely what its own comment says it exists to avoid.

640, and the comment now derives it from MAX_CLAIM_CHARS rather than
restating a number. Telegram's limit is 4,096."
```

---

### Task 3: A counterparty is a name, or it is refused

**Files:**
- Modify: `libs/filings/src/logic/counterparty.ts` — the
  `CounterpartyRefusalReason` union at 139-151, a new regex beside
  `INDEFINITE_OPENER` at 103, and `isDescription` at 222-230
- Test: `libs/filings/src/logic/counterparty.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `'phrase-not-name'` as a member of the exported
  `CounterpartyRefusalReason` union. It is persisted into
  `enrichment.counterpartyRefusalReason` by existing code with no change.

- [ ] **Step 1: Write the failing test**

Add to `libs/filings/src/logic/counterparty.spec.ts`. Follow the fixture shape
the surrounding tests already use — they build a document containing the SEBI
LODR mandated row and assert the outcome — and copy that shape rather than the
skeleton here if it differs.

```ts
describe('a row answered with a sentence rather than a name', () => {
  // The real production value, from SAATVIKGL on 2026-08-13. It reached a
  // reader as "Rs 476 cr from Received order from Vikran Engineering Limited".
  it('refuses a value that opens with a verb', () => {
    const doc = [
      'Name of the entity awarding the order(s)/contract(s);',
      'Received order from Vikran Engineering Limited',
    ].join('\n');

    const result = extractCounterparty(doc);

    expect(result.outcome).toBe('refused');
    expect(result).toMatchObject({ reason: 'phrase-not-name' });
  });

  it('still accepts the same name given on its own', () => {
    const doc = [
      'Name of the entity awarding the order(s)/contract(s);',
      'Vikran Engineering Limited',
    ].join('\n');

    const result = extractCounterparty(doc);

    expect(result.outcome).toBe('named');
    expect(result).toMatchObject({ name: 'Vikran Engineering Limited' });
  });
});
```

Read the existing tests for the exact success-outcome discriminator and field
name — `'named'` and `name` here are the expected shape, but the file is the
authority and the assertions must match it.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx jest libs/filings/src/logic/counterparty.spec.ts -t 'sentence rather than a name'
```

Expected: FAIL on the first test. The value passes every current guard —
`INDEFINITE_OPENER` does not match "Received", it is 45 characters so
`isIllegible` passes, and it contains "Limited" so `ENTITY_FORM_WORDS` passes
— so it is returned as a name.

- [ ] **Step 3: Add the guard and the reason**

Add to the `CounterpartyRefusalReason` union in
`libs/filings/src/logic/counterparty.ts`, after `'described-not-named'`:

```ts
  /** The row was answered with a clause rather than the entity's name. */
  | 'phrase-not-name'
```

Add this regex immediately after `INDEFINITE_OPENER`:

```ts
/**
 * Openers that make the row an ANSWER SENTENCE rather than a name.
 *
 * A production filing answered the mandated row with "Received order from
 * Vikran Engineering Limited", which passed every guard here — it is not
 * indefinite, it is 45 characters, and it carries "Limited" — and reached a
 * reader as "Rs 476 cr from Received order from Vikran Engineering Limited".
 *
 * REFUSED RATHER THAN TRIMMED, and the difference is the whole point.
 * Stripping the leading clause would recover the correct name here and would
 * convert a refusal into an inference, on the one field whose wrong answer
 * "attributes a commercial relationship to two named companies that does not
 * exist". A clause where a name belongs is evidence the row was not parsed as
 * intended, and this module's stated answer to that is silence:
 *
 *   OMISSION IS ALWAYS ACCEPTABLE. A headline without a counterparty is a
 *   headline; a headline with the wrong one is a correction.
 *
 * Scale, measured over the production corpus on 2026-08-13: nine
 * counterparties exist in total and this is the one malformed one. Small, and
 * on a surface readers forward to other people.
 */
const VERB_OPENER =
  /^(?:received|receiving|awarded|awarding|bagged|bagging|secured|securing|won|winning|obtained|placed|issued|from|by|the\s+company|we\s+have|company\s+has)\b/i;
```

Extend `isDescription` — the refusal order is deliberate and documented, so
this joins the existing disjunction rather than becoming a separate check
before it:

```ts
/** True when the candidate describes a counterparty rather than naming one. */
function isDescription(name: string): boolean {
  return (
    INDEFINITE_OPENER.test(name) ||
    ANONYMISING_WORDS.test(name) ||
    NON_ANSWERS.test(name)
  );
}
```

becomes:

```ts
/** True when the candidate describes a counterparty rather than naming one. */
function isDescription(name: string): boolean {
  return (
    INDEFINITE_OPENER.test(name) ||
    ANONYMISING_WORDS.test(name) ||
    NON_ANSWERS.test(name)
  );
}

/** True when the candidate answers the row in a sentence instead of naming. */
function isPhrase(name: string): boolean {
  return VERB_OPENER.test(name);
}
```

and add the check in `extractCounterparty`, immediately after the
`isDescription` line so the documented refusal order is preserved — a
description is still reported as a description even when it is also a phrase:

```ts
  if (isDescription(name)) return refuse('described-not-named');
  if (isPhrase(name)) return refuse('phrase-not-name');
  if (isIllegible(name)) return refuse('illegible');
```

- [ ] **Step 4: Run the tests**

```bash
npx jest libs/filings/src/logic/counterparty.spec.ts
npm test
```

Expected: PASS, and specifically the four anonymisations the module's header
documents ("International Customer", "A leading private sector bank in
India*", and the two others) must still be refused as
`'described-not-named'` — not as `'phrase-not-name'`. If any moved, the new
check is in the wrong position.

- [ ] **Step 5: Commit**

```bash
git add libs/filings/src/logic/counterparty.ts libs/filings/src/logic/counterparty.spec.ts
git commit -m "fix: a counterparty that is a sentence is refused, not printed

A production filing answered the Schedule III row with 'Received order from
Vikran Engineering Limited', which passed every guard — not indefinite, 45
characters, carries 'Limited' — and reached a reader as 'Rs 476 cr from
Received order from Vikran Engineering Limited'.

Refused rather than trimmed. Stripping the clause would recover the correct
name here and would convert a refusal into an inference, on the one field
whose header says a wrong answer attributes a commercial relationship that
does not exist. A clause where a name belongs is evidence the row was not
parsed as intended, and this module's answer to that is silence.

Nine counterparties exist corpus-wide; this is the one malformed one."
```

---

### Task 4: The shared text carries the figure

**Files:**
- Modify: `apps/dashboard/src/ui/script/script-share.ts` — `shareText`, 104-132
- Test: `apps/dashboard/src/ui/script/script-share.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the placement rule Task 5 must match — the amount is a paragraph
  of its own between the header and the claims, rendered as
  `enrichment.amountDisplay` verbatim.

**Why there, and not with the results line:** `shareText` argues the results
line goes last because "in a chat the claims are the sentences a person reads
and the figures are the thing they scroll back to". That argument is about a
results TABLE — many figures, secondary to the sentences. A single order value
is not that: for the 33 filings measured, the amount IS the event and the
claims are its detail. So it leads, and the results line keeps its place.

- [ ] **Step 1: Write the failing test**

Add to `apps/dashboard/src/ui/script/script-share.spec.ts`, following the
fixture shape already used in that file:

```ts
  it('leads with the figure when the filing printed one', () => {
    const text = shareText({
      companyName: 'Saatvik Green Energy Limited',
      symbol: 'SAATVIKGL',
      category: 'Bagging/Receiving of orders/contracts',
      disseminatedAtIstHuman: '13 Aug 2026, 12:21 pm',
      enrichment: {
        amountDisplay: '₹476 cr',
        claims: [{ text: 'Order to be executed by March 2027.' }],
      },
    });
    const lines = text.split('\n');

    // Between the header block and the first claim, on its own.
    const figureAt = lines.indexOf('₹476 cr');
    const claimAt = lines.indexOf('- Order to be executed by March 2027.');
    expect(figureAt).toBeGreaterThan(-1);
    expect(claimAt).toBeGreaterThan(figureAt);
  });

  it('is unchanged for a filing with no amount', () => {
    const text = shareText({
      companyName: 'Example Limited',
      symbol: 'EXAMPLE',
      category: 'Board Meeting',
      disseminatedAtIstHuman: '13 Aug 2026, 12:21 pm',
      enrichment: {
        amountDisplay: null,
        claims: [{ text: 'The board met on Wednesday and approved nothing.' }],
      },
    });

    expect(text).toContain('- The board met on Wednesday and approved nothing.');
    expect(text.split('\n').filter((l) => l === '')).toHaveLength(2);
  });
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx jest apps/dashboard/src/ui/script/script-share.spec.ts -t 'leads with the figure'
```

Expected: FAIL. `figureAt` is `-1` — `shareText` never reads `amountDisplay`.

- [ ] **Step 3: Add the figure to `shareText`**

In `apps/dashboard/src/ui/script/script-share.ts`, replace:

```js
    out.push('');
    for (var i = 0; i < claims.length; i++) {
      out.push('- ' + claims[i].text);
    }
```

with:

```js
    // THE FIGURE LEADS, and it is the one place this differs from the results
    // line below. That line goes last because a results table is many numbers
    // secondary to the sentences; a single order value is the event itself.
    // Measured 2026-08-13: of 1,193 filings holding a claim, 33 had a verified
    // amount and NOT ONE claim containing a digit — the money was extracted,
    // verified, shown on the card, and absent from what got shared.
    //
    // Rendered as stored. Nothing is computed here, and no label is invented
    // to sit beside it: the category line above already says what kind of
    // event this is.
    if (e.amountDisplay) {
      out.push('');
      out.push(e.amountDisplay);
    }

    out.push('');
    for (var i = 0; i < claims.length; i++) {
      out.push('- ' + claims[i].text);
    }
```

**No backtick and no `${` may appear in that block, including in the comment.**
This file is a TypeScript template literal.

- [ ] **Step 4: Run the tests**

```bash
npx jest apps/dashboard/src/ui/script/script-share.spec.ts
npx jest apps/dashboard/src/ui/script/script-fragments.spec.ts
npm test
```

Expected: all PASS. `script-fragments.spec.ts` is the one that catches a
stray backtick, and it must be run explicitly here.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/ui/script/script-share.ts apps/dashboard/src/ui/script/script-share.spec.ts
git commit -m "fix: the shared text says how much

Measured 2026-08-13: of 1,193 filings holding at least one claim, 33 had a
verified amount and not one claim containing a digit. A production share card
read 'Order to be executed by March 2027.' about a Rs 476 crore order win —
the money was extracted, verified, stored, shown on the card, and dropped on
the way to WhatsApp.

The figure leads rather than trailing with the results line. That line goes
last because a results table is many numbers secondary to the sentences; a
single order value is the event itself.

Rendered as stored, with no invented label: the category line above already
says what kind of event it is."
```

---

### Task 5: The picture carries the figure

**Files:**
- Modify: `apps/dashboard/src/ui/script/script-share-image.ts` —
  `shareBodyBlocks` at 365 and its one call site at 428-431
- Test: `apps/dashboard/src/ui/script/script-share.spec.ts`

**Interfaces:**
- Consumes: the placement rule from Task 4 — the amount sits between the
  header and the first claim, rendered as `amountDisplay` verbatim.
- Produces: `shareBodyBlocks(ctx, claims, resultsLine, amountDisplay)` — a
  fourth parameter, appended so existing callers and tests that pass three
  arguments still type-check.

- [ ] **Step 1: Write the failing test**

Add to `apps/dashboard/src/ui/script/script-share.spec.ts`, beside the Task 4
tests. This suite exists precisely to keep the two surfaces in step.

```ts
  it('draws the figure in the picture too, ahead of the claims', () => {
    const ctx = fakeCanvasContext();
    const blocks = shareBodyBlocks(
      ctx,
      [{ text: 'Order to be executed by March 2027.' }],
      null,
      '₹476 cr',
    );

    expect(blocks[0].text).toBe('₹476 cr');
    expect(blocks[1].text).toBe('Order to be executed by March 2027.');
  });

  it('draws no figure block when the filing printed no amount', () => {
    const ctx = fakeCanvasContext();
    const blocks = shareBodyBlocks(
      ctx,
      [{ text: 'The board met on Wednesday and approved nothing.' }],
      null,
      null,
    );

    expect(blocks[0].text).toBe('The board met on Wednesday and approved nothing.');
  });
```

Use whatever canvas stub the surrounding tests already use for `ctx` —
`shareBlock` calls `measureText`, so a bare `{}` will throw. Read the top of
the spec file and reuse its helper rather than writing a new one.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npx jest apps/dashboard/src/ui/script/script-share.spec.ts -t 'in the picture too'
```

Expected: FAIL. `blocks[0].text` is the claim — `shareBodyBlocks` takes three
parameters and never reads an amount.

- [ ] **Step 3: Add the block**

In `apps/dashboard/src/ui/script/script-share-image.ts`, change the signature
and prepend the block:

```js
  /** What the filing said: the claims, what was left out, and the figures. */
  function shareBodyBlocks(ctx, claims, resultsLine) {
    var blocks = [];
    var shown = claims.length < SHARE_CLAIM_CAP ? claims.length : SHARE_CLAIM_CAP;
```

becomes:

```js
  /** What the filing said: the figure, the claims, what was left out. */
  function shareBodyBlocks(ctx, claims, resultsLine, amountDisplay) {
    var blocks = [];

    // AHEAD OF THE CLAIMS, matching the shared text exactly — the two surfaces
    // are kept in step by hand and script-share.spec.ts is where that is
    // asserted. Measured 2026-08-13: 33 filings had a verified amount and no
    // claim carrying a digit, so the picture showed a deadline and no money.
    //
    // Accent, no bullet, and larger than a claim: it is the event, not one of
    // the sentences about it. Drawn as stored, like everything else here.
    if (amountDisplay) {
      blocks.push(shareBlock(ctx, {
        font: '600 36px ' + SHARE_SANS,
        fill: SHARE_ACCENT,
        text: amountDisplay,
        lineHeight: 48,
        gap: 44,
        indent: SHARE_HANG
      }));
    }

    var shown = claims.length < SHARE_CLAIM_CAP ? claims.length : SHARE_CLAIM_CAP;
```

The first claim's `gap` is `i === 0 ? 44 : 20`, which now double-spaces after
the figure. Change that line so the first claim spaces normally when a figure
precedes it:

```js
        gap: i === 0 ? 44 : 20,
```

becomes:

```js
        gap: i === 0 && !amountDisplay ? 44 : 20,
```

Update the call site at 428-431:

```js
    var claims = e.claims || [];
    return {
      body: shareBodyBlocks(ctx, claims, e.resultsLine)
```

becomes:

```js
    var claims = e.claims || [];
    return {
      body: shareBodyBlocks(ctx, claims, e.resultsLine, e.amountDisplay)
```

Confirm `SHARE_ACCENT` is the constant's actual name by reading the palette
block near line 60 — the comment there names `SHARE_INK` and `SHARE_MUTED`;
use the accent constant defined beside them, whatever it is called.

**No backtick and no `${` in any of it, comments included.**

- [ ] **Step 4: Run the tests, then look at the picture**

```bash
npx jest apps/dashboard/src/ui/script/script-share.spec.ts
npx jest apps/dashboard/src/ui/script/script-fragments.spec.ts
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
```

Then render one, because a canvas layout is not proved by assertions about an
array:

```bash
npm run start:dashboard     # AUTH_MODE resolves to local with no FIREBASE_* set
```

Sign in, find a filing with an amount, use "copy as image", and confirm the
figure reads clearly, sits above the claims, and does not collide with the
watermark.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/ui/script/script-share-image.ts apps/dashboard/src/ui/script/script-share.spec.ts
git commit -m "fix: the shared picture says how much

The other half of the same gap: shareBodyBlocks built from claims and the
results line, so a picture of an order win showed a deadline and no money.

Accent, no bullet, larger than a claim, ahead of them — it is the event
rather than one of the sentences about it, and the placement matches the
shared text exactly. The two surfaces are kept in step by hand and
script-share.spec.ts is where that is asserted.

The first claim's leading gap now applies only when no figure precedes it,
or the two would double-space."
```

---

## After the tasks

Not code, and not to be run without asking:

**The backfill — DECIDED 2026-08-13: NOT HAPPENING.** None of the 154
discarded claims return on their own; `claimDiscards` records that something
was thrown away, not enough to rebuild it, so they come back only by re-running
those filings through extraction. The founder's call is to spend nothing on
history and let the fix apply to everything arriving from now on.

What that leaves behind, stated rather than glossed: **39 filings stay visible
with zero claims and 36 with one**, and no marker distinguishes them from a
filing the pipeline genuinely found nothing in. That is the cost of the
decision, not a defect introduced by it — those records are exactly as they
were before this change. If they ever want revisiting, the query is
`{"enrichment.claimDiscards.reason": "too-long"}` and the tool is
`npm run enrich:requeue`.

**The full gate before merge**, including the browser suite CI does not run:

```bash
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run start:dashboard      # in one shell
npx playwright test          # in another
```

## Self-review

- **Spec coverage.** Defect 1 (the cap) → Tasks 1 and 2. Defect 2 (the share
  post) → Tasks 4 and 5. Defect 3 (the counterparty) → Task 3. The backfill →
  the section above, deliberately not a task. Testing requirements 1-5 from
  the spec map to Tasks 1, 2, 4+5, 3 and the fragment runs in Tasks 4 and 5.
- **Placeholders.** None: every step carries the code to write or the exact
  command to run, and the three places where the implementer must read the
  existing file rather than trust this plan (the `claimLine` call signature,
  the counterparty outcome discriminator, the canvas stub and accent constant)
  say so explicitly instead of guessing.
- **Type consistency.** `MAX_CLAIM_CHARS` is produced by Task 1 and consumed
  by Task 2's comment and test. `shareBodyBlocks` gains a fourth parameter in
  Task 5 only, appended so three-argument callers still compile.
  `'phrase-not-name'` is added to `CounterpartyRefusalReason` in Task 3 and
  used nowhere else.
