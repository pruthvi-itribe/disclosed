/**
 * Validation for the only untrusted input this application has: the query
 * string.
 *
 * Everything here fails LOUDLY with a 400 rather than falling back to a
 * default. A viewer that silently ignores `?limit=abc` and returns 25 rows is
 * indistinguishable from one that honoured the request, and the person reading
 * the page has no way to tell that their filter did nothing.
 *
 * The numeric rule is the project's, not a new one: `Number.isFinite` first,
 * because `NaN` passes a bare lower-bound check (`NaN < 1` is FALSE) and then
 * reaches Mongo as `limit(NaN)` — which the driver treats as no limit at all
 * and streams the entire collection.
 */

import { BadRequestException } from '@nestjs/common';

/**
 * Express parses a repeated key (`?symbol=A&symbol=B`) into an array and a
 * bracketed key (`?symbol[$ne]=x`) into an object. Neither is a value this API
 * accepts, and the object form is the shape a NoSQL-injection attempt takes, so
 * both are rejected here rather than coerced.
 */
export type RawQuery = Readonly<Record<string, unknown>>;

/** Longest accepted filter string; longer inputs are a mistake or an attack, never a symbol. */
export const MAX_FILTER_LENGTH = 128;

/**
 * Narrows one raw query value to a single string, or throws.
 *
 * The `typeof` check is a security control, not a formality. Without it a
 * bracketed query key arrives as a plain object and, interpolated into a Mongo
 * filter, becomes an operator the caller chose — `{symbol: {$ne: null}}` reads
 * the whole collection past any intended filter.
 */
export const readSingle = (
  name: string,
  query: RawQuery,
): string | undefined => {
  const raw = query[name];
  if (raw === undefined) return undefined;

  if (typeof raw !== 'string') {
    throw new BadRequestException(
      `${name} must be given at most once, as a plain value.`,
    );
  }

  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Reads a bounded whole number, or throws naming the key and the bound.
 *
 * `Number` rather than `parseInt`: `parseInt('50rows')` is 50 and
 * `parseInt('1e3')` is 1, both accepting a value the caller did not write.
 */
export const readBoundedInteger = (
  name: string,
  query: RawQuery,
  bounds: {
    readonly fallback: number;
    readonly min: number;
    readonly max: number;
  },
): number => {
  const raw = readSingle(name, query);
  if (raw === undefined) return bounds.fallback;

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new BadRequestException(
      `${name} must be a finite number, but was "${raw}".`,
    );
  }

  if (!Number.isInteger(value)) {
    throw new BadRequestException(
      `${name} must be a whole number, but was "${raw}".`,
    );
  }

  if (value < bounds.min || value > bounds.max) {
    throw new BadRequestException(
      `${name} must be between ${bounds.min} and ${bounds.max}, but was "${raw}".`,
    );
  }

  return value;
};

/** Reads a filter string, rejecting anything too long to be a real value. */
export const readFilter = (
  name: string,
  query: RawQuery,
): string | undefined => {
  const value = readSingle(name, query);
  if (value === undefined) return undefined;

  if (value.length > MAX_FILTER_LENGTH) {
    throw new BadRequestException(
      `${name} must be at most ${MAX_FILTER_LENGTH} characters, but was ${value.length}.`,
    );
  }

  return value;
};
