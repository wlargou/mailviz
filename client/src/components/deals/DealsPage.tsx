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
import { Add, TrashCan, Launch, Edit } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { DealCreateModal } from './DealCreateModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { EmptyState } from '../shared/EmptyState';
import { dealsApi } from '../../api/deals';
import { dealPartnersApi } from '../../api/dealPartners';
import { useUIStore } from '../../store/uiStore';
import type { Deal, DealPartner, DealStatus } from '../../types/deal';
import { DEAL_STATUS_LABELS, DEAL_STATUS_TAG_TYPE } from '../../types/deal';
import type { PaginationMeta } from '../../types/api';
import { format, isPast } from 'date-fns';

const headers = [
  { key: 'title', header: 'Title' },
  { key: 'partner', header: 'Partner' },
  { key: 'customer', header: 'Customer' },
  { key: 'products', header: 'Products' },
  { key: 'status', header: 'Status' },
  { key: 'expiry', header: 'Expiry Date' },
  { key: 'actions', header: '' },
];

export function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [partners, setPartners] = useState<DealPartner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteDeal, setDeleteDeal] = useState<Deal | null>(null);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Load partners for filter dropdown
  useEffect(() => {
    dealPartnersApi.getAll().then(({ data: res }) => {
      setPartners(res.data);
    }).catch(() => {});
  }, []);

  const fetchDeals = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: '20' };
      if (debouncedSearch) params.search = debouncedSearch;
      if (selectedStatus) params.status = selectedStatus;
      if (selectedPartnerId) params.partnerId = selectedPartnerId;
      const { data: response } = await dealsApi.getAll(params);
      setDeals(response.data);
      setMeta(response.meta || null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load deals' });
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, selectedStatus, selectedPartnerId, addNotification]);

  useEffect(() => {
    fetchDeals();
  }, [fetchDeals]);

  const handleDelete = async () => {
    if (!deleteDeal) return;
    try {
      await dealsApi.delete(deleteDeal.id);
      addNotification({ kind: 'success', title: 'Deal deleted' });
      setDeleteDeal(null);
      fetchDeals();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete deal' });
    }
  };

  const statusItems = [
    { id: '__all__', text: 'All Statuses' },
    { id: 'TO_CHALLENGE', text: 'To Challenge' },
    { id: 'APPROVED', text: 'Approved' },
    { id: 'DECLINED', text: 'Declined' },
  ];

  const partnerItems = [
    { id: '__all__', text: 'All Partners' },
    ...partners.map((p) => ({ id: p.id, text: p.name })),
  ];

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>Deal Registration</h1>
          <p className="page-header__subtitle">Track partner deal registrations</p>
        </div>
        <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
          New Deal
        </Button>
      </div>

      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
          {loading && deals.length === 0 ? (
            <DataTableSkeleton headers={headers} rowCount={5} />
          ) : (
            <>
              <DataTable rows={deals.map((d) => ({ id: d.id }))} headers={headers}>
                {({ getTableProps }) => (
                <TableContainer className="deals-table">
                  <TableToolbar>
                    <TableToolbarContent>
                      <TableToolbarSearch
                        placeholder="Search deals..."
                        defaultValue={search}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setSearch(e.target.value || '');
                          setPage(1);
                        }}
                        persistent
                      />
                      {partners.length > 0 && (
                        <Dropdown
                          id="partner-filter"
                          titleText=""
                          label="All Partners"
                          items={partnerItems}
                          itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                          selectedItem={
                            selectedPartnerId
                              ? { id: selectedPartnerId, text: partners.find((p) => p.id === selectedPartnerId)?.name || '' }
                              : { id: '__all__', text: 'All Partners' }
                          }
                          onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                            const id = selectedItem?.id === '__all__' ? null : selectedItem?.id || null;
                            setSelectedPartnerId(id);
                            setPage(1);
                          }}
                          size="sm"
                          className="contacts-company-filter"
                        />
                      )}
                      <Dropdown
                        id="status-filter"
                        titleText=""
                        label="All Statuses"
                        items={statusItems}
                        itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
                        selectedItem={
                          selectedStatus
                            ? statusItems.find((s) => s.id === selectedStatus) || statusItems[0]
                            : statusItems[0]
                        }
                        onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
                          const id = selectedItem?.id === '__all__' ? null : selectedItem?.id || null;
                          setSelectedStatus(id);
                          setPage(1);
                        }}
                        size="sm"
                        className="contacts-company-filter"
                      />
                    </TableToolbarContent>
                  </TableToolbar>
                  {deals.length === 0 ? (
                    <EmptyState
                      title="No deals"
                      description={search || selectedPartnerId || selectedStatus ? 'No deals match your filters' : 'Register your first deal to get started'}
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
                      {deals.map((deal) => (
                        <TableRow key={deal.id}>
                          <TableCell>{deal.title}</TableCell>
                          <TableCell>
                            <span className="deal-partner-cell">
                              {deal.partner.name}
                              {deal.partner.registrationUrl && (
                                <Button
                                  kind="ghost"
                                  size="sm"
                                  hasIconOnly
                                  renderIcon={Launch}
                                  iconDescription="Open registration portal"
                                  onClick={() => window.open(deal.partner.registrationUrl!, '_blank')}
                                />
                              )}
                            </span>
                          </TableCell>
                          <TableCell>
                            {deal.customer ? (
                              <span
                                className="customer-name-cell"
                                onClick={() => navigate(`/customers/${deal.customer!.id}`)}
                              >
                                {deal.customer.name}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            {deal.products
                              ? deal.products.length > 60
                                ? `${deal.products.slice(0, 60)}...`
                                : deal.products
                              : '—'}
                          </TableCell>
                          <TableCell>
                            <Tag type={DEAL_STATUS_TAG_TYPE[deal.status]} size="sm">
                              {DEAL_STATUS_LABELS[deal.status]}
                            </Tag>
                          </TableCell>
                          <TableCell>
                            {deal.expiryDate ? (
                              isPast(new Date(deal.expiryDate)) ? (
                                <span className="deal-expiry--expired">
                                  {format(new Date(deal.expiryDate), 'MMM d, yyyy')}
                                </span>
                              ) : (
                                format(new Date(deal.expiryDate), 'MMM d, yyyy')
                              )
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="table-actions">
                              <Button
                                kind="ghost"
                                size="sm"
                                hasIconOnly
                                renderIcon={Edit}
                                iconDescription="Edit deal"
                                onClick={() => setEditDeal(deal)}
                              />
                              <Button
                                kind="danger--ghost"
                                size="sm"
                                hasIconOnly
                                renderIcon={TrashCan}
                                iconDescription="Delete"
                                onClick={() => setDeleteDeal(deal)}
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

      <DealCreateModal
        open={createOpen || !!editDeal}
        onClose={() => { setCreateOpen(false); setEditDeal(null); }}
        onCreated={() => { fetchDeals(); setEditDeal(null); }}
        editDeal={editDeal}
      />

      <ConfirmDeleteModal
        open={!!deleteDeal}
        title={deleteDeal?.title || ''}
        onClose={() => setDeleteDeal(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
