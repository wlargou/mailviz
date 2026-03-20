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
  Dropdown,
  Grid,
  Column,
} from '@carbon/react';
import { Copy } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { contactsApi, customersApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../shared/EmptyState';
import type { Contact, Customer } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';

const headers = [
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'company', header: 'Company' },
];

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
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

  // Load customers for the filter dropdown
  useEffect(() => {
    customersApi.getAll({ limit: '500' }).then(({ data: res }) => {
      setCustomers(res.data);
    }).catch(() => {});
  }, []);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '20' };
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
  }, [page, debouncedSearch, selectedCustomerId, addNotification]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const dropdownItems = [
    { id: '__all__', text: 'All companies' },
    ...customers.map((c) => ({ id: c.id, text: c.name })),
  ];

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
                      <Dropdown
                        id="company-filter"
                        titleText=""
                        label="All companies"
                        items={dropdownItems}
                        itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                        selectedItem={dropdownItems.find((d) => d.id === (selectedCustomerId || '__all__')) || dropdownItems[0]}
                        onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                          const id = selectedItem?.id === '__all__' ? null : selectedItem?.id || null;
                          setSelectedCustomerId(id);
                          setPage(1);
                        }}
                        size="sm"
                        className="contacts-company-filter"
                      />
                    </TableToolbarContent>
                  </TableToolbar>
                  <Table {...getTableProps()} size="lg">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <TableHeader key={header.key}>
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
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
                )}
              </DataTable>
              {meta && meta.totalPages > 1 && (
                <Pagination
                  totalItems={meta.total}
                  pageSize={meta.limit}
                  pageSizes={[10, 20, 50]}
                  page={page}
                  onChange={({ page: p }: { page: number }) => setPage(p)}
                />
              )}
            </>
          )}
        </Column>
      </Grid>
    </div>
  );
}
