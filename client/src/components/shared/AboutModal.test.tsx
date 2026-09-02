import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AboutModal } from './AboutModal';
import { fetchServerVersion } from '../../api/auth';

/**
 * The About dialog answers two things: what this is, and when it shipped.
 *
 * It deliberately shows ONE version — the server's, because that is what "the
 * app" is. It still fetches and compares the browser's own build, but only to
 * answer the question a reader cannot: whether this tab is running what the
 * server is. When it is not, the number on screen would be quietly wrong for
 * them, so a reload prompt appears. That prompt is the interesting case here.
 */

vi.mock('../../api/auth', () => ({ fetchServerVersion: vi.fn() }));

// `__APP_VERSION__` is substituted by Vite at build time; under test it has to
// be defined explicitly or the component references a global that is not there.
vi.stubGlobal('__APP_VERSION__', '1.0.0.0');
vi.stubGlobal('__BUILT_AT__', '2026-09-02T08:00:00.000Z');

const serverSays = (version: string) =>
  vi.mocked(fetchServerVersion).mockResolvedValue({
    version,
    releasedAt: '2026-09-02T09:30:00.000Z',
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

    await screen.findByText(/^Released /);
    expect(screen.queryByText(/reload to update/i)).toBeNull();
  });

  it('shows the release date, not a timestamp', async () => {
    // An About box is read by a person, not grepped by a script — the time of
    // day tells them nothing they wanted to know.
    serverSays('1.0.0.0');
    render(<AboutModal open onClose={vi.fn()} />);

    const released = await screen.findByText(/^Released /);
    expect(released.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('shows one version, not two', async () => {
    // The whole point of the trim: a reader should never have to work out
    // which of two numbers is "the version".
    serverSays('1.0.0.0');
    render(<AboutModal open onClose={vi.fn()} />);

    await screen.findByText(/^Released /);
    expect(screen.queryByText(/this browser/i)).toBeNull();
    expect(screen.queryByText(/^Server$/i)).toBeNull();
    expect(screen.queryByText(/environment/i)).toBeNull();
  });

  it('says the date is unavailable rather than showing a wrong one', async () => {
    vi.mocked(fetchServerVersion).mockRejectedValue(new Error('offline'));
    render(<AboutModal open onClose={vi.fn()} />);

    expect(await screen.findByText(/release date unavailable/i)).toBeInTheDocument();
  });

  it('still names a version when the server cannot be reached', async () => {
    // Offline, the bundle's own version is the only honest answer — and it is
    // a better one than a blank dialog.
    vi.mocked(fetchServerVersion).mockRejectedValue(new Error('offline'));
    render(<AboutModal open onClose={vi.fn()} />);

    expect(await screen.findByText('1.0.0.0')).toBeInTheDocument();
  });

  it('asks the server only when it is opened', async () => {
    // Mounted closed in the header on every page, so an unconditional fetch
    // would be a request per navigation for a dialog nobody opened.
    serverSays('1.0.0.0');
    render(<AboutModal open={false} onClose={vi.fn()} />);

    await waitFor(() => expect(fetchServerVersion).not.toHaveBeenCalled());
  });
});
