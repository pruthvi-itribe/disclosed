# A shared post that says what happened

**Status:** approved 2026-08-13. Implementation plan to follow.

## The report

A share card copied from production read, in full:

```
Saatvik Green Energy Limited (SAATVIKGL)
Bagging/Receiving of orders/contracts · 13 Aug 2026, 12:21 pm IST

- Order to be executed by March 2027.

AI-extracted. Every line verified against the company's filing.
```

A reader learns a deadline and not one thing about the order. The filing was
an order win worth ₹476 crore.

## What the pipeline actually knew

Everything. The record for that filing holds:

```
headline     : SAATVIKGL BAGS ORDER ₹476 cr from Received order from Vikran Engineering Limited
amountRupees : 4760000000          amountEvidence: "INR 476 Crores"
counterparty : Received order from Vikran Engineering Limited
claims       : ["Order to be executed by March 2027."]
claimDiscards: [{ reason: "too-long",
                  claim:  "Material subsidiary Saatvik Solar Industries received and accepted INR 476 Crore",
                  detail: "143 characters exceeds the 120 a wire line may carry" }]
```

So nothing failed to be read, verified or stored. Three separate defects
between storage and the reader threw the substance away.

## Defect 1 — a length limit is deciding what a reader sees

`MAX_CLAIM_CHARS = 120` lives in `claim-verify.ts` and DISCARDS a claim that
exceeds it, purely on length.

**Corrected 2026-08-13, after implementation.** This document originally said
the claim "is verified first and dropped afterwards", and that every one had
"already been string-matched against the source document". That is backwards.
The length check is position two of eleven in `checkOne`, sixty-one lines
BEFORE `findVerbatimSpan` — which is the header's stated design, "cheap and
categorical first, evidential last". So these 154 were never matched against
the document.

Raising the bound therefore does not ADMIT them, it lets them be JUDGED. An
unknown fraction will now be refused by `number-not-in-span`,
`period-not-in-context` or `span-not-found` instead — the three largest
discard classes in the sweep. **154 is a ceiling on what returns, not a
forecast**, and the "~153 claims recovered" figure below should be read the
same way. It is a better change than the one first described: a length filter
was pre-empting the gate this project exists for.

Measured over the 2,763-filing production corpus:

| | |
|---|---|
| `too-long` discards | **154** |
| ...carrying a digit | **92** |
| ...that left the filing with **zero** claims | **39** |
| ...that left the filing with exactly one | **36** |

`too-long` is the fifth most common of the ten reasons that OCCURRED in this
corpus — `ClaimDiscardReason` has thirteen members and three never fired — and
one of only three that drop a claim for something other than what it says, the
others being `over-limit` (a rank position) and `duplicate` (a repetition).

The discarded claims are not rambling. Their lengths cluster just past the
line, while accepted claims sit well below it:

```
kept (5,095)      p50  66   p75  85   p90 102   p95 110   p99 118   max 120  <- clipped by the cap
discarded (154)   min 121   p25 123   p50 128   p75 133   p90 143   max 203
```

The median discard is **128 characters — eight over the line**. What they buy
for those characters is a second figure:

```
Q1 FY27: consolidated income Rs 434.51 crore, net loss Rs 45.19 crore; ...
Rs 3,418.24 million of Rs 4,000.00 million gross IPO proceeds ...
Delay in setting up 220 TPD air separation unit at Uluberia-II: Rs 888.25 millio...
```

### Why the number is 120, and why that reason does not survive contact

It is not arbitrary. `claim-line.ts` derives the wire-line backstop from it:

> *A BACKSTOP RATHER THAN A WORKING CONSTRAINT, and sized so it stays one.
> Three claims of 120 characters, two separators and the longest NSE symbol
> come to 382, so a line assembled from claims `verifyClaims` has already
> accepted always fits and this bound never fires in production.*

`MAX_CLAIM_CHARS` exists to keep `MAX_CLAIM_LINE_CHARS = 400` a backstop. That
is a **wire-line** concern — the Telegram one-liner — and it is being enforced
as a **storage** gate. The app card wraps. The share image wraps. The company
page wraps. Only the wire needs one line, and the wire is one of five surfaces.

The codebase already draws exactly this distinction one level up, and says so:

> *What is stored is what the document supports; what is published is
> `MAX_CLAIMS_ON_WIRE` of it.*

Twelve claims stored, three published. Length never got the same treatment.

### The change

- `MAX_CLAIM_CHARS` **120 → 200**, in `claim-verify.ts`.
- `MAX_CLAIM_LINE_CHARS` **400 → 640**, in `claim-line.ts`, preserving the
  property its comment claims: `3 × 200 + 2 separators + longest NSE symbol`
  comes to ~622, so the backstop still never fires. Telegram's own message
  limit is 4,096, so 640 is not close to anything.
- Both comments rewritten to cite the sweep above, per the repo convention
  that a threshold carries the measurement that placed it.

**200 recovers the same 153 of 154 as 180 would** — the single remaining claim
is 203 characters, and 240 would be needed for all of them. 200 is chosen for
headroom above the observed p90 of 143, NOT because it recovers more than 180,
and the comment must say so, or the next reader will assume it was fitted to
the data.

**No verification rule changes.** `MIN_CLAIM_CHARS`, `MAX_CLAIMS_EXTRACTED`
and `MAX_CLAIMS_ON_WIRE` are untouched, and no check is removed or reordered —
the recovered claims are handed to the same evidential chain every other claim
runs, rather than being excused from it. See the correction above: they had
NOT been matched before, and that is the point.

## Defect 2 — the share post ignores the figure

`script-share.ts` (the WhatsApp text) and `script-share-image.ts` (the picture)
both build their body from `enrichment.claims` and `enrichment.resultsLine`,
and nothing else. The amount and the counterparty are extracted, verified,
stored and rendered on the app's card — and dropped on the way out.

Measured: of 1,193 filings holding at least one claim, **33 have a verified
amount and no claim containing a single digit.** Those are the SAATVIKGL case
exactly — the money is known and invisible to whoever receives the post.

### The change

Both share surfaces gain the figure, drawn from what is already stored and
already verified. Nothing is computed: `amountDisplay` is rendered as stored,
as the picture's own header already requires ("NOTHING IS COMPUTED INTO THE
PICTURE").

The two surfaces must stay in step. `script-share.spec.ts` exists because they
already share a claims-selection rule that is deliberately duplicated rather
than factored out; the new rule joins it and the spec must cover both.

## Defect 3 — a counterparty that is a sentence

Stored: `"Received order from Vikran Engineering Limited"`. The headline built
from it reads `₹476 cr from Received order from Vikran Engineering Limited` —
two `from`s and a clause where a company name belongs.

`counterparty.ts` reads only SEBI LODR Schedule III Part A(B)'s mandated row
and is explicit that it must refuse anything that is not a name:

> *even from there it is refused unless it looks like an entity's NAME rather
> than a description of one.*
>
> *OMISSION IS ALWAYS ACCEPTABLE. A headline without a counterparty is a
> headline; a headline with the wrong one is a correction.*

So this value should never have been stored. The guard is too loose, and the
fix is to tighten it — **refuse**, not trim.

Trimming the leading `Received order from ` would recover a correct name here
and would be the wrong change: it converts a refusal into an inference, on the
one field whose header says a wrong answer "attributes a commercial
relationship to two named companies that does not exist". A phrase-shaped
value is evidence the row was not parsed as intended, and the module's stated
answer to that is silence.

Scale: **9 counterparties exist corpus-wide, 1 is malformed.** Small, and on a
surface readers forward to other people.

### The change

Tighten the name guard in `counterparty.ts` to refuse a value that opens with
a verb or prepositional phrase rather than a name, with the refusal recorded in
`counterpartyRefusalReason` like every other. Fixture-driven: the four
anonymisations the header already lists must still be refused, the genuine
names must still pass, and this value must now be refused.

## The backfill question

None of the 154 discarded claims return on their own — `claimDiscards` records
what was thrown away, not enough to reconstruct it. They come back only by
re-running those filings through extraction, which spends model calls.

**Decision: requeue only the 39 filings the cap left with zero claims**, using
the existing `npm run enrich:requeue`. Those are the ones showing a reader
nothing at all. The 36 left with one claim, and the rest, keep what they have —
a filing that already says something true is not worth a model call to say one
more true thing, and the fix applies to everything arriving from now on.

This is a decision to confirm before running, not part of the code change.

## Testing

TDD throughout, and the repo's existing gates are the bar: 5,583 Jest tests,
`tsc --noEmit`, `eslint`, and the Playwright suite against a local
`AUTH_MODE=local` stack.

Specifically required:

1. **`claim-verify`** — a claim of 200 characters is accepted; 201 is discarded
   as `too-long`; the discard record still carries the true length in `detail`.
   The existing `too-long` tests move with the number rather than being deleted.
2. **`claim-line`** — three 200-character claims compose a line under the new
   backstop, so it still never fires; a line that does exceed it still DROPS the
   tail rather than truncating, because half a claim is a different claim.
3. **Both share surfaces** — a filing with an amount and no digit-bearing claim
   renders the figure in the text AND in the image; a filing without an amount
   renders exactly what it does today. Regression-guarded in
   `script-share.spec.ts`, which already exists to keep the two in step.
4. **`counterparty`** — the four documented anonymisations stay refused, the
   genuine names stay accepted, and `"Received order from Vikran Engineering
   Limited"` becomes a recorded refusal.
5. **Client-script fragments** — `script-fragments.spec.ts` must stay green:
   the share files are TypeScript template literals, so no backtick and no
   `${` may enter them, including in comments.

## Out of scope

Recorded so they are not discovered as surprises mid-implementation:

- **Why only 9 counterparties exist across 1,193 filings.** The extractor
  almost never fires. That may be correct — the mandated row appears only in
  order-win filings — or it may be a second defect. Not investigated here.
- **Ranking claims by informativeness.** The cap change makes length stop
  deciding; it does not make importance start deciding. A filing with twelve
  claims still publishes the first three.
- **`MAX_CLAIMS_ON_WIRE = 3`** and `MAX_CLAIMS_EXTRACTED = 12` — untouched.
