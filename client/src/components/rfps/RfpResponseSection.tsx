import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  Dropdown,
  FileUploaderButton,
  InlineLoading,
  Modal,
  Tag,
  TextInput,
} from '@carbon/react';
import { Add, Attachment, TrashCan } from '@carbon/icons-react';
import { isAxiosError } from 'axios';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { AttachmentPreviewModal } from '../shared/AttachmentPreviewModal';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { PIECE_ACCEPTED, RfpPiecePanel } from './RfpPiecePanel';
import { PersonAvatar, VerificationSummary, When } from './RfpPeople';
import { shortDate, timeLeft } from '../../utils/dates';
import { ReadyMeter } from './RfpRisk';

/** Past its internal due date and not done. */
function isLate(item: RfpItem): boolean {
  return Boolean(item.dueDate) && new Date(item.dueDate!).getTime() < Date.now() && item.status !== 'READY' && item.status !== 'NOT_APPLICABLE';
}
import {
  currentVersion,
  personName,
  readiness,
  readyNeedsVerifiers,
  verificationStates,
  RFP_ITEM_STATUSES,
  RFP_ITEM_STATUS_LABELS,
  RFP_ITEM_STATUS_TAG_TYPE,
  type RfpCatalogueEntry,
  type RfpDetail,
  type RfpFolder,
  type RfpFolderKind,
  type RfpItem,
  type RfpItemStatus,
  type RfpPerson,
  type RfpVerifier,
} from '../../types/rfp';

const statusItems = RFP_ITEM_STATUSES.map((id) => ({ id, text: RFP_ITEM_STATUS_LABELS[id] }));

interface RfpResponseSectionProps {
  rfp: RfpDetail;
  catalogue: RfpCatalogueEntry[];
  currentUserId: string | undefined;
  /** Local, optimistic change — the status dropdown answers before the server does. */
  onLocalChange: (update: (rfp: RfpDetail) => RfpDetail) => void;
  /** Re-read the tender after a change the server shapes (positions, prefill). */
  onRefresh: () => Promise<void> | void;
}

/**
 * The response: one accordion row per dossier, and inside each the pieces it
 * needs — a CV, a diploma, the signed CPS — with where each one stands and
 * the files prepared for it.
 *
 * With more than one lot the dossiers are grouped: what is prepared once for
 * the whole tender first, then each lot's offers together, which is how the
 * envelopes are assembled on the day.
 */
export function RfpResponseSection({ rfp, catalogue, currentUserId, onLocalChange, onRefresh }: RfpResponseSectionProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [deleteFolder, setDeleteFolder] = useState<RfpFolder | null>(null);
  const [preview, setPreview] = useState<{ item: RfpItem; index: number } | null>(null);
  /** The piece open in the panel — by id, so a refresh shows its new state. */
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const openFolder = rfp.folders.find((f) => f.items.some((i) => i.id === openItemId)) ?? null;
  const openItem = openFolder?.items.find((i) => i.id === openItemId) ?? null;
  /** Which dossiers are open — controlled, so the overview can open one. */
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  /** Who a piece can be assigned to — re-read when the sharing changes. */
  const [people, setPeople] = useState<RfpPerson[]>([]);
  const shareCount = rfp._count?.shares ?? 0;
  useEffect(() => {
    let live = true;
    rfpsApi
      .getPeople(rfp.id)
      .then(({ data: res }) => live && setPeople(res.data))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [rfp.id, shareCount]);

  const groups: Array<{ key: string; heading: string | null; folders: RfpFolder[] }> =
    rfp.lots.length > 1
      ? [
          { key: 'tender', heading: 'Whole tender', folders: rfp.folders.filter((f) => !f.lotId) },
          ...rfp.lots.map((lot) => ({
            key: lot.id,
            heading: `Lot ${lot.number} — ${lot.title}`,
            folders: rfp.folders.filter((f) => f.lotId === lot.id),
          })),
        ].filter((g) => g.folders.length > 0)
      : [{ key: 'all', heading: null, folders: rfp.folders }];

  const handleDeleteFolder = async () => {
    if (!deleteFolder) return;
    try {
      await rfpsApi.deleteFolder(rfp.id, deleteFolder.id);
      addNotification({ kind: 'success', title: 'Dossier removed' });
      setDeleteFolder(null);
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to remove the dossier' });
    }
  };

  const fileCount = (folder: RfpFolder) => folder.items.reduce((n, i) => n + i.documents.length, 0);

  return (
    <section className="rfp-detail__section" aria-labelledby="rfp-response-heading">
      <div className="rfp-detail__section-header">
        <div>
          <h2 id="rfp-response-heading" className="rfp-detail__section-title">Response</h2>
          <p className="rfp-detail__section-subtitle">The dossiers to prepare, and where each piece stands</p>
        </div>
        <Button kind="tertiary" size="sm" renderIcon={Add} onClick={() => setAddFolderOpen(true)}>
          Add dossier
        </Button>
      </div>

      {rfp.folders.length > 0 && (
        <DossierOverview
          folders={rfp.folders}
          onOpen={(folderId) => {
            setOpenFolders((prev) => new Set(prev).add(folderId));
            // After the accordion has opened.
            requestAnimationFrame(() =>
              document.getElementById(`rfp-folder-${folderId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
            );
          }}
        />
      )}

      {rfp.folders.length === 0 ? (
        <p className="rfp-detail__empty">No dossiers yet. Add the ones the RC asks for.</p>
      ) : (
        groups.map((group) => (
          <div key={group.key} className="rfp-response__group">
            {group.heading && <h3 className="rfp-response__group-heading">{group.heading}</h3>}
            <Accordion align="start" size="lg" className="rfp-response__accordion">
              {group.folders.map((folder) => {
                const { ready, total } = readiness(folder.items);
                const done = total > 0 && ready === total;
                return (
                  <AccordionItem
                    key={folder.id}
                    open={openFolders.has(folder.id)}
                    onHeadingClick={({ isOpen }: { isOpen: boolean }) =>
                      setOpenFolders((prev) => {
                        const next = new Set(prev);
                        if (isOpen) next.add(folder.id);
                        else next.delete(folder.id);
                        return next;
                      })
                    }
                    title={
                      <span className="rfp-response__folder-title" id={`rfp-folder-${folder.id}`}>
                        <span className="rfp-response__folder-name">{folder.title}</span>
                        <Tag type={done ? 'green' : 'gray'} size="sm">
                          {total === 0 ? 'No pieces' : `${ready}/${total} ready`}
                        </Tag>
                        {fileCount(folder) > 0 && (
                          <span className="rfp-response__folder-files">
                            <Attachment size={16} aria-label="Files" />
                            {fileCount(folder)}
                          </span>
                        )}
                      </span>
                    }
                  >
                    <FolderBody
                      rfpId={rfp.id}
                      folder={folder}
                      onLocalChange={onLocalChange}
                      onRefresh={onRefresh}
                      verifiers={rfp.verifiers}
                      onPreview={(item, index) => setPreview({ item, index })}
                      onOpen={(item) => setOpenItemId(item.id)}
                      onDelete={() => setDeleteFolder(folder)}
                    />
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>
        ))
      )}

      {addFolderOpen && (
        <AddFolderModal
          rfp={rfp}
          catalogue={catalogue}
          onClose={() => setAddFolderOpen(false)}
          onAdded={async () => {
            setAddFolderOpen(false);
            await onRefresh();
          }}
        />
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteFolder)}
        title={deleteFolder?.title ?? ''}
        entityLabel="dossier"
        consequence={
          deleteFolder
            ? `Its ${deleteFolder.items.length} piece${deleteFolder.items.length === 1 ? '' : 's'}${
                fileCount(deleteFolder) > 0 ? ` and ${fileCount(deleteFolder)} file${fileCount(deleteFolder) === 1 ? '' : 's'}` : ''
              } will be deleted too.`
            : undefined
        }
        onConfirm={handleDeleteFolder}
        onClose={() => setDeleteFolder(null)}
      />

      <RfpPiecePanel
        rfpId={rfp.id}
        item={openItem}
        folderTitle={openFolder?.title ?? ''}
        verifiers={rfp.verifiers}
        people={people}
        tenderDeadline={rfp.deadlineAt}
        currentUserId={currentUserId}
        onClose={() => setOpenItemId(null)}
        onPreview={(item, index) => setPreview({ item, index })}
        onRefresh={onRefresh}
      />

      <AttachmentPreviewModal
        open={preview !== null}
        items={(preview?.item.documents ?? []).map((d) => ({
          file: d,
          inlineUrl: rfpsApi.documentInlineUrl(d.rfpId, d.id),
          downloadUrl: rfpsApi.documentUrl(d.rfpId, d.id),
        }))}
        index={preview?.index ?? 0}
        onIndexChange={(index) => setPreview((p) => (p ? { ...p, index } : p))}
        onClose={() => setPreview(null)}
      />
    </section>
  );
}

/**
 * Every dossier on one screen: who is on it, how far along, and the next
 * date that falls due. The accordions below start closed, so the response
 * used to open on a column of headers with nothing in them.
 */
function DossierOverview({ folders, onOpen }: { folders: RfpFolder[]; onOpen: (folderId: string) => void }) {
  return (
    <div className="rfp-dossiers" role="table" aria-label="Dossiers at a glance">
      <div className="rfp-dossiers__row rfp-dossiers__row--head" role="row">
        <span role="columnheader">Dossier</span>
        <span role="columnheader">Owners</span>
        <span role="columnheader">Ready</span>
        <span role="columnheader">Next due</span>
      </div>
      {folders.map((folder) => {
        const owners = [...new Map(folder.items.filter((i) => i.assignee).map((i) => [i.assignee!.id, i.assignee!])).values()];
        const open = folder.items.filter((i) => i.status !== 'READY' && i.status !== 'NOT_APPLICABLE');
        const unowned = open.filter((i) => !i.assigneeId).length;
        const nextDue = open
          .filter((i) => i.dueDate)
          .map((i) => i.dueDate!)
          .sort()[0];
        const late = nextDue && new Date(nextDue).getTime() < Date.now();
        return (
          <button type="button" key={folder.id} className="rfp-dossiers__row" role="row" onClick={() => onOpen(folder.id)}>
            <span role="cell" className="rfp-dossiers__name">
              {folder.title}
            </span>
            <span role="cell" className="rfp-dossiers__owners">
              {owners.map((o) => (
                <span key={o.id} title={personName(o)}>
                  <PersonAvatar person={o} />
                </span>
              ))}
              {unowned > 0 && (
                <span className="rfp-dossiers__unowned" title={`${unowned} open piece${unowned === 1 ? '' : 's'} without an owner`}>
                  {unowned} unassigned
                </span>
              )}
              {owners.length === 0 && unowned === 0 && <span className="rfp-muted">—</span>}
            </span>
            <span role="cell">
              <ReadyMeter readiness={readiness(folder.items)} />
            </span>
            <span role="cell" className={late ? 'rfp-response__due--late' : 'rfp-dossiers__due'}>
              {nextDue ? `${shortDate(nextDue, { dayFirst: true })} · ${timeLeft(nextDue)}` : '—'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface FolderBodyProps {
  rfpId: string;
  folder: RfpFolder;
  verifiers: RfpVerifier[];
  onLocalChange: RfpResponseSectionProps['onLocalChange'];
  onRefresh: RfpResponseSectionProps['onRefresh'];
  onPreview: (item: RfpItem, index: number) => void;
  onOpen: (item: RfpItem) => void;
  onDelete: () => void;
}

/**
 * One dossier's pieces, and the way to add another.
 *
 * Each row answers the questions asked of a piece most often — what is the
 * current file, who handed it in and when, who has checked it — and opens
 * the piece's panel for the rest: earlier versions, comments, deciding.
 */
function FolderBody({ rfpId, folder, verifiers, onLocalChange, onRefresh, onPreview, onOpen, onDelete }: FolderBodyProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);

  const patchItem = (itemId: string, next: Partial<RfpItem>) =>
    onLocalChange((r) => ({
      ...r,
      folders: r.folders.map((f) =>
        f.id !== folder.id ? f : { ...f, items: f.items.map((i) => (i.id === itemId ? { ...i, ...next } : i)) },
      ),
    }));

  const setStatus = async (item: RfpItem, status: RfpItemStatus) => {
    const previous = item.status;
    patchItem(item.id, { status });
    try {
      await rfpsApi.updateItem(rfpId, item.id, { status });
    } catch (err) {
      patchItem(item.id, { status: previous });
      addNotification(
        isAxiosError(err) && err.response?.status === 409
          ? { kind: 'warning', title: 'Not verified yet', subtitle: 'Every verifier must approve the current version first.' }
          : { kind: 'error', title: 'Failed to update the piece' },
      );
    }
  };

  const addItem = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await rfpsApi.createItem(rfpId, folder.id, title);
      setNewTitle('');
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to add the piece' });
    } finally {
      setAdding(false);
    }
  };

  const removeItem = async (item: RfpItem) => {
    try {
      await rfpsApi.deleteItem(rfpId, item.id);
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to remove the piece' });
    }
  };

  /** A new version — one file, the piece's next number. */
  const upload = async (item: RfpItem, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingItem(item.id);
    try {
      await rfpsApi.uploadItemDocument(rfpId, item.id, files[0]);
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Upload failed', subtitle: 'Check the file type and that it is under 25 MB.' });
    } finally {
      setUploadingItem(null);
    }
  };

  return (
    <div className="rfp-response__folder">
      {folder.items.length === 0 ? (
        <p className="rfp-detail__empty">No pieces yet.</p>
      ) : (
        <ul className="rfp-response__items" aria-label={`Pieces of ${folder.title}`}>
          {folder.items.map((item) => {
            const current = currentVersion(item);
            const gated = readyNeedsVerifiers(item, verifiers);
            const verified = verificationStates(item, verifiers).every((v) => v.state === 'approved');
            // With verifiers, Ready is theirs to give — offered but disabled
            // here, so the menu says why rather than the server refusing.
            const items = statusItems.map((s) =>
              s.id === 'READY' && gated && !verified ? { ...s, text: 'Ready — after verification', disabled: true } : s,
            );
            return (
              <li key={item.id} className={`rfp-response__item rfp-response__item--${item.status.toLowerCase()}`}>
                <span className="rfp-response__item-head">
                  <button type="button" className="rfp-response__item-title" onClick={() => onOpen(item)}>
                    {item.title}
                  </button>
                  {(item.assignee || item.dueDate) && (
                    <span className="rfp-response__owner">
                      {item.assignee && <PersonAvatar person={item.assignee} />}
                      {item.assignee && <span>{personName(item.assignee)}</span>}
                      {item.dueDate && (
                        <span className={isLate(item) ? 'rfp-response__due--late' : undefined}>
                          {item.assignee ? ' · ' : ''}due {shortDate(item.dueDate, { dayFirst: true })}
                        </span>
                      )}
                    </span>
                  )}
                </span>

                <div className="rfp-response__item-files">
                  {current ? (
                    <span className="rfp-response__current">
                      <span className="rfp-response__file">
                        <button
                          type="button"
                          className="rfp-response__file-name"
                          title={current.filename}
                          onClick={() => onPreview(item, item.documents.length - 1)}
                        >
                          {current.filename}
                        </button>
                        <Tag type="blue" size="sm" className="rfp-response__version">
                          v{current.version}
                        </Tag>
                      </span>
                      <span className="rfp-response__meta">
                        {personName(current.uploadedBy)} · <When at={current.createdAt} />
                      </span>
                    </span>
                  ) : (
                    <span className="rfp-response__meta">No file yet</span>
                  )}
                </div>

                <div className="rfp-response__item-verif">
                  {verifiers.length > 0 && current ? (
                    <button type="button" className="rfp-response__verif-button" onClick={() => onOpen(item)}>
                      <VerificationSummary item={item} verifiers={verifiers} />
                    </button>
                  ) : null}
                </div>

                <div className="rfp-response__item-upload">
                  {uploadingItem === item.id ? (
                    <InlineLoading description="Uploading…" />
                  ) : (
                    <FileUploaderButton
                      buttonKind="ghost"
                      size="sm"
                      labelText={current ? 'New version' : 'Upload'}
                      accept={PIECE_ACCEPTED}
                      disableLabelChanges
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => upload(item, e.target.files)}
                    />
                  )}
                </div>

                <Dropdown
                  id={`rfp-item-status-${item.id}`}
                  className="rfp-response__item-status"
                  titleText={`Status of ${item.title}`}
                  hideLabel
                  label=""
                  type="inline"
                  size="sm"
                  // The menu is wider than this column; unaligned it ran past
                  // the page edge and scrolled the page sideways.
                  autoAlign
                  items={items}
                  itemToString={(i) => i?.text ?? ''}
                  selectedItem={items.find((s) => s.id === item.status)}
                  renderSelectedItem={(i) => (
                    <Tag type={RFP_ITEM_STATUS_TAG_TYPE[i.id]} size="sm">
                      {RFP_ITEM_STATUS_LABELS[i.id]}
                    </Tag>
                  )}
                  onChange={({ selectedItem }) => selectedItem && selectedItem.id !== item.status && setStatus(item, selectedItem.id)}
                />

                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  renderIcon={TrashCan}
                  iconDescription={`Remove ${item.title}`}
                  onClick={() => removeItem(item)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="rfp-response__add"
        onSubmit={(e) => {
          e.preventDefault();
          addItem();
        }}
      >
        <TextInput
          id={`rfp-new-item-${folder.id}`}
          labelText={`New piece for ${folder.title}`}
          hideLabel
          size="sm"
          placeholder="Add a piece — e.g. CV du chef de projet"
          value={newTitle}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewTitle(e.target.value)}
        />
        <Button kind="ghost" size="sm" type="submit" renderIcon={Add} disabled={!newTitle.trim() || adding}>
          Add piece
        </Button>
        <Button kind="danger--ghost" size="sm" renderIcon={TrashCan} onClick={onDelete} className="rfp-response__remove-folder">
          Remove dossier
        </Button>
      </form>
    </div>
  );
}

interface AddFolderModalProps {
  rfp: RfpDetail;
  catalogue: RfpCatalogueEntry[];
  onClose: () => void;
  onAdded: () => void;
}

/**
 * A dossier the wizard did not create — a forgotten one, or an "Autre" the
 * RC invents. A couple of fields, so a small modal.
 */
function AddFolderModal({ rfp, catalogue, onClose, onAdded }: AddFolderModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [kind, setKind] = useState<RfpFolderKind>('OTHER');
  /** What was picked; `null` until then, or for "Whole tender". */
  const [lotId, setLotId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [prefill, setPrefill] = useState(true);
  const [saving, setSaving] = useState(false);

  const entry = catalogue.find((c) => c.kind === kind);
  // Offers belong to a lot; tender-wide dossiers never do; "Autre" either.
  const lotChoice = entry?.perLot ? 'required' : kind === 'OTHER' ? 'optional' : 'none';
  const kindItems = catalogue.map((c) => ({ id: c.kind, text: c.label }));
  const lotItems = [
    ...(lotChoice === 'optional' ? [{ id: '__none__', text: 'Whole tender' }] : []),
    ...rfp.lots.map((l) => ({ id: l.id, text: `Lot ${l.number} — ${l.title}` })),
  ];
  // An offer defaults to the first lot; a one-off "Autre" to the whole tender.
  const effectiveLot = lotChoice === 'none' ? null : lotChoice === 'required' ? (lotId ?? rfp.lots[0]?.id ?? null) : lotId;
  const canSave = !saving && (kind !== 'OTHER' || title.trim() !== '') && (lotChoice !== 'required' || effectiveLot !== null);

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await rfpsApi.createFolder(rfp.id, {
        kind,
        lotId: effectiveLot,
        title: title.trim() || undefined,
        prefill: entry && entry.defaultItems.length > 0 ? prefill : false,
      });
      addNotification({ kind: 'success', title: 'Dossier added' });
      onAdded();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to add the dossier' });
      setSaving(false);
    }
  };

  return createPortal(
    <Modal
      open
      size="sm"
      modalHeading="Add dossier"
      primaryButtonText={saving ? 'Adding…' : 'Add'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canSave}
      onRequestSubmit={submit}
      onRequestClose={onClose}
      className="rfp-add-folder"
    >
      <div className="rfp-add-folder__fields">
        <Dropdown
          id="rfp-add-folder-kind"
          titleText="Kind"
          label="Choose a kind"
          items={kindItems}
          itemToString={(i) => i?.text ?? ''}
          selectedItem={kindItems.find((k) => k.id === kind)}
          onChange={({ selectedItem }) => selectedItem && setKind(selectedItem.id)}
        />
        {lotChoice !== 'none' && rfp.lots.length > 0 && (
          <Dropdown
            id="rfp-add-folder-lot"
            titleText="Lot"
            label="Choose a lot"
            items={lotItems}
            itemToString={(i) => i?.text ?? ''}
            selectedItem={lotItems.find((l) => l.id === (effectiveLot ?? '__none__')) ?? null}
            onChange={({ selectedItem }) => setLotId(!selectedItem || selectedItem.id === '__none__' ? null : selectedItem.id)}
          />
        )}
        <TextInput
          id="rfp-add-folder-title"
          labelText={kind === 'OTHER' ? 'Title' : 'Title (optional)'}
          placeholder={kind === 'OTHER' ? 'Échantillons' : entry?.label}
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
        />
        {entry && entry.defaultItems.length > 0 && (
          <Checkbox
            id="rfp-add-folder-prefill"
            labelText={`Start with the standard pieces (${entry.defaultItems.length})`}
            checked={prefill}
            onChange={(_e: React.ChangeEvent<HTMLInputElement>, { checked }: { checked: boolean }) => setPrefill(checked)}
          />
        )}
      </div>
    </Modal>,
    document.body,
  );
}
