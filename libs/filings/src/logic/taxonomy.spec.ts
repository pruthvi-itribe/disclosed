import { isRoutine, ROUTINE_CATEGORIES } from './taxonomy';

describe('taxonomy', () => {
  it('marks demat status filings as routine', () => {
    expect(isRoutine('Updates')).toBe(true);
  });

  it('marks newspaper publication as routine', () => {
    expect(isRoutine('Copy of Newspaper Publication')).toBe(true);
  });

  it('does not mark order wins as routine', () => {
    expect(isRoutine('Bagging/Receiving of orders/contracts')).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isRoutine('  copy of NEWSPAPER publication ')).toBe(true);
  });

  it('treats unknown categories as non-routine so nothing is silently dropped', () => {
    expect(isRoutine('Some Category NSE Invented Yesterday')).toBe(false);
  });

  it('exposes the routine set for corpus analysis', () => {
    expect(ROUTINE_CATEGORIES.size).toBeGreaterThan(0);
  });
});
