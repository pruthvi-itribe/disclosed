# Rating an update: what a filings wire may say about good and bad news

Design only. No production code changes. Branch `feat/product-evolution`.

The founder's ask, quoted: each update should be rated — *"positive, negative,
how much good for company and how can it improve"*. This document takes that ask
seriously, measures what the corpus can actually support, and returns the
largest piece of it that can ship without breaking the one rule the product is
built on.

---

## 0. The numbers this document is built on

Every figure below was measured against the live collection
(`mongodb://localhost:27117/turret`) on 2026-08-08. Nothing here is estimated.

| Measurement | Value |
|---|---|
| Filings in collection | 3,451 |
| Filings with an enrichment record | 3,079 |
| Filings with ≥1 verified claim | 1,157 (33.5% of all) |
| Verified claims stored | 3,420 |
| Claims per claim-bearing filing | 2.96 |
| Filings with ≥1 verified results figure | 18 |
| Verified results figures | 50 |
| Avg claim `text` + `span` | 198 chars (~49 tokens) |
| Avg `documentChars` on a claim-bearing filing | 50,218 (~12.6k tokens) |

Claim `kind` mix (3,420 claims): `operational` 2,191, **`guidance` 643**,
`expansion` 335, `approval` 136, `partnership` 62, **`target` 59**.
The two bolded rows matter in §3 — 702 claims (20.5%) are already the company's
own forward-looking statements, verbatim-gated.

Claim `topic` mix: `other` 1,208, `financial` 893, unclassified (pre-classifier)
528, `capacity` 203, `acquisition` 175, `dividend` 157, `product` 112,
`orders` 73, `ratings` 41, `governance` 36.

### 0.1 Direction words the document itself printed

Scanning the **`span`** (the document's own bytes, not the model's compressed
`text`) for direction vocabulary:

| Rule | Claims tagged | Share | up | down | mixed | up:down |
|---|---|---|---|---|---|---|
| Direction word only (traps stripped) | 1,033 | 30.2% | 955 | 64 | 14 | 14.9 : 1 |
| Direction **+ printed magnitude** (`%`/`bps`) | **798** | **23.3%** | 741 | 45 | 12 | 16.5 : 1 |
| Direction + magnitude + explicit period comparator | 577 | 16.8% | 543 | 25 | 9 | 21.7 : 1 |

Filing level, at the strictest rule: **271 of 1,157 claim-bearing filings
(23.4%) — 7.9% of all 3,451 filings** — carry at least one defensibly taggable
claim. Filing tags split 242 expansion / 6 contraction / 23 mixed.

**The answer to "what fraction of filings could get a defensible direction tag
from printed text alone" is 7.9% of all filings, or 23.4% of the filings that
produce any claim at all.** Not most of them. This single number reframes the
whole feature: a direction tag is a *sometimes* marker on a minority of cards,
not a rating that appears on every update.

### 0.2 The model invents direction words 5.9% of the time

201 of 3,420 claims (5.9%) carry a direction word in the extractor's compressed
`text` that **is not present in the document `span` it was read from**. The
verbatim gate does not catch this today, because `claim-span.ts` checks that the
span exists in the document and `claim-numbers.ts` checks that figures in the
text appear in the span — neither checks direction *verbs*.

This is the most important measurement in the document. It is direct, in-corpus
evidence that a model asked to characterise movement will characterise movement
that the source did not state, at a 1-in-17 rate, inside a pipeline that already
constrains it heavily. Any design that lets a model *originate* the direction
inherits at least that error rate.

### 0.3 Results figures cannot supply a direction at all

50 of 50 stored results figures carry a prior-period pair. **0 of 50 store them
as numbers** — `current` and `prior` are grouped strings (`'70,046'`,
`'58,319'`). And **0 of 50 figure spans contain a printed `%` or `bps` change**;
1 of 50 contains any direction word. The spans are table rows:

```
a) Revenue from operations | 70,046 | 86,327 | 58,319 | 291,484
```

Four unlabelled columns of digits. Deriving "revenue up 20.1% YoY" from that
requires parsing two grouped numbers, picking the right column, dividing, and
rounding. That is exactly the operation `results-line.ts` forbids, and §1 says
why.

### 0.4 The corpus is structurally optimistic, and that is a trap

Two independent effects make the claim collection unrepresentative of reality:

1. **Filers self-select.** 16.5 up-tagged claims for every down-tagged one. A
   company issues an investor presentation about a good quarter; a bad quarter
   gets a bare results table with no narrative to extract claims from.
2. **The pipeline filters the bad news out on purpose.** `legal-block.ts`
   matches 41 of 3,451 filings (1.2%) — litigation, SEBI enforcement, insolvency,
   auditor qualification, fraud, default — and **0 of those 41 produced a single
   claim.** 21 further claims were discarded with reason `legally-blocked`.

So a "sentiment" surface computed over stored claims would report a market that
is roughly 90% expanding, because the worst news is refused upstream by design
and the rest is filed by companies with something to boast about. **A product
that shows a sentiment distribution built on this corpus is publishing a
cheerful lie, and it is a lie the product manufactured itself.** Any design must
either correct for this or refuse to aggregate.

### 0.5 A quarter of "down" is good news

Of the 45 contraction-tagged claims (direction + printed magnitude), **12
(26.7%) are metrics where a fall is unambiguously good**: gross NPA, net debt,
cost of borrowing, slippages, Scope 1/2 emissions, provisions. Real examples,
verbatim:

- `ESAFSFB` — *"gross NPA for Q1 FY27 declined to 5.4% from 7.5% ... slippages reduced sharply to INR 75 crores from INR 468 crores"*
- `EDELWEISS` — *"Corporate net debt declined by 10% YoY to $605 Mn"*
- `LEMONTREE` — *"cost of debt reduced to 7.48%, down 53 basis points versus a year ago"*
- `MUTHOOTCAP` — *"Gross Non-Performing Assets (GNPA) percentage dropped from a peak of 25.93% (FY22) ... down to 3.94%"*

In the other direction, 16 of 741 expansion-tagged claims (2.2%) are rising costs,
debt or emissions — up, and bad.

**A direction tag and a sentiment label are not the same object, and the gap
between them is 26.7% on the cases that matter most.** Every design below is
graded on whether it respects that.

---

## 1. What the codebase already refuses, and why the refusals bind here

### `claim-advisory.ts` — the output filter

The module's own header states the rule and the reason it is a filter rather
than a prompt instruction:

> a prompt is a request, and the one time it is not honoured is the time a
> message goes out reading "positive for the stock" over a named listed
> company's filing. Under SEBI's research-analyst regulations that sentence is
> the difference between reporting a disclosure and publishing investment advice
> without a registration, and the difference is not recoverable by an apology.

`ADVISORY_PATTERNS` explicitly blocks
`/\b(?:positive|negative|bad|good|great) for the (?:stock|share|scrip|counter)\b/i`
with the reason `states an effect on the security`, and
`/\b(?:bullish|bearish|under-?valued|over-?valued)\b/i` with the reason
`is a directional or valuation judgement`. It also blocks
`/\b(?:we|our) (?:recommend|believe|view|expect the stock|see)\b/i` because it
`is this pipeline speaking rather than the filing`.

That last one is the load-bearing clause for this feature. **The line the module
draws is not "no directional words" — it is "no sentence this pipeline
authored."** The header is explicit that the company's own forward-looking
statements are allowed and necessary: *"expecting volume growth of 16-18%",
"targets 100 billion rupees adjusted EBITDA by FY31", "lowers topline
guidance"* — *"Those are the company's disclosures, quoted; a filings wire that
could not carry them would have nothing to carry."*

A rating this pipeline computes is this pipeline speaking. A direction word the
document printed, attributed to the document, is the filing speaking. That
distinction is the entire design space.

### `results-line.ts` — the competitor's wrong margin

The cited precedent, for the exact filing Turret also processed. A competitor
published:

```
APOLLO TYRES: Q1 CONS NET PROFIT 3.49B RUPEES VS 129M (YOY)
APOLLO TYRES: Q1 REVENUE 74B RUPEES VS 65.61B (YOY)
APOLLO TYRES: Q1 EBITDA MARGIN 11.73% VS 13.32% (YOY)
```

The document says `₹ Million` and prints `3,488.72`, `128.78`, `73,977.90`,
`65,607.59`. The module's verdict on the third line:

> **8.68B over 65.61B is 13.23%, not 13.32%. Two digits transposed, in a figure
> the filing never printed, on a line about a named listed company.**

That is what derived arithmetic costs. And §0.3 established that computing a
direction from stored results figures is *precisely* this operation: two grouped
strings, a division, a rounding, a number the filing never printed. **Direction
from results arithmetic is dead on arrival and is not proposed in any option
below.**

### `claim-topic.ts` — the deterministic precedent to copy

The classifier that already works, and its own justification for being rules:

> A wrong topic FILES a claim badly; it cannot publish anything false, because
> the claim itself was already matched character-for-character against the
> source document by the time this runs. That asymmetry is what makes rules an
> honest choice here and not a shortcut — the verbatim gate is upstream and
> unaffected.

It also records the cost argument: *"a model call per claim would cost roughly
$2 to reclassify a collection this size and would have to be paid again for
every future change of mind."* And it refuses to tune away its large `other`
bucket, because *"`other` at 39.4% is NOT a failure of the rules."*

Direction has the same asymmetry **only if the tag is derived from the already-
verified span.** A wrong direction tag on a claim whose span is checked mislabels
a true sentence. A direction tag the model originates can assert movement the
document never described — that is a new publication, not a filing decision, and
it lands outside the gate.

### `confidence-tier.ts` — tiering is the house pattern

Three tiers, and the reason there is no score:

> A single 0-to-1 score would collapse those into a number that invites a
> threshold, and a threshold on a mixed scale is how a verified figure and a
> confident-sounding summary end up on the same side of a line.

And:

> The tier answers exactly one question — how would somebody check this? — and
> materiality is a separate judgement made separately.

`isAlertableTier` admits only `verified` to the wire, for truth **and volume**:
71.2% of 17,442 corpus filings survive the routine gate, ≈388 Telegram messages
a day, peak 106 in an hour. `alert-gate.ts` adds the routine-category and
watchlist gates; `alert-window.ts` adds the cold-start window.

The founder's "how much good for company" is a request for exactly the 0-to-1
score this module refuses. The refusal stands, and the design substitutes an
ordinal that cannot be thresholded into a recommendation.

### `claim-summary.ts` / `documentSummary` — the "labelled unverified" precedent

2,552 filings carry a `documentSummary`: model prose, vetted but **not**
verified. `claim.types.ts` is emphatic about its containment:

> Carried alongside the claims rather than among them. Nothing downstream may
> treat this as a claim: it reaches no wire line, no alert and no published
> surface.

This is the existing template for Option C, and it demonstrates the price of
that template: an unverified artefact that exists but is allowed nowhere a
reader can act on it. Anything shaped like C inherits that containment or it
inherits the risk.

---

## 2. Three designs

Vocabulary decision applying across all three, stated once: **the words
`positive` and `negative` are not used anywhere in this feature.** They are
sentiment terms about an entity. `expansion` / `contraction` / `mixed` are terms
about a *figure's movement*. This is not a euphemism — §0.5 measured that the
two genuinely differ on 26.7% of the down-cases, so using sentiment vocabulary
for a direction measurement would be factually wrong 12 times in the current
corpus, not merely cautious.

---

### Option A — Printed direction tags, deterministic, zero model calls

**What it is.** A pure function `claimDirection(span: string)` in the mould of
`claimTopic`, run over the already-verified `span`. It tags a claim only when the
document printed **both** a direction verb **and** a magnitude (`%` / `per cent`
/ `bps` / `basis points`) in the same sentence, after removing a trap list.

**Vocabulary.** `expansion` | `contraction` | `mixed` | `unrated`.
`unrated` is the honest floor and is the majority state (76.7% of claims), for
the same reason `claim-topic.ts` keeps `other` at 39.4%: it is a real answer.

**Rule shape.** First a trap strip, then direction, then a magnitude
requirement, all against the span:

```
TRAPS (removed before matching — each read off a real false positive):
  paid-up / up to / upto / setting up / set up / follow-up / back-up
  wound up / ramp(ed|ing) up / scaling up / signed up / up-front / upgrade
  step-down (subsidiary) / drawn down / draw-down / shut down / downstream
  not lower than / no lower than / higher end
  "Subansiri Lower"            <- a project NAME in an NHPC span
UP    up|rose|rising|grew|grown|growth|increased?|higher|improved?|
      improvement|expanded|expansion|gained?|surged|lifted|lifting
DOWN  down|fell|declined?|decline|decreased?|decrease|lower|dropped|
      reduced|reduction|contracted|de-grew|slipped|moderating
MAG   \d[\d,.]*\s*(%|per ?cent|bps|basis points)
```

Every trap above was found by reading matched spans, not imagined. `paid-up`
alone fires on ARVIND, BEL and BLUSPRING share-capital lines; `Subansiri Lower`
is a hydro project that made an NHPC capacity-*addition* claim match DOWN.

**Coverage (measured).** 798 of 3,420 claims (23.3%); 271 of 1,157 claim-bearing
filings (23.4%); 7.9% of all filings.

**Where it renders.**
- **Card:** an inline glyph on the claim line — `▲` / `▼` / `◆` — with the
  matched evidence substring in the `title`. Monochrome, same weight as body
  text. **No red/green.** Colour is the whole sentiment claim smuggled back in
  through CSS, and §0.5 says it would be wrong on a quarter of the `▼`s.
- **Feed filter:** a third chip row under `.chips.topics`, following the existing
  `data-topic` pattern in `page.ts`. Deferred to follow-on — at 7.9% of filings a
  filter is a near-empty view on day one.
- **Company page:** counts, not a trend line. "Of 14 verified claims in the last
  4 quarters, 9 printed an increase, 2 a decrease." A *line* would imply the
  claims are commensurable across filings; they are revenue, EBITDA, NPA and
  emissions, and they are not.
- **Telegram:** nothing new. See §2.4.

**Cost.** $0. No model call, no document fetch. Backfilling all 3,420 claims is
one pass of the regex list — the same economics `claim-topic.ts` cites when it
notes a model pass would cost ~$2 and be re-payable on every change of mind.

**Failure modes.**
1. *Trap escapes.* A new idiom (`"stepping up capacity"`, `"marked up"`) mislabels
   a claim. Contained: mislabels a true, verified sentence; fixed by one regex
   and one test; costs nothing to re-run.
2. *Polarity inversion, 26.7% measured.* `▼` on falling NPA. **Not a bug in this
   design** — the tag is honest about the metric's direction and the design never
   maps it to good/bad. It is a bug in any *reader* who reads `▼` as bad, which
   is why the labelling in §3.6 is load-bearing rather than decorative.
3. *Second-derivative spans.* `SUNDROP` — *"the overall rate of decline is
   moderating sequentially from -10% in Q4 FY26 to -3% in Q1 FY 27."* The
   direction word describes the *rate of change*, and the level is improving
   while the tag would say contraction. Handled by adding `rate of decline`,
   `pace of decline`, `moderating` to the trap list and returning `unrated`.
4. *Silent bias.* Publishing 242 `▲` filings against 6 `▼` reads as cheerleading
   even though each individual tag is defensible. Handled in §3.6 by refusing to
   aggregate and by disclosing the base rate.
5. *Coverage disappointment.* The founder asked for a rating on every update and
   gets one on 7.9% of them. This is honest and it will be unpopular; §5 sizes it.

---

### Option B — Deterministic direction + model-assigned materiality with a verbatim justification span

**What it is.** Option A unchanged, plus a second, narrow model pass that runs
**only on the 271 filings A already tagged**. The model does not decide
direction — it decides *materiality*, and it must return a `justification` string
that string-matches the document, extending the existing verification gate from
facts to opinions-with-evidence.

**Vocabulary.** Direction as A. Materiality: `headline` | `secondary` |
`incidental` — an ordinal about the claim's prominence *in the filing*, not its
importance to a company. Deliberately not numeric, per `confidence-tier.ts`:
a 0-to-1 "how much good" invites a threshold, and a threshold on this scale is a
recommendation engine.

**The extended gate.** Reuse `claim-span.ts` canonicalisation (`span-canon.ts`)
exactly as the claim lane does:

```
1. Model returns { materiality, justification }.
2. justification must string-match the source document after canonicalisation.
   Not matched            -> DISCARD the materiality, keep A's direction.
3. justification must fall inside the SAME sentence scope as the claim's own
   span (sentence-scope.ts).                    -> else DISCARD.
4. justification must trip no ADVISORY_PATTERNS and no INDIVIDUAL_PATTERNS.
                                                 -> else DISCARD.
5. On any discard the filing keeps its A tag and records a discard reason.
   Never softened, never rewritten -- claim-advisory.ts's rule.
```

Step 2 is the novel part and it is the only genuinely new mechanism in this
document: it says an *opinion* may ship if and only if the model can point at
document bytes that support it. The opinion is still ours; the evidence is
theirs; the reader can check the second and discount the first.

**Where it renders.** A's glyph plus a weight: `headline` claims sort first
within a card and are the only ones eligible for the (deferred) feed filter's
default view. The justification renders as the existing evidence-quote pattern.

**Cost.** Input: system prompt (~600 tok) + 2.96 claims × 49 tok ≈ **800 input
tokens**. Output on `claude-opus-5` with adaptive thinking on by default,
~400 tokens including thinking. At $5.00 / $25.00 per MTok:

```
per filing  = (800 x $5 / 1e6) + (400 x $25 / 1e6)
            = $0.004 + $0.010 = $0.014
backfill    = 271 filings x $0.014          = $3.79   (one-off)
```

Daily: `.env.example` records 12,415 of 17,442 corpus filings ≈ 388 Telegram
messages/day, implying a 32-day corpus and ≈545 filings/day. At the measured
7.9% tag rate that is ≈43 filings/day → **$0.60/day, ≈$18/month.**

**Failure modes.**
1. *Justification-shaped hallucination.* The model finds a real span that does
   not actually support the materiality it asserted. The gate cannot catch this —
   it checks presence, not entailment. This is the residual risk and it is real.
   Bounded by: the span is in the same sentence as an already-verified claim, and
   the whole artefact is labelled model-assigned.
2. *Advisory leakage through the justification.* Mitigated by running the
   existing `advisoryHitIn` on the justification, which already blocks
   `positive/negative for the stock`, `bullish/bearish`, and `we believe`.
3. *Cost drift.* If the tag rate rises the cost rises linearly. At the measured
   rate this is $18/month, which is noise; at 100% coverage it would be $229/month.
4. *Two-lane skew.* A materiality that renders while its direction is `unrated`
   would be an opinion with no anchor. Prevented structurally: B never runs on an
   untagged filing.
5. *Prompt drift.* Materiality is a judgement, judgements drift across model
   versions, and there is no ground truth to regression-test against. Partly
   handled by the seed set in §3.4, which pins direction but cannot pin
   materiality.

---

### Option C — Full model sentiment score plus improvement commentary, labelled unverified

**What it is.** The founder's ask taken literally. Per filing: a polarity, a
magnitude score, and prose on how the company could improve. Labelled
`unverified`, contained like `documentSummary`.

**Vocabulary.** Whatever the model returns. That is the first problem.

**Cost.** A rating "about the filing" that only sees the extracted claims cannot
rate what the extractor *missed*, so it needs the document: 50,218 chars ≈ 12.6k
tokens.

```
per filing  = (13,000 x $5 / 1e6) + (900 x $25 / 1e6)
            = $0.065 + $0.0225 = $0.088
all filings = 3,451 x $0.088                = $304   (one-off)
daily       = 545 filings/day x $0.088       = $48/day  = $1,440/month
claims-only = 1,157 x $0.088                = $102   backfill; ~$95/month
```

**6.3× Option B's cost even when restricted to claim-bearing filings, and 80×
when run on everything the founder actually meant ("each update").** A cheaper
variant piggybacks on the existing claim-extraction call — the document is
already in context, so only output tokens are incremental. That variant is worse
on every non-cost axis, because it couples a rating to the extraction: a
malformed rating field now risks the verbatim lane, and `parse-retry.ts` would be
retrying the lane that produces publishable facts because an opinion field failed
to parse.

**Where it renders.** Nowhere a reader can act on it, if the `documentSummary`
precedent is honoured. Which is the argument against building it.

**Failure modes.**
1. *It is the thing `claim-advisory.ts` exists to stop.* Not "similar to" — the
   filter literally blocks the strings this option's output would contain.
   Shipping C means either deleting patterns from `ADVISORY_PATTERNS` or building
   a lane that bypasses it. Both are the same decision, and the module's header
   already argued it: *"the one time it is not honoured is the time a message
   goes out reading 'positive for the stock' over a named listed company's
   filing."*
2. *Defamation, not correction.* See §2.5.
3. *The 5.9% floor.* §0.2 measured the model inventing direction words inside a
   tightly constrained extraction task. C is an *unconstrained* characterisation
   task with no span to check against. There is no reason to expect better than
   5.9% and every reason to expect worse.
4. *Aggregation lies.* §0.4 — a sentiment distribution over this corpus reports
   ~90% positive because the pipeline refuses the bad news. Every dashboard chart
   built on it is wrong in a direction that flatters.
5. *Unfalsifiable.* A wrong direction tag is checkable against printed bytes. A
   wrong sentiment score is checkable against nothing, so the discard-reason
   discipline that `claim.types.ts` calls "the product" has nothing to bite on.

---

### 2.4 What NEVER reaches Telegram, in all three options

**No direction tag, no materiality, no score, no glyph, no commentary. The wire
line is unchanged.**

Three independent reasons, each sufficient:

1. **Regulatory.** A 400-character line about a named listed company is the most
   quotable, most forwardable artefact the system produces, and it arrives with
   no surrounding context, no legend, and no disclaimer. A `▼` on it is read as a
   call. `confidence-tier.ts` already restricts the wire to `verified`; a derived
   tag is by construction not verified.
2. **It is redundant.** The claim line already carries the document's own words.
   `SIS Revenue up 30% YoY.` is on the wire today, verbatim, because the document
   printed it. The direction is *already there*, attributed correctly, with zero
   added risk. The tag adds nothing a reader of the line does not have.
3. **Volume.** `confidence-tier.ts` documents 388 messages/day at 71.2%
   survival, peak 106/hour, and warns the channel gets muted — taking operator
   alerts (`INGEST DEGRADED`, `BLIND`, `DRAIN FAILED`) with it. Nothing that
   widens or decorates the wire is worth that.

The dashboard is where a tag can carry its own legend. The wire is not.

### 2.5 Killing "how can it improve"

**It cannot ship, in any form where the pipeline is the author. Recommend
killing it outright.**

The reasoning:

- It is unfalsifiable by construction. Every other output of this system can be
  checked against document bytes. "The company should reduce its working-capital
  cycle" can be checked against nothing, so it cannot be verified, cannot be
  discarded for a nameable reason, and cannot be reviewed. `claim.types.ts`:
  *"an extractor that refuses is only trustworthy when its refusals are
  enumerable, countable and visible."* This has no refusal vocabulary because it
  has no failure condition.
- It is a published criticism of a named, identifiable Indian listed company,
  authored by us and derived from an LLM. `claim-advisory.ts` already fails
  closed and deliberately over-blocks on claims about *individuals*, on the
  grounds that such a line is *"a defamation claim rather than a correction."*
  A company is a person that sues. The `INDIVIDUAL_PATTERNS` reasoning applies
  with more force here, not less, because improvement commentary about a company
  routinely lands on its officers — "management should improve capital
  allocation" is a statement about the MD, whom §`INDIVIDUAL_PATTERNS` blocks
  naming at all.
- It is unregistered research. Improvement commentary is the analytic core of a
  research note. Attaching it to a named scrip is the activity SEBI's
  research-analyst framework covers.
- The 5.9% invention rate (§0.2) is measured on a task with a span to check
  against. Free-form advice has none.

**The safe version already exists and costs nothing.** The founder's real
question — *what is this company going to do next?* — is answered by 702 stored
claims: 643 `kind: 'guidance'` and 59 `kind: 'target'`, 20.5% of the collection.
These are the company's own printed forward-looking statements, already through
the verbatim gate, already allowed by `claim-advisory.ts`'s header (*"expecting
volume growth of 16-18%"*, *"lowers topline guidance"*). Real stored examples:

- `MASFIN` — *"we remain committed to our guidance of growing anywhere between 20% to 25%, hopefully at the higher end of the spectrum"*
- `INDGN` — *"we expect our organic growth in FY27 to be better than FY26"*
- `STEELCAS` — *"And for FY27, we expect a growth of 25% compared to last financial year."*
- `INDUSINDBK` — *"restoring the franchise to industry-aligned growth and achieving an exit Return on Assets (RoA) of 1% in FY2027"*

**Ship a card section headed "What the company says it plans", filtered to
`kind ∈ {guidance, target}`, quoted and attributed.** Zero model calls, zero new
risk, zero new schema, and it answers the founder's question with the company's
own words instead of ours. This is a rendering change over data that already
exists — the single highest ratio of answered-intent to added-risk in this
document.

---

## 3. The winner: Option A now, Option B as an earned follow-on

**Ship Option A.** Deterministic printed-direction tags, dashboard only, zero
cost. Option B is a real design and its extended gate is the right mechanism, but
it should not ship until A has been live long enough to show that readers use the
tag and read it correctly. Option C is rejected; "how can it improve" is killed
and replaced by §2.5's guidance section.

Why A wins:

- It is the only option whose output is checkable against the document by a
  reader with no tools. `▲` means the words are there; the `title` shows them.
- It inherits `claim-topic.ts`'s asymmetry argument intact: a wrong tag mislabels
  a verified sentence and cannot publish a falsehood.
- The tag is *the document's* characterisation, not ours, which is exactly the
  line `claim-advisory.ts`'s header draws between a blocked sentence and a
  carryable one.
- Zero marginal cost means the rule set can be re-swept whenever a trap escapes,
  which is the property `claim-topic.ts` names as the reason it is not a model.
- B's $18/month is affordable but its residual risk (justification-shaped
  hallucination, §2 B.1) is not measurable until A has established whether
  readers treat a direction marker as a direction or as a rating.

### 3.1 The classifier

New module `libs/filings/src/logic/claim-direction.ts`, ~120 lines, shaped like
`claim-topic.ts`: a type, an exported constant list, a rule table, one pure
total function that never throws.

```ts
export type ClaimDirection =
  /** The document printed an increase and the amount it increased by. */
  | 'expansion'
  /** The document printed a decrease and the amount it decreased by. */
  | 'contraction'
  /** The document printed both, in the same sentence. */
  | 'mixed'
  /** The document printed no checkable movement. The honest floor: 76.7%. */
  | 'unrated';

export interface DirectionReading {
  readonly direction: ClaimDirection;
  /**
   * The document's own characters that decided it -- direction word and
   * magnitude. Rendered in the card's `title`, so the tag is checkable by a
   * reader without leaving the page. Empty string when `unrated`.
   */
  readonly evidence: string;
}

export function claimDirection(span: string): DirectionReading;
```

Order of operations, which is the policy:

1. Reject non-string / empty → `unrated`.
2. Collapse whitespace (spans carry PDF line breaks — see the KIRLOSENG and
   COHANCE spans, which are multi-line).
3. **Strip traps first.** Not "match traps and skip", but *remove the trap
   substring and continue*, because `RAMCOCEM`'s *"Average Cement prices have
   dropped by 2% YoY; however, improved by 6% QoQ"* must still be readable after
   an unrelated trap elsewhere in the sentence is removed.
4. Require a magnitude (`%` / `per cent` / `bps` / `basis points`) in the
   stripped span. No magnitude → `unrated`. This is what takes coverage from
   30.2% to 23.3% and it buys the entire defensibility argument: it is the
   difference between *"supports future growth"* (BIOCON, aspirational, refused)
   and *"grew 34.7%"* (CLEDUCATE, printed, tagged).
5. Test UP and DOWN. Both → `mixed`. One → that one. Neither → `unrated`.
6. Return the matched direction word plus the matched magnitude as `evidence`.

Second-derivative traps (`rate of decline`, `pace of decline`, `moderating`,
`decline is narrowing`) go in the trap list and yield `unrated`, per failure mode
A.3.

### 3.2 Storage schema

**On the claim, not the filing** — the direction is a property of a specific
verified span, and rolling it up first would lose the evidence.

`claim.types.ts`, on `VerifiedClaim`, following the `topic` field's precedent
exactly (including the reason it stays optional):

```ts
  /**
   * The movement the document printed about this claim's own figure.
   *
   * SET BY `verifyClaims` ON EVERY CLAIM IT ACCEPTS. Still optional, and the
   * option is about READING rather than writing: 3,420 claims stored before
   * this existed have none, and a reader must be able to tell "not classified
   * yet" from "classified as no printed movement" -- which is what `unrated`
   * means and an absent field does not.
   */
  readonly direction?: ClaimDirection;
  /**
   * The document's own characters that decided `direction`. Null when
   * `unrated`. Present so a tag can be checked without opening the PDF.
   */
  readonly directionEvidence?: string | null;
```

Plus one derived filing-level roll-up in `enrichment`, computed by a second pure
function over the filing's claims, for the deferred feed filter:

```ts
  /** expansion if every tagged claim expands, contraction if every one
   *  contracts, mixed if both appear, unrated if none is tagged. */
  readonly direction?: ClaimDirection;
```

No new collection, no migration, no index on day one — 271 filings does not need
one. Add `{'enrichment.direction': 1}` only when the feed filter ships.

### 3.3 UI rendering

Per `docs/ui-components.md` and the existing `page.ts` chip pattern:

- **Card, claim line:** a leading glyph `▲` / `▼` / `◆`, `aria-label` spelling it
  out (`increase printed`, `decrease printed`, `both printed`), `title` carrying
  `directionEvidence`. `unrated` renders **nothing** — an explicit "unrated"
  badge on 76.7% of claims is noise, and its absence already means what it means.
- **Colour: none.** Same `color: inherit` as the surrounding text. This is the
  single most important rendering decision in the document. Red/green *is* the
  sentiment claim, and §0.5 measured it wrong on 26.7% of the `▼` cases. A team
  member will request colour; the answer is the ESAFSFB span.
- **Legend:** one line under the topic chip row, always visible when any tagged
  card is on screen. Text in §3.6.
- **Feed filter:** deferred. A third `.chips` row `data-direction`, matching the
  `data-topic` pattern in `page.ts`. Not on day one — 7.9% coverage makes two of
  the three chips near-empty and an empty filter reads as a broken filter.
- **Company page:** deferred. Counts under the existing topic mix
  (`data-ui="company-topic-mix"`), phrased as a count and never as a line.
- **Telegram:** nothing. §2.4.

Standard repo constraints apply: `page.ts` and `page-style.ts` are TypeScript
template literals, so no backtick or `${` may appear in the added fragments
(guarded by `script-fragments.spec.ts`), and client-side regexes need doubled
backslashes.

### 3.4 Seed test set — 20 real claims from the collection, hand-labelled

Spans are verbatim from `enrichment.claims[].span`, whitespace collapsed. These
become `claim-direction.spec.ts` fixtures. Chosen to cover every failure mode in
§2 A, not to make the classifier look good — six of the twenty are cases where a
naive implementation is wrong.

| # | Symbol | Span (verbatim, collapsed) | Label | Why it is in the set |
|---|---|---|---|---|
| 1 | ENIL | *ENIL's digital business continued its strong upward trajectory, reporting revenues of ₹21.1 Crores up 43.3% YoY.* | `expansion` | Baseline: verb + magnitude + comparator |
| 2 | PGIL | *PAT for the quarter stood at INR 99 crore, up 51.4% Y-o-Y* | `expansion` | Terse wire-shaped form |
| 3 | RPPL | *Q1 FY27 EBITDA at ₹ 16.52 Cr; up 36.75% YoY with a margin of 16.05%* | `expansion` | Two percentages, only one is the change |
| 4 | KIMS | *Our consolidated revenue stood at Rs. 39,308 Mn for FY 26 compared to Rs. 30,670 Mn in FY 25, showing a growth of 28.2%.* | `expansion` | Noun form `growth of`, not a verb |
| 5 | BIKAJI | *Delivered overall volume growth of 7.7% and value growth of 12.5% in Q1 YoY* | `expansion` | Two same-direction magnitudes → not `mixed` |
| 6 | GVT&D | *Order bookings were INR 11.4 billion, against INR 16.2 billion in Quarter Ended June 2025, down by 30% YoY* | `contraction` | Baseline down |
| 7 | COHANCE | *Q1FY27 reported revenue from operations of ₹4,223 million, down 23.1% year-on-year.* | `contraction` | |
| 8 | WHIRLPOOL | *Consolidated PBT: Rs. 139 Cr (29% decrease YoY)* | `contraction` | Magnitude precedes the direction noun |
| 9 | BLUESTARCO | *PBT before exceptional items dropped by 23.7% to Rs 125.62 cr in Q1FY27 as compared to Rs 164.64 cr in Q1FY26.* | `contraction` | `dropped` |
| 10 | COFFEEDAY | *Net profit/(loss) after tax at f 1 Crs ; down 96% YoY* | `contraction` | OCR damage (`f` for `₹`) must not break it |
| 11 | GMMPFAUDLR | *Revenue up 16% YoY and down 2% QoQ* | `mixed` | The clean mixed case |
| 12 | RAMCOCEM | *Total Sale volume increased by 12% YoY and down by 17% QoQ despite demand disruption due to state elections in Tamil Nadu, Kerala & West Bengal* | `mixed` | Mixed with trailing narrative |
| 13 | RSWM | *Revenue for Q1 FY27 stood at ₹1,161 crore, reflecting a 1.7% QoQ increase, driven by stable domestic demand and improved volumes. On a YoY basis, revenue declined by 0.7% amid softer export demand...* | `mixed` | Two sentences, opposite directions |
| 14 | PARAGMILK | *EBITDA at ₹70 crore increased by 6% YoY; 7.4% vs 7.7% LY. PBT flat YoY; PAT declined by 20% mainly due to current tax impact* | `mixed` | Three metrics, two directions |
| 15 | ESAFSFB | *As compared to Q1 FY26, gross NPA for Q1 FY27 declined to 5.4% from 7.5% and net NPA declined to 0.8% from 3.8% while slippages reduced sharply to INR 75 crores from INR 468 crores on a Y-o-Y basis.* | `contraction` | **Polarity inversion.** Correct tag, good news. The test asserts the tag AND that nothing maps it to sentiment. |
| 16 | EDELWEISS | *Corporate net debt declined by 10% YoY to $605 Mn* | `contraction` | Inversion: falling debt |
| 17 | LEMONTREE | *cost of debt reduced to 7.48%, down 53 basis points versus a year ago* | `contraction` | Inversion + `bps` magnitude form |
| 18 | SUNDROP | *the overall rate of decline is moderating sequentially from -10% in Q4 FY26 to -3% in Q1 FY 27.* | `unrated` | **Second derivative.** Naive rule says contraction; level is improving. Must refuse. |
| 19 | ARVIND | *Pursuant to the allotment of Equity Shares under the QIP, the paid-up Equity Share capital of the Company stands increased from ₹ 2,62,13,96,400 consisting of 26,21,39,640 Equity Shares to ₹ 2,72,04,06,300...* | `unrated` | `paid-up` trap + `increased` with no % → refuse |
| 20 | ASTERDM | *Acquisition of up to an additional 12% equity stake in United CIIGMA Institute of Medical Sciences Private Limited (UCIMSPL) through exercise of the put option by the Promoter/Promoter Group...* | `unrated` | `up to` trap next to a bare `12%` — the nastiest false positive in the corpus |

Three further negatives worth pinning as fixtures: `NHPC` (*"750 MW of Subansiri
Lower"* — project name matches DOWN), `PGIL` (*"Step-Down Subsidiary"*), and
`WAAREEINDO` (*"at the rate of interest not lower than Government Security
rate"*).

### 3.5 Verification of the classifier itself

The seed set is the unit test. The corpus test follows `claim-corpus.spec.ts`'s
precedent: assert the measured distribution (798 / 23.3%, split 741/45/12) so a
rule change that silently moves coverage produces a red build rather than a
quiet drift, and so the number in the module comment stays true — the repo
convention that a comment's measurement is corrected when it changes, not
deleted.

### 3.6 The exact labelling and disclaimer language

Three surfaces, three lengths. Every word below is proposed as final copy.

**Legend, under the topic chip row, whenever a tagged card is visible:**

> **▲ ▼ ◆ mark movement the document itself printed** — the direction word and
> the figure it printed beside it. They describe what the filing said about its
> own numbers. They are not a view on the company or its shares, and Turret
> publishes none.

**Card `title` on the glyph (per claim):**

> Printed in the document: "{directionEvidence}"

**Expanded note, in the same place the confidence-tier explanation lives:**

> **What these marks are.** A mark appears only where the document printed both
> a direction — up, down, grew, declined — and the amount, as a percentage or in
> basis points. Where a filing did not print both, no mark appears; that is the
> case for about three-quarters of verified claims, and an absent mark means the
> filing was silent, not that nothing happened.
>
> **A fall is not bad news and a rise is not good news.** These marks follow the
> figure, not the company. In the current collection, 12 of 45 marked decreases
> are falling bad loans, debt, borrowing costs or emissions — a decrease every
> reader would call an improvement. Read the claim, not the arrow.
>
> **Turret does not rate companies or securities.** It reports what documents
> say and shows you where they say it.

**Aggregation refusal, wherever a count is shown:**

> Counted over verified claims only. Filings that report poorly often publish no
> narrative to verify, and filings involving litigation, enforcement or
> insolvency produce no claims at all by design — so these counts describe what
> companies chose to print, not how they performed.

That last paragraph is the §0.4 finding rendered as product copy. It is
uncomfortable and it is the difference between a tally and a lie.

---

## 4. MVP — one focused day

Scope: the tag exists, is stored, is rendered, is labelled, and is checkable.
No filter, no company page, no wire change, no model call.

| # | Task | Est. | Deliverable |
|---|---|---|---|
| 1 | `claim-direction.spec.ts` with the 20 seed rows + 3 negatives, written first and failing (RED) | 45m | Failing suite |
| 2 | `claim-direction.ts` — type, `CLAIM_DIRECTIONS`, trap list, rule table, `claimDirection()` (GREEN) | 75m | ~120-line module, all 23 green |
| 3 | Corpus assertion: 798 / 23.3%, split 741 / 45 / 12, against the fixture corpus | 30m | Distribution locked; module comment cites the measured sweep |
| 4 | `direction` + `directionEvidence` on `VerifiedClaim`; set in `verifyClaims`; filing roll-up in `enrichment-merge.ts` | 60m | Schema + wiring, with the "optional means unclassified" comment |
| 5 | Backfill tool `tools/backfill-direction.ts` — report-then-skip, no model calls, per repo convention | 45m | 3,420 claims tagged; printed before/after distribution |
| 6 | Card rendering: glyph, `aria-label`, `title`. **No colour.** Legend line. | 60m | `page.ts` + `page-style.ts`, fragments backtick-free |
| 7 | Expanded note copy (§3.6) in the confidence-tier explanation block | 20m | Copy shipped with the feature, not after it |
| 8 | `page.spec.ts`: glyph present for each tag, **absent for `unrated`**, no colour token on the glyph selector, legend present | 40m | Regression lock on the colour decision |
| 9 | Playwright: one tagged card, `data-seq`-pinned per repo convention | 25m | E2E |
| 10 | `npm test`, `npx tsc --noEmit`, `npm run lint`, browser check | 20m | Evidence before the commit message claims it |

≈ 7 hours. Commit message carries the measured distribution, per repo
convention.

Explicitly **not** in the MVP: feed filter, company-page counts, materiality,
any model call, any Telegram change, any colour.

## 5. Follow-ons, in order

1. **"What the company says it plans" card section** — filter existing claims to
   `kind ∈ {guidance, target}` (702 claims, 20.5%), quoted and attributed. Half a
   day, zero cost, zero new risk. **This is the honest answer to "how can it
   improve" and should arguably jump the queue ahead of the MVP** — it answers
   more of the founder's question for less work than anything else here.
2. **Feed filter chip row** — once tagged volume makes a filter non-empty.
   Ships with the `data-direction` query-string round-trip the topic chips
   already have.
3. **Read the `unrated` bucket** — 2,455 claims with no direction word at all.
   `claim-topic.ts`'s discipline says read the residue before tuning: some will
   be printed movements in forms the rule misses (`"₹410 crores versus ₹270
   crores"` — a comparison with no verb), and those are free coverage.
4. **Company-page counts** — after (2), phrased per §3.6's aggregation refusal.
5. **Option B materiality**, gated on evidence that readers read `▼` as a
   direction and not a rating. If the answer is no, B makes things worse and
   should not ship.
6. **Direction-word verification in the claim gate** — a new discard reason,
   `direction-not-in-span`, closing the 5.9% hole measured in §0.2. This is a
   *correctness* fix to the existing pipeline that this investigation surfaced,
   independent of the feature, and it is the highest-value line in this list.
   201 published claims currently carry a movement word the document did not
   print.

## 6. Open questions

- Should `direction-not-in-span` (follow-on 6) be a hard discard or a downgrade?
  Hard discard loses 201 otherwise-true claims; the reason is nameable either way.
- Does `MAG` need to admit bare multiples (`"increased 5.8x from 1,000 MT to
  5,800 MT"` — RPPL)? It is a printed magnitude and is currently refused.
- Are `bps`-only claims (LEMONTREE, BIKAJI's `70 bps`) the same kind of thing as
  `%` claims for a reader, or should they render differently?
