import { actionPhraseFor } from './action-phrase';
import { formatRupees } from './amount-format';

/**
 * Composes the one line a reader sees first.
 *
 * EVERY COMPONENT IS TRACEABLE TO A STORED FACT. There are exactly four, and
 * each one has a single, checkable origin:
 *
 *   symbol         the stored field, verbatim, uppercased
 *   action phrase  a lookup in `action-phrase.ts`, keyed by the stored category
 *   amount         `amount-extraction.ts`, which quotes the substring it read
 *   counterparty   `counterparty.ts`, which quotes the substring it read
 *
 * Nothing is inferred, nothing is summarised, and no model is consulted. If a
 * component cannot be produced from those sources it is omitted, and if the
 * AMOUNT cannot be produced the line degrades all the way back to the format
 * the alert already uses today — the exchange's own symbol and category, in
 * caps, with no claim of any kind attached.
 *
 * That degradation is the point rather than a fallback. An order win whose PDF
 * was refused is still an order win, and saying "PANACEABIO —
 * BAGGING/RECEIVING OF ORDERS/CONTRACTS" is exactly as true as it was before
 * this module existed. What must never happen is a line that reads like a
 * headline and carries a number nobody verified.
 */

/**
 * How much of a component may reach the wire.
 *
 * A bound rather than a preference: `symbol`, `category` and the counterparty's
 * source row are all exchange-supplied text, and a message that a client
 * refuses to render is a filing lost.
 */
export const MAX_COMPONENT_CHARS = 120;

export type HeadlineForm =
  /** Carries a verified amount, so it states the fact rather than the label. */
  | 'enriched'
  /** The exchange's own words, unchanged. What the alert says today. */
  | 'verbatim';

export interface HeadlineInput {
  readonly symbol: string;
  readonly category: string;
  /** Exact rupees from the extractor, or null when it refused. */
  readonly amountRupees: number | null;
  /** The verbatim name from the extractor, or null when it refused. */
  readonly counterparty: string | null;
}

export interface Headline {
  readonly form: HeadlineForm;
  readonly text: string;
  /** The parts that went in, so a stored headline can be re-derived and checked. */
  readonly components: {
    readonly symbol: string;
    readonly actionPhrase: string | null;
    readonly amount: string | null;
    readonly counterparty: string | null;
  };
}

/**
 * Collapses a component to a single bounded line.
 *
 * The wire convention is one atomic fact per line, and every component here
 * originates outside this process — NSE's feed for the symbol and category, a
 * PDF's text layer for the counterparty. A newline in any of them would split
 * one fact across two lines and, in a message that also carries a timestamp and
 * a source link, make the second half look like a separate claim.
 */
const oneLine = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, MAX_COMPONENT_CHARS);

/**
 * The line the alert has always sent: symbol and category, both in caps,
 * separated by an em dash.
 */
const verbatimText = (symbol: string, category: string): string =>
  `${oneLine(symbol).toUpperCase()} — ${oneLine(category).toUpperCase()}`;

/**
 * Builds the headline.
 *
 * The enriched form requires BOTH a mapped action phrase and a formattable
 * amount. Requiring the phrase as well as the figure is deliberate: without it
 * the line would have to fall back to the raw category, producing
 * "PANACEABIO BAGGING/RECEIVING OF ORDERS/CONTRACTS ₹78.24 cr", which reads as
 * a machine's output rather than a wire headline — and a category this table
 * does not know is exactly the case where nobody has checked that a monetary
 * figure means what the headline would imply it means.
 */
export function composeHeadline(input: HeadlineInput): Headline {
  const { symbol, category, amountRupees, counterparty } = input;

  const actionPhrase = actionPhraseFor(category);
  const amount = amountRupees === null ? null : formatRupees(amountRupees);

  if (actionPhrase === null || amount === null) {
    return {
      form: 'verbatim',
      text: verbatimText(symbol, category),
      components: {
        symbol: oneLine(symbol),
        actionPhrase,
        amount,
        counterparty: null,
      },
    };
  }

  // The counterparty rides along only on an enriched line. On its own it is a
  // true fact with nothing to attach to, and "PANACEABIO BAGS ORDER from South
  // Western Railway" invites the reader to supply the missing size themselves.
  const party =
    counterparty === null || oneLine(counterparty).length === 0
      ? null
      : oneLine(counterparty);

  const head = `${oneLine(symbol).toUpperCase()} ${actionPhrase} ${amount}`;

  return {
    form: 'enriched',
    // "from" stays lower case while the symbol and verb are capitalised. It is
    // the one word in the line that is neither a fact nor a label, and leaving
    // it uncapitalised is what keeps the eye on the parts that are.
    text: party === null ? head : `${head} from ${party}`,
    components: {
      symbol: oneLine(symbol),
      actionPhrase,
      amount,
      counterparty: party,
    },
  };
}
