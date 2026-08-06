/**
 * Renders a rupee figure the way an Indian market participant reads one.
 *
 * `18,53,66,820` is what the filer wrote and it is what the record stores, but
 * nobody trading reads eight digits at a glance — they read "18.54 cr". The
 * headline exists to be understood in the second it is on screen, so this
 * module converts to the unit a reader already holds a mental scale for.
 *
 * THIS IS THE ONE PLACE IN THE HEADLINE PIPELINE THAT IS NOT VERBATIM. Every
 * other component is a stored string or a table lookup; this one performs
 * arithmetic and rounds. That is a deliberate, bounded exception and it is
 * bounded in two ways: the exact rupee value and the verbatim source substring
 * are both persisted alongside the rendered text, so any rendering can be
 * checked against what the document actually said; and rounding is to two
 * decimal places, which for a crore figure is a ₹10,000-scale display
 * difference on a figure of ₹10,00,00,000 or more.
 *
 * Rounding is half-away-from-zero at two decimals, then trailing zeros are
 * stripped — `1063.00` renders as `1,063`, not `1,063.00`, because the trailing
 * zeros imply a precision the round did not preserve.
 */

/** One crore: 10^7. The unit Indian filings and Indian traders both use. */
export const CRORE = 10_000_000;

/** One lakh: 10^5. */
export const LAKH = 100_000;

/** Decimal places kept when rendering into crore or lakh. */
export const AMOUNT_DECIMALS = 2;

/**
 * Indian digit grouping: the last three digits, then pairs.
 *
 * `1063` → `1,063`; `100000` → `1,00,000`; `123456789` → `12,34,56,789`. NOT
 * `toLocaleString('en-IN')`, which depends on the ICU data compiled into the
 * running Node binary — a small-icu build silently falls back to en-US grouping
 * and renders `1,00,000` as `100,000`. A four-line function has no such
 * dependency, and this figure is going into a public message about a named
 * listed company.
 */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

/**
 * Rounds to `AMOUNT_DECIMALS` and drops trailing zeros.
 *
 * `AMOUNT_DECIMALS` is at least 1, so `toFixed` always emits a decimal point
 * and the split always yields two halves — asserted in the suite rather than
 * guarded here, because a guard for a case that cannot arise is a branch no
 * test can reach and no reader can evaluate.
 */
export function splitRounded(value: number): {
  integer: string;
  fraction: string;
} {
  const fixed = value.toFixed(AMOUNT_DECIMALS);
  const dot = fixed.lastIndexOf('.');
  return {
    integer: fixed.slice(0, dot),
    fraction: fixed.slice(dot + 1).replace(/0+$/, ''),
  };
}

const render = (value: number, unit: string): string => {
  const { integer, fraction } = splitRounded(value);
  const number =
    fraction === ''
      ? groupIndian(integer)
      : `${groupIndian(integer)}.${fraction}`;
  return `₹${number} ${unit}`;
};

/**
 * Formats an exact rupee amount for a headline.
 *
 * @returns `₹78.24 cr`, `₹18.54 lakh`, `₹45,000` — or null when the value is
 * not a figure that can be rendered at all. Null rather than a placeholder
 * string: a headline must omit what it cannot state, never print a stand-in
 * that reads like a number.
 *
 * Negative and non-finite values return null. Neither can arise from the
 * extractor, which parses digits from a document and guards `Number.isFinite`
 * — but this function is also called with values read back from a database
 * that a future migration could put anything in, and `₹NaN cr` in a message
 * about a listed company is the failure this codebase spends most of its
 * effort avoiding.
 */
export function formatRupees(rupees: number): string | null {
  if (!Number.isFinite(rupees) || rupees < 0) return null;

  if (rupees >= CRORE) return render(rupees / CRORE, 'cr');
  if (rupees >= LAKH) return render(rupees / LAKH, 'lakh');

  // Below a lakh there is no idiomatic unit, so the figure is stated whole.
  // Rounded to a rupee: the sub-rupee part of a ₹45,000.37 order is noise, and
  // the exact value is stored regardless.
  return `₹${groupIndian(String(Math.round(rupees)))}`;
}
