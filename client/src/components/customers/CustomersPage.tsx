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
  Grid,
  Column,
  Dropdown,
} from '@carbon/react';
import { Add, View, TrashCan } from '@carbon/icons-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerCreateModal } from './CustomerCreateModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { EmptyState } from '../shared/EmptyState';
import { CategoryTag } from '../shared/CategoryTag';
import { VipBadge } from '../shared/VipBadge';
import { customersApi } from '../../api/customers';
import { companyCategoriesApi } from '../../api/companyCategories';
import { useUIStore } from '../../store/uiStore';
import type { Customer, CompanyCategory } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';

const headers = [
  { key: 'name', header: 'Name' },
  { key: 'category', header: 'Category' },
  { key: 'contacts', header: 'Contacts' },
  { key: 'tasks', header: 'Tasks' },
  { key: 'emails', header: 'Emails' },
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
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteCustomer, setDeleteCustomer] = useState<Customer | null>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

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
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (debouncedSearch) params.search = debouncedSearch;
      if (selectedCategoryId) params.categoryId = selectedCategoryId;
      const { data: response } = await customersApi.getAll(params);
      setCustomers(response.data);
      setMeta(response.meta || null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load companies' });
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, selectedCategoryId, addNotification]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

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
          <p className="page-header__subtitle">All companies and their contacts</p>
        </div>
        <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
          New Company
        </Button>
      </div>

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
          {loading && customers.length === 0 ? (
            <DataTableSkeleton headers={headers} rowCount={5} />
          ) : (
            <>
              <DataTable rows={customers.map((c) => ({ id: c.id }))} headers={headers}>
                {({ getTableProps }) => (
                <TableContainer className="customers-table">
                  <TableToolbar>
                    <TableToolbarContent>
                      <TableToolbarSearch
                        placeholder="Search companies..."
                        defaultValue={search}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setSearch(e.target.value || '');
                          setPage(1);
                        }}
                        persistent
                      />
                      {categories.length > 0 && (
                        <Dropdown
                          id="category-filter"
                          titleText=""
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
                          className="contacts-company-filter"
                        />
                      )}
                    </TableToolbarContent>
                  </TableToolbar>
                  {customers.length === 0 ? (
                    <EmptyState
                      title="No companies"
                      description={search || selectedCategoryId ? 'No companies match your filters' : 'Create your first company to get started'}
                    />
                  ) : (
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
                            {customer.isVip && <VipBadge isVip size={16} />}
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
                        <TableCell>
                          <CategoryTag category={customer.category} />
                        </TableCell>
                        <TableCell>
                          <Tag type="cyan" size="sm">{customer._count?.contacts ?? 0}</Tag>
                        </TableCell>
                        <TableCell>
                          <Tag type="blue" size="sm">{customer._count?.tasks ?? 0}</Tag>
                        </TableCell>
                        <TableCell>
                          <Tag type="teal" size="sm">{customer._count?.emails ?? 0}</Tag>
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
                  )}
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
