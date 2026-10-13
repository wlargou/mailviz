import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { PursuitsRedirect } from './PursuitsPage';

/** Deals was Pursuits until 1.27: the old addresses still land, query and all. */

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function follow(from: string) {
  const { container, unmount } = render(
    <MemoryRouter initialEntries={[from]}>
      <Routes>
        <Route path="/pursuits" element={<PursuitsRedirect />} />
        <Route path="/rfps" element={<PursuitsRedirect tab="tenders" />} />
        <Route path="/deals" element={<Where />} />
      </Routes>
    </MemoryRouter>
  );
  const where = container.querySelector('[data-testid="where"]')!.textContent;
  unmount();
  return where;
}

describe('the old addresses of Deals', () => {
  it('sends /pursuits to /deals, keeping the tab and filters', () => {
    expect(follow('/pursuits?tab=deals&search=awb')).toBe('/deals?tab=deals&search=awb');
    expect(follow('/pursuits')).toBe('/deals');
  });

  it('sends /rfps to the tenders tab', () => {
    expect(follow('/rfps?search=aix')).toBe('/deals?search=aix&tab=tenders');
  });
});
