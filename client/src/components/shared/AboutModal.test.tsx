import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AboutModal } from './AboutModal';
import { fetchServerVersion } from '../../api/auth';

/**
 * The About dialog exists to answer "what is deployed", so the case that
 * matters is when the two answers disagree.
 *
 * The bundle in a browser tab is fixed at build time; the server it talks to
 * can be redeployed under it. Showing one number would make a stale tab look
 * like a stale deploy, which is the wrong thing to go and investigate.
 */

vi.mock('../../api/auth', () => ({ fetchServerVersion: vi.fn() }));

// `__APP_VERSION__` is substituted by Vite at build time; under test it has to
// be defined explicitly or the component references a global that is not there.
vi.stubGlobal('__APP_VERSION__', '1.0.0.0');
vi.stubGlobal('__BUILT_AT__', '2026-09-02T08:00:00.000Z');

const serverSays = (version: string) =>
  vi.mocked(fetchServerVersion).mockResolvedValue({
    version,
    startedAt: '2026-09-02T09:30:00.000Z',
    environment: 'production',
  });

beforeEach(() => vi.clearAllMocks());

describe('AboutModal', () => {
  it('shows the version this browser is running', async () => {
    serverSays('1.0.0.0');
    render(<AboutModal open onClose={vi.fn()} />);

    expect(await screen.findAllByText('1.0.0.0')).not.toHaveLength(0);
  });

  it('says to reload when the server has moved on', async () => {
    // The whole point: this tab is older than the deploy it is talking to.
    serverSays('1.0.1.0');
    render(<AboutModal open onClose={vi.fn()} />);

    expect(await screen.findByText(/reload to update/i)).toBeInTheDocument();
  });

  it('stays quiet when both agree', async () => {
    serverSays('1.0.0.0');
    render(<AboutModal open onClose={vi.fn()} />);

    await screen.findByText('production');
    expect(screen.queryByText(/reload to update/i)).toBeNull();
  });

  it('reports an unreachable server rather than showing nothing', async () => {
    // Version is most often checked while something is broken, so a silent
    // blank here would be the least helpful possible response.
    vi.mocked(fetchServerVersion).mockRejectedValue(new Error('offline'));
    render(<AboutModal open onClose={vi.fn()} />);

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });

  it('names the environment it is talking to', async () => {
    serverSays('1.0.0.0');
    render(<AboutModal open onClose={vi.fn()} />);

    expect(await screen.findByText('production')).toBeInTheDocument();
  });

  it('asks the server only when it is opened', async () => {
    // Mounted closed in the header on every page, so an unconditional fetch
    // would be a request per navigation for a dialog nobody opened.
    serverSays('1.0.0.0');
    render(<AboutModal open={false} onClose={vi.fn()} />);

    await waitFor(() => expect(fetchServerVersion).not.toHaveBeenCalled());
  });
});
