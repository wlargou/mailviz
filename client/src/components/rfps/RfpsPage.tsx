import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Add, TrashCan, Edit, Launch, Attachment, Document } from '@carbon/icons-react';
import { format } from 'date-fns';
import { RfpFormPanel } from './RfpFormPanel';
import { AttachmentPreviewModal } from '../shared/AttachmentPreviewModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { EmptyState } from '../shared/EmptyState';
import { TableFilterFlyout } from '../shared/TableFilterFlyout';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import type { PaginationMeta } from '../../types/api';
import {
  formatBudget,
  RFP_STATUSES,
  RFP_STATUS_LABELS,
  RFP_STATUS_TAG_TYPE,
  RFP_SUBMISSION_FORMATS,
  RFP_SUBMISSION_FORMAT_LABELS,
  RFP_TERMINAL_STATUSES,
  type Rfp,
} from '../../types/rfp';
import { toolbarSearchValue } from '../../utils/carbonSearch';
import { useTableSort } from '../../hooks/useTableSort';

/**
 * `sortField` is the API field. Format, GOE and Documents are not ordered on:
 * two of them have three distinct values and the third is a relation count,
 * so a sort affordance there would be a control that does nothing useful.
 */
const headers = [
  { key: 'deadline', header: 'Deadline', sortField: 'deadlineAt' },
  { key: 'name', header: 'RFP', sortField: 'name' },
  { key: 'company', header: 'Company' },
  { key: 'reference', header: 'Reference', sortField: 'reference' },
  { key: 'format', header: 'Format' },
  { key: 'goe', header: 'GOE' },
  { key: 'budget', header: 'Budget', sortField: 'budget' },
  { key: 'status', header: 'Status', sortField: 'status' },
  { key: 'documents', header: 'Docs' },
  { key: 'actions', header: '' },
];

const DAY = 24 * 60 * 60 * 1000;

/**
 * How close the deadline is — the only thing on this page that is urgent.
 *
 * A finished tender is never urgent, whatever its date says: a won bid from
 * last month must not sit in the table coloured like a missed deadline.
 */
export function deadlineTone(deadlineAt: string, status: Rfp['status'], now = Date.now()): 'overdue' | 'soon' | 'normal' {
  if (RFP_TERMINAL_STATUSES.includes(status)) return 'normal';
  const remaining = new Date(deadlineAt).getTime() - now;
  if (remaining < 0) return 'overdue';
  if (remaining <= 7 * DAY) return 'soon';
  return 'normal';
}

const scopeItems = [
  { id: 'open', text: 'Open tenders' },
  { id: '__all__', text: 'All tenders' },
];
const statusItems = [{ id: '__all__', text: 'All statuses' }, ...RFP_STATUSES.map((id) => ({ id, text: RFP_STATUS_LABELS[id] }))];
const formatItems = [{ id: '__all__', text: 'All formats' }, ...RFP_SUBMISSION_FORMATS.map((id) => ({ id, text: RFP_SUBMISSION_FORMAT_LABELS[id] }))];
const goeItems = [
  { id: '__all__', text: 'GOE and private' },
  { id: 'true', text: 'GOE only' },
  { id: 'false', text: 'Private only' },
];

export function RfpsPage() {
  const [rfps, setRfps] = useState<Rfp[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { params: sortParams, headerProps } = useTableSort('deadlineAt', 'asc');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // The register keeps every tender for ever, so it opens on what is live.
  const [scope, setScope] = useState<string>('open');
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [selectedGoe, setSelectedGoe] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editRfp, setEditRfp] = useState<Rfp | null>(null);
  const [deleteRfp, setDeleteRfp] = useState<Rfp | null>(null);
  /**
   * The dossier, opened straight from the table's document count — the
   * documents are the reason to open a tender at all, and reaching them
   * meant opening the edit panel and scrolling to the bottom first.
   */
  const [previewRfp, setPreviewRfp] = useState<{ rfp: Rfp; index: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchRfps = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: String(pageSize), ...sortParams };
      if (debouncedSearch) params.search = debouncedSearch;
      // An explicit status is narrower than the scope, so it replaces it.
      if (selectedStatus) params.status = selectedStatus;
      else if (scope === 'open') params.scope = 'open';
      if (selectedFormat) params.submissionFormat = selectedFormat;
      if (selectedGoe) params.isGoe = selectedGoe;
      const { data: res } = await rfpsApi.getAll(params);
      setRfps(res.data);
      setMeta(res.meta || null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load RFPs' });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, scope, selectedStatus, selectedFormat, selectedGoe, addNotification, sortParams.sortBy, sortParams.sortOrder]);

  useEffect(() => {
    fetchRfps();
  }, [fetchRfps]);

  const handleDelete = async () => {
    if (!deleteRfp) return;
    try {
      await rfpsApi.delete(deleteRfp.id);
      addNotification({ kind: 'success', title: 'RFP deleted' });
      setDeleteRfp(null);
      fetchRfps();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete the RFP' });
    }
  };

  const openCreate = () => {
    setEditRfp(null);
    setPanelOpen(true);
  };

  const openEdit = (rfp: Rfp) => {
    setEditRfp(rfp);
    setPanelOpen(true);
  };

  const activeFilterCount = [selectedStatus, selectedFormat, selectedGoe].filter(Boolean).length + (scope === 'open' ? 0 : 1);
  const hasFilters = activeFilterCount > 0 || Boolean(search);

  return (
    <div>
      <div className="page-header">
        <div className="page-header__info">
          <h1>RFPs</h1>
          <p className="page-header__subtitle">Tenders in flight, their deadlines and their dossiers</p>
        </div>
      </div>

      <TableContainer>
        {loading ? (
          <DataTableSkeleton headers={headers} rowCount={5} />
        ) : (
          <DataTable rows={rfps.map((r) => ({ id: r.id }))} headers={headers}>
            {({ getTableProps }) => (
              <>
                <TableToolbar>
                  <TableToolbarContent>
                    <TableToolbarSearch
                      ref={searchRef}
                      placeholder="Search name, reference or notes"
                      persistent
                      value={search}
                      onChange={(e) => {
                        setSearch(toolbarSearchValue(e));
                        setPage(1);
                      }}
                    />
                    <TableFilterFlyout
                      activeFilterCount={activeFilterCount}
                      onReset={() => {
                        setScope('open');
                        setSelectedStatus(null);
                        setSelectedFormat(null);
                        setSelectedGoe(null);
                        setPage(1);
                      }}
                    >
                      <Dropdown
                        id="rfp-filter-scope"
                        titleText="Show"
                        label="Open tenders"
                        items={scopeItems}
                        itemToString={(item) => item?.text || ''}
                        selectedItem={scopeItems.find((s) => s.id === scope) ?? scopeItems[0]}
                        onChange={({ selectedItem }) => {
                          setScope(selectedItem?.id ?? 'open');
                          setPage(1);
                        }}
                        size="sm"
                      />
                      <Dropdown
                        id="rfp-filter-status"
                        titleText="Status"
                        label="All statuses"
                        items={statusItems}
                        itemToString={(item) => item?.text || ''}
                        selectedItem={statusItems.find((s) => s.id === (selectedStatus ?? '__all__'))}
                        onChange={({ selectedItem }) => {
                          setSelectedStatus(selectedItem?.id === '__all__' ? null : selectedItem?.id ?? null);
                          setPage(1);
                        }}
                        size="sm"
                      />
                      <Dropdown
                        id="rfp-filter-format"
                        titleText="Submission format"
                        label="All formats"
                        items={formatItems}
                        itemToString={(item) => item?.text || ''}
                        selectedItem={formatItems.find((f) => f.id === (selectedFormat ?? '__all__'))}
                        onChange={({ selectedItem }) => {
                          setSelectedFormat(selectedItem?.id === '__all__' ? null : selectedItem?.id ?? null);
                          setPage(1);
                        }}
                        size="sm"
                      />
                      <Dropdown
                        id="rfp-filter-goe"
                        titleText="Buyer"
                        label="GOE and private"
                        items={goeItems}
                        itemToString={(item) => item?.text || ''}
                        selectedItem={goeItems.find((g) => g.id === (selectedGoe ?? '__all__'))}
                        onChange={({ selectedItem }) => {
                          setSelectedGoe(selectedItem?.id === '__all__' ? null : selectedItem?.id ?? null);
                          setPage(1);
                        }}
                        size="sm"
                      />
                    </TableFilterFlyout>
                    <Button renderIcon={Add} onClick={openCreate}>
                      New RFP
                    </Button>
                  </TableToolbarContent>
                </TableToolbar>

                {rfps.length === 0 ? (
                  <EmptyState
                    icon={<Document size={20} />}
                    title="No RFPs"
                    description={hasFilters ? 'No tenders match your filters' : 'Register the first tender to track its deadline and dossier'}
                    action={hasFilters ? undefined : <Button renderIcon={Add} onClick={openCreate}>New RFP</Button>}
                  />
                ) : (
                  <Table {...getTableProps()} size="lg">
                    <TableHead>
                      <TableRow>
                        {headers.map((header) => (
                          <TableHeader key={header.key} {...(header.sortField ? headerProps(header.sortField) : {})}>
                            {header.header}
                          </TableHeader>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rfps.map((rfp) => {
                        const tone = deadlineTone(rfp.deadlineAt, rfp.status);
                        return (
                          <TableRow key={rfp.id}>
                            <TableCell>
                              <span className={`rfp-deadline rfp-deadline--${tone}`}>
                                {format(new Date(rfp.deadlineAt), 'd MMM yyyy')}
                                <span className="rfp-deadline__time">{format(new Date(rfp.deadlineAt), 'HH:mm')}</span>
                              </span>
                            </TableCell>
                            <TableCell>
                              <button type="button" className="rfp-name-cell" onClick={() => openEdit(rfp)}>
                                {rfp.name}
                              </button>
                            </TableCell>
                            <TableCell>
                              {rfp.customer ? (
                                <span
                                  className="customer-name-cell"
                                  onClick={() => navigate(`/customers/${rfp.customer!.id}`)}
                                >
                                  {rfp.customer.name}
                                </span>
                              ) : (
                                <span className="rfp-muted">—</span>
                              )}
                            </TableCell>
                            <TableCell><span className="rfp-reference">{rfp.reference}</span></TableCell>
                            <TableCell>
                              <span className="rfp-format-cell">
                                {RFP_SUBMISSION_FORMAT_LABELS[rfp.submissionFormat]}
                                {rfp.submissionFormat === 'PORTAL' && rfp.portalUrl && (
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    hasIconOnly
                                    renderIcon={Launch}
                                    iconDescription="Open the buyer's portal"
                                    onClick={() => window.open(rfp.portalUrl!, '_blank', 'noopener,noreferrer')}
                                  />
                                )}
                              </span>
                            </TableCell>
                            <TableCell>{rfp.isGoe ? <Tag type="teal" size="sm">GOE</Tag> : <span className="rfp-muted">—</span>}</TableCell>
                            <TableCell>
                              {rfp.isGoe ? formatBudget(rfp.budget) : <span className="rfp-muted">—</span>}
                            </TableCell>
                            <TableCell>
                              <Tag type={RFP_STATUS_TAG_TYPE[rfp.status]} size="sm">{RFP_STATUS_LABELS[rfp.status]}</Tag>
                            </TableCell>
                            <TableCell>
                              {rfp.documents.length > 0 ? (
                                <button
                                  type="button"
                                  className="rfp-doc-count"
                                  title={rfp.documents.map((d) => d.filename).join(', ')}
                                  aria-label={`Preview ${rfp.documents.length} document${rfp.documents.length === 1 ? '' : 's'} of ${rfp.name}`}
                                  onClick={() => setPreviewRfp({ rfp, index: 0 })}
                                >
                                  <Attachment size={16} />
                                  {rfp.documents.length}
                                </button>
                              ) : (
                                <span className="rfp-muted">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="table-row-actions">
                                <Button kind="ghost" size="sm" hasIconOnly renderIcon={Edit} iconDescription={`Edit ${rfp.name}`} onClick={() => openEdit(rfp)} />
                                <Button kind="ghost" size="sm" hasIconOnly renderIcon={TrashCan} iconDescription={`Delete ${rfp.name}`} onClick={() => setDeleteRfp(rfp)} />
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </DataTable>
        )}

        {meta && meta.total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            pageSizes={[10, 20, 50, 100]}
            totalItems={meta.total}
            onChange={({ page: p, pageSize: ps }) => {
              setPage(p);
              setPageSize(ps);
            }}
          />
        )}
      </TableContainer>

      <RfpFormPanel
        open={panelOpen}
        rfp={editRfp}
        onClose={() => {
          setPanelOpen(false);
          setEditRfp(null);
        }}
        onSaved={fetchRfps}
      />

      <AttachmentPreviewModal
        open={previewRfp !== null}
        items={(previewRfp?.rfp.documents ?? []).map((d) => ({
          file: d,
          inlineUrl: rfpsApi.documentInlineUrl(d.rfpId, d.id),
          downloadUrl: rfpsApi.documentUrl(d.rfpId, d.id),
        }))}
        index={previewRfp?.index ?? 0}
        onIndexChange={(index) => setPreviewRfp((p) => (p ? { ...p, index } : p))}
        onClose={() => setPreviewRfp(null)}
      />

      <ConfirmDeleteModal
        open={Boolean(deleteRfp)}
        title={deleteRfp?.name ?? ''}
        entityLabel="RFP"
        consequence={
          deleteRfp && deleteRfp.documents.length > 0
            ? `Its ${deleteRfp.documents.length} document${deleteRfp.documents.length === 1 ? '' : 's'} will be deleted too.`
            : undefined
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteRfp(null)}
      />
    </div>
  );
}
