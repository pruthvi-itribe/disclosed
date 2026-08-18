import { fireEvent } from '@testing-library/react';
import { flush, renderApp } from './app.fixtures';

// A RENDER PROBE, not a stub for brevity: Hero re-renders exactly when the
// App shell does (it is not memoised), so counting its renders is how the
// keystroke test below can tell "the box repainted" from "the whole app
// repainted". No other test in this file reads Hero's output.
const heroRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../features/feed/Hero', () => ({
  Hero: () => {
    heroRenders.count += 1;
    return <div data-ui="hero-probe" />;
  },
}));

describe('the keystroke budget', () => {
  // Review finding #10, deferred until the phone made it critical-path:
  // the draft used to live in App state, so every character re-rendered
  // the whole shell — feed, brief, watching — while the reader typed. The
  // draft is the box's own; the shell repaints on submit or pick, when
  // the question actually changed.
  it('typing in the search box does not re-render the app shell', async () => {
    const { container } = await renderApp();
    const input = container.querySelector('#symbol') as HTMLInputElement;
    const before = heroRenders.count;

    for (const text of ['r', 're', 'rel']) {
      fireEvent.change(input, { target: { value: text } });
    }
    await flush();

    expect(input.value).toBe('rel');
    expect(heroRenders.count).toBe(before);
  });
});
