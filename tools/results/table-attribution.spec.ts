import {
  columnHeadersIn,
  foldPage,
  isColumnHeaderLine,
  MARKET_INFRASTRUCTURE,
  nameOffsetsIn,
  nearestAbove,
  ownerOf,
  sweep,
  withoutCorporateSuffix,
  type HeaderRow,
} from './table-attribution';

/**
 * The document's own bytes, as `pdf-parse` produced them, for the page that
 * decided this measurement.
 *
 * RateGain filed its newspaper advertisement (seqId 106731309). The page's
 * layout is the ordinary one: RateGain's own results table ends with the
 * signature block naming RateGain, and SHYAM CENTURY FERROUS LIMITED's
 * advertisement — its own banner, its own CIN, its own results extract, its own
 * column header — begins immediately underneath. The filer's name therefore
 * sits 508 characters ABOVE a table that is not the filer's.
 */
const RATEGAIN_PAGE =
  " behall of lhe Board of o;e..,.. \nRATEGAIN TRAVEL TECHNOLOGIES LIMITED \nSd/• \nBhanu Chopra \n(Ch.tlfm'an and Managing Director) \nSHYAM CENTURY FERROUS LIMITED \nRegd.Office: Viii.: Lumshnong, PO: Khaliehriat, Dist. East l  aintia Hills, Meghalaya -793210 \nCIN: L\n27310ML201!PLC008578, Phone: ♦91-9147415110 \nEmail: lnvestors@shyamcenturvferrous.com; website: www.shyamcenturyferrous.com \ni--..-;-Ext..,.-ract of Unaudited Financial Results for the Quarter ended 30th June,r:.2ca:02;;::6a--~i \n{fin lacs) \nQuarter erided Year ended \nPartkulars \n30.06.2026 31.03.2026 30.06.2025 \n31,03.2026 \n(Unaudited) (Audited) ";

/**
 * HCL Infosystems' page (seqId 106725984), where the parser welds the banner
 * into one token. Any matcher that treats a space as significant answers "the
 * name is not on this page" about a page that prints it as a heading.
 */
const HCL_PAGE =
  'embership No: A-54882 \n \n \n \n \n \n \n \n \n\nFor WonderlaHolidaysLimited\nManagingDirector& ExecutiveChairman\n1.  The abovefin';

describe('foldPage and nameOffsetsIn', () => {
  it('finds a banner the parser welded into one token', () => {
    const offsets = nameOffsetsIn(
      foldPage(HCL_PAGE),
      'Wonderla Holidays Limited',
    );
    expect(offsets).toHaveLength(1);
    expect(HCL_PAGE.slice(offsets[0], offsets[0] + 24)).toBe(
      'WonderlaHolidaysLimited\n',
    );
  });

  it('matches a name the advertisement sets in capitals', () => {
    const offsets = nameOffsetsIn(
      foldPage(RATEGAIN_PAGE),
      'RateGain Travel Technologies Limited',
    );
    expect(offsets).toHaveLength(1);
    expect(RATEGAIN_PAGE.startsWith('RATEGAIN', offsets[0])).toBe(true);
  });

  it('returns every occurrence, not only the first', () => {
    const page = foldPage('ACME LIMITED said. Later, Acme Limited said again.');
    expect(nameOffsetsIn(page, 'Acme Limited')).toHaveLength(2);
  });

  it('maps the offset back into the ORIGINAL text, not the projection', () => {
    const source = '   \n\n  Acme  Limited  ';
    const [offset] = nameOffsetsIn(foldPage(source), 'Acme Limited');
    expect(source.slice(offset, offset + 4)).toBe('Acme');
  });

  it('answers nothing for a name the page does not print', () => {
    expect(nameOffsetsIn(foldPage(HCL_PAGE), 'Sanofi India Limited')).toEqual(
      [],
    );
  });

  it('answers nothing for an empty name rather than matching everywhere', () => {
    expect(nameOffsetsIn(foldPage(HCL_PAGE), '')).toEqual([]);
    expect(nameOffsetsIn(foldPage(HCL_PAGE), '   ')).toEqual([]);
  });
});

describe('withoutCorporateSuffix', () => {
  it('drops the suffix the exchange stores', () => {
    expect(withoutCorporateSuffix('Sterling Tools Limited')).toBe(
      'Sterling Tools',
    );
    expect(withoutCorporateSuffix('Associated Alcohols & Breweries Ltd.')).toBe(
      'Associated Alcohols & Breweries',
    );
  });

  it('leaves a name that does not end in one alone', () => {
    expect(withoutCorporateSuffix('Bharat Electronics')).toBe(
      'Bharat Electronics',
    );
  });

  it('does not eat a name whose last word merely contains it', () => {
    expect(withoutCorporateSuffix('Unlimited Foods')).toBe('Unlimited Foods');
  });
});

describe('isColumnHeaderLine', () => {
  it('accepts a bare row of column dates', () => {
    expect(isColumnHeaderLine('30.06.2026 31.03.2026 30.06.2025 ')).toBe(true);
  });

  it('accepts a header the parser welded a stub of the row label onto', () => {
    expect(
      isColumnHeaderLine('No. o 30-06-2026 | 31-03-2026 | 30-06-2025 '),
    ).toBe(true);
  });

  it('refuses prose that happens to carry two dates', () => {
    expect(
      isColumnHeaderLine(
        '3. The figures for the quarter ended 31.03.2026 are the balancing ' +
          'figures between the audited figures for 31.03.2026 and the published ' +
          'year to date figures.',
      ),
    ).toBe(false);
  });

  it('refuses a line carrying one date, which names no columns', () => {
    expect(isColumnHeaderLine('Quarter ended 30.06.2026')).toBe(false);
  });

  it('refuses an empty line', () => {
    expect(isColumnHeaderLine('   ')).toBe(false);
  });
});

describe('columnHeadersIn', () => {
  it('locates the header by its offset in the document', () => {
    const headers = columnHeadersIn(RATEGAIN_PAGE);
    expect(headers).toHaveLength(1);
    expect(RATEGAIN_PAGE.startsWith('30.06.2026', headers[0].offset)).toBe(
      true,
    );
  });
});

describe('nearestAbove', () => {
  it('takes the closest offset at or above the point', () => {
    expect(nearestAbove([10, 400, 900], 500)).toBe(400);
  });

  it('ignores everything below it', () => {
    expect(nearestAbove([900, 1200], 500)).toBeNull();
  });

  it('counts an offset exactly at the point as above it', () => {
    expect(nearestAbove([500], 500)).toBe(500);
  });
});

/**
 * The measurement's decisive case, reproduced from the document's own bytes.
 *
 * This is what a `tableAttribution` check would have to get right, and the page
 * shows why no window can: the filer's name is 508 characters above a table
 * belonging to another company, because a statutory advertisement SIGNS OFF
 * with the company's name and the next advertiser's banner follows it.
 */
describe('the page that decided the measurement', () => {
  const page = foldPage(RATEGAIN_PAGE);
  const header = columnHeadersIn(RATEGAIN_PAGE)[0];
  const filer = nearestAbove(
    nameOffsetsIn(page, 'RateGain Travel Technologies Limited'),
    header.offset,
  );
  const other = nearestAbove(
    nameOffsetsIn(page, 'Shyam Century Ferrous Limited'),
    header.offset,
  );

  it('puts the filer 508 characters above a table that is not its own', () => {
    expect(header.offset - (filer ?? 0)).toBe(508);
  });

  it('puts the table owner 414 characters above it — nearer, but not by much', () => {
    expect(header.offset - (other ?? 0)).toBe(414);
  });

  it('is read as another company’s table by the document’s own layout', () => {
    const row: HeaderRow = {
      symbol: 'RATEGAIN',
      seqId: 106731309,
      companyName: 'RateGain Travel Technologies Limited',
      filerAbove: header.offset - (filer ?? 0),
      otherAbove: header.offset - (other ?? 0),
      otherName: 'Shyam Century Ferrous Limited',
      soleCompany: false,
      line: header.line,
    };
    expect(ownerOf(row)).toBe('other');
    // Any window wide enough to admit a real banner admits this one too.
    expect(sweep([row], [400, 600])).toEqual([
      {
        window: 400,
        admitted: 0,
        ownTotal: 0,
        misattributed: 0,
        otherTotal: 1,
      },
      {
        window: 600,
        admitted: 0,
        ownTotal: 0,
        misattributed: 1,
        otherTotal: 1,
      },
    ]);
  });
});

describe('ownerOf', () => {
  const row = (over: Partial<HeaderRow>): HeaderRow => ({
    symbol: 'X',
    seqId: 1,
    companyName: 'X Limited',
    filerAbove: null,
    otherAbove: null,
    otherName: null,
    soleCompany: false,
    line: '',
    ...over,
  });

  it('gives a table on a sole-company page to the filer', () => {
    expect(ownerOf(row({ soleCompany: true, filerAbove: 9_000 }))).toBe(
      'filer',
    );
  });

  it('refuses to name an owner when the page never prints the filer', () => {
    expect(ownerOf(row({ soleCompany: true }))).toBe('neither');
    expect(ownerOf(row({}))).toBe('neither');
  });

  it('gives the table to whichever name sits nearer above it', () => {
    expect(ownerOf(row({ filerAbove: 100, otherAbove: 500 }))).toBe('filer');
    expect(ownerOf(row({ filerAbove: 500, otherAbove: 100 }))).toBe('other');
  });

  it('gives it to the only name there is', () => {
    expect(ownerOf(row({ filerAbove: 5_000 }))).toBe('filer');
    expect(ownerOf(row({ otherAbove: 5_000 }))).toBe('other');
  });
});

describe('sweep', () => {
  const own: HeaderRow = {
    symbol: 'A',
    seqId: 1,
    companyName: 'A Limited',
    filerAbove: 300,
    otherAbove: 900,
    otherName: 'B Limited',
    soleCompany: false,
    line: '',
  };
  const theirs: HeaderRow = { ...own, filerAbove: 800, otherAbove: 200 };

  it('counts the filer’s own tables admitted and the others mis-attributed', () => {
    expect(sweep([own, theirs], [400, 1_000])).toEqual([
      {
        window: 400,
        admitted: 1,
        ownTotal: 1,
        misattributed: 0,
        otherTotal: 1,
      },
      {
        window: 1_000,
        admitted: 1,
        ownTotal: 1,
        misattributed: 1,
        otherTotal: 1,
      },
    ]);
  });
});

describe('MARKET_INFRASTRUCTURE', () => {
  it('holds the exchanges every covering letter addresses', () => {
    expect(MARKET_INFRASTRUCTURE.has('BSE Limited')).toBe(true);
    expect(
      MARKET_INFRASTRUCTURE.has('National Stock Exchange of India Limited'),
    ).toBe(true);
    expect(MARKET_INFRASTRUCTURE.has('Sanofi India Limited')).toBe(false);
  });
});
