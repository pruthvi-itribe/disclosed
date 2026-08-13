# Claim length: what the 120-character cap was deleting

Run 2026-08-13 against the **production** database (`turret` on
`prod-mongo-v2`, reached from inside the DOKS cluster — it is VPC-private),
holding **2,763 filings** spanning 2026-08-11 to 2026-08-13. Read-only:
nothing was written and no index was created.

This is the sweep cited by `MAX_CLAIM_CHARS` in
`libs/filings/src/logic/claim-verify.ts`. It exists because that comment says
"Measured", and a number in a comment must come from a measurement somebody
can re-run.

**It is not the same corpus as
[`2026-08-11-processing-audit.md`](./2026-08-11-processing-audit.md)**, and the
difference is the WINDOW AND THE POPULATION rather than the host. That audit
also ran against a live `turret` database — it says so in its header — two days
earlier, over **5,062 filings disseminated 2026-08-04 to 2026-08-11**; this one
holds **2,763 disseminated 2026-08-11 to 2026-08-13**. Where the two disagree
they are describing different populations, not contradicting each other.

`too-long` is 208 there and 154 here, which divides out to 4.1% and 5.6% of
their respective corpora. **Read that pair loosely.** The audit's 5,062 is
explicitly NSE-only — it holds 2,104 BSE announcements separately and never
processes them (its §8) — while the §1 query below applies no exchange filter,
so the two denominators are not built the same way. The division is right; what
the ratio means across the two is looser than the numbers look.

## 1. Discard reasons, ranked

```js
db.filings.aggregate([
  { $match: { 'enrichment.state': 'enriched',
              'enrichment.claimDiscards.0': { $exists: true } } },
  { $unwind: '$enrichment.claimDiscards' },
  { $group: { _id: '$enrichment.claimDiscards.reason', n: { $sum: 1 } } },
  { $sort: { n: -1 } },
])
```

| Reason | n |
| --- | ---: |
| `number-not-in-span` | 1,060 |
| `period-not-in-context` | 954 |
| `span-not-found` | 921 |
| `direction-not-in-span` | 188 |
| **`too-long`** | **154** |
| `names-an-individual` | 140 |
| `conditional-language` | 67 |
| `span-too-short` | 66 |
| `legally-blocked` | 32 |
| `advisory-language` | 9 |

**Ten reasons OCCURRED; the `ClaimDiscardReason` type has thirteen members.**
`duplicate`, `empty-claim` and `over-limit` produced nothing in this corpus.
That distinction matters and was got wrong once already: a comment that says
"of ten" without saying "of the ten that occurred" reads as a claim about the
type, and is then false.

`too-long` is **fifth by occurrence here**. It is fourth in the 2026-08-11
audit, over a different corpus. Neither ranking is portable; cite the corpus
or cite neither.

## 2. What `too-long` was throwing away

The stored `claim` on a discard is truncated to 80 characters for the record,
so true lengths come from `detail`, which carries them verbatim
(`"<N> characters exceeds the <cap> ..."`).

```js
// 154 discards; lengths parsed out of `detail`.
db.filings.find({ 'enrichment.claimDiscards.reason': 'too-long' },
                { 'enrichment.claimDiscards': 1 })
```

| | |
| --- | ---: |
| `too-long` discards | 154 |
| ...carrying at least one digit | 92 |
| ...that left the filing with **zero** claims | 39 |
| ...that left the filing with exactly one | 36 |

Lengths of the discarded claims:

```
min 121   p25 123   p50 128   p75 133   p90 143   max 203
```

The median was **eight characters over the line**. A sample of what that
bought, all of them digit-carrying:

```
Q1 FY27: consolidated income Rs 434.51 crore, net loss Rs 45.19 crore; ...
CRISIL migrated ratings on bank facilities to 'Crisil BB/Stable/Crisil A4+ ...
Material subsidiary Saatvik Solar Industries received and accepted INR 476 ...
Delay in setting up 220 TPD air separation unit at Uluberia-II: Rs 888.25 m...
As at June 30, 2026, Rs 3,418.24 million of Rs 4,000.00 million gross IPO p...
L&T forays into AI Factory business, deploying NVIDIA B300 infrastructure a...
```

## 3. Lengths of the claims that were kept

```js
// 5,095 claims across every filing holding at least one.
db.filings.find({ 'enrichment.claims.0': { $exists: true } },
                { 'enrichment.claims.text': 1 })
```

```
p50 66   p75 85   p90 102   p95 110   p99 118   max 120
```

`max 120` is the cap clipping the distribution, not the distribution ending.

## 4. Recovery by candidate bound

```
<= 140 chars: 133 of 154  (86%)
<= 160 chars: 147 of 154  (95%)
<= 180 chars: 153 of 154  (99%)
<= 200 chars: 153 of 154  (99%)
<= 240 chars: 154 of 154  (100%)
```

**These are grid points, not thresholds the data chose.** 200 recovers exactly
what 180 recovers; the single claim beyond both is 203 characters. The gate is
`if (text.length > MAX_CLAIM_CHARS)` — a strict `>`, so the bound is an
INCLUSIVE maximum and a claim of exactly N passes at cap N. **203** is
therefore the smallest bound admitting all 154, not 204. (Section 3's `max 120`
under a cap of 120 is the same fact seen from the other side.) 240 is simply
the next point tested after 200 — it is not a fact about the corpus, and a
comment that says "240 would be needed for all of them" is describing this grid
rather than the data.

200 was chosen for **headroom** above the observed p90 of 143, not because it
recovers more than 180.

## 5. What the share post was dropping

```js
// Filings holding a claim, and what else they hold.
db.filings.countDocuments({ 'enrichment.state': 'enriched',
                            'enrichment.claims.0': { $exists: true } })
```

| | n |
| --- | ---: |
| filings with at least one claim | 1,193 |
| ...also holding a verified amount | 33 |
| ...also holding a counterparty | 6 |
| ...holding an amount while **no claim carries a digit** | **33** |

Every filing that had an amount had no digit in any claim. The money was
extracted, verified, stored, shown on the card, and absent from the shared
post.

## 6. Counterparties

```js
db.filings.find({ 'enrichment.counterparty': { $ne: null } },
                { 'enrichment.counterparty': 1 })
```

Nine exist corpus-wide. One is a sentence rather than a name:

```
Received order from Vikran Engineering Limited
```

Two are longer than six words. That value reached a reader as
`Rs 476 cr from Received order from Vikran Engineering Limited`.

## The re-sweep this obsoletes itself with

`MAX_CLAIM_CHARS` is interpolated into the extractor prompt
(`libs/filings/src/logic/claim-prompt.ts`, rule 8), so it does not merely
filter what the model produces — it changes what the model is **told** to
produce. Every length above was generated under an instruction to stay under
120. Under a 200-character instruction the distribution moves, by an unknown
amount, and section 3 in particular stops describing the present.

Re-run this file once the 200-character prompt has been live long enough to
have produced a corpus of its own. Task #59 tracks it.
