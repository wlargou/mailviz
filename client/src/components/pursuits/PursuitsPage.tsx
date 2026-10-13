import { Tabs, TabList, Tab, TabPanels, TabPanel } from '@carbon/react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../shared/PageHeader';
import { RfpsPage } from '../rfps/RfpsPage';
import { DealsPage } from '../deals/DealsPage';

/**
 * Deals: what you are trying to win, in one place — at /deals.
 *
 * Called Pursuits until 1.27; `/pursuits` still resolves here.
 *
 * A public tender and a partner deal registration are both an opportunity
 * with a buyer, a date that matters and a status — they sat in two nav
 * entries, one of them usually empty. They stay separate records, with their
 * own fields and lifecycles, under one page: the tab is in the URL
 * (`?tab=deals`), so links and the back button land where they should.
 */
const TABS = ['tenders', 'deals'] as const;

export function PursuitsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'deals' ? 'deals' : 'tenders';

  return (
    <div>
      <PageHeader
        title="Deals"
        subtitle="Tenders and deal registrations — what you are trying to win, and by when"
      />
      <Tabs
        selectedIndex={TABS.indexOf(tab)}
        onChange={({ selectedIndex }: { selectedIndex: number }) => {
          const next = new URLSearchParams(params);
          next.set('tab', TABS[selectedIndex]);
          // Filters belong to the tab they were set on.
          next.delete('search');
          setParams(next, { replace: true });
        }}
      >
        <TabList aria-label="Deal type" className="pursuits-tabs">
          <Tab>Tenders</Tab>
          <Tab>Deal registrations</Tab>
        </TabList>
        <TabPanels>
          <TabPanel className="pursuits-tabs__panel">{tab === 'tenders' && <RfpsPage embedded />}</TabPanel>
          <TabPanel className="pursuits-tabs__panel">{tab === 'deals' && <DealsPage embedded />}</TabPanel>
        </TabPanels>
      </Tabs>
    </div>
  );
}

/** `/rfps` and `/pursuits` still resolve — bookmarks, search links — onto the page, and `/rfps` onto its tab. */
export function PursuitsRedirect({ tab }: { tab?: (typeof TABS)[number] }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (tab) params.set('tab', tab);
  const query = params.toString();
  return <Navigate to={`/deals${query ? `?${query}` : ''}`} replace />;
}
