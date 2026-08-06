import { matchesOf } from './regex-matches';

/**
 * Reads WHO awarded the order, verbatim, or refuses.
 *
 * The same rule that governs the amount extractor governs this module, and it
 * bites harder here: a wrong number is a wrong number, but a wrong counterparty
 * attributes a commercial relationship to two named companies that does not
 * exist. So the answer is only ever taken from the one position that declares
 * what it means — SEBI LODR Schedule III Part A(B)'s mandated row, "Name of the
 * entity awarding the order(s)/contract(s)" — and even from there it is refused
 * unless it looks like an entity's NAME rather than a description of one.
 *
 * That last guard is not theoretical. Filers routinely fill the row with a
 * deliberate anonymisation, because the counterparty's identity is
 * commercially confidential:
 *
 *     "International Customer"
 *     "A leading private sector bank in India*"
 *     "A large packaging manufacturer listed on Indian Stock Exchange,
 *      majorly owned by Finland based packaging giant."
 *
 * Four of the ten labelled rows in the committed corpus are of that shape. Each
 * is a correct, complete answer to the regulator's question and a useless one
 * for a headline, and printing it would read as though the pipeline had
 * identified somebody. All four are refused.
 *
 * OMISSION IS ALWAYS ACCEPTABLE. A headline without a counterparty is a
 * headline; a headline with the wrong one is a correction.
 */

/**
 * The mandated row label.
 *
 * Whitespace between every token is `\s*` for the same reason it is in
 * `amount-anchors.ts`: PDF text extraction both stretches and removes the gaps,
 * and the label is routinely broken across a line ("Name of the entity awarding
 * the \norder(s)/contract(s);").
 *
 * `cont(?:r)?a?ct` covers the `contact(s)` typo that reached production in a
 * real HFCL filing — the filer's template has it, so every filing from that
 * template has it.
 */
const AWARDING_LABEL =
  /name\s*of\s*the\s*entit(?:y|ies)\s*award(?:ing|ed)\s*(?:the\s*)?order\s*\(\s*s\s*\)\s*(?:\/\s*cont(?:r)?a?ct\s*\(\s*s\s*\)\s*)?[;:.]?/gi;

/**
 * How far past the label the answer may lie before the row is presumed empty.
 *
 * Measured: the longest genuine name in the corpus is 49 characters and the
 * longest anonymisation is 110, both well inside this. The window exists to
 * bound the damage when a terminator is missing, not to reach anything.
 */
export const PARTY_WINDOW_CHARS = 300;

/**
 * Where the labelled row ends and the next one begins.
 *
 * Every Schedule III order-win table puts "Significant terms and conditions"
 * immediately after the awarding-entity row, so that phrase is the primary
 * terminator. The others are the neighbouring mandated rows, plus a generic
 * line-leading enumerator ("2.", "b)") for a filer who reworded the next label.
 */
const ROW_TERMINATORS: readonly RegExp[] = [
  /significant\s*terms/i,
  /whether\s*(?:the\s*)?(?:order|contract|contact|promoter|domestic)/i,
  /nature\s*of\s*(?:the\s*)?(?:order|contract)/i,
  /time\s*period\s*(?:by|within)\s*which/i,
  /broad\s*(?:commercial\s*)?(?:consideration|value)/i,
  /(?:^|\n)\s*(?:\d{1,2}|[a-z])\s*[.)]\s/,
];

/**
 * A line that carries only a row enumerator ("2", "b.", "iii)") and no content.
 *
 * These survive the terminator because the terminator matches the next label's
 * WORDS, and the enumerator sits on its own line above them. Left in, they
 * render as "Paschim Gujarat Vij Company Limited 2".
 */
const ENUMERATOR_ONLY = /^(?:\d{1,2}|[a-z]|[ivx]{1,4})\s*[.)]?$/i;

/**
 * Words that mean the filer described the counterparty instead of naming it.
 *
 * Matched as whole words. A company genuinely called "… Customer …" does not
 * exist in the Indian listed universe; a filing that says "International
 * Customer" is telling the regulator it will not say.
 */
const ANONYMISING_WORDS =
  /\b(?:customer|client|counterparty|counter-party|buyer|purchaser|leading|reputed|renowned|esteemed|undisclosed|confidential|anonymous|unnamed)\b/i;

/** Phrases that decline to answer outright. */
const NON_ANSWERS =
  /\b(?:(?:not|cannot\s+be|to\s+be|shall\s+not\s+be)\s+disclos\w*|withheld|not\s+applicable|refer\s+to\b|as\s+per\s+annexure|n\s*\/\s*a\b)/i;

/**
 * An indefinite article opening the row: the single most reliable tell that
 * what follows is a description, not a name.
 *
 * "The" is deliberately NOT here — "The Tata Power Company Limited" and "The
 * Federal Bank Limited" are real names that begin with it.
 */
const INDEFINITE_OPENER = /^(?:an?|one\s+of)\b/i;

/**
 * Legal-form and public-body words. A candidate must carry at least one.
 *
 * This is the positive half of the test and it is what "International Customer"
 * fails. Every named entity in the corpus carries one — Limited, Private
 * Limited, Authority, Council, Railway, Department — because Indian
 * counterparties are either incorporated bodies or arms of the state, and both
 * say so in their names.
 *
 * Deliberately NOT a list of generic business nouns (Services, Solutions,
 * Technologies). Those widen the gate without identifying anything: an
 * anonymisation reading "a large packaging manufacturer" would pass a list that
 * held "manufacturer".
 */
const ENTITY_FORM_WORDS =
  /\b(?:limited|ltd|pvt|private|llp|inc|incorporated|corporation|corp|company|plc|gmbh|pte|sdn|bhd|srl|authority|authorities|council|commission|board|department|ministry|directorate|municipality|municipal|nigam|vidyut|railway|railways|university|institute|institution|academy|hospital|bank|trust|society|federation|association|undertaking|mission|agency|panchayat|samiti|nagar|port|airport)\b/i;

/**
 * The longest run of non-space characters a readable name contains.
 *
 * PDF text extraction sometimes loses the spaces entirely, producing
 * "InformationTechnologyAndElectronicsDepartmentUttarPradesh" from a real
 * RAILTEL filing. That string IS verbatim, and it is also not something to put
 * in a message a human is meant to read in one second. It is refused on
 * legibility, which is the one refusal in this module that is about the reader
 * rather than about the truth.
 */
export const MAX_NAME_TOKEN_CHARS = 30;

/** Bounds on the whole rendered name. */
export const MIN_NAME_CHARS = 3;
export const MAX_NAME_CHARS = 80;

/** Why a labelled row yielded no counterparty. All machine-readable. */
export type CounterpartyRefusalReason =
  /** No Schedule III awarding-entity row in the document. */
  | 'no-label'
  /** The row is present and empty. */
  | 'empty-row'
  /** The filer described the counterparty instead of naming it. */
  | 'described-not-named'
  /** Nothing in the text identifies it as an incorporated or public body. */
  | 'no-entity-form'
  /** The extracted text is not legible as a name. */
  | 'illegible'
  /** The value could not be traced back to an exact substring of the source. */
  | 'verbatim-mismatch';

export interface ExtractedCounterparty {
  readonly outcome: 'extracted';
  /** The name as it will be rendered: the row's own words, whitespace tidied. */
  readonly name: string;
  /** The exact substring of the document the name was read from. */
  readonly evidence: string;
  readonly offset: number;
  /** The row label, verbatim, exactly as the filer spelled it. */
  readonly label: string;
}

export interface RefusedCounterparty {
  readonly outcome: 'refused';
  readonly reason: CounterpartyRefusalReason;
}

export type CounterpartyExtraction =
  ExtractedCounterparty | RefusedCounterparty;

const refuse = (reason: CounterpartyRefusalReason): RefusedCounterparty => ({
  outcome: 'refused',
  reason,
});

/** Offset of the earliest row terminator inside `window`, or its full length. */
function firstTerminator(window: string): number {
  let end = window.length;
  for (const terminator of ROW_TERMINATORS) {
    const match = terminator.exec(window);
    if (match !== null && match.index < end) end = match.index;
  }
  return end;
}

/**
 * Collapses the row's lines into one readable string, dropping the lines that
 * carry only the next row's enumerator.
 */
function renderName(evidence: string): string {
  return evidence
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !ENUMERATOR_ONLY.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:*]+$/, '')
    .trim();
}

/**
 * Whether the rendered name is genuinely made of the evidence's own words.
 *
 * The counterpart of `isTraceableEvidence` in the amount extractor, and it
 * exists for the same reason: `renderName` transforms, and a transformation
 * that invented or moved text would produce a name that reads perfectly and
 * attributes a contract to the wrong company.
 */
export function isTraceableName(
  documentText: string,
  evidence: string,
  offset: number,
  name: string,
): boolean {
  if (documentText.slice(offset, offset + evidence.length) !== evidence) {
    return false;
  }
  return name.split(' ').every((word) => evidence.includes(word));
}

/** True when the candidate describes a counterparty rather than naming one. */
function isDescription(name: string): boolean {
  return (
    INDEFINITE_OPENER.test(name) ||
    ANONYMISING_WORDS.test(name) ||
    NON_ANSWERS.test(name)
  );
}

/** True when the candidate is not legible as a name in a one-line message. */
function isIllegible(name: string): boolean {
  if (name.length < MIN_NAME_CHARS || name.length > MAX_NAME_CHARS) return true;
  if (!/[A-Za-z]/.test(name)) return true;
  return name.split(/\s+/).some((token) => token.length > MAX_NAME_TOKEN_CHARS);
}

/**
 * Reads the awarding entity from a filing's document text.
 *
 * Refusal order is significant, and it is ordered by how confident the refusal
 * is rather than by how cheap it is to test: a description ("A leading private
 * sector bank") is refused as a description even though it is also illegibly
 * long, because that is the reason a human reviewing the refusal needs to see.
 */
export function extractCounterparty(
  documentText: string,
): CounterpartyExtraction {
  const matches = [...matchesOf(documentText, AWARDING_LABEL)];
  if (matches.length === 0) return refuse('no-label');

  // The FIRST labelled row only. A document carrying two of them is describing
  // two orders, and nothing in the text says which one this filing announces —
  // the same disagreement the amount extractor refuses outright. Here the
  // second row is simply not consulted, because the amount was already refused
  // for `multiple-candidates` in that case and no headline will be composed.
  const match = matches[0];
  const start = match.index + match[0].length;
  const window = documentText.slice(start, start + PARTY_WINDOW_CHARS);
  const evidence = window.slice(0, firstTerminator(window));

  const name = renderName(evidence);
  if (name.length === 0) return refuse('empty-row');
  if (isDescription(name)) return refuse('described-not-named');
  if (isIllegible(name)) return refuse('illegible');
  if (!ENTITY_FORM_WORDS.test(name)) return refuse('no-entity-form');
  if (!isTraceableName(documentText, evidence, start, name)) {
    return refuse('verbatim-mismatch');
  }

  return {
    outcome: 'extracted',
    name,
    evidence,
    offset: start,
    label: match[0].replace(/\s+/g, ' ').trim(),
  };
}
