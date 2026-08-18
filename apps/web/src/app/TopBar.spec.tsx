import { fireEvent, render } from '@testing-library/react';
import { TopBar } from './TopBar';
import type { MeView } from '../shared/types/account';

const SIGNED_IN: MeView = {
  signedIn: true,
  email: 'r@example.invalid',
  watchCount: 3,
  watchCap: 50,
  unread: 5,
  channels: [],
};

const renderBar = (
  me: MeView | undefined,
  unread = 0,
  handlers: Partial<{ onShowView: () => void; onSignOut: () => void }> = {},
) =>
  render(
    <TopBar
      viewState={{ view: 'feed', company: null }}
      live="live"
      summary={null}
      me={me}
      unread={unread}
      onShowView={handlers.onShowView ?? vi.fn()}
      onSignOut={handlers.onSignOut ?? vi.fn()}
    />,
  );

describe('TopBar account controls', () => {
  // "We do not know yet" is a third state, and drawing either of the other
  // two through it makes the header flicker on load.
  it('renders neither control before api/me answers', () => {
    const { container } = renderBar(undefined);
    expect(container.querySelector('#signout')).toBeNull();
    expect(container.querySelector('#tab-watching')).toBeNull();
  });

  it('signed in: Sign out outside the tablist, Watching inside it', () => {
    const { container } = renderBar(SIGNED_IN);
    const signout = container.querySelector('#signout');
    expect(signout?.textContent).toBe('Sign out');
    // A non-tab child of a role=tablist is an ARIA violation: the account
    // wrapper is a SIBLING of nav.tabs sharing the tab's styling by class.
    expect(signout?.closest('[role="tablist"]')).toBeNull();
    expect(signout?.closest('[data-ui="account"]')).not.toBeNull();

    const watching = container.querySelector('#tab-watching');
    expect(watching?.closest('[role="tablist"]')).not.toBeNull();
    expect(watching?.getAttribute('aria-controls')).toBe('view-watching');
  });

  it('the unread badge is a child of the tab, absent at zero', () => {
    const at0 = renderBar(SIGNED_IN, 0);
    // Absent, never a 0 — a badge reading 0 is furniture that teaches a
    // reader to stop looking at it.
    expect(at0.container.querySelector('#tab-watching-count')).toBeNull();

    const at5 = renderBar(SIGNED_IN, 5);
    const badge = at5.container.querySelector('#tab-watching-count');
    expect(badge?.textContent).toBe('5');
    expect(badge?.closest('#tab-watching')).not.toBeNull();
  });

  it('caps the badge at 99+', () => {
    const { container } = renderBar(SIGNED_IN, 120);
    expect(container.querySelector('#tab-watching-count')?.textContent).toBe(
      '99+',
    );
  });

  it('wires the two controls', () => {
    const onShowView = vi.fn();
    const onSignOut = vi.fn();
    const { container } = renderBar(SIGNED_IN, 0, { onShowView, onSignOut });

    fireEvent.click(container.querySelector('#tab-watching') as Element);
    expect(onShowView).toHaveBeenCalledWith('watching');

    fireEvent.click(container.querySelector('#signout') as Element);
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
