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
  DataTableSkeleton,
  Tag,
  Grid,
  Column,
} from '@carbon/react';
import { Copy } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { contactsApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../shared/EmptyState';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import type { Contact } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';

const headers = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'company', header: 'Company' },
  { key: 'emails', header: 'Emails' },
];

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
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
      const params: Record<string, string> = { page: String(page), limit: String(pageSize) };
      if (debouncedSearch) params.search = debouncedSearch;
      if (selectedCustomerId) params.customerId = selectedCustomerId;
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
  }, [page, pageSize, debouncedSearch, selectedCustomerId, addNotification]);

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
      </div>

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
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
                        defaultValue={search}
                        onChange={(e: any) => {
                          const val = typeof e === 'string' ? e : (e?.target?.value ?? '');
                          setSearch(val);
                          setPage(1);
                        }}
                        persistent
                      />
                      <TableFilterFlyout
                        activeFilterCount={selectedCustomerId ? 1 : 0}
                        onReset={() => { setSelectedCustomerId(null); setPage(1); }}
                      >
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
                            {contact.customer?.logoUrl && (
                              <img
                                src={contact.customer.logoUrl}
                                alt=""
                                className="customer-logo"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                            )}
                            {contact.firstName} {contact.lastName}
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
        </Column>
      </Grid>
    </div>
  );
}
