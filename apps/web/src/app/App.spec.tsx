import { render, screen } from '@testing-library/react';
import { App } from './App';
import { SessionEndedError } from '../shared/api/api-get';

const ok = { success: true, data: { totalFilings: 9459 }, error: null, meta: null };

describe('App', () => {
  it('reports the count the API returned', async () => {
    const apiGet = vi.fn().mockResolvedValue({ status: 'ok', body: ok });

    render(<App apiGet={apiGet} onSessionEnded={vi.fn()} />);

    expect(await screen.findByText(/9459/)).toBeInTheDocument();
  });

  it('asks for the summary route', async () => {
    const apiGet = vi.fn().mockResolvedValue({ status: 'ok', body: ok });

    render(<App apiGet={apiGet} onSessionEnded={vi.fn()} />);
    await screen.findByText(/9459/);

    expect(apiGet).toHaveBeenCalledWith('/api/summary');
  });

  // A session that ended is handed back to the caller, which reloads into the
  // landing page. Rendering an error here would leave the reader on a dead
  // page with no way forward.
  it('hands a session that ended to its caller', async () => {
    const apiGet = vi.fn().mockRejectedValue(new SessionEndedError());
    const onSessionEnded = vi.fn();

    render(<App apiGet={apiGet} onSessionEnded={onSessionEnded} />);

    await vi.waitFor(() => expect(onSessionEnded).toHaveBeenCalledOnce());
  });

  // Never swallowed. A page that silently stops updating is worse than one
  // that says it stopped, because the stale numbers still read as current.
  it('says so when the request fails', async () => {
    const apiGet = vi.fn().mockRejectedValue(new Error('502'));

    render(<App apiGet={apiGet} onSessionEnded={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/502/);
  });
});
