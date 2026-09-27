import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
} from '@carbon/react';
import { Add, Edit, TrashCan } from '@carbon/icons-react';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { BudgetInput } from './RfpFormFields';
import { formatBudget, parseBudget, type RfpDetail, type RfpLot } from '../../types/rfp';

interface RfpLotsSectionProps {
  rfp: RfpDetail;
  onRefresh: () => Promise<void> | void;
}

/**
 * The lots, each with its own published budget.
 *
 * Adding a lot also adds its offers — the server copies whichever per-lot
 * dossiers the tender already has — so the response keeps one technical and
 * one financial offer per lot without anyone remembering to.
 */
export function RfpLotsSection({ rfp, onRefresh }: RfpLotsSectionProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  /** `null` closed, `'new'` adding, a lot when editing it. */
  const [editing, setEditing] = useState<RfpLot | 'new' | null>(null);
  const [deleteLot, setDeleteLot] = useState<RfpLot | null>(null);

  const offersOf = (lot: RfpLot) => rfp.folders.filter((f) => f.lotId === lot.id);

  const handleDelete = async () => {
    if (!deleteLot) return;
    try {
      await rfpsApi.deleteLot(rfp.id, deleteLot.id);
      addNotification({ kind: 'success', title: 'Lot removed' });
      setDeleteLot(null);
      await onRefresh();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to remove the lot' });
    }
  };

  return (
    <section className="rfp-detail__section" aria-labelledby="rfp-lots-heading">
      <div className="rfp-detail__section-header">
        <div>
          <h2 id="rfp-lots-heading" className="rfp-detail__section-title">Lots</h2>
          <p className="rfp-detail__section-subtitle">
            {rfp.isGoe ? "Each lot's published estimate — the tender's budget is their total" : 'How the tender is split'}
          </p>
        </div>
        <Button kind="tertiary" size="sm" renderIcon={Add} onClick={() => setEditing('new')}>
          Add lot
        </Button>
      </div>

      <Table size="md" aria-label="Lots" className="rfp-lots-table">
        <TableHead>
          <TableRow>
            <TableHeader className="rfp-lots-table__number">Lot</TableHeader>
            <TableHeader>Title</TableHeader>
            {rfp.isGoe && <TableHeader className="rfp-lots-table__budget">Budget</TableHeader>}
            <TableHeader className="rfp-lots-table__actions" />
          </TableRow>
        </TableHead>
        <TableBody>
          {rfp.lots.map((lot) => (
            <TableRow key={lot.id}>
              <TableCell>{lot.number}</TableCell>
              <TableCell>{lot.title}</TableCell>
              {rfp.isGoe && <TableCell className="rfp-lots-table__budget">{formatBudget(lot.budget)}</TableCell>}
              <TableCell>
                <div className="table-row-actions">
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={Edit} iconDescription={`Edit lot ${lot.number}`} onClick={() => setEditing(lot)} />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    renderIcon={TrashCan}
                    // A tender keeps at least one lot; the server refuses too.
                    disabled={rfp.lots.length <= 1}
                    iconDescription={rfp.lots.length <= 1 ? 'A tender keeps at least one lot' : `Remove lot ${lot.number}`}
                    onClick={() => setDeleteLot(lot)}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {rfp.isGoe && rfp.lots.length > 1 && (
            <TableRow className="rfp-lots-table__total">
              <TableCell />
              <TableCell>Total</TableCell>
              <TableCell className="rfp-lots-table__budget">{formatBudget(rfp.budget)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editing && (
        <LotModal
          rfp={rfp}
          lot={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onRefresh();
          }}
        />
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteLot)}
        title={deleteLot ? `Lot ${deleteLot.number} — ${deleteLot.title}` : ''}
        entityLabel="lot"
        consequence={
          deleteLot && offersOf(deleteLot).length > 0
            ? `Its ${offersOf(deleteLot).map((f) => f.title).join(' and ')} will be deleted too, with their pieces and files.`
            : undefined
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteLot(null)}
      />
    </section>
  );
}

interface LotModalProps {
  rfp: RfpDetail;
  lot: RfpLot | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Two fields, so a small modal — portaled, like every modal on a page with panels. */
function LotModal({ rfp, lot, onClose, onSaved }: LotModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const nextNumber = Math.max(0, ...rfp.lots.map((l) => l.number)) + 1;
  const [title, setTitle] = useState(lot?.title ?? `Lot ${nextNumber}`);
  const [budget, setBudget] = useState(lot?.budget === null || lot?.budget === undefined ? '' : String(lot.budget));
  const [saving, setSaving] = useState(false);
  const parsed = rfp.isGoe ? parseBudget(budget) : null;

  const submit = async () => {
    if (!title.trim() || parsed === undefined) return;
    setSaving(true);
    const body = {
      title: title.trim(),
      ...(rfp.isGoe ? { budget: parseBudget(budget) ?? null } : {}),
    };
    try {
      if (lot) await rfpsApi.updateLot(rfp.id, lot.id, body);
      else await rfpsApi.createLot(rfp.id, body);
      addNotification({ kind: 'success', title: lot ? 'Lot updated' : 'Lot added' });
      onSaved();
    } catch {
      addNotification({ kind: 'error', title: lot ? 'Failed to update the lot' : 'Failed to add the lot' });
      setSaving(false);
    }
  };

  return createPortal(
    <Modal
      open
      size="sm"
      modalHeading={lot ? `Edit lot ${lot.number}` : `Add lot ${nextNumber}`}
      primaryButtonText={saving ? 'Saving…' : lot ? 'Save' : 'Add'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={saving || !title.trim() || parsed === undefined}
      onRequestSubmit={submit}
      onRequestClose={onClose}
    >
      <div className="rfp-add-folder__fields">
        <TextInput
          id="rfp-lot-title"
          labelText="Title"
          value={title}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          invalid={!title.trim()}
          invalidText="A lot needs a title"
        />
        {rfp.isGoe && (
          <BudgetInput
            id="rfp-lot-budget"
            labelText="Budget (MAD)"
            helperText={parsed ? `${formatBudget(parsed)} — the estimate published in the Avis` : 'The estimate published in the Avis'}
            value={budget}
            onChange={setBudget}
          />
        )}
        {!lot && rfp.folders.some((f) => f.lotId) && (
          <p className="rfp-form__section-hint">Its offers are added with it, starting with the standard pieces.</p>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
