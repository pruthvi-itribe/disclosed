import { figuresIn, numbersIn, unsupportedNumbers } from './claim-numbers';

describe('numbersIn', () => {
  it.each([
    ['a plain figure', 'grew 18%', ['18']],
    ['Indian grouping', '₹1,00,000 crore', ['100000']],
    ['western grouping', '₹10,000 Cr', ['10000']],
    ['a decimal', 'up 2.5x', ['2.5']],
    ['a range', '15-20%', ['15', '20']],
    ['a fiscal year', 'by FY31', ['31']],
    ['several figures', 'Q1 FY27 revenue of 4,336', ['1', '27', '4336']],
    ['no figures at all', 'expanded the distribution network', []],
  ])('reads %s', (_label, text, expected) => {
    expect(numbersIn(text)).toEqual(expected);
  });

  it('does not swallow a trailing full stop into the figure', () => {
    expect(numbersIn('₹10,000 Cr.')).toEqual(['10000']);
  });

  it('keeps a repeated figure, because repetition can be the claim', () => {
    expect(numbersIn('from 15 to 15')).toEqual(['15', '15']);
  });
});

describe('figuresIn', () => {
  it.each([
    ['a plain figure', 'grew 18%', ['18']],
    ['a quarter and year, which are not figures', 'Q1 FY27 revenue', []],
    ['a figure beside a period', 'Q1 FY27 revenue of 4,336', ['4336']],
    ['a joined period', 'Q1FY27 EBITDA of ₹9.5 Cr', ['9.5']],
    ['a four-digit fiscal year', 'FY2027 margin of 12.25%', ['12.25']],
    ['a target year', 'targets ₹10,000 Cr by FY31', ['10000']],
    ['a range beside a period', 'guides FY27 growth of 10-13%', ['10', '13']],
    ['no digits at all', 'expanded the distribution network', []],
  ])('reads %s', (_label, text, expected) => {
    expect(figuresIn(text)).toEqual(expected);
  });

  it('differs from numbersIn exactly by the period digits', () => {
    // The whole change, in one assertion: `1` and `27` are the quarter and the
    // year, and reading them as money is what threw away five real claims.
    expect(numbersIn('Q1 FY27 revenue of 4,336')).toEqual(['1', '27', '4336']);
    expect(figuresIn('Q1 FY27 revenue of 4,336')).toEqual(['4336']);
  });

  it('keeps a figure that merely looks like a year', () => {
    // `2026` here is a headcount, not a period, because nothing marks it as one.
    expect(figuresIn('employs 2026 people')).toEqual(['2026']);
  });
});

describe('unsupportedNumbers', () => {
  it('accepts a claim whose figures are all in its span', () => {
    expect(
      unsupportedNumbers(
        'targets ₹10,000 Cr adj EBITDA by FY31',
        'setting out its goal to build a ₹10,000 Cr. Adjusted EBITDA business by FY31',
      ),
    ).toEqual([]);
  });

  it('accepts a comma placement the filer chose differently', () => {
    expect(
      unsupportedNumbers('order worth 10000 crore', 'Rs. 10,000 crore'),
    ).toEqual([]);
  });

  it('REFUSES a unit conversion, however correct the arithmetic', () => {
    // 10,000 crore IS 100 billion rupees. It is the same money and it is not
    // the same evidence, and a model doing arithmetic on a filing about a named
    // listed company is the error class this whole pipeline refuses to make.
    expect(
      unsupportedNumbers(
        'targets 100b rupees adj EBITDA by FY31',
        'a ₹10,000 Cr. Adjusted EBITDA business by FY31',
      ),
    ).toEqual(['100']);
  });

  it('refuses a figure that is simply not there', () => {
    expect(
      unsupportedNumbers(
        'margin of 25%',
        'EBITDA up 10% YoY, 21% EBITDA margin',
      ),
    ).toEqual(['25']);
  });

  it('names every unsupported figure, so a discard can be reviewed', () => {
    expect(
      unsupportedNumbers(
        'grew 30% to 40 crore',
        'revenue grew 18% in the quarter',
      ),
    ).toEqual(['30', '40']);
  });

  it('accepts a claim with no figures at all', () => {
    expect(
      unsupportedNumbers(
        'joins the Microsoft Intelligent Security Association',
        'The Company has joined the Microsoft Intelligent Security Association.',
      ),
    ).toEqual([]);
  });

  it('does not demand a period’s digits of the span', () => {
    // The measured failure: every figure was present and the claim died on the
    // `1` of `Q1` and the `27` of `FY27`.
    expect(
      unsupportedNumbers(
        'Q1 FY27 revenue from operations rose 20.2% YoY to INR 15.4 billion',
        'Revenue from operations increased to INR 15.4 billion (+20.2% YoY)',
      ),
    ).toEqual([]);
  });

  it('still refuses a figure hiding beside a period', () => {
    expect(
      unsupportedNumbers(
        'Q1 FY27 revenue of ₹130.0 Cr',
        'Revenue & EBITDA of ₹125.2 Cr and ₹9.5 Cr respectively.',
      ),
    ).toEqual(['130.0']);
  });

  it('does not let a period in the SPAN support a figure in the claim', () => {
    // Both sides drop period digits, so the span's `FY2027` cannot stand in for
    // a claim asserting 2027 of something. The asymmetric alternative would
    // have been looser than the rule this replaces.
    expect(
      unsupportedNumbers('shipped 2027 units', 'Q1 FY2027 revenue grew'),
    ).toEqual(['2027']);
  });

  it('is span-scoped, not document-scoped', () => {
    // A document-wide check is almost no check at all: any two-digit number
    // appears somewhere in a forty-page presentation.
    const span = 'EBITDA margin of 21% in the quarter';
    expect(unsupportedNumbers('margin of 23%', span)).toEqual(['23']);
  });
});
