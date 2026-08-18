import { act, renderHook } from '@testing-library/react';
import { useMe } from './use-me';
import type { ApiEnvelope } from './api-get';

const envelope = <T,>(data: T): ApiEnvelope<T> => ({
  success: true,
  data,
  error: null,
  meta: null,
});

const SIGNED_IN = {
  signedIn: true,
  email: 'r@example.invalid',
  watchCount: 3,
  watchCap: 50,
  unread: 5,
  channels: [],
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

const renderMe = (apiSend: ReturnType<typeof vi.fn>, onReload = vi.fn()) => ({
  onReload,
  ...renderHook(() => useMe({ apiSend: apiSend as never, onReload })),
});

describe('useMe', () => {
  it('starts not knowing, and asks api/me once on mount', async () => {
    const apiSend = vi.fn().mockResolvedValue(envelope(SIGNED_IN));
    const { result } = renderMe(apiSend);
    // THE THIRD STATE: "we do not know yet". The header renders neither
    // signed state through it — the flicker the old hidden attributes
    // prevent.
    expect(result.current.me).toBeUndefined();
    await flush();

    expect(apiSend).toHaveBeenCalledWith('/api/me', 'GET');
    expect(result.current.me).toEqual(SIGNED_IN);
    expect(result.current.unread).toBe(5);
  });

  // api/me answers 200 signed-out, never 401 — and signed-out is a reload,
  // not a repaint: there is no repaint-to-signed-out path at all.
  it('a signed-out answer reloads once, latched', async () => {
    const apiSend = vi.fn().mockResolvedValue(envelope({ signedIn: false }));
    const { result, onReload } = renderMe(apiSend);
    await flush();
    act(() => {
      result.current.refreshMe();
    });
    await flush();

    expect(onReload).toHaveBeenCalledOnce();
  });

  // Deliberately not swallowed: the reader is told the account read failed.
  it('reports a failed read in the old words', async () => {
    const apiSend = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = renderMe(apiSend);
    await flush();

    expect(result.current.me).toBeUndefined();
    expect(result.current.failure).toBe('Could not read your account: boom');
  });

  it('signs out with a bodyless POST and reloads', async () => {
    const apiSend = vi.fn().mockResolvedValue(envelope(SIGNED_IN));
    const { result, onReload } = renderMe(apiSend);
    await flush();

    apiSend.mockResolvedValueOnce(envelope({ signedIn: false }));
    act(() => {
      result.current.signOut();
    });
    await flush();

    expect(apiSend).toHaveBeenCalledWith('/api/auth/logout', 'POST');
    expect(onReload).toHaveBeenCalledOnce();
  });

  // A failed sign-out shows the server's sentence and re-asks who we are.
  it('a failed sign-out reports and refreshes me', async () => {
    const apiSend = vi.fn().mockResolvedValue(envelope(SIGNED_IN));
    const { result, onReload } = renderMe(apiSend);
    await flush();
    const asksBefore = apiSend.mock.calls.filter(
      (c) => c[0] === '/api/me',
    ).length;

    apiSend.mockRejectedValueOnce(new Error('Something went wrong.'));
    act(() => {
      result.current.signOut();
    });
    await flush();

    expect(onReload).not.toHaveBeenCalled();
    expect(result.current.failure).toBe('Something went wrong.');
    expect(apiSend.mock.calls.filter((c) => c[0] === '/api/me').length).toBe(
      asksBefore + 1,
    );
  });

  it('clears the unread count on demand', async () => {
    const apiSend = vi.fn().mockResolvedValue(envelope(SIGNED_IN));
    const { result } = renderMe(apiSend);
    await flush();

    act(() => {
      result.current.clearUnread();
    });
    expect(result.current.unread).toBe(0);
  });
});
