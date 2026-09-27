import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Checkbox, InlineLoading, Modal } from '@carbon/react';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { PersonAvatar } from './RfpPeople';
import { personName, type RfpDetail, type RfpPerson } from '../../types/rfp';

interface RfpVerifiersModalProps {
  rfp: RfpDetail;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Choose who verifies the response. The owner's to decide, among the people
 * who can open the tender — the owner and whoever it is shared with — since
 * a verifier who cannot see the documents cannot check them.
 *
 * A couple of fields, so a small modal.
 */
export function RfpVerifiersModal({ rfp, onClose, onSaved }: RfpVerifiersModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [people, setPeople] = useState<RfpPerson[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(rfp.verifiers.map((v) => v.userId)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    rfpsApi
      .getRfpShares(rfp.id)
      .then(({ data: res }) => {
        if (!live) return;
        const owner: RfpPerson = {
          id: rfp.userId,
          name: rfp.user?.name ?? null,
          email: rfp.user?.email ?? '',
          avatarUrl: rfp.verifiers.find((v) => v.userId === rfp.userId)?.user.avatarUrl ?? null,
        };
        setPeople([owner, ...res.data.map((s) => s.sharedWith)]);
      })
      .catch(() => {
        if (live) setPeople([]);
      });
    return () => {
      live = false;
    };
  }, [rfp]);

  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await rfpsApi.setVerifiers(rfp.id, [...chosen]);
      addNotification({ kind: 'success', title: 'Verifiers updated' });
      onSaved();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update the verifiers' });
      setSaving(false);
    }
  };

  return createPortal(
    <Modal
      open
      size="sm"
      modalHeading="Verifiers"
      primaryButtonText={saving ? 'Saving…' : 'Save'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={saving || people === null}
      onRequestSubmit={save}
      onRequestClose={onClose}
    >
      <p className="rfp-verifiers-modal__intro">
        Each verifier approves every piece. A piece with a file becomes Ready once all of them have approved its current version.
      </p>
      {people === null ? (
        <InlineLoading description="Loading people…" />
      ) : (
        <fieldset className="cds--fieldset rfp-verifiers-modal__list">
          <legend className="cds--label">People with access to this RFP</legend>
          {people.map((p) => (
            <div key={p.id} className="rfp-verifiers-modal__person">
              <Checkbox
                id={`rfp-verifier-${p.id}`}
                labelText={
                  <span className="rfp-verifiers-modal__label">
                    <PersonAvatar person={p} />
                    {personName(p)}
                    {p.id === rfp.userId && <span className="rfp-piece-panel__muted"> · owner</span>}
                  </span>
                }
                checked={chosen.has(p.id)}
                onChange={(_e: React.ChangeEvent<HTMLInputElement>, { checked }: { checked: boolean }) => toggle(p.id, checked)}
              />
            </div>
          ))}
          {people.length === 1 && (
            <p className="rfp-form__section-hint">Share the RFP with colleagues to make them verifiers.</p>
          )}
        </fieldset>
      )}
    </Modal>,
    document.body,
  );
}
