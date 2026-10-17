import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  ComboBox,
  DataTable,
  DataTableSkeleton,
  Dropdown,
  DismissibleTag,
  FilterableMultiSelect,
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
  TextInput,
  type DataTableSortState,
} from '@carbon/react';
import { Add, Certificate, DocumentPdf } from '@carbon/icons-react';
import { clientReferencesApi } from '../../api/clientReferences';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../shared/EmptyState';
import { openRowOnClick } from '../../utils/rowOpen';
import { toolbarSearchValue } from '../../utils/carbonSearch';
import type { PaginationMeta } from '../../types/api';
import {
  REFERENCE_APPRECIATION_LABELS,
  REFERENCE_DOCUMENT_TYPES,
  REFERENCE_DOCUMENT_TYPE_LABELS,
  REFERENCE_WORK_STATUS_LABELS,
  formatAmount,
  parseAmount,
  projectPeriod,
  referenceYear,
  type ClientReference,
  type ReferenceFacets,
} from '../../types/clientReference';

/**
 * The References tab: every attestation a customer signed, searchable the
 * way a tender asks — "Power references above a million HT in the last three
 * years, with the signer's role and a word of satisfaction".
 *
 * The filters are a bar, not a flyout: a bid team sets three or four at once
 * and needs to see which are on. They live in the URL, so the detail page's
 * way back, a bookmark or a link to a colleague lands on the same list. Each
 * applies as it is set (Carbon's "instant update" filtering), and each shows
 * as a tag that removes it, with one "Clear filters" for all.
 */

/** URL key → API parameter. */
const FILTER_KEYS = ['q', 'tags', 'services', 'min', 'since', 'appreciation', 'signer', 'type', 'status', 'company', 'partner', 'review'] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

const PERIOD_ITEMS = [
  { id: '', text: 'Any time' },
  { id: '3', text: 'Last 3 years' },
  { id: '5', text: 'Last 5 years' },
  { id: '10', text: 'Last 10 years' },
];
const APPRECIATION_ITEMS = [
  { id: '', text: 'Any appreciation' },
  { id: 'SATISFACTION', text: 'Satisfaction expressed' },
  { id: 'POSITIVE', text: 'Satisfaction or good execution' },
  { id: 'NONE', text: 'No appreciation' },
];
const SIGNER_ITEMS = [
  { id: '', text: 'Any signer' },
  { id: 'role', text: "Signer's role stated" },
];
const TYPE_ITEMS = [{ id: '', text: 'All documents' }, ...REFERENCE_DOCUMENT_TYPES.map((t) => ({ id: t, text: REFERENCE_DOCUMENT_TYPE_LABELS[t] }))];
const STATUS_ITEMS = [
  { id: '', text: 'Completed or in progress' },
  { id: 'COMPLETED', text: 'Completed' },
  { id: 'IN_PROGRESS', text: 'In progress' },
];
const REVIEW_ITEMS = [
  { id: '', text: 'Reviewed or not' },
  { id: 'true', text: 'To review' },
  { id: 'false', text: 'Reviewed' },
];

const headers = [
  { key: 'customer', header: 'Customer', sortField: 'customerName' },
  { key: 'project', header: 'Project', sortField: 'projectName' },
  { key: 'amount', header: 'Amount', sortField: 'amountHt' },
  { key: 'year', header: 'Year', sortField: 'effectiveDate' },
  { key: 'appreciation', header: 'Appreciation' },
  { key: 'technologies', header: 'Technologies' },
  { key: 'flags', header: '' },
];

const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

/** The API's parameters for the filters in the URL. */
export function apiParams(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  const get = (k: FilterKey) => params.get(k) ?? '';
  if (get('q')) out.search = get('q');
  if (get('tags')) out.tags = get('tags');
  if (get('services')) out.services = get('services');
  const min = parseAmount(get('min'));
  if (typeof min === 'number') out.minAmount = String(min);
  if (get('since')) out.sinceYears = get('since');
  if (get('appreciation')) out.appreciation = get('appreciation');
  if (get('signer') === 'role') out.signerRole = 'true';
  if (get('type')) out.documentType = get('type');
  if (get('status')) out.workStatus = get('status');
  if (get('company')) out.customerId = get('company');
  if (get('partner')) out.partner = get('partner');
  if (get('review')) out.needsReview = get('review');
  if (params.get('sort')) out.sortBy = params.get('sort')!;
  if (params.get('order')) out.sortOrder = params.get('order')!;
  return out;
}

function AppreciationTag({ value }: { value: ClientReference['appreciation'] }) {
  if (value === 'NONE') return <span className="references-muted">—</span>;
  return (
    <Tag size="sm" type={value === 'SATISFACTION' ? 'green' : 'cool-gray'}>
      {REFERENCE_APPRECIATION_LABELS[value]}
    </Tag>
  );
}

/** What sets a row apart from a plain, reviewed, completed attestation. */
function Flags({ reference }: { reference: ClientReference }) {
  return (
    <span className="references-flags">
      {reference.documentType !== 'ATTESTATION_REFERENCE' && (
        <Tag size="sm" type={reference.documentType === 'ATTESTATION_EXECUTION' ? 'cool-gray' : 'warm-gray'}>
          {REFERENCE_DOCUMENT_TYPE_LABELS[reference.documentType]}
        </Tag>
      )}
      {reference.workStatus === 'IN_PROGRESS' && (
        <Tag size="sm" type="blue">
          {REFERENCE_WORK_STATUS_LABELS.IN_PROGRESS}
        </Tag>
      )}
      {reference.consortiumPartners.length > 0 && (
        <Tag size="sm" type="purple" title={`With ${reference.consortiumPartners.join(', ')}`}>
          Consortium
        </Tag>
      )}
      {reference.needsReview && (
        <Tag size="sm" type="magenta">
          To review
        </Tag>
      )}
      {reference.hasDocument && (
        <span className="references-flags__doc" title={reference.documentFilename ?? 'Document'} aria-label="Has a document">
          <DocumentPdf size={16} />
        </span>
      )}
    </span>
  );
}

export function ReferencesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const [rows, setRows] = useState<ClientReference[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [facets, setFacets] = useState<ReferenceFacets | null>(null);
  // Typed text is kept here and written to the URL after a pause: a request
  // per keystroke, and a history entry per keystroke, is no way to search.
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const [minAmount, setMinAmount] = useState(() => params.get('min') ?? '');

  const page = Number(params.get('page') ?? '1') || 1;
  const pageSize = Number(params.get('size') ?? '50') || 50;
  const query = useMemo(() => apiParams(params), [params]);
  const queryKey = JSON.stringify(query);

  const update = useCallback(
    (changes: Partial<Record<FilterKey | 'page' | 'size' | 'sort' | 'order', string | null>>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v) next.set(k, v);
            else next.delete(k);
          }
          // A new filter starts the list again.
          if (!('page' in changes)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== search) update({ q: search.trim() ? search : null });
    }, 300);
    return () => clearTimeout(t);
  }, [search, params, update]);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('min') ?? '') !== minAmount && parseAmount(minAmount) !== undefined) update({ min: minAmount.trim() || null });
    }, 400);
    return () => clearTimeout(t);
  }, [minAmount, params, update]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await clientReferencesApi.getAll({ ...JSON.parse(queryKey), page: String(page), limit: String(pageSize) });
      setRows(res.data);
      setMeta(res.meta ?? null);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load references' });
    } finally {
      setLoading(false);
    }
  }, [queryKey, page, pageSize, addNotification]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    clientReferencesApi
      .getFacets()
      .then(({ data: res }) => setFacets(res.data))
      .catch(() => {
        /* the filters still work; they only lack their counts */
      });
  }, []);

  const tags = csv(params.get('tags'));
  const services = csv(params.get('services'));
  const tagItems = (facets?.technologyTags ?? []).filter((t) => t.count > 0 || tags.includes(t.tag));
  const serviceItems = (facets?.prestationTags ?? []).filter((t) => t.count > 0 || services.includes(t.tag));
  const companyItems = facets?.companies ?? [];
  const partnerItems = [{ id: '', text: 'Any partner' }, ...(facets?.partners ?? []).map((p) => ({ id: p.name, text: `${p.name} (${p.count})` }))];

  const sortBy = params.get('sort') ?? 'amountHt';
  const sortOrder = params.get('order') ?? (sortBy === 'customerName' || sortBy === 'projectName' ? 'asc' : 'desc');
  const sortProps = (field: string) => ({
    isSortable: true,
    isSortHeader: sortBy === field,
    sortDirection: (sortBy === field ? (sortOrder === 'asc' ? 'ASC' : 'DESC') : 'NONE') as DataTableSortState,
    onClick: () => {
      if (sortBy !== field) update({ sort: field, order: null });
      else update({ order: sortOrder === 'asc' ? 'desc' : 'asc' });
    },
  });

  const open = (id: string) => navigate(`/references/${id}`, { state: { query, back: `/deals?${params.toString()}` } });

  /** Applied filters, each a tag that removes it. */
  const applied: Array<{ key: string; label: string; clear: () => void }> = [];
  if (params.get('q')) applied.push({ key: 'q', label: `“${params.get('q')}”`, clear: () => { setSearch(''); update({ q: null }); } });
  for (const t of tags) applied.push({ key: `tag-${t}`, label: t, clear: () => update({ tags: tags.filter((x) => x !== t).join(',') || null }) });
  for (const s of services) applied.push({ key: `svc-${s}`, label: s, clear: () => update({ services: services.filter((x) => x !== s).join(',') || null }) });
  if (params.get('min')) applied.push({ key: 'min', label: `≥ ${formatAmount(parseAmount(params.get('min')!) ?? null)} HT`, clear: () => { setMinAmount(''); update({ min: null }); } });
  const pick = (items: Array<{ id: string; text: string }>, key: FilterKey) => {
    const v = params.get(key);
    const item = v ? items.find((i) => i.id === v) : undefined;
    if (item) applied.push({ key, label: item.text, clear: () => update({ [key]: null }) });
  };
  pick(PERIOD_ITEMS, 'since');
  pick(APPRECIATION_ITEMS, 'appreciation');
  pick(SIGNER_ITEMS, 'signer');
  pick(TYPE_ITEMS, 'type');
  pick(STATUS_ITEMS, 'status');
  pick(REVIEW_ITEMS, 'review');
  pick(partnerItems, 'partner');
  const company = companyItems.find((c) => c.id === params.get('company'));
  if (params.get('company')) applied.push({ key: 'company', label: company?.name ?? 'Company', clear: () => update({ company: null }) });

  const clearAll = () => {
    setSearch('');
    setMinAmount('');
    update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
  };

  const dropdown = (id: string, key: FilterKey, items: Array<{ id: string; text: string }>, title: string) => (
    <Dropdown
      id={id}
      titleText={title}
      label={items[0].text}
      size="sm"
      items={items}
      itemToString={(i) => i?.text ?? ''}
      selectedItem={items.find((i) => i.id === (params.get(key) ?? '')) ?? items[0]}
      onChange={({ selectedItem }) => update({ [key]: selectedItem?.id || null })}
    />
  );

  return (
    <div className="references-page">
      <TableContainer>
        <TableToolbar>
          <TableToolbarContent>
            <TableToolbarSearch
              persistent
              placeholder="Search customer, project, technology, signer…"
              value={search}
              onChange={(e) => setSearch(toolbarSearchValue(e))}
            />
            <Button renderIcon={Add} onClick={() => navigate('/references/new', { state: { back: `/deals?${params.toString()}` } })}>
              New reference
            </Button>
          </TableToolbarContent>
        </TableToolbar>

        <div className="references-filters" role="group" aria-label="Filters">
          <FilterableMultiSelect
            id="ref-filter-tags"
            titleText="Technologies"
            placeholder="Any technology"
            size="sm"
            items={tagItems}
            itemToString={(i) => (i ? `${i.tag} (${i.count})` : '')}
            selectedItems={tagItems.filter((t) => tags.includes(t.tag))}
            onChange={({ selectedItems }) => update({ tags: selectedItems.map((s) => s.tag).join(',') || null })}
            selectionFeedback="top-after-reopen"
          />
          <TextInput
            id="ref-filter-min"
            labelText="Minimum amount (HT)"
            placeholder="1 000 000"
            size="sm"
            inputMode="decimal"
            autoComplete="off"
            value={minAmount}
            invalid={parseAmount(minAmount) === undefined}
            invalidText="Not an amount"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMinAmount(e.target.value)}
          />
          {dropdown('ref-filter-since', 'since', PERIOD_ITEMS, 'Period (project end)')}
          {dropdown('ref-filter-appreciation', 'appreciation', APPRECIATION_ITEMS, 'Appreciation')}
          {dropdown('ref-filter-signer', 'signer', SIGNER_ITEMS, 'Signer')}
          {dropdown('ref-filter-type', 'type', TYPE_ITEMS, 'Document')}
          <FilterableMultiSelect
            id="ref-filter-services"
            titleText="Services"
            placeholder="Any service"
            size="sm"
            items={serviceItems}
            itemToString={(i) => (i ? `${i.tag} (${i.count})` : '')}
            selectedItems={serviceItems.filter((t) => services.includes(t.tag))}
            onChange={({ selectedItems }) => update({ services: selectedItems.map((s) => s.tag).join(',') || null })}
            selectionFeedback="top-after-reopen"
          />
          <ComboBox
            id="ref-filter-company"
            titleText="Company"
            placeholder="Any company"
            size="sm"
            items={companyItems}
            itemToString={(c) => (c ? `${c.name} (${c.count})` : '')}
            selectedItem={company ?? null}
            onChange={({ selectedItem }: { selectedItem?: (typeof companyItems)[number] | null }) => update({ company: selectedItem?.id ?? null })}
          />
          {dropdown('ref-filter-partner', 'partner', partnerItems, 'Partner')}
          {dropdown('ref-filter-status', 'status', STATUS_ITEMS, 'Status')}
          {dropdown('ref-filter-review', 'review', REVIEW_ITEMS, 'Review')}
        </div>

        <div className="references-applied" aria-live="polite">
          <span className="references-applied__count">
            {meta ? `${meta.total} reference${meta.total === 1 ? '' : 's'}` : ''}
            {facets && facets.needsReview > 0 && !params.get('review') && (
              <>
                {' · '}
                <button type="button" className="references-applied__review" onClick={() => update({ review: 'true' })}>
                  {facets.needsReview} to review
                </button>
              </>
            )}
          </span>
          {applied.map((a) => (
            <DismissibleTag key={a.key} type="high-contrast" size="sm" text={a.label} title={`Remove ${a.label}`} onClose={a.clear} />
          ))}
          {applied.length > 0 && (
            <Button kind="ghost" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          )}
        </div>

        {loading ? (
          <DataTableSkeleton headers={headers} rowCount={8} showToolbar={false} showHeader={false} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Certificate size={20} />}
            title="No references"
            description={applied.length > 0 ? 'No reference matches these filters' : 'Add the first attestation a customer signed'}
            action={applied.length > 0 ? <Button kind="tertiary" onClick={clearAll}>Clear filters</Button> : undefined}
          />
        ) : (
          <DataTable rows={rows.map((r) => ({ id: r.id }))} headers={headers}>
            {({ getTableProps }) => (
              <Table {...getTableProps()} size="lg" className="references-table">
                <TableHead>
                  <TableRow>
                    {headers.map((h) => (
                      <TableHeader key={h.key} {...(h.sortField ? sortProps(h.sortField) : {})}>
                        {h.header}
                      </TableHeader>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="table-row--clickable" onClick={openRowOnClick(() => open(r.id))}>
                      <TableCell>
                        <button type="button" className="table-title-button references-customer" onClick={() => open(r.id)}>
                          {r.customerName}
                        </button>
                        {r.city && <span className="references-secondary">{r.city}</span>}
                      </TableCell>
                      <TableCell>
                        <span className="references-project" title={r.projectName ?? undefined}>
                          {r.projectName ?? '—'}
                        </span>
                        {r.projectReference && <span className="references-secondary">{r.projectReference}</span>}
                      </TableCell>
                      <TableCell className="references-amount-cell">
                        <span className="references-amount">{formatAmount(r.amount, r.currency)}</span>
                        <span className="references-secondary">
                          {r.amount === null ? '' : r.amountType ?? 'HT/TTC not stated'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span title={`Project ${projectPeriod(r)}${r.signedAt ? ` · signed ${r.signedAt.split('-').reverse().join('/')}` : ''}`}>
                          {referenceYear(r)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <AppreciationTag value={r.appreciation} />
                      </TableCell>
                      <TableCell>
                        <span className="references-tags">
                          {r.technologyTags
                            .filter((t) => !/^IBM Power \d+$/.test(t))
                            .slice(0, 3)
                            .map((t) => (
                              <Tag key={t} size="sm" type="outline">
                                {t}
                              </Tag>
                            ))}
                          {r.technologyTags.filter((t) => !/^IBM Power \d+$/.test(t)).length > 3 && (
                            <span className="references-secondary">+{r.technologyTags.filter((t) => !/^IBM Power \d+$/.test(t)).length - 3}</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Flags reference={r} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </DataTable>
        )}

        {meta && meta.total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            pageSizes={[20, 50, 100]}
            totalItems={meta.total}
            onChange={({ page: p, pageSize: ps }) => update({ page: p > 1 ? String(p) : null, size: ps !== 50 ? String(ps) : null })}
          />
        )}
      </TableContainer>
    </div>
  );
}
