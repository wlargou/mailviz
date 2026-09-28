import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MailFolderBar, type MailFolder } from './MailFolderBar';

/**
 * The folder bar shows four places and hides the rest behind More. The parts
 * worth pinning: a folder opened from More must show up as the selected
 * switch (otherwise the bar claims you are in the Inbox while you read the
 * Trash), All mail must map back to `null`, and the To reply count must say
 * how many people are waiting — and say nothing when nobody is.
 */

function setup(folder: MailFolder, toReplyCount: number | null = null) {
  const onChange = vi.fn();
  render(<MailFolderBar folder={folder} toReplyCount={toReplyCount} onChange={onChange} />);
  return { onChange };
}

const switchNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('MailFolderBar', () => {
  it('shows the four working folders, with the Inbox selected', () => {
    setup('inbox');
    expect(switchNames()).toEqual(['Inbox', 'To reply', 'Sent', 'Drafts']);
    expect(selected()).toBe('Inbox');
  });

  it('adds a folder opened from More to the bar, selected', () => {
    setup('trash');
    expect(switchNames()).toEqual(['Inbox', 'To reply', 'Sent', 'Drafts', 'Trash']);
    expect(selected()).toBe('Trash');
  });

  it('treats a null folder as All mail', () => {
    setup(null);
    expect(selected()).toBe('All mail');
  });

  it('counts the replies owed, and shows no count when there are none', () => {
    const { unmount } = render(<MailFolderBar folder="inbox" toReplyCount={3} onChange={vi.fn()} />);
    expect(switchNames()).toContain('To reply (3)');
    unmount();
    setup('inbox', 0);
    expect(switchNames()).toContain('To reply');
  });

  it('reports the folder a switch stands for', async () => {
    const { onChange } = setup('inbox');
    await userEvent.click(screen.getByRole('tab', { name: 'To reply' }));
    expect(onChange).toHaveBeenCalledWith('to-reply');
  });

  it('opens the others from More, All mail as null', async () => {
    const { onChange } = setup('inbox');
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Snoozed' }));
    expect(onChange).toHaveBeenLastCalledWith('snoozed');

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'All mail' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
