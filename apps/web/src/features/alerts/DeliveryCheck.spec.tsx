import { fireEvent, render } from '@testing-library/react';
import { DeliveryCheck } from './DeliveryCheck';

describe('DeliveryCheck', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // With nothing granted yet, the enable button is the thing to press.
  it('says nothing until permission is granted', () => {
    const { container } = render(
      <DeliveryCheck permission="default" onTest={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('warns that a permission is not a delivery, and offers the test', () => {
    const onTest = vi.fn();
    const { container } = render(
      <DeliveryCheck permission="granted" onTest={onTest} />,
    );
    expect(container.textContent).toContain('not the same as seeing one');

    fireEvent.click(
      container.querySelector('[data-ui="delivery-test"]') as Element,
    );
    expect(onTest).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Did a banner appear?');
  });

  // The reader is the only instrument that can see the screen, so their
  // answer is the fact, and it is kept.
  it('goes away for good once a banner has been seen', () => {
    const { container } = render(
      <DeliveryCheck permission="granted" onTest={vi.fn()} />,
    );
    fireEvent.click(
      container.querySelector('[data-ui="delivery-test"]') as Element,
    );
    fireEvent.click(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Yes',
      ) as Element,
    );
    expect(container.firstChild).toBeNull();

    const again = render(
      <DeliveryCheck permission="granted" onTest={vi.fn()} />,
    );
    expect(again.container.firstChild).toBeNull();
  });

  // What actually happened on 2026-08-20: notifications for the browser
  // were switched off in macOS, and the page said nothing.
  it('names the operating-system setting when nothing appeared', () => {
    const { container } = render(
      <DeliveryCheck permission="granted" onTest={vi.fn()} />,
    );
    fireEvent.click(
      container.querySelector('[data-ui="delivery-test"]') as Element,
    );
    fireEvent.click(
      container.querySelector('[data-ui="delivery-none"]') as Element,
    );

    expect(container.textContent).toContain('System Settings');
    expect(container.textContent).toContain('Notifications');
    expect(container.textContent).toContain('Focus');
    // Still offered, because the reader has just been told how to fix it.
    expect(container.textContent).toContain('Send another test');
  });
});
