import { renderDashboardPage } from '../page';

/**
 * `undoPicked`, run as the served document carries it — the same cut
 * `script-base.spec.ts` makes, for the same reason: these fragments are
 * template literals and the served string is the only one worth asserting.
 */
const html = renderDashboardPage(true);

const SCRIPT = html.slice(
  html.indexOf('<script>') + '<script>'.length,
  html.lastIndexOf('</script>'),
);

const cutFunction = (source: string, signature: string): string => {
  const at = source.indexOf(signature);
  if (at < 0) throw new Error(`"${signature}" is not in the served script.`);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(`"${signature}" is never closed in the served script.`);
};

interface PickState {
  picked: { kind: string; value: string } | null;
  symbol: string;
  category: string;
  group: string;
}

const undo = (state: PickState): void => {
  new Function(
    'state',
    'setControl',
    'syncChips',
    `${cutFunction(SCRIPT, 'function undoPicked(')}
undoPicked();`,
  )(
    state,
    () => undefined,
    () => undefined,
  );
};

describe('undoPicked', () => {
  it('clears exactly what the pick set, while the pick still holds it', () => {
    const state: PickState = {
      picked: { kind: 'category', value: 'Financial Results' },
      symbol: '',
      category: 'Financial Results',
      group: '',
    };
    undo(state);
    expect(state.category).toBe('');
    expect(state.picked).toBeNull();
  });

  // Admin's selects write the same fields. Picking 'Financial Results' from
  // the suggest list, choosing 'Press Release' in Admin, then typing one
  // character used to run this and wipe the Press Release filter the reader
  // had just chosen — the exact clobber the function's own comment promises
  // not to make. The undo is scoped by VALUE: it clears a field only while
  // it still holds what the pick wrote. The React client's undoPicked
  // carries the same rule.
  it('leaves a filter the reader overwrote elsewhere alone', () => {
    const state: PickState = {
      picked: { kind: 'category', value: 'Financial Results' },
      symbol: '',
      category: 'Press Release',
      group: '',
    };
    undo(state);
    expect(state.category).toBe('Press Release');
    expect(state.picked).toBeNull();
  });

  it('scopes the company and group kinds the same way', () => {
    const company: PickState = {
      picked: { kind: 'company', value: 'RELIANCE' },
      symbol: 'TCS',
      category: '',
      group: '',
    };
    undo(company);
    expect(company.symbol).toBe('TCS');

    const group: PickState = {
      picked: { kind: 'group', value: 'results' },
      symbol: '',
      category: '',
      group: 'governance',
    };
    undo(group);
    expect(group.group).toBe('governance');
  });
});
