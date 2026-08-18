import { act, fireEvent, render } from '@testing-library/react';
import { SignInView } from './SignInView';

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('SignInView', () => {
  it('tells the story in three slides with the door beneath them', () => {
    const { container } = render(
      <SignInView
        brand={<span data-ui="brand-stub" />}
        authMode="firebase"
        apiSend={vi.fn() as never}
        onSignedIn={vi.fn()}
        signInWithGoogle={null}
      />,
    );
    const slides = container.querySelectorAll('.slide');
    expect(slides).toHaveLength(3);
    expect(slides[0]?.textContent).toContain('character for character');
    // No ratings, no advice is IN the onboarding, not fine print.
    expect(slides[2]?.textContent).toContain('No ratings, no advice');
    // The door says whose door it is.
    expect(container.querySelector('[data-ui="brand-stub"]')).not.toBeNull();
    expect(container.querySelector('#shell-google')).not.toBeNull();
    expect(container.querySelector('#shell-email')).toBeNull();
  });

  it('local mode signs in through the existing login route', async () => {
    const apiSend = vi.fn().mockResolvedValue({});
    const onSignedIn = vi.fn();
    const { container } = render(
      <SignInView
        brand={<span data-ui="brand-stub" />}
        authMode="local"
        apiSend={apiSend as never}
        onSignedIn={onSignedIn}
        signInWithGoogle={null}
      />,
    );

    fireEvent.change(container.querySelector('#shell-email') as Element, {
      target: { value: 'r@example.invalid' },
    });
    fireEvent.change(container.querySelector('#shell-password') as Element, {
      target: { value: 'pw' },
    });
    fireEvent.submit(
      container.querySelector('.doorcard form') as HTMLFormElement,
    );
    await flush();

    expect(apiSend).toHaveBeenCalledWith('/api/auth/login', 'POST', {
      email: 'r@example.invalid',
      password: 'pw',
    });
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  // The server's sentence is the reader's sentence — INVALID_CREDENTIALS is
  // copy somebody wrote to be read, not a code to translate.
  it('shows the server sentence when the sign-in is refused', async () => {
    const apiSend = vi
      .fn()
      .mockRejectedValue(new Error('That email or password is not right.'));
    const { container } = render(
      <SignInView
        brand={<span data-ui="brand-stub" />}
        authMode="local"
        apiSend={apiSend as never}
        onSignedIn={vi.fn()}
        signInWithGoogle={null}
      />,
    );

    fireEvent.submit(
      container.querySelector('.doorcard form') as HTMLFormElement,
    );
    await flush();

    const failure = container.querySelector('#shell-failure') as HTMLElement;
    expect(failure.hidden).toBe(false);
    expect(failure.textContent).toBe('That email or password is not right.');
  });

  it('exchanges a Google token at the firebase route', async () => {
    const apiSend = vi.fn().mockResolvedValue({});
    const onSignedIn = vi.fn();
    const { container } = render(
      <SignInView
        brand={<span data-ui="brand-stub" />}
        authMode="firebase"
        apiSend={apiSend as never}
        onSignedIn={onSignedIn}
        signInWithGoogle={() => Promise.resolve('id-token-1')}
      />,
    );

    fireEvent.click(container.querySelector('#shell-google') as Element);
    await flush();

    expect(apiSend).toHaveBeenCalledWith('/api/auth/firebase', 'POST', {
      idToken: 'id-token-1',
    });
    expect(onSignedIn).toHaveBeenCalledOnce();
  });

  // Null until the native module is wired: the button explains itself
  // rather than doing nothing.
  it('says what is missing while the native module is absent', () => {
    const { container } = render(
      <SignInView
        brand={<span data-ui="brand-stub" />}
        authMode="firebase"
        apiSend={vi.fn() as never}
        onSignedIn={vi.fn()}
        signInWithGoogle={null}
      />,
    );
    fireEvent.click(container.querySelector('#shell-google') as Element);
    expect(container.querySelector('#shell-failure')?.textContent).toContain(
      'native module',
    );
  });
});
