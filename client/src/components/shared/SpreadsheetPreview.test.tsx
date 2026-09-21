import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { utils, write } from 'xlsx';
import { SpreadsheetPreview, columnLabel, parseWorkbook, MAX_ROWS, MAX_COLS } from './SpreadsheetPreview';

/**
 * The bytes are built with the same library that reads them, so what is
 * asserted is the rendering — bounds, formatting, sheet switching — not the
 * parser.
 */
function workbookBytes(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    utils.book_append_sheet(wb, utils.aoa_to_sheet(rows, { cellDates: true }), name);
  }
  const out = write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

function serve(bytes: ArrayBuffer, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 400, arrayBuffer: async () => bytes }));
}

afterEach(() => vi.unstubAllGlobals());

describe('columnLabel', () => {
  it('counts like Excel', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});

describe('parseWorkbook', () => {
  it('cuts a sheet at the bounds and reports the real size', () => {
    const wide = Array.from({ length: MAX_COLS + 10 }, (_, i) => `c${i}`);
    const rows = Array.from({ length: MAX_ROWS + 100 }, (_, r) => [`r${r}`, ...wide]);
    const [sheet] = parseWorkbook(workbookBytes({ Big: rows }));

    expect(sheet.totalRows).toBe(MAX_ROWS + 100);
    expect(sheet.totalCols).toBe(MAX_COLS + 11);
    expect(sheet.rows).toHaveLength(MAX_ROWS);
    expect(sheet.rows[0]).toHaveLength(MAX_COLS);
    expect(sheet.rows[MAX_ROWS - 1][0]).toBe(`r${MAX_ROWS - 1}`);
  });

  it('shows cells as Excel formats them — a date is a date, not a serial', () => {
    const [sheet] = parseWorkbook(workbookBytes({ S: [['When', 'Qty'], [new Date(2026, 0, 15), 3]] }));

    expect(sheet.rows[1][0]).toMatch(/^1\/15\/(26|2026)$/);
    expect(sheet.rows[1][1]).toBe('3');
  });

  it('pads ragged rows so every row has the same width', () => {
    const [sheet] = parseWorkbook(workbookBytes({ S: [['a', 'b', 'c'], ['only']] }));

    expect(sheet.rows).toEqual([['a', 'b', 'c'], ['only', '', '']]);
  });
});

describe('SpreadsheetPreview', () => {
  it('renders one sheet as a grid with column letters and row numbers', async () => {
    serve(workbookBytes({ Sizing: [['Name', 'Qty'], ['Widget', 3]] }));
    render(<SpreadsheetPreview url="/att" />);

    const table = await screen.findByRole('table', { name: 'Sheet Sizing' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['', 'A', 'B']);
    expect(within(table).getByText('Widget')).toBeInTheDocument();
    expect(within(table).getByText('3')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/att', { credentials: 'include' });
  });

  it('offers a tab per sheet and switches between them', async () => {
    const user = userEvent.setup();
    serve(workbookBytes({ First: [['one']], Second: [['two']] }));
    render(<SpreadsheetPreview url="/att" />);

    expect((await screen.findAllByRole('tab')).map((t) => t.textContent)).toEqual(['First', 'Second']);
    expect(screen.getByText('one')).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'Second' }));
    expect(screen.getByText('two')).toBeVisible();
  });

  it('says when a sheet was cut', async () => {
    serve(workbookBytes({ Big: Array.from({ length: MAX_ROWS + 1 }, (_, r) => [r]) }));
    render(<SpreadsheetPreview url="/att" />);

    expect(await screen.findByText(`Showing the first ${MAX_ROWS} of ${MAX_ROWS + 1} rows. Download for the full sheet.`)).toBeInTheDocument();
    // Header row plus exactly MAX_ROWS body rows.
    expect(screen.getAllByRole('row')).toHaveLength(MAX_ROWS + 1);
  });

  it('reports a failed fetch instead of an empty grid', async () => {
    serve(new ArrayBuffer(0), false);
    render(<SpreadsheetPreview url="/att" />);

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
