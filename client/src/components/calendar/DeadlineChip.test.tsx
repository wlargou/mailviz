import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DeadlineChip } from './DeadlineChip';

describe('DeadlineChip', () => {
  it('names the kind, the tender and the hour, and opens the tender', async () => {
    const onDay = vi.fn();
    render(
      <MemoryRouter initialEntries={['/calendar']}>
        <Routes>
          <Route
            path="/calendar"
            element={
              // Inside a day cell that opens the day on click.
              <div onClick={onDay}>
                <DeadlineChip
                  deadline={{
                    kind: 'RFP_DEADLINE',
                    id: 'RFP_DEADLINE:r1',
                    title: 'Refonte AIX',
                    context: '70/AOO/BKAM/2026',
                    at: new Date(2026, 10, 20, 11, 0).toISOString(),
                    href: '/rfps/r1',
                  }}
                />
              </div>
            }
          />
          <Route path="/rfps/:id" element={<p>tender page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    const chip = screen.getByRole('button', { name: 'Tender deadline: Refonte AIX (70/AOO/BKAM/2026), 11:00' });
    await userEvent.click(chip);

    expect(await screen.findByText('tender page')).toBeInTheDocument();
    expect(onDay).not.toHaveBeenCalled();
  });

  it('leaves the hour out of a date-only deadline', () => {
    render(
      <MemoryRouter>
        <DeadlineChip
          deadline={{ kind: 'TASK_DUE', id: 'TASK_DUE:t1', title: 'Relancer', context: null, at: new Date(2026, 10, 20).toISOString(), href: '/tasks?task=t1' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Task due: Relancer' })).toBeInTheDocument();
  });
});
