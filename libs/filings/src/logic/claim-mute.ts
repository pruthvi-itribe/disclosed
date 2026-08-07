import { composeClaimLine } from './claim-line';
import { claimTopic, type ClaimTopic } from './claim-topic';
import type { ClaimKind, VerifiedClaim } from './claim.types';

/**
 * Which verified claims are worth a reader's attention on the wire.
 *
 * ================================================================
 * WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
 * ================================================================
 *
 * ONLY THE TELEGRAM LINE. A muted claim is still extracted, still verified
 * against a verbatim span, still stored on the filing, still counted, still in
 * the feed and still carries its span for review. `composeClaimLine` is
 * untouched and the stored `claimLine` is composed from every claim exactly as
 * before, so nothing on the dashboard moves. The only thing this module can do
 * is make a Telegram message shorter, or stop one being sent.
 *
 * ================================================================
 * WHY THIS IS NOT "MUTE `other`", WHICH IS WHAT IT SET OUT TO BE
 * ================================================================
 *
 * `claim-topic.ts` calls `other` "the most useful topic on this list, because
 * it is the one an alert path can mute", and this is that alert path. Muting on
 * `other` was implemented, measured against the live collection, and abandoned,
 * because the measurement says `other` does not mean what the mute needs it to
 * mean. Two separate populations are in there.
 *
 * FIRST, a named KIND is not a named topic. Of the 952 `other` claims, 292
 * (30.7%) carry a kind the extractor could name — 178 guidance, 56 expansion,
 * 26 partnership, 19 approval, 13 target. "Infosys entered a ten-year strategic
 * agreement with Crocs, Inc." is one of them. So the kind axis is checked too.
 *
 * SECOND, AND THE REASON THE RULE HAD TO INVERT: `other` is not only "nothing
 * nameable". It is also "the topic rules missed a plural". Measured, on real
 * claims that reached `other`:
 *
 *     dividends       `dividend` does not match the plural       OFSS, ₹400/share
 *     wins orders     `won` does not match `wins`                LT, ONGC orders
 *     net loss        `profit` does not match `loss`             HCL-INSYS
 *     approves        `approved|approvals?` misses `approves`    NAVINFLUOR capex
 *     capacities      `capacity` does not match the plural       NAVINFLUOR
 *     reaffirmed AA-  the ratings rule lists five agencies       UCOBANK
 *     shareholding    `stake` does not match `shareholding`      BOSCH-HCIL
 *
 * A predicate that muted `other` + `operational` outright removed the claim line
 * from 139 filings, and reading all 139 by hand, about 25 were things a desk
 * plainly wants: a ₹400-per-share dividend, a cash tender offer for Nagarro at a
 * ~140% premium, L&T's offshore ONGC orders, a rating reaffirmation, two
 * promoter stake sales, a net loss with current liabilities exceeding current
 * assets, and an auditor's report on unpaid statutory dues. Shipping that would
 * have traded 952 boring lines for a handful of the loudest filings in the
 * collection.
 *
 * The fix is NOT to teach `claim-topic.ts` those words. That rule decides what
 * is STORED and what the dashboard's topic filter shows, this change is
 * contracted to move neither, and the file is explicit that `other` must not be
 * tuned to flatter a downstream consumer.
 *
 * ================================================================
 * SO THE PREDICATE NAMES THE NOISE INSTEAD
 * ================================================================
 *
 * A claim is muted only when all three hold:
 *
 *   1. the topic rules could not name it   (`other`)
 *   2. the extractor could not name it     (`operational`)
 *   3. and it matches something this module CAN name as boilerplate
 *
 * The third condition is what inverts the risk. "Mute what nothing recognised"
 * fails toward silence, and silence is the expensive failure — it is the one
 * that loses a tender offer. "Mute what is recognisably an ESOP grant" fails
 * toward a line one claim longer, which costs a reader a second.
 *
 * `taxonomy.ts` already made exactly this call one level up, for exactly this
 * reason: ROUTINE_CATEGORIES enumerates the categories that carry no signal and
 * notes that "the gate fails open at this stage so an unrecognised category is
 * reviewed rather than silently discarded". This is the same decision about
 * claims rather than categories, and it fails open the same way.
 */

/** The topic that names nothing. */
const UNNAMED_TOPIC: ClaimTopic = 'other';

/** The kind that names nothing. */
const UNNAMED_KIND: ClaimKind = 'operational';

/**
 * The administrative mechanics a wire line should not spend a reader on.
 *
 * ENUMERATED, NOT INFERRED, and every group below was read off the claims this
 * change would mute rather than imagined. They are the recurring shapes: a
 * company granting its own employees options, a company restating its own share
 * count, a company confirming it spent money it already told the exchange it had
 * raised, and the registrar's housekeeping. None of them is news; all of them
 * are true, verified, and already in the feed.
 *
 * DELIBERATELY NARROW. Anything not on this list survives to the wire, so the
 * cost of an omission here is a boring line and the cost of an over-broad
 * pattern is a lost filing. When in doubt the pattern is left off.
 */
const ROUTINE_MECHANICS: readonly RegExp[] = [
  // Employee equity: grants, vesting schedules, exercise prices, allotments on
  // exercise. Much the largest group, and on its own it accounts for most of the
  // filings that lose their claim line.
  /\b(stock options?|employee stock|ESOPs?|RSUs?|SOP ?\d{4}|option pool|exercise price|vest(?:s|ed|ing)?|employee incentive scheme|options? (?:granted|exercisable|convertible))\b/i,
  // The company's own share count and the arithmetic around it. A paid-up
  // capital line is the bookkeeping consequence of an event, never the event.
  /\b(paid-?up (?:equity )?(?:share )?capital|issued,? subscribed|rank(?:s|ing)? pari-?passu|pari-?passu with existing|sub-?divided? equity|face value of (?:Rs|₹|INR)|issued capital rises)\b/i,
  // Monitoring-agency and use-of-proceeds reporting. Filed quarterly by every
  // company that has ever raised money, and almost always says "no deviation".
  /\b(no (?:major )?deviations?|deviation or variation|monitoring agency|prospectus objects|objects (?:stated|in the offer|of the (?:issue|preferential))|un-?utili[sz]ed|utili[sz]ed as per|utilisation of (?:the )?(?:IPO|rights issue|preferential|issue|first and final call) proceeds)\b/i,
  // The registrar's calendar: IEPF transfers, the windows for re-lodging
  // physical shares, book closure. A `record date` never reaches this list —
  // the topic rules already file it as `governance`.
  /\b(IEPF|Investor Education and Protection Fund|special window|physical securities|demat form|book closure|cut-?off date|lock-?in for one year)\b/i,
  // Secretarial housekeeping: the company changing its own paperwork.
  //
  // The audit pattern names the CLEAN opinion and not the auditor. "Statutory
  // auditor" on its own would also mute a qualified or adverse one, and an
  // auditor raising a matter is among the most consequential things a filing
  // can say — the live collection has one reporting unpaid statutory dues.
  /\b(CIN (?:changed|is)|registered office|new tax regime|unmodified (?:opinion|report)|typographical error)\b/i,
];

const isRoutineMechanics = (text: string): boolean =>
  ROUTINE_MECHANICS.some((pattern) => pattern.test(text));

/**
 * The topic a claim is filed under for the purpose of the wire.
 *
 * STORED FIRST, DERIVED SECOND, and both branches are live. The stored field is
 * preferred so the wire and the feed cannot disagree about the same claim — a
 * reader who sees a claim filed under `dividend` in the dashboard and cannot
 * find it on the wire has been told two different things by one system.
 *
 * The derivation is not a fallback for old data, it is the ordinary case.
 * `verifyClaims` does not set `topic`; only the backfill tool does, so every
 * claim enriched since it last ran carries none — 374 of the 2,771 stored
 * claims at the time of writing, and that number grows with every filing until
 * the tool is next run. Every claim the worker composes a wire line from
 * therefore arrives here unfiled, and a predicate that read the stored field
 * alone would mute nothing in production while passing every test.
 * `claimTopic` is the same pure function the backfill calls, so the two answers
 * agree by construction.
 */
export const topicOnWire = (claim: VerifiedClaim): ClaimTopic =>
  claim.topic ?? claimTopic(claim.text);

/**
 * Whether this claim is kept off the wire.
 *
 * NEVER THROWS on a claim that reached it: `claimTopic` never throws and the
 * field reads are on a claim the verification gate already built.
 */
export const isMutedOnWire = (claim: VerifiedClaim): boolean =>
  topicOnWire(claim) === UNNAMED_TOPIC &&
  claim.kind === UNNAMED_KIND &&
  isRoutineMechanics(claim.text);

/** The claims a wire line may carry, in the order `verifyClaims` ranked them. */
export const audibleClaims = (
  claims: readonly VerifiedClaim[],
): readonly VerifiedClaim[] => claims.filter((claim) => !isMutedOnWire(claim));

/**
 * The wire's claim line: the stored composer, over the audible claims only.
 *
 * FILTERED BEFORE THE COMPOSER, NEVER AFTER, and the order is the point.
 * `MAX_CLAIMS_ON_WIRE` is three, so three stock-option lines at the head of the
 * ranked order push a real dividend off the end of the stored line entirely.
 * Filtering first PROMOTES it, and on the live collection that is the larger of
 * the two effects: 21 filings get a better line this way against 17 that merely
 * get a shorter one. Filtering after the composer would recover neither.
 *
 * Null means the same thing it means in `composeClaimLine` — there is nothing to
 * say — and the caller must treat it as such rather than falling back to the
 * stored line, which is the one this exists to replace.
 */
export const composeWireClaimLine = (
  symbol: string,
  claims: readonly VerifiedClaim[],
): string | null => composeClaimLine(symbol, audibleClaims(claims));
