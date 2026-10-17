import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Dropdown,
  FileUploaderDropContainer,
  IconButton,
  InlineNotification,
  Modal,
  OverflowMenu,
  OverflowMenuItem,
  RadioButton,
  RadioButtonGroup,
  SkeletonText,
  Tag,
  TextArea,
  TextInput,
  Toggle,
} from '@carbon/react';
import { Add, ChevronLeft, ChevronRight, Launch, TrashCan, Upload } from '@carbon/icons-react';
import { clientReferencesApi } from '../../api/clientReferences';
import { useUIStore } from '../../store/uiStore';
import { PageHeader } from '../shared/PageHeader';
import { EmptyState } from '../shared/EmptyState';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import {
  REFERENCE_APPRECIATIONS,
  REFERENCE_APPRECIATION_HELP,
  REFERENCE_APPRECIATION_LABELS,
  REFERENCE_DOCUMENT_TYPES,
  REFERENCE_DOCUMENT_TYPE_LABELS,
  REFERENCE_WORK_STATUSES,
  REFERENCE_WORK_STATUS_LABELS,
  formatAmount,
  parseAmount,
  type ClientReference,
  type ReferenceAmountType,
} from '../../types/clientReference';
import { EMPTY_FORM, changedInput, formErrors, signatoryKey, toForm, toInput, type ReferenceForm } from './referenceForm';

const ACCEPT = ['application/pdf', 'image/png', 'image/jpeg'];
const AMOUNT_TYPE_ITEMS: Array<{ id: ReferenceAmountType | ''; text: string }> = [
  { id: 'TTC', text: 'TTC' },
  { id: 'HT', text: 'HT' },
  { id: '', text: 'Not stated' },
];

interface LocationState {
  /** The list's query, to step through the same references in the same order. */
  query?: Record<string, string>;
  /** Where "References" goes back to — the list with its filters. */
  back?: string;
}

/**
 * One reference, corrected beside its document: the fields on the left, the
 * signed letter on the right, so every value can be checked against the page
 * it came from without leaving it. Previous and Next step through the list
 * the user came from, in its order — reviewing an import is a run of these,
 * so each step saves what was changed first.
 *
 * `/references/new` is the same page for a letter not yet in the register:
 * the file is chosen on the right and uploaded once the reference exists.
 */
export function ReferenceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const backTo = state.back ?? '/deals?tab=references';
  const addNotification = useUIStore((s) => s.addNotification);

  const [reference, setReference] = useState<ClientReference | null>(null);
  const [base, setBase] = useState<ReferenceForm>(EMPTY_FORM);
  const [form, setForm] = useState<ReferenceForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [ids, setIds] = useState<string[] | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The router reuses this component from one reference to the next: a load
  // that resolves after a newer one began must not land on screen.
  const loadSeq = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    if (!id || isNew) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setDeleteOpen(false);
    setLeaveTo(null);
    try {
      const { data: res } = await clientReferencesApi.getById(id);
      if (seq !== loadSeq.current) return;
      setReference(res.data);
      const f = toForm(res.data);
      setBase(f);
      setForm(f);
      setNotFound(false);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (isAxiosError(err) && err.response?.status === 404) setNotFound(true);
      else addNotification({ kind: 'error', title: 'Failed to load the reference' });
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [id, isNew, addNotification]);

  useEffect(() => {
    if (isNew) {
      setReference(null);
      setBase(EMPTY_FORM);
      setForm(EMPTY_FORM);
      setLoading(false);
      return;
    }
    load();
  }, [isNew, load]);

  // The list's order, fetched once per list: Previous and Next walk it.
  const queryKey = JSON.stringify(state.query ?? null);
  useEffect(() => {
    if (!state.query) return;
    clientReferencesApi
      .getIds(JSON.parse(queryKey))
      .then(({ data: res }) => setIds(res.data))
      .catch(() => setIds(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  useEffect(() => {
    if (!pendingFile) return;
    const url = URL.createObjectURL(pendingFile);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const errors = useMemo(() => formErrors(form), [form]);
  const valid = Object.keys(errors).length === 0;
  const changes = useMemo(() => (valid && !isNew ? changedInput(form, base) : {}), [valid, isNew, form, base]);
  const dirty = isNew ? JSON.stringify(form) !== JSON.stringify(EMPTY_FORM) || pendingFile !== null : JSON.stringify(form) !== JSON.stringify(base);

  // Closing the tab with unsaved corrections asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof ReferenceForm>(key: K, value: ReferenceForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  /** Save what changed. Resolves to whether the reference is now saved. */
  const save = useCallback(async (): Promise<boolean> => {
    // One save at a time: a second ⌘S during the first would create the
    // reference twice, or send two overlapping PATCHes.
    if (savingRef.current) return false;
    if (!valid) {
      addNotification({ kind: 'error', title: 'Some fields need correcting', subtitle: Object.values(errors)[0] });
      return false;
    }
    if (!isNew && Object.keys(changes).length === 0) return true;
    savingRef.current = true;
    setSaving(true);
    const snapshot = form;
    try {
      if (isNew) {
        const { data: res } = await clientReferencesApi.create(toInput(form));
        let created = res.data;
        if (pendingFile) {
          try {
            created = (await clientReferencesApi.uploadDocument(created.id, pendingFile)).data.data;
          } catch {
            addNotification({ kind: 'error', title: 'Reference saved, but the document did not upload', subtitle: 'Add it again from the reference.' });
          }
        }
        addNotification({ kind: 'success', title: 'Reference added' });
        setBase(form);
        setPendingFile(null);
        setPendingUrl(null);
        navigate(`/references/${created.id}`, { replace: true, state });
        return true;
      }
      const { data: res } = await clientReferencesApi.update(reference!.id, changes);
      setReference(res.data);
      const f = toForm(res.data);
      setBase(f);
      // The saved row, plus whatever was typed while the request was out.
      setForm((current) => (current === snapshot ? f : rebase(f, snapshot, current)));
      addNotification({ kind: 'success', title: 'Reference saved' });
      return true;
    } catch (err) {
      const message = isAxiosError(err) ? err.response?.data?.error?.message : undefined;
      addNotification({ kind: 'error', title: 'Failed to save the reference', subtitle: message });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [valid, errors, isNew, changes, form, pendingFile, reference, navigate, state, addNotification]);

  // ⌘S / Ctrl+S saves, as anywhere else one edits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!e.repeat) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const position = ids && reference ? ids.indexOf(reference.id) : -1;
  const prevId = position > 0 ? ids![position - 1] : null;
  const nextId = position >= 0 && position < ids!.length - 1 ? ids![position + 1] : null;

  /** Step to a neighbour, saving the corrections made here first. */
  const step = async (to: string | null) => {
    if (!to) return;
    if (dirty && !(await save())) return;
    navigate(`/references/${to}`, { state });
  };

  /** Leave for somewhere else; unsaved corrections ask first. */
  const leave = (to: string) => {
    if (dirty) setLeaveTo(to);
    else navigate(to);
  };

  const accept = (file: File | undefined) => {
    if (!file) return null;
    if (!ACCEPT.includes(file.type)) {
      addNotification({ kind: 'error', title: 'A PDF or an image of the letter, please', subtitle: file.name });
      return null;
    }
    return file;
  };

  const replaceDocument = async (picked: File | undefined) => {
    const file = accept(picked);
    if (!file) return;
    if (isNew) {
      setPendingFile(file);
      return;
    }
    const forId = reference!.id;
    setUploading(true);
    try {
      const { data: res } = await clientReferencesApi.uploadDocument(forId, file);
      // Only the document's fields — the form may hold unsaved corrections —
      // and only if this is still the reference on screen.
      setReference((r) => (r && r.id === forId ? { ...r, ...pickDocument(res.data) } : r));
      addNotification({ kind: 'success', title: 'Document replaced' });
    } catch (err) {
      const message = isAxiosError(err) ? err.response?.data?.error?.message : undefined;
      addNotification({ kind: 'error', title: 'Failed to upload the document', subtitle: message });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!reference) return;
    try {
      await clientReferencesApi.delete(reference.id);
      addNotification({ kind: 'success', title: 'Reference deleted' });
      setDeleteOpen(false);
      navigate(backTo);
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete the reference' });
    }
  };

  if (loading) {
    return (
      <div className="reference-detail">
        <SkeletonText heading width="40%" />
        <SkeletonText paragraph lineCount={6} />
      </div>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        title="Reference not found"
        description="It may have been deleted."
        action={<Button onClick={() => navigate(backTo)}>Back to references</Button>}
      />
    );
  }

  const previewUrl = isNew
    ? pendingUrl
    : reference?.hasDocument
      ? clientReferencesApi.documentInlineUrl(reference.id, reference.documentUploadedAt)
      : null;
  const amountHt = (() => {
    const a = parseAmount(form.amount);
    if (typeof a !== 'number') return null;
    return form.amountType === 'TTC' ? Math.round((a / 1.2) * 100) / 100 : a;
  })();

  return (
    <div className="reference-detail">
      {/* Not PageHeader's breadcrumbs: those navigate at once, and leaving
          with unsaved corrections must ask first. */}
      <Breadcrumb noTrailingSlash className="page-header__breadcrumb">
        <BreadcrumbItem
          href={backTo}
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            leave(backTo);
          }}
        >
          References
        </BreadcrumbItem>
      </Breadcrumb>
      <PageHeader
        title={isNew ? 'New reference' : form.customerName || reference?.customerName || 'Reference'}
        subtitle={isNew ? 'The customer’s attestation, and the letter itself' : reference?.projectName ?? undefined}
        actions={
          <div className="reference-detail__actions">
            {ids && position >= 0 && (
              <span className="reference-detail__stepper">
                <IconButton
                  kind="ghost"
                  size="md"
                  label={dirty ? 'Save and open the previous' : 'Previous reference'}
                  autoAlign
                  disabled={!prevId || saving || uploading}
                  onClick={() => step(prevId)}
                >
                  <ChevronLeft />
                </IconButton>
                <span className="reference-detail__position">
                  {position + 1} of {ids.length}
                </span>
                <IconButton
                  kind="ghost"
                  size="md"
                  label={dirty ? 'Save and open the next' : 'Next reference'}
                  autoAlign
                  disabled={!nextId || saving || uploading}
                  onClick={() => step(nextId)}
                >
                  <ChevronRight />
                </IconButton>
              </span>
            )}
            <Button kind="primary" size="md" disabled={saving || (!isNew && !dirty)} onClick={() => void save()}>
              {saving ? 'Saving…' : isNew ? 'Add reference' : 'Save'}
            </Button>
            {!isNew && (
              <OverflowMenu flipped size="md" iconDescription="More actions">
                {[
                  ...(reference?.hasDocument
                    ? [<OverflowMenuItem key="download" itemText="Download document" onClick={() => window.open(clientReferencesApi.documentUrl(reference.id), '_blank', 'noopener')} />]
                    : []),
                  <OverflowMenuItem key="delete" itemText="Delete reference" isDelete hasDivider onClick={() => setDeleteOpen(true)} />,
                ]}
              </OverflowMenu>
            )}
          </div>
        }
      />
      <div className="reference-detail__split">
        <form
          className="reference-form"
          aria-label="Reference"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {form.needsReview && (
            <InlineNotification
              kind="warning"
              lowContrast
              hideCloseButton
              title="To review"
              subtitle={form.reviewNotes ? 'Check against the document the points below, then switch "To review" off.' : 'Check the fields against the document, then switch "To review" off.'}
            />
          )}

          <section className="reference-form__section" aria-labelledby="ref-sec-document">
            <h2 id="ref-sec-document" className="reference-form__heading">Document</h2>
            <div className="reference-form__row">
              <Dropdown
                id="ref-type"
                titleText="Type"
                label=""
                items={REFERENCE_DOCUMENT_TYPES as unknown as string[]}
                itemToString={(t) => (t ? REFERENCE_DOCUMENT_TYPE_LABELS[t as keyof typeof REFERENCE_DOCUMENT_TYPE_LABELS] : '')}
                selectedItem={form.documentType}
                onChange={({ selectedItem }) => selectedItem && set('documentType', selectedItem as ReferenceForm['documentType'])}
              />
              <Dropdown
                id="ref-status"
                titleText="Status"
                label=""
                items={REFERENCE_WORK_STATUSES as unknown as string[]}
                itemToString={(t) => (t ? REFERENCE_WORK_STATUS_LABELS[t as keyof typeof REFERENCE_WORK_STATUS_LABELS] : '')}
                selectedItem={form.workStatus}
                onChange={({ selectedItem }) => selectedItem && set('workStatus', selectedItem as ReferenceForm['workStatus'])}
              />
            </div>
            <Toggle
              id="ref-review"
              labelText="To review"
              labelA="No"
              labelB="Yes"
              size="sm"
              toggled={form.needsReview}
              onToggle={(on: boolean) => set('needsReview', on)}
            />
            {(form.needsReview || form.reviewNotes) && (
              <TextArea id="ref-review-notes" labelText="What to check" rows={3} value={form.reviewNotes} onChange={(e) => set('reviewNotes', e.target.value)} />
            )}
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-customer">
            <h2 id="ref-sec-customer" className="reference-form__heading">Customer</h2>
            <TextInput
              id="ref-customer"
              labelText="Customer, as the letter names it"
              value={form.customerName}
              invalid={Boolean(errors.customerName)}
              invalidText={errors.customerName}
              onChange={(e) => set('customerName', e.target.value)}
            />
            <div className="reference-form__row">
              <CompanyComboBox id="ref-company" titleText="Company in Mailviz" size="md" selectedId={form.customerId} onChange={(cid) => set('customerId', cid)} />
              <TextInput id="ref-city" labelText="City" value={form.city} onChange={(e) => set('city', e.target.value)} />
            </div>
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-project">
            <h2 id="ref-sec-project" className="reference-form__heading">Project</h2>
            <TextArea id="ref-project" labelText="Project name" rows={3} value={form.projectName} onChange={(e) => set('projectName', e.target.value)} />
            <div className="reference-form__row">
              <TextInput
                id="ref-project-reference"
                labelText="Project reference"
                helperText="Market, contract or order number"
                value={form.projectReference}
                onChange={(e) => set('projectReference', e.target.value)}
              />
              <TextInput id="ref-attestation-number" labelText="Attestation n°" value={form.attestationNumber} onChange={(e) => set('attestationNumber', e.target.value)} />
            </div>
            <div className="reference-form__row reference-form__row--dates">
              <TextInput
                id="ref-start"
                labelText="Project start"
                placeholder="2025 · 07/2025 · 30/07/2025"
                value={form.projectStart}
                invalid={Boolean(errors.projectStart)}
                invalidText={errors.projectStart}
                onChange={(e) => set('projectStart', e.target.value)}
              />
              <TextInput
                id="ref-end"
                labelText="Project end"
                placeholder="As precise as the letter"
                value={form.projectEnd}
                invalid={Boolean(errors.projectEnd)}
                invalidText={errors.projectEnd}
                onChange={(e) => set('projectEnd', e.target.value)}
              />
            </div>
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-amount">
            <h2 id="ref-sec-amount" className="reference-form__heading">Amount</h2>
            <div className="reference-form__row reference-form__row--amount">
              <TextInput
                id="ref-amount"
                labelText="Amount"
                placeholder="1 500 000,00"
                inputMode="decimal"
                autoComplete="off"
                value={form.amount}
                invalid={Boolean(errors.amount)}
                invalidText={errors.amount}
                helperText={amountHt !== null && form.amountType === 'TTC' ? `≈ ${formatAmount(amountHt, form.currency)} HT` : undefined}
                onChange={(e) => set('amount', e.target.value)}
              />
              <Dropdown
                id="ref-amount-type"
                titleText="HT / TTC"
                label=""
                items={AMOUNT_TYPE_ITEMS}
                itemToString={(i) => i?.text ?? ''}
                selectedItem={AMOUNT_TYPE_ITEMS.find((i) => i.id === form.amountType)}
                onChange={({ selectedItem }) => set('amountType', selectedItem?.id ?? '')}
              />
              <TextInput
                id="ref-currency"
                labelText="Currency"
                maxLength={3}
                value={form.currency}
                invalid={Boolean(errors.currency)}
                invalidText={errors.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
              />
            </div>
            <TextInput
              id="ref-amount-scope"
              labelText="What the amount covers"
              placeholder="Project total, turnover over the period, lot 1, consortium total…"
              value={form.amountScope}
              onChange={(e) => set('amountScope', e.target.value)}
            />
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-signature">
            <h2 id="ref-sec-signature" className="reference-form__heading">Signature</h2>
            <div className="reference-form__row">
              <TextInput
                id="ref-signed-at"
                labelText="Signed on"
                placeholder="17/09/2026"
                helperText="Not the certified-copy stamp's date"
                value={form.signedAt}
                invalid={Boolean(errors.signedAt)}
                invalidText={errors.signedAt}
                onChange={(e) => set('signedAt', e.target.value)}
              />
              <TextInput id="ref-signed-place" labelText="Signed at" placeholder="Casablanca" value={form.signedPlace} onChange={(e) => set('signedPlace', e.target.value)} />
            </div>
            <fieldset className="reference-form__signatories">
              <legend className="cds--label">Signed by</legend>
              {form.signatories.map((s, i) => (
                <div key={s.key} className="reference-form__signatory">
                  <TextInput
                    id={`ref-signer-name-${s.key}`}
                    labelText="Name"
                    hideLabel={i > 0}
                    placeholder="Name"
                    value={s.name}
                    onChange={(e) => set('signatories', form.signatories.map((x) => (x.key === s.key ? { ...x, name: e.target.value } : x)))}
                  />
                  <TextInput
                    id={`ref-signer-role-${s.key}`}
                    labelText="Role"
                    hideLabel={i > 0}
                    placeholder="Role, as written"
                    value={s.role}
                    onChange={(e) => set('signatories', form.signatories.map((x) => (x.key === s.key ? { ...x, role: e.target.value } : x)))}
                  />
                  <IconButton
                    kind="ghost"
                    size="md"
                    label={`Remove ${s.name || 'this signatory'}`}
                    autoAlign
                    onClick={() => set('signatories', form.signatories.filter((x) => x.key !== s.key))}
                  >
                    <TrashCan />
                  </IconButton>
                </div>
              ))}
              <Button
                kind="ghost"
                size="sm"
                renderIcon={Add}
                onClick={() => set('signatories', [...form.signatories, { key: signatoryKey(), name: '', role: '' }])}
              >
                Add signatory
              </Button>
            </fieldset>
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-appreciation">
            <h2 id="ref-sec-appreciation" className="reference-form__heading">Appreciation</h2>
            <RadioButtonGroup
              legendText="What the customer says of the work"
              name="ref-appreciation"
              orientation="vertical"
              valueSelected={form.appreciation}
              onChange={(v) => set('appreciation', v as ReferenceForm['appreciation'])}
            >
              {REFERENCE_APPRECIATIONS.map((a) => (
                <RadioButton key={a} id={`ref-appreciation-${a}`} value={a} labelText={`${REFERENCE_APPRECIATION_LABELS[a]} — ${REFERENCE_APPRECIATION_HELP[a]}`} />
              ))}
            </RadioButtonGroup>
            <TextArea
              id="ref-appreciation-quote"
              labelText="The customer's words"
              rows={3}
              value={form.appreciationQuote}
              onChange={(e) => set('appreciationQuote', e.target.value)}
            />
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-scope">
            <h2 id="ref-sec-scope" className="reference-form__heading">Scope</h2>
            <TextArea
              id="ref-technologies"
              labelText="Technologies, one per line"
              rows={Math.min(14, Math.max(4, form.technologies.split('\n').length + 1))}
              value={form.technologies}
              onChange={(e) => set('technologies', e.target.value)}
            />
            <StandardTags label="Standard tags" tags={reference?.technologyTags ?? []} />
            <TextArea
              id="ref-prestations"
              labelText="Services, one per line"
              rows={Math.min(10, Math.max(3, form.prestations.split('\n').length + 1))}
              value={form.prestations}
              onChange={(e) => set('prestations', e.target.value)}
            />
            <StandardTags label="Standard services" tags={reference?.prestationTags ?? []} />
            <div className="reference-form__row">
              <TextInput
                id="ref-partners"
                labelText="Technology partners"
                placeholder="IBM, Red Hat"
                helperText="Separated by commas"
                value={form.partners}
                onChange={(e) => set('partners', e.target.value)}
              />
              <TextInput
                id="ref-consortium"
                labelText="Consortium partners"
                placeholder="Corporate Software"
                helperText="Credited together with Power Maroc"
                value={form.consortiumPartners}
                onChange={(e) => set('consortiumPartners', e.target.value)}
              />
            </div>
          </section>

          <section className="reference-form__section" aria-labelledby="ref-sec-details">
            <h2 id="ref-sec-details" className="reference-form__heading">Other details</h2>
            <TextArea
              id="ref-details"
              labelText="Lots, sizing, sites, contract and reception dates, the customer's legal ids…"
              rows={Math.min(12, Math.max(4, form.details.split('\n').length + 1))}
              value={form.details}
              onChange={(e) => set('details', e.target.value)}
            />
          </section>
        </form>

        <aside className="reference-preview" aria-label="Document">
          <div className="reference-preview__bar">
            <span className="reference-preview__name" title={reference?.documentFilename ?? pendingFile?.name ?? undefined}>
              {reference?.documentFilename ?? pendingFile?.name ?? 'No document yet'}
            </span>
            <Button kind="ghost" size="sm" renderIcon={Upload} disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading ? 'Uploading…' : previewUrl ? 'Replace document' : 'Add document'}
            </Button>
            {previewUrl && !isNew && (
              <IconButton kind="ghost" size="sm" label="Open in a new tab" autoAlign onClick={() => window.open(previewUrl, '_blank', 'noopener')}>
                <Launch />
              </IconButton>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT.join(',')}
              hidden
              data-testid="reference-file-input"
              onChange={(e) => {
                void replaceDocument(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          {previewUrl ? (
            <iframe key={previewUrl} className="reference-preview__frame" src={previewUrl} title="Document preview" />
          ) : (
            <div className="reference-preview__empty">
              <FileUploaderDropContainer
                labelText="Drag the signed letter here, or click to choose it — a PDF or an image"
                accept={ACCEPT}
                multiple={false}
                onAddFiles={(_e: unknown, { addedFiles }: { addedFiles: File[] }) => void replaceDocument(addedFiles[0])}
              />
            </div>
          )}
        </aside>
      </div>

      {reference && (
        <ConfirmDeleteModal
          open={deleteOpen}
          title={reference.customerName}
          entityLabel="reference"
          consequence={reference.hasDocument ? 'Its document will be deleted too.' : undefined}
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {leaveTo && (
        <Modal
          open
          danger
          modalHeading="Discard your changes?"
          primaryButtonText="Discard"
          secondaryButtonText="Keep editing"
          onRequestClose={() => setLeaveTo(null)}
          onRequestSubmit={() => {
            const to = leaveTo;
            setLeaveTo(null);
            setForm(base);
            navigate(to);
          }}
        >
          <p>The corrections to this reference have not been saved.</p>
        </Modal>
      )}
    </div>
  );
}

/** The derived tags, read-only: they follow the wording, on save. */
function StandardTags({ label, tags }: { label: string; tags: string[] }) {
  return (
    <div className="reference-form__tags">
      <span className="reference-form__tags-label">{label}</span>
      {tags.length === 0 ? (
        <span className="reference-form__tags-none">None yet — set from the list above when saved</span>
      ) : (
        tags.map((t) => (
          <Tag key={t} size="sm" type="outline">
            {t}
          </Tag>
        ))
      )}
    </div>
  );
}

/**
 * The saved row with the edits made since `snapshot` was sent laid back on
 * top: a field the user changed while the PATCH was out keeps their value.
 */
function rebase(saved: ReferenceForm, snapshot: ReferenceForm, current: ReferenceForm): ReferenceForm {
  const next = { ...saved };
  for (const key of Object.keys(current) as Array<keyof ReferenceForm>) {
    if (JSON.stringify(current[key]) !== JSON.stringify(snapshot[key])) (next as Record<string, unknown>)[key] = current[key];
  }
  return next;
}

function pickDocument(r: ClientReference) {
  return {
    hasDocument: r.hasDocument,
    documentFilename: r.documentFilename,
    documentMimeType: r.documentMimeType,
    documentSize: r.documentSize,
    documentUploadedAt: r.documentUploadedAt,
  };
}
