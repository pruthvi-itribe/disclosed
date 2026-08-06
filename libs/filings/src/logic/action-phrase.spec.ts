import {
  actionFor,
  actionPhraseFor,
  eventNounFor,
  MAPPED_CATEGORIES,
} from './action-phrase';

describe('actionPhraseFor', () => {
  it.each([
    ['Bagging/Receiving of orders/contracts', 'BAGS ORDER'],
    ['Awarding of order(s)/contract(s)', 'AWARDS CONTRACT'],
    ['Acquisition', 'ACQUISITION'],
    ['Credit Rating- Revision', 'CREDIT RATING REVISED'],
    ['Outcome of Board Meeting', 'BOARD MEETING OUTCOME'],
    ['Agreements', 'SIGNS AGREEMENT'],
    ['Resignation of Director/KMP/SMP', 'RESIGNATION'],
    ['Defaults on Payment of Interest/Principal', 'PAYMENT DEFAULT'],
    ['Spurt in Volume', 'VOLUME SPURT'],
    ['Press Release', 'PRESS RELEASE'],
  ])('maps %s to %s', (category, expected) => {
    expect(actionPhraseFor(category)).toBe(expected);
  });

  it.each([
    ['  Bagging/Receiving of orders/contracts  '],
    ['BAGGING/RECEIVING OF ORDERS/CONTRACTS'],
    ['bagging/receiving of orders/contracts'],
    ['Bagging/Receiving  of   orders/contracts'],
  ])('normalises %s to the same entry', (category) => {
    expect(actionPhraseFor(category)).toBe('BAGS ORDER');
  });

  it.each([
    ['Some Category NSE Invented Yesterday'],
    ['Integrated Filing- Financial'],
    ['Structural Digital Database'],
    [''],
    ['   '],
    ['Bagging'],
    ['orders'],
  ])('returns null for the unmapped category %s', (category) => {
    // Null, never a guess. The caller falls back to the exchange's own words,
    // which is what the alert already says today.
    expect(actionPhraseFor(category)).toBeNull();
  });

  it('never returns a phrase built from the category text', () => {
    // The mapping must come from the table. A phrase derived by uppercasing or
    // truncating the input would pass a spot check and then invent copy for the
    // next category NSE adds.
    expect(actionPhraseFor('Bagging/Receiving of orders/contracts')).not.toBe(
      'BAGGING/RECEIVING OF ORDERS/CONTRACTS',
    );
  });
});

describe('eventNounFor', () => {
  it.each([
    ['Bagging/Receiving of orders/contracts', 'order'],
    ['Credit Rating', 'credit-rating action'],
    ['Acquisition', 'acquisition'],
    ['Awarding of order(s)/contract(s)', 'contract award'],
  ])('gives %s the noun %s', (category, expected) => {
    expect(eventNounFor(category)).toBe(expected);
  });

  it.each([
    ['Demise'],
    ['Name Change'],
    ['Suspension of Trading'],
    ['Corrigendum'],
  ])('returns null for %s, which has no countable event', (category) => {
    expect(eventNounFor(category)).toBeNull();
    // But the phrase still exists: the category IS mapped, it simply has no
    // sensible plural to count.
    expect(actionPhraseFor(category)).not.toBeNull();
  });

  it('returns null for an unmapped category', () => {
    expect(eventNounFor('Not A Real Category')).toBeNull();
  });
});

describe('the table itself', () => {
  it('is keyed entirely by normalised categories', () => {
    // A key that is not already normalised is unreachable through actionFor,
    // which is a dead entry that looks live in a code review.
    for (const key of MAPPED_CATEGORIES) {
      expect(key).toBe(key.trim().toLowerCase().replace(/\s+/g, ' '));
      expect(actionFor(key)).not.toBeNull();
    }
  });

  it.each(MAPPED_CATEGORIES)(
    'gives %s a non-empty upper-case phrase carrying no interpretation',
    (category) => {
      const action = actionFor(category);
      expect(action).not.toBeNull();
      const phrase = (action as { phrase: string }).phrase;

      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).toBe(phrase.toUpperCase());
      expect(phrase.trim()).toBe(phrase);
      // The wire convention forbids advisory or predictive framing. These are
      // the words that would smuggle it in.
      expect(phrase).not.toMatch(
        /\b(BULLISH|BEARISH|POSITIVE|NEGATIVE|BUY|SELL|STRONG|WEAK|MAJOR|HUGE|BIG)\b/,
      );
    },
  );

  it.each(MAPPED_CATEGORIES)(
    'gives %s a lower-case singular noun or none at all',
    (category) => {
      const noun = actionFor(category)?.noun ?? null;
      if (noun === null) return;
      expect(noun.length).toBeGreaterThan(0);
      expect(noun.trim()).toBe(noun);
      // Rendered as "3rd order for X in 30 days", so it must not already be
      // plural or the sentence reads "3rd orders".
      expect(noun).not.toMatch(/s$/);
    },
  );

  it('has no duplicate keys', () => {
    expect(new Set(MAPPED_CATEGORIES).size).toBe(MAPPED_CATEGORIES.length);
  });

  it('covers the categories that carry a monetary event', () => {
    // These are the lanes the amount extractor can actually produce a figure
    // for; an unmapped one there would mean a filing with a verified amount and
    // no verb to state it with.
    for (const category of [
      'Bagging/Receiving of orders/contracts',
      'Awarding of order(s)/contract(s)',
      'Acquisition',
      'Agreements',
      'Press Release',
    ]) {
      expect(actionPhraseFor(category)).not.toBeNull();
    }
  });
});
