import { isLegallyBlocked } from './legal-block';

const filing = (
  category: string,
  summary = '',
): { category: string; summary: string } => ({
  category,
  summary,
});

describe('isLegallyBlocked', () => {
  // The boilerplate on the majority of filings. A bare /sebi/ matched 2,646 of
  // 12,415 corpus records on this text alone, blocking order wins for citing
  // the rulebook rather than for being enforcement actions.
  it.each([
    'Pursuant to Regulation 30 of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015, we wish to inform that the Company has received an order worth Rs 900 crore',
    'Certificate under SEBI (Depositories and Participants) Regulations, 2018',
    'Disclosure under Regulation 30 of SEBI (LODR) Regulations, 2015 regarding a press release',
  ])('does not block SEBI regulatory boilerplate: %s', (summary) => {
    expect(isLegallyBlocked(filing('Press Release', summary))).toBe(false);
  });

  it.each([
    'The Company has received a show-cause notice from SEBI',
    'SEBI has passed an adjudication order imposing a penalty on the Company',
    'Settlement of proceedings initiated by SEBI under the adjudication mechanism',
    'SEBI has initiated an investigation into trading in the Company scrip',
  ])('blocks genuine SEBI enforcement: %s', (summary) => {
    expect(isLegallyBlocked(filing('Updates', summary))).toBe(true);
  });

  // These categories carry no usable summary — "has informed the Exchange
  // about Action(s) taken or orders passed" is the whole text. Before this
  // rule they were blocked only by accident, when their boilerplate happened
  // to mention SEBI.
  it.each([
    'Action(s) taken or orders passed',
    'Action(s) initiated or orders passed',
  ])(
    'blocks regulatory-action categories on category alone: %s',
    (category) => {
      expect(
        isLegallyBlocked(
          filing(category, 'Company has informed the Exchange about the same.'),
        ),
      ).toBe(true);
    },
  );

  it('blocks litigation', () => {
    expect(
      isLegallyBlocked(
        filing(
          'Pendency of litigation(s)/dispute(s)',
          'An arbitration tribunal has issued an award against the Company',
        ),
      ),
    ).toBe(true);
  });

  it('blocks insolvency', () => {
    expect(
      isLegallyBlocked(
        filing(
          'Corporate Insolvency Resolution Process',
          'NCLT has admitted the application under the IBC',
        ),
      ),
    ).toBe(true);
  });

  it.each([
    'The auditor has resigned with immediate effect',
    'The statutory auditor has issued a qualified opinion',
  ])('blocks auditor resignation and qualification: %s', (summary) => {
    expect(isLegallyBlocked(filing('Change in Auditors', summary))).toBe(true);
  });

  it('blocks fraud and default language', () => {
    expect(
      isLegallyBlocked(filing('Updates', 'Default in payment of interest')),
    ).toBe(true);
  });

  // The whole point of the gate is that clean commercial news passes.
  it.each([
    [
      'Bagging/Receiving of orders/contracts',
      'Company has received a work order worth Rs. 78.24 Crore from UNICEF',
    ],
    ['Press Release', 'Dabur Q1 Consol Net Profit Surges 15% at Rs 591 Crore'],
  ])('does not block clean commercial news: %s', (category, summary) => {
    expect(isLegallyBlocked(filing(category, summary))).toBe(false);
  });

  it('matches on the category as well as the summary', () => {
    expect(isLegallyBlocked(filing('Arbitration award', ''))).toBe(true);
  });
});
