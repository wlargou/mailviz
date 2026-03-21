import { useEffect, useState } from 'react';
import { TextInput, TextArea, Dropdown, DatePicker, DatePickerInput } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { dealsApi } from '../../api/deals';
import { dealPartnersApi } from '../../api/dealPartners';
import { CompanyComboBox } from '../shared/CompanyComboBox';
import { useUIStore } from '../../store/uiStore';
import type { Deal, DealPartner, DealStatus } from '../../types/deal';
import { DEAL_STATUS_LABELS } from '../../types/deal';

interface DealCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  editDeal?: Deal | null;
}

const statusItems: { id: DealStatus; text: string }[] = [
  { id: 'TO_CHALLENGE', text: DEAL_STATUS_LABELS.TO_CHALLENGE },
  { id: 'APPROVED', text: DEAL_STATUS_LABELS.APPROVED },
  { id: 'DECLINED', text: DEAL_STATUS_LABELS.DECLINED },
];

export function DealCreateModal({ open, onClose, onCreated, editDeal }: DealCreateModalProps) {
  const [title, setTitle] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [products, setProducts] = useState('');
  const [status, setStatus] = useState<DealStatus>('TO_CHALLENGE');
  const [expiryDate, setExpiryDate] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [partners, setPartners] = useState<DealPartner[]>([]);
  const addNotification = useUIStore((s) => s.addNotification);

  const resetForm = () => {
    setTitle('');
    setPartnerId('');
    setCustomerId(null);
    setProducts('');
    setStatus('TO_CHALLENGE');
    setExpiryDate(null);
    setNotes('');
  };

  // Load partners and customers when panel opens
  useEffect(() => {
    if (!open) return;

    dealPartnersApi.getAll().then(({ data: res }) => {
      setPartners(res.data);
    }).catch(() => {});

    // Pre-fill form in edit mode
    if (editDeal) {
      setTitle(editDeal.title);
      setPartnerId(editDeal.partnerId);
      setCustomerId(editDeal.customerId);
      setProducts(editDeal.products || '');
      setStatus(editDeal.status);
      setExpiryDate(editDeal.expiryDate || null);
      setNotes(editDeal.notes || '');
    } else {
      resetForm();
    }
  }, [open, editDeal]);

  const handleSubmit = async () => {
    if (!title.trim() || !partnerId) return;
    setLoading(true);
    try {
      const data = {
        title: title.trim(),
        partnerId,
        customerId: customerId || null,
        products: products.trim() || undefined,
        status,
        expiryDate: expiryDate || null,
        notes: notes.trim() || undefined,
      };

      if (editDeal) {
        await dealsApi.update(editDeal.id, data);
        addNotification({ kind: 'success', title: 'Deal updated' });
      } else {
        await dealsApi.create(data);
        addNotification({ kind: 'success', title: 'Deal created' });
      }
      resetForm();
      onCreated();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: editDeal ? 'Failed to update deal' : 'Failed to create deal' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SidePanel
      open={open}
      onRequestClose={() => { resetForm(); onClose(); }}
      title={editDeal ? 'Edit Deal' : 'New Deal'}
      subtitle={editDeal ? 'Update deal registration details' : 'Register a new partner deal'}
      size="md"
      actions={[
        {
          label: loading ? (editDeal ? 'Saving...' : 'Creating...') : (editDeal ? 'Save' : 'Create'),
          onClick: handleSubmit,
          kind: 'primary' as const,
          disabled: !title.trim() || !partnerId || loading,
          loading,
        },
        {
          label: 'Cancel',
          onClick: () => { resetForm(); onClose(); },
          kind: 'secondary' as const,
        },
      ]}
    >
      <TextInput
        id="deal-title"
        labelText="Title"
        placeholder="Deal title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        invalid={open && title.length > 0 && !title.trim()}
        invalidText="Title is required"
        className="create-side-panel__form-item"
      />
      <Dropdown
        id="deal-partner"
        titleText="Partner"
        label="Select a partner"
        items={partners.map((p) => ({ id: p.id, text: p.name }))}
        itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
        selectedItem={
          partnerId
            ? { id: partnerId, text: partners.find((p) => p.id === partnerId)?.name || '' }
            : null
        }
        onChange={({ selectedItem }: { selectedItem: { id: string; text: string } | null }) => {
          setPartnerId(selectedItem?.id || '');
        }}
        className="create-side-panel__form-item"
      />
      <div className="create-side-panel__form-item">
        <CompanyComboBox
          id="deal-customer"
          titleText="Customer"
          selectedId={customerId}
          onChange={(id) => setCustomerId(id)}
          allowNone
        />
      </div>
      <Dropdown
        id="deal-status"
        titleText="Status"
        label="Select status"
        items={statusItems}
        itemToString={(item: { id: string; text: string } | null) => item?.text || ''}
        selectedItem={statusItems.find((s) => s.id === status) || statusItems[0]}
        onChange={({ selectedItem }: { selectedItem: { id: DealStatus; text: string } | null }) => {
          if (selectedItem) setStatus(selectedItem.id);
        }}
        className="create-side-panel__form-item"
      />
      <DatePicker
        datePickerType="single"
        value={expiryDate ? new Date(expiryDate) : undefined}
        onChange={([date]: Date[]) => {
          setExpiryDate(date ? date.toISOString() : null);
        }}
      >
        <DatePickerInput
          id="deal-expiry"
          labelText="Expiry Date"
          placeholder="mm/dd/yyyy"
          className="create-side-panel__form-item"
        />
      </DatePicker>
      <TextArea
        id="deal-products"
        labelText="Products"
        placeholder="Products included in this deal"
        value={products}
        onChange={(e) => setProducts(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextArea
        id="deal-notes"
        labelText="Notes"
        placeholder="Additional notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="create-side-panel__form-item"
      />
    </SidePanel>
  );
}
