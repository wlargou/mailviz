import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailCategoriesModal } from './MailCategoriesModal';
import { authApi } from '../../api/auth';
import { useAuthStore } from '../../store/authStore';

vi.mock('../../api/auth', () => ({ authApi: { updateMailCategoryTabs: vi.fn() } }));

/**
 * The customise dialog seeds from the stored preference, offers the four
 * optional categories (never Primary), and saves the ones left checked —
 * then the session's user carries the new list without a refetch.
 */
describe('MailCategoriesModal', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', email: 'me@test', name: null, avatarUrl: null, mailCategoryTabs: ['social', 'updates'] } });
    vi.mocked(authApi.updateMailCategoryTabs).mockReset();
  });

  it('seeds the checkboxes from the stored tabs and never offers Primary', () => {
    render(<MailCategoriesModal open onClose={vi.fn()} />);

    expect(screen.getByLabelText('Social')).toBeChecked();
    expect(screen.getByLabelText('Updates')).toBeChecked();
    expect(screen.getByLabelText('Promotions')).not.toBeChecked();
    expect(screen.getByLabelText('Forums')).not.toBeChecked();
    expect(screen.queryByLabelText('Primary')).toBeNull();
  });

  it('saves what is checked and updates the session user from the response', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.updateMailCategoryTabs).mockResolvedValue({ data: { data: { mailCategoryTabs: ['updates', 'forums'] } } } as never);
    const onClose = vi.fn();
    render(<MailCategoriesModal open onClose={onClose} />);

    await user.click(screen.getByLabelText('Social'));
    await user.click(screen.getByLabelText('Forums'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(authApi.updateMailCategoryTabs).toHaveBeenCalledWith(['updates', 'forums']));
    expect(useAuthStore.getState().user?.mailCategoryTabs).toEqual(['updates', 'forums']);
    expect(onClose).toHaveBeenCalled();
  });

  it('cancel leaves the preference alone', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MailCategoriesModal open onClose={onClose} />);

    await user.click(screen.getByLabelText('Social'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(authApi.updateMailCategoryTabs).not.toHaveBeenCalled();
    expect(useAuthStore.getState().user?.mailCategoryTabs).toEqual(['social', 'updates']);
    expect(onClose).toHaveBeenCalled();
  });
});
