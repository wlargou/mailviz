import { useEffect, useState } from 'react';
import {
  InlineLoading,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
} from '@carbon/react';
import { read, utils } from 'xlsx';

/**
 * A spreadsheet, rendered in the browser.
 *
 * SheetJS parses the bytes (xlsx, xls, csv — it sniffs the format) and each
 * sheet becomes a plain grid: column letters across, row numbers down, the
 * cell text as Excel would format it. No formulas, merges, colours or
 * charts — the data is what a sizing questionnaire or a cabling matrix is
 * opened for, and the file is one click away for the rest.
 *
 * Bounded: a sheet is cut at `MAX_ROWS` × `MAX_COLS` and says so. A quarter
 * of a million cells is a table the browser can draw; a full export is not.
 */
export const MAX_ROWS = 500;
export const MAX_COLS = 50;

export interface ParsedSheet {
  name: string;
  /** Rows as displayed text, already cut to the bounds and padded square. */
  rows: string[][];
  totalRows: number;
  totalCols: number;
}

/** 0 → A, 25 → Z, 26 → AA — the header Excel shows. */
export function columnLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function parseWorkbook(bytes: ArrayBuffer): ParsedSheet[] {
  const workbook = read(bytes, { type: 'array' });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    // `raw: false` hands back the formatted text (`w`), so a date cell reads
    // 1/15/26 rather than 46037 and 0.1 formatted as a percentage reads 10%.
    // `blankrows: true` keeps empty rows so the row numbers match Excel's.
    const all = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true });
    const totalRows = all.length;
    const totalCols = all.reduce((max, row) => Math.max(max, row.length), 0);
    const width = Math.min(totalCols, MAX_COLS);
    const rows = all.slice(0, MAX_ROWS).map((row) => {
      const cells = row.slice(0, width).map((v) => (v == null ? '' : String(v)));
      while (cells.length < width) cells.push('');
      return cells;
    });
    return { name, rows, totalRows, totalCols };
  });
}

function truncationNote(sheet: ParsedSheet): string | null {
  const parts: string[] = [];
  if (sheet.totalRows > MAX_ROWS) parts.push(`the first ${MAX_ROWS.toLocaleString()} of ${sheet.totalRows.toLocaleString()} rows`);
  if (sheet.totalCols > MAX_COLS) parts.push(`the first ${MAX_COLS} of ${sheet.totalCols} columns`);
  return parts.length ? `Showing ${parts.join(' and ')}. Download for the full sheet.` : null;
}

function SheetGrid({ sheet }: { sheet: ParsedSheet }) {
  const note = truncationNote(sheet);
  const width = sheet.rows[0]?.length ?? 0;
  if (sheet.totalRows === 0) {
    return <p className="spreadsheet-preview__empty">This sheet is empty.</p>;
  }
  return (
    <>
      {note && <p className="spreadsheet-preview__note">{note}</p>}
      <div className="spreadsheet-preview__scroll">
        <Table size="sm" useZebraStyles aria-label={`Sheet ${sheet.name}`}>
          <TableHead>
            <TableRow>
              <TableHeader className="spreadsheet-preview__corner" />
              {Array.from({ length: width }, (_, i) => (
                <TableHeader key={i} className="spreadsheet-preview__col">{columnLabel(i)}</TableHeader>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sheet.rows.map((row, r) => (
              <TableRow key={r}>
                <TableCell className="spreadsheet-preview__rownum">{r + 1}</TableCell>
                {row.map((cell, c) => (
                  <TableCell key={c}>{cell}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

interface SpreadsheetPreviewProps {
  /** Where the bytes are; fetched with the session cookie. */
  url: string;
}

export function SpreadsheetPreview({ url }: SpreadsheetPreviewProps) {
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseWorkbook(await res.arrayBuffer());
        if (!cancelled) setSheets(parsed);
      } catch {
        if (!cancelled) setError('The spreadsheet could not be loaded. Download to open it.');
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <p className="spreadsheet-preview__error">{error}</p>;
  if (!sheets) return <InlineLoading description="Reading the spreadsheet…" />;
  if (sheets.length === 0) return <p className="spreadsheet-preview__empty">This workbook has no sheets.</p>;
  if (sheets.length === 1) {
    return <div className="spreadsheet-preview"><SheetGrid sheet={sheets[0]} /></div>;
  }
  return (
    <div className="spreadsheet-preview">
      <Tabs>
        <TabList aria-label="Sheets" contained>
          {sheets.map((s) => <Tab key={s.name}>{s.name}</Tab>)}
        </TabList>
        <TabPanels>
          {sheets.map((s) => <TabPanel key={s.name}><SheetGrid sheet={s} /></TabPanel>)}
        </TabPanels>
      </Tabs>
    </div>
  );
}
