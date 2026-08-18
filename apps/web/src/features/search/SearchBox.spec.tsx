import { fireEvent, render } from '@testing-library/react';
import { act } from '@testing-library/react';
import { SearchBox } from './SearchBox';
import { SearchNote } from './SearchNote';
import { SUGGEST_DEBOUNCE_MS } from './use-suggest';

const answer = {
  status: 'ok' as const,
  body: {
    success: true,
    data: {
      companies: [
        {
          symbol: 'BRITANNIA',
          companyName: 'Britannia Industries',
          filings: 120,
        },
      ],
      categories: [{ category: 'Stock Split', filings: 8 }],
      groups: [],
      builtAtIst: '',
      companiesKnown: 954,
    },
    error: null,
    meta: null,
  },
};

// The draft is the box's own state now (review finding #10), so the
// harness owns nothing: the spies record what the parent is told, and what
// the input SHOWS is asserted on the input itself.
const renderBox = (apiGet = vi.fn().mockResolvedValue(answer)) => {
  const handlers = {
    onTyped: vi.fn(),
    onApply: vi.fn(),
    onSubmit: vi.fn(),
  };
  const view = render(<SearchBox apiGet={apiGet as never} {...handlers} />);
  return { apiGet, handlers, ...view };
};

const typeAndWait = async (container: HTMLElement, text: string) => {
  const input = container.querySelector('#symbol') as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS);
  });
  return input;
};

describe('SearchBox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is a combobox whose listbox is a sibling, empty in the markup', () => {
    const { container } = renderBox();
    const input = container.querySelector('#symbol');
    expect(input?.getAttribute('role')).toBe('combobox');
    expect(input?.getAttribute('aria-controls')).toBe('suggest');
    expect(input?.getAttribute('aria-expanded')).toBe('false');
    const list = container.querySelector('#suggest');
    expect(list?.getAttribute('role')).toBe('listbox');
    expect(list?.parentElement).toBe(input?.parentElement);
  });

  it('opens with headings, options and counts after the debounce', async () => {
    const { container, handlers } = renderBox();
    await typeAndWait(container, 'br');

    expect(handlers.onTyped).toHaveBeenCalled();
    const headings = [...container.querySelectorAll('.sgroup')].map(
      (h) => h.textContent,
    );
    expect(headings).toEqual(['Companies', 'Categories']);
    const first = container.querySelector('#suggest-opt-0');
    expect(first?.querySelector('.ssym')?.textContent).toBe('BRITANNIA');
    expect(first?.querySelector('.sname')?.textContent).toBe(
      'Britannia Industries',
    );
    expect(first?.querySelector('.scount')?.textContent).toBe('120');
  });

  // The highlight is announced without moving DOM focus: the input keeps
  // focus and aria-activedescendant names the option.
  it('arrows move the highlight and Enter applies it', async () => {
    const { container, handlers } = renderBox();
    const input = await typeAndWait(container, 'br');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe('suggest-opt-0');
    expect(
      container.querySelector('#suggest-opt-0')?.getAttribute('aria-selected'),
    ).toBe('true');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.onApply).toHaveBeenCalledWith({
      kind: 'company',
      value: 'BRITANNIA',
      head: 'BRITANNIA',
      name: 'Britannia Industries',
      filings: 120,
    });
    // The pick writes the head into the box's own draft.
    expect(input.value).toBe('BRITANNIA');
    expect(handlers.onSubmit).not.toHaveBeenCalled();
  });

  // -1 is a real third state: nothing highlighted, Enter searches the text.
  it('Enter with no highlight submits the typed text', async () => {
    const { container, handlers } = renderBox();
    const input = await typeAndWait(container, 'dividend rs');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(handlers.onSubmit).toHaveBeenCalledWith('dividend rs');
    expect(handlers.onApply).not.toHaveBeenCalled();
  });

  it('Escape closes only while open; blur closes too', async () => {
    const { container } = renderBox();
    const input = await typeAndWait(container, 'br');
    expect((container.querySelector('#suggest') as HTMLElement).hidden).toBe(
      false,
    );
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((container.querySelector('#suggest') as HTMLElement).hidden).toBe(
      true,
    );

    await typeAndWait(container, 'brit');
    fireEvent.blur(input);
    expect((container.querySelector('#suggest') as HTMLElement).hidden).toBe(
      true,
    );
  });

  it('a click on an option applies it', async () => {
    const { container, handlers } = renderBox();
    await typeAndWait(container, 'br');
    fireEvent.click(container.querySelector('#suggest-opt-1') as Element);
    expect(handlers.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'category', value: 'Stock Split' }),
    );
  });

  it('the slash shortcut focuses the box, except from a field', () => {
    const { container } = renderBox();
    fireEvent.keyDown(document, { key: '/' });
    expect(document.activeElement).toBe(container.querySelector('#symbol'));
  });
});

describe('SearchNote', () => {
  it('names each kind of query and offers clear', () => {
    const company = render(
      <SearchNote
        picked={{
          kind: 'company',
          value: 'TCS',
          head: 'TCS',
          name: '',
          filings: 9,
        }}
        q=""
        onClear={vi.fn()}
      />,
    );
    expect(company.container.textContent).toContain('Every filing by TCS');

    const group = render(
      <SearchNote
        picked={{
          kind: 'group',
          value: 'capital',
          head: 'Capital',
          name: '',
          filings: 3,
        }}
        q=""
        onClear={vi.fn()}
      />,
    );
    expect(group.container.textContent).toContain('Group: Capital');

    const onClear = vi.fn();
    const free = render(
      <SearchNote picked={null} q="dividend" onClear={onClear} />,
    );
    expect(free.container.textContent).toContain('Searching for dividend');
    fireEvent.click(free.container.querySelector('.clearq') as Element);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('hides itself with nothing to say', () => {
    const { container } = render(
      <SearchNote picked={null} q="" onClear={vi.fn()} />,
    );
    expect(
      (container.querySelector('#search-note') as HTMLElement).hidden,
    ).toBe(true);
  });
});
