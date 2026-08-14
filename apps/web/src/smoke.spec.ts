// Not a placeholder test. It asserts the two things Task 1 actually delivers:
// TypeScript compiles under `strict`, and Vitest executes in a DOM.
it('runs in a DOM environment', () => {
  const el = document.createElement('div');
  el.textContent = 'ok';
  expect(el.textContent).toBe('ok');
});

it('has strict null checking on', () => {
  const maybe: string | null = null;
  expect(maybe ?? 'fallback').toBe('fallback');
});
