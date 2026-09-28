import { Tabs, TabList, Tab, TabPanels, TabPanel } from '@carbon/react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../shared/PageHeader';
import { RfpsPage } from '../rfps/RfpsPage';
import { DealsPage } from '../deals/DealsPage';

/**
 * Pursuits: what you are trying to win, in one place.
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
        title="Pursuits"
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
        <TabList aria-label="Pursuit type" className="pursuits-tabs">
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

/** `/rfps` and `/deals` still resolve — bookmarks, search links — onto their tab. */
export function PursuitsRedirect({ tab }: { tab: (typeof TABS)[number] }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', tab);
  return <Navigate to={`/pursuits?${params.toString()}`} replace />;
}
