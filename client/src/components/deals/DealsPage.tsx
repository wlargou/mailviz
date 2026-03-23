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
} from '@carbon/react';
import { Add, TrashCan, Launch, Edit, Share } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { DealCreateModal } from './DealCreateModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { EmptyState } from '../shared/EmptyState';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { ShareDialog } from '../shared/ShareDialog';
import { dealsApi } from '../../api/deals';
import { dealPartnersApi } from '../../api/dealPartners';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
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
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [partners, setPartners] = useState<DealPartner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteDeal, setDeleteDeal] = useState<Deal | null>(null);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [shareDeal, setShareDeal] = useState<Deal | null>(null);
  const [dealShares, setDealShares] = useState<Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }>>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const currentUser = useAuthStore((s) => s.user);

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
      const params: Record<string, string> = { page: String(page), limit: String(pageSize) };
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
  }, [page, pageSize, debouncedSearch, selectedStatus, selectedPartnerId, addNotification]);

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

  const fetchDealShares = useCallback(async (dealId: string) => {
    try {
      const { data: res } = await dealsApi.getDealShares(dealId);
      setDealShares(res.data);
    } catch {
      // Ignore
    }
  }, []);

  const handleOpenShare = async (deal: Deal) => {
    setShareDeal(deal);
    await fetchDealShares(deal.id);
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
      </div>

          {loading && deals.length === 0 && !search ? (
            <DataTableSkeleton headers={headers} rowCount={5} />
          ) : (
            <>
              <DataTable rows={deals.map((d) => ({ id: d.id }))} headers={headers}>
                {({ getTableProps }) => (
                <TableContainer className="deals-table">
                  <TableToolbar>
                    <TableToolbarContent>
                      <TableToolbarSearch
                        ref={searchRef}
                        placeholder="Search deals..."
                        defaultValue={search}
                        onChange={(e: any) => {
                          const val = typeof e === 'string' ? e : (e?.target?.value ?? '');
                          setSearch(val);
                          setPage(1);
                        }}
                        persistent
                      />
                      <TableFilterFlyout
                        activeFilterCount={(selectedPartnerId ? 1 : 0) + (selectedStatus ? 1 : 0)}
                        onReset={() => { setSelectedPartnerId(null); setSelectedStatus(null); setPage(1); }}
                      >
                        {partners.length > 0 && (
                          <Dropdown
                            id="partner-filter"
                            titleText="Partner"
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
                          />
                        )}
                        <Dropdown
                          id="status-filter"
                          titleText="Status"
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
                        />
                      </TableFilterFlyout>
                      <Button renderIcon={Add} onClick={() => setCreateOpen(true)}>
                        New Deal
                      </Button>
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
                          <TableCell>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                              {deal.title}
                              {currentUser && deal.userId !== currentUser.id && (
                                <Tag size="sm" type="purple">Shared</Tag>
                              )}
                            </span>
                          </TableCell>
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
                                renderIcon={Share}
                                iconDescription="Share deal"
                                onClick={() => handleOpenShare(deal)}
                              />
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

      {shareDeal && (
        <ShareDialog
          open={!!shareDeal}
          onClose={() => { setShareDeal(null); setDealShares([]); }}
          title={shareDeal.title}
          currentShares={dealShares}
          onShare={async (userIds) => {
            await dealsApi.shareDeal(shareDeal.id, userIds);
          }}
          onUnshare={async (userId) => {
            await dealsApi.unshareDeal(shareDeal.id, userId);
          }}
          onRefresh={() => fetchDealShares(shareDeal.id)}
        />
      )}
    </div>
  );
}
