import { useEffect, useState, useCallback, useRef } from 'react';
import {
  DataTable,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Pagination,
  Button,
  DataTableSkeleton,
  Tag,
  Dropdown,
  OverflowMenu,
  OverflowMenuItem,
  Tabs,
  TabList,
  Tab,
} from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { openRowOnClick } from '../../utils/rowOpen';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerCreateModal } from './CustomerCreateModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { EmptyState } from '../shared/EmptyState';
import { CategoryTag } from '../shared/CategoryTag';
import { VipBadge } from '../shared/VipBadge';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { customersApi } from '../../api/customers';
import { companyCategoriesApi } from '../../api/companyCategories';
import { useUIStore } from '../../store/uiStore';
import type { Customer, CompanyCategory, CompanyStatus } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';
import { toolbarSearchValue } from '../../utils/carbonSearch';
import { CompanyLogo } from '../shared/CompanyLogo';
import { useTableSort } from '../../hooks/useTableSort';

/**
 * `sortable` marks the columns the API can actually order by
 * (`CUSTOMER_SORT_FIELDS` in customerService). The count columns are computed
 * per row, so ordering by them needs aggregate SQL the endpoint does not do yet —
 * and a sort arrow that does nothing when clicked is worse than none.
 */
const headers = [
  { key: 'name', header: 'Name', sortField: 'name' },
  { key: 'category', header: 'Category' },
  { key: 'contacts', header: 'Contacts' },
  { key: 'tasks', header: 'Tasks' },
  { key: 'emails', header: 'Emails', sortField: 'emailCount' },
  { key: 'actions', header: '' },
];

const STATUS_TABS: Array<{ id: CompanyStatus; label: string }> = [
  { id: 'ACCOUNT', label: 'Accounts' },
  { id: 'SENDER', label: 'Senders to review' },
  { id: 'IGNORED', label: 'Ignored' },
];

/** "3 046" — grouped by hand; `toLocaleString` differs between Node and Chrome. */
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

function Count({ n }: { n: number }) {
  return <span className={n === 0 ? 'table-count table-count--zero' : 'table-count'}>{group(n)}</span>;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // The busiest first: A→Z opened on "0X5E", "163", "1ft Seabass".
  const { params: sortParams, headerProps } = useTableSort('emailCount', 'desc');
  /** Accounts by default; senders to review and ignored ones a tab away. */
  const [status, setStatus] = useState<CompanyStatus>('ACCOUNT');
  const [statusCounts, setStatusCounts] = useState<Record<CompanyStatus, number> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [urlParams] = useSearchParams();
  const [search, setSearch] = useState(() => urlParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => urlParams.get('search') || '');
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load categories for filter dropdown
  useEffect(() => {
    companyCategoriesApi.getAll().then(({ data: res }) => {
      setCategories(res.data);
    }).catch(() => {});
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(pageSize),
        ...sortParams,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (selectedCategoryId) params.categoryId = selectedCategoryId;
      params.status = status;
      const { data: response } = await customersApi.getAll(params);
      setCustomers(response.data);
      setMeta(response.meta || null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load companies' });
    } finally {
      setLoading(false);
      // Refocus search input after results update to prevent losing focus
      if (search) {
        requestAnimationFrame(() => {
          const input = searchRef.current?.querySelector?.('input') ?? searchRef.current;
          if (input && typeof input.focus === 'function') {
            input.focus();
            // Move cursor to end
            if ('setSelectionRange' in input && typeof input.value === 'string') {
              (input as HTMLInputElement).setSelectionRange(input.value.length, input.value.length);
            }
          }
        });
      }
    }
  }, [page, pageSize, debouncedSearch, selectedCategoryId, status, addNotification, search, sortParams.sortBy, sortParams.sortOrder]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const fetchCounts = useCallback(() => {
    customersApi
      .getStatusCounts()
      .then(({ data: res }) => setStatusCounts(res.data))
      .catch(() => setStatusCounts(null));
  }, []);
  useEffect(() => fetchCounts(), [fetchCounts]);

  /** Keep or ignore, one or many; the rows leave the tab they were in. */
  const triage = async (ids: string[], next: CompanyStatus) => {
    try {
      await customersApi.setStatus(ids, next);
      const verb = next === 'ACCOUNT' ? 'Kept as account' : next === 'IGNORED' ? 'Ignored' : 'Moved back to review';
      addNotification({ kind: 'success', title: ids.length === 1 ? verb : `${verb} · ${ids.length} companies` });
      setSelected(new Set());
      fetchCustomers();
      fetchCounts();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update the companies' });
    }
  };

  const toggleSelected = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const triaging = status !== 'ACCOUNT';

  const handleDelete = async () => {
    if (!deleteCustomer) return;
    try {
      await customersApi.delete(deleteCustomer.id);
      addNotification({ kind: 'success', title: 'Company deleted' });
      setDeleteCustomer(null);
      fetchCustomers();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete company' });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Companies</h1>
          <p className="page-header__subtitle">The companies you deal with — and the senders to sort</p>
        </div>
      </div>

      <Tabs
        selectedIndex={STATUS_TABS.findIndex((t) => t.id === status)}
        onChange={({ selectedIndex }: { selectedIndex: number }) => {
          setStatus(STATUS_TABS[selectedIndex].id);
          setSelected(new Set());
          setPage(1);
        }}
      >
        <TabList aria-label="Company status" className="companies-tabs">
          {STATUS_TABS.map((t) => (
            <Tab key={t.id}>
              {t.label}
              {statusCounts && <span className="companies-tabs__count">{group(statusCounts[t.id])}</span>}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {status === 'SENDER' && (
        <p className="companies-tabs__hint">
          Domains that have mailed you and nothing more. Keep the ones you deal with; ignore the rest — an ignored sender
          stays out of your accounts, even when it mails again.
        </p>
      )}
      {triaging && selected.size > 0 && (
        <div className="companies-batch" role="region" aria-label="Selected companies">
          <span>{selected.size} selected</span>
          <Button size="sm" kind="primary" onClick={() => triage([...selected], 'ACCOUNT')}>
            Keep as accounts
          </Button>
          {status === 'SENDER' && (
            <Button size="sm" kind="secondary" onClick={() => triage([...selected], 'IGNORED')}>
              Ignore
            </Button>
          )}
          <Button size="sm" kind="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

          {loading && customers.length === 0 && !search ? (
            <DataTableSkeleton headers={headers} rowCount={5} />
          ) : (
            <>
              <DataTable rows={customers.map((c) => ({ id: c.id }))} headers={headers}>
                {({ getTableProps }) => (
                <TableContainer className="customers-table">
                  <TableToolbar>
                    <TableToolbarContent>
                      <TableToolbarSearch
                        ref={searchRef}
                        placeholder="Search companies..."
                        defaultValue={search}
                        onChange={(e) => {
                          setSearch(toolbarSearchValue(e));
                          setPage(1);
                        }}
                        persistent
                      />
                      {categories.length > 0 && (
                        <TableFilterFlyout
                          activeFilterCount={selectedCategoryId ? 1 : 0}
                          onReset={() => { setSelectedCategoryId(null); setPage(1); }}
                        >
                          <Dropdown
                            id="category-filter"
                            titleText="Category"
                            label="All categories"
                            items={[{ id: '__all__', text: 'All categories' }, ...categories.map((c) => ({ id: c.id, text: c.label }))]}
                            itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                            selectedItem={
                              selectedCategoryId
                                ? { id: selectedCategoryId, text: categories.find((c) => c.id === selectedCategoryId)?.label || '' }
                                : { id: '__all__', text: 'All categories' }
                            }
                            onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                              const id = selectedItem?.id === '__all__' ? null : selectedItem?.id || null;
                              setSelectedCategoryId(id);
                              setPage(1);
                            }}
                            size="sm"
                          />
                        </TableFilterFlyout>
                      )}
                      <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
                        New Company
                      </Button>
                    </TableToolbarContent>
                  </TableToolbar>
                  {customers.length === 0 ? (
                    <EmptyState
                      title={status === 'SENDER' ? 'Nothing to review' : status === 'IGNORED' ? 'No ignored senders' : 'No accounts'}
                      description={
                        search || selectedCategoryId
                          ? 'No companies match your filters'
                          : status === 'ACCOUNT'
                            ? 'Create a company, or keep one from the senders to review'
                            : undefined
                      }
                    />
                  ) : (
                  <Table {...getTableProps()} size="lg">
                    <TableHead>
                      <TableRow>
                        {triaging && (
                          <TableHeader className="companies-select">
                            <input
                              type="checkbox"
                              aria-label="Select every company on this page"
                              checked={customers.length > 0 && customers.every((c) => selected.has(c.id))}
                              onChange={(e) => setSelected(e.target.checked ? new Set(customers.map((c) => c.id)) : new Set())}
                            />
                          </TableHeader>
                        )}
                        {headers.map((header) => (
                          <TableHeader
                            key={header.key}
                            className={['contacts', 'tasks', 'emails'].includes(header.key) ? 'table-cell--center' : undefined}
                            {...(header.sortField ? headerProps(header.sortField) : {})}
                          >
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow
                        key={customer.id}
                        className="table-row--clickable"
                        onClick={openRowOnClick(() => navigate(`/customers/${customer.id}`))}
                      >
                        {triaging && (
                          <TableCell className="companies-select">
                            <input
                              type="checkbox"
                              aria-label={`Select ${customer.name}`}
                              checked={selected.has(customer.id)}
                              onChange={(e) => toggleSelected(customer.id, e.target.checked)}
                            />
                          </TableCell>
                        )}
                        <TableCell>
                          <button
                            type="button"
                            className="table-title-button customer-name-cell"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                          >
                            {customer.isVip && <VipBadge isVip size={16} />}
                            <CompanyLogo src={customer.logoUrl} name={customer.name} />
                            {customer.name}
                          </button>
                        </TableCell>
                        <TableCell>
                          <CategoryTag category={customer.category} />
                        </TableCell>
                        {/* Plain numbers, a zero muted: a coloured pill around
                            every 0 made the table look busy with nothing. */}
                        <TableCell className="table-cell--center">
                          <Count n={customer._count?.contacts ?? 0} />
                        </TableCell>
                        <TableCell className="table-cell--center">
                          <Count n={customer._count?.tasks ?? 0} />
                        </TableCell>
                        <TableCell className="table-cell--center">
                          <Count n={customer._count?.emails ?? 0} />
                        </TableCell>
                        <TableCell>
                          <div className="companies-row-actions">
                            {status === 'SENDER' && (
                              <>
                                <Button size="sm" kind="ghost" onClick={() => triage([customer.id], 'ACCOUNT')}>
                                  Keep
                                </Button>
                                <Button size="sm" kind="ghost" onClick={() => triage([customer.id], 'IGNORED')}>
                                  Ignore
                                </Button>
                              </>
                            )}
                            {status === 'IGNORED' && (
                              <Button size="sm" kind="ghost" onClick={() => triage([customer.id], 'SENDER')}>
                                Un-ignore
                              </Button>
                            )}
                            <OverflowMenu flipped size="sm" iconDescription={`Actions for ${customer.name}`}>
                              {[
                                <OverflowMenuItem key="open" itemText="Open" onClick={() => navigate(`/customers/${customer.id}`)} />,
                                ...(status === 'ACCOUNT'
                                  ? [<OverflowMenuItem key="sender" itemText="Not an account" onClick={() => triage([customer.id], 'SENDER')} />]
                                  : []),
                                <OverflowMenuItem key="delete" itemText="Delete" isDelete hasDivider onClick={() => setDeleteCustomer(customer)} />,
                              ]}
                            </OverflowMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                  )}
              </TableContainer>
                )}
              </DataTable>
              {meta && (meta.totalPages > 1 || pageSize !== 20) && (
                <Pagination
                  totalItems={meta.total}
                  pageSize={pageSize}
                  pageSizes={[10, 20, 50]}
                  page={page}
                  onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
                    if (ps !== pageSize) { setPageSize(ps); setPage(1); }
                    else setPage(p);
                  }}
                />
              )}
            </>
          )}

      <CustomerCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchCustomers}
      />

      <ConfirmDeleteModal
        open={!!deleteCustomer}
        title={deleteCustomer?.name || ''}
        entityLabel="company"
        onClose={() => setDeleteCustomer(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
