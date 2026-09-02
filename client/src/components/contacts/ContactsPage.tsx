import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableToolbar,
  TableToolbarContent,
  TableToolbarSearch,
  Tag,
} from '@carbon/react';
import { Copy, Merge } from '@carbon/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { contactsApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../shared/EmptyState';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import type { Contact } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';
import { toolbarSearchValue } from '../../utils/carbonSearch';
import { CompanyLogo } from '../shared/CompanyLogo';
import { useTableSort } from '../../hooks/useTableSort';
import { decodeEntities } from '../../utils/text';

/**
 * `sortField` is the API field, which is not always the column key:
 * `CONTACT_SORT_FIELDS` has no combined "name", so Name orders by surname.
 * Company is a relation and Emails is a computed count — neither is orderable by
 * the endpoint, so neither gets an affordance.
 */
/**
 * `people` is person + role: someone answers a shared mailbox, nobody answers a
 * `noreply@`. Splitting those two into separate options is what lets you find
 * `support@` without wading through delivery notifications.
 */
/**
 * Named from the contact's side, matching the stored value: `sender` means they
 * wrote to you.
 *
 * Defaults to `all` rather than `any`, deliberately. Filtering to "has exchanged
 * mail" by default would hide 5,918 of 11,694 contacts, and someone looking up an
 * address they were once cc'd on would conclude it was never captured. The
 * default should not silently answer a different question than the one asked.
 */
const ENGAGEMENT_FILTERS = [
  { id: 'all', label: 'Any correspondence' },
  { id: 'any', label: 'Has exchanged mail' },
  { id: 'both', label: 'Two-way' },
  { id: 'sender', label: 'They wrote to me' },
  { id: 'receiver', label: 'I wrote to them' },
  { id: 'none', label: 'Never exchanged' },
];

const KIND_FILTERS = [
  { id: 'people', label: 'People and shared mailboxes' },
  { id: 'person', label: 'People only' },
  { id: 'role', label: 'Shared mailboxes' },
  { id: 'automated', label: 'Automated senders' },
  { id: 'all', label: 'All contacts' },
];

const headers = [
  { key: 'name', header: 'Name', sortField: 'lastName' },
  { key: 'email', header: 'Email', sortField: 'email' },
  { key: 'company', header: 'Company' },
  { key: 'emails', header: 'Emails' },
];

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { params: sortParams, headerProps } = useTableSort('lastName', 'asc');
  const [searchParams] = useSearchParams();
  const initialSearch = useMemo(() => searchParams.get('search') || '', []);
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  /**
   * Defaults to `people` — a person or a shared mailbox someone answers.
   *
   * Of 11,694 contacts about 1,350 are machines or brand addresses, and they are
   * not who you look up a contact to find. "All" is one click away for when the
   * question is "who has ever emailed me from that domain".
   */
  const [kindFilter, setKindFilter] = useState<string>('people');
  const [engagementFilter, setEngagementFilter] = useState<string>('all');
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(pageSize),
        ...sortParams,
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (selectedCustomerId) params.customerId = selectedCustomerId;
      if (kindFilter !== 'all') params.kind = kindFilter;
      if (engagementFilter !== 'all') params.engagement = engagementFilter;
      const { data: response } = await contactsApi.getAll(params);
      setContacts(response.data);
      setMeta(response.meta || null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load contacts' });
    } finally {
      setLoading(false);
      if (search) {
        requestAnimationFrame(() => {
          const input = searchRef.current?.querySelector?.('input') ?? searchRef.current;
          if (input && typeof input.focus === 'function') {
            input.focus();
            if ('setSelectionRange' in input && typeof input.value === 'string') {
              (input as HTMLInputElement).setSelectionRange(input.value.length, input.value.length);
            }
          }
        });
      }
    }
  }, [page, pageSize, debouncedSearch, selectedCustomerId, kindFilter, engagementFilter, addNotification, sortParams.sortBy, sortParams.sortOrder]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Contacts</h1>
          <p className="page-header__subtitle">All contacts across companies</p>
        </div>
        <div className="page-header__actions">
          <Button
            kind="tertiary"
            size="sm"
            renderIcon={Merge}
            onClick={() => navigate('/contacts/duplicates')}
          >
            Find duplicates
          </Button>
        </div>
      </div>

          {loading && contacts.length === 0 && !search ? (
            <DataTableSkeleton headers={headers} rowCount={5} />
          ) : contacts.length === 0 && !search && !selectedCustomerId ? (
            <EmptyState title="No contacts yet" description="Contacts are created automatically when you sync your calendar" />
          ) : (
            <>
              <DataTable rows={contacts.map((c) => ({ id: c.id }))} headers={headers}>
                {({ getTableProps }) => (
                <TableContainer className="contacts-table">
                  <TableToolbar>
                    <TableToolbarContent>
                      <TableToolbarSearch
                        ref={searchRef}
                        placeholder="Search contacts..."
                        value={search}
                        onChange={(e) => {
                          setSearch(toolbarSearchValue(e));
                          setPage(1);
                        }}
                        persistent
                      />
                      <TableFilterFlyout
                        activeFilterCount={
                          (selectedCustomerId ? 1 : 0) +
                          (kindFilter !== 'people' ? 1 : 0) +
                          (engagementFilter !== 'all' ? 1 : 0)
                        }
                        onReset={() => {
                          setSelectedCustomerId(null);
                          setKindFilter('people');
                          setEngagementFilter('all');
                          setPage(1);
                        }}
                      >
                        <Dropdown
                          id="kind-filter"
                          titleText="Type"
                          // Carbon requires `label` as the empty-state text even
                          // when a selection is always present.
                          label="Select a type"
                          size="sm"
                          items={KIND_FILTERS}
                          itemToString={(item) => (item ? item.label : '')}
                          selectedItem={KIND_FILTERS.find((k) => k.id === kindFilter) ?? KIND_FILTERS[0]}
                          onChange={({ selectedItem }) => {
                            setKindFilter(selectedItem?.id ?? 'people');
                            setPage(1);
                          }}
                        />
                        <Dropdown
                          id="engagement-filter"
                          titleText="Correspondence"
                          label="Select correspondence"
                          size="sm"
                          items={ENGAGEMENT_FILTERS}
                          itemToString={(item) => (item ? item.label : '')}
                          selectedItem={
                            ENGAGEMENT_FILTERS.find((e) => e.id === engagementFilter) ?? ENGAGEMENT_FILTERS[0]
                          }
                          onChange={({ selectedItem }) => {
                            setEngagementFilter(selectedItem?.id ?? 'all');
                            setPage(1);
                          }}
                        />
                        <CompanyComboBox
                          id="company-filter"
                          titleText="Company"
                          selectedId={selectedCustomerId}
                          onChange={(id) => { setSelectedCustomerId(id); setPage(1); }}
                          size="sm"
                          allowNone
                        />
                      </TableFilterFlyout>
                    </TableToolbarContent>
                  </TableToolbar>
                  <Table {...getTableProps()} size="lg">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <TableHeader
                            key={header.key}
                            className={header.key === 'emails' ? 'table-cell--center' : undefined}
                            {...(header.sortField ? headerProps(header.sortField) : {})}
                          >
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                  <TableBody>
                    {contacts.map((contact) => (
                      <TableRow key={contact.id}>
                        <TableCell>
                          <span
                            className="contact-name-cell"
                            onClick={() => navigate(`/contacts/${contact.id}`)}
                          >
                            <CompanyLogo
                              src={contact.customer?.logoUrl}
                              name={contact.customer?.name ?? contact.firstName}
                            />
                            {decodeEntities(`${contact.firstName} ${contact.lastName}`)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {contact.email ? (
                            <span className="contact-email-cell">
                              <span>{contact.email}</span>
                              <button
                                className="contact-copy-btn"
                                title="Copy email"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard.writeText(contact.email!);
                                }}
                              >
                                <Copy size={14} />
                              </button>
                            </span>
                          ) : '—'}
                        </TableCell>
                        <TableCell>
                          {contact.customer ? (
                            <Tag
                              type="cyan"
                              size="sm"
                              className="clickable-tag"
                              onClick={() => navigate(`/customers/${contact.customer!.id}`)}
                            >
                              {contact.customer.name}
                            </Tag>
                          ) : '—'}
                        </TableCell>
                        <TableCell className="table-cell--center">
                          <Tag type="teal" size="sm">{(contact as any)._emailCount ?? 0}</Tag>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
    </div>
  );
}
