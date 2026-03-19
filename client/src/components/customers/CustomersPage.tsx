import { useEffect, useState, useCallback } from 'react';
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
} from '@carbon/react';
import { Add, View, TrashCan } from '@carbon/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerCreateModal } from './CustomerCreateModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { EmptyState } from '../shared/EmptyState';
import { customersApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import type { Customer } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';

const headers = [
  { key: 'name', header: 'Name' },
  { key: 'company', header: 'Company' },
  { key: 'email', header: 'Email' },
  { key: 'contacts', header: 'Contacts' },
  { key: 'tasks', header: 'Tasks' },
  { key: 'actions', header: '' },
];

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [urlParams] = useSearchParams();
  const [search, setSearch] = useState(() => urlParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => urlParams.get('search') || '');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (debouncedSearch) params.search = debouncedSearch;
      const { data: response } = await customersApi.getAll(params);
      setCustomers(response.data);
      setMeta(response.meta || null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load customers' });
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, addNotification]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleDelete = async () => {
    if (!deleteCustomer) return;
    try {
      await customersApi.delete(deleteCustomer.id);
      addNotification({ kind: 'success', title: 'Customer deleted' });
      setDeleteCustomer(null);
      fetchCustomers();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete customer' });
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Customers</h1>
          <p className="page-header__subtitle">All customers and their contacts</p>
        </div>
        <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
          New Customer
        </Button>
      </div>

      {loading && customers.length === 0 ? (
        <DataTableSkeleton headers={headers} rowCount={5} />
      ) : customers.length === 0 && !search ? (
        <EmptyState title="No customers yet" description="Create your first customer to get started" />
      ) : (
        <>
          <DataTable rows={customers.map((c) => ({ id: c.id }))} headers={headers}>
            {({ getTableProps }) => (
            <TableContainer>
              <TableToolbar>
                <TableToolbarContent>
                  <TableToolbarSearch
                    placeholder="Search customers..."
                    defaultValue={search}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                      setSearch(e.target.value || '');
                      setPage(1);
                    }}
                    persistent
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
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell>
                      <span
                        className="customer-name-cell"
                        onClick={() => navigate(`/customers/${customer.id}`)}
                      >
                        {customer.logoUrl && (
                          <img
                            src={customer.logoUrl}
                            alt=""
                            className="customer-logo"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                        {customer.name}
                      </span>
                    </TableCell>
                    <TableCell>{customer.company || '—'}</TableCell>
                    <TableCell>{customer.email || '—'}</TableCell>
                    <TableCell>
                      <Tag type="cyan" size="sm">{customer._count?.contacts ?? 0}</Tag>
                    </TableCell>
                    <TableCell>
                      <Tag type="blue" size="sm">{customer._count?.tasks ?? 0}</Tag>
                    </TableCell>
                    <TableCell>
                      <div className="table-actions">
                        <Button
                          kind="ghost"
                          size="sm"
                          hasIconOnly
                          renderIcon={View}
                          iconDescription="View details"
                          onClick={() => navigate(`/customers/${customer.id}`)}
                        />
                        <Button
                          kind="danger--ghost"
                          size="sm"
                          hasIconOnly
                          renderIcon={TrashCan}
                          iconDescription="Delete"
                          onClick={() => setDeleteCustomer(customer)}
                        />
                      </div>
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

      <CustomerCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={fetchCustomers}
      />

      <ConfirmDeleteModal
        open={!!deleteCustomer}
        title={deleteCustomer?.name || ''}
        onClose={() => setDeleteCustomer(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
