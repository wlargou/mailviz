import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';
import { authApi } from '../../api/auth';
import { useUIStore } from '../../store/uiStore';

/**
 * The sign-in screen was rebuilt around the brand, and the one thing that must
 * not have moved with it is the Google button: fetch the URL, then leave for it.
 * The name and descriptor are written out rather than read from `src/brand.ts`,
 * so a change to either has to be made on purpose here too.
 */

vi.mock('../../api/auth', () => ({ authApi: { getLoginUrl: vi.fn() } }));

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';
const realLocation = window.location;
const initialUI = useUIStore.getState();

function renderLogin(path = '/login') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: 'http://localhost:5174/login' } as unknown as Location,
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
  useUIStore.setState(initialUI, true);
});

describe('LoginPage', () => {
  it('names the product and says what it is', () => {
    renderLogin();

    expect(screen.getByRole('heading', { level: 1, name: 'Olympusx Productivity Hub' })).toBeInTheDocument();
    expect(screen.getByText('Your workday in one place')).toBeInTheDocument();
  });

  it('sends the browser to the sign-in URL the server hands back', async () => {
    vi.mocked(authApi.getLoginUrl).mockResolvedValue({ data: { data: { url: GOOGLE_URL } } } as never);
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(window.location.href).toBe(GOOGLE_URL));
    expect(authApi.getLoginUrl).toHaveBeenCalledTimes(1);
    // Left disabled while the browser leaves, so a second click cannot race it.
    expect(screen.getByRole('button', { name: 'Redirecting...' })).toBeDisabled();
  });

  it('gives the button back when the URL cannot be fetched', async () => {
    vi.mocked(authApi.getLoginUrl).mockRejectedValue(new Error('offline'));
    renderLogin();

    await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    expect(window.location.href).toBe('http://localhost:5174/login');
  });

  it('explains a sign-in the server refused', () => {
    renderLogin('/login?error=unauthorized');

    expect(screen.getByText('Your email is not authorized to access this application.')).toBeInTheDocument();
  });

  it('follows the saved theme instead of forcing the dark one', () => {
    useUIStore.setState({ theme: 'g10' });
    const { container } = renderLogin();

    expect(container.querySelector('.cds--g10')).not.toBeNull();
    expect(container.querySelector('.cds--g100')).toBeNull();
  });
});
