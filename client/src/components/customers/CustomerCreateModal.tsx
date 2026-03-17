import { useState } from 'react';
import { Modal, TextInput, TextArea } from '@carbon/react';
import { customersApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';

interface CustomerCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function CustomerCreateModal({ open, onClose, onCreated }: CustomerCreateModalProps) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const resetForm = () => {
    setName('');
    setCompany('');
    setEmail('');
    setPhone('');
    setWebsite('');
    setNotes('');
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      await customersApi.create({
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      addNotification({ kind: 'success', title: 'Customer created' });
      resetForm();
      onCreated();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create customer' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onRequestClose={() => { resetForm(); onClose(); }}
      onRequestSubmit={handleSubmit}
      modalHeading="New Customer"
      primaryButtonText={loading ? 'Creating...' : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!name.trim() || loading}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <TextInput
          id="customer-name"
          labelText="Name"
          placeholder="Customer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <TextInput
          id="customer-company"
          labelText="Company"
          placeholder="Company name"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <TextInput
              id="customer-email"
              labelText="Email"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextInput
              id="customer-phone"
              labelText="Phone"
              placeholder="+1 234 567 890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <TextInput
          id="customer-website"
          labelText="Website"
          placeholder="https://example.com"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
        <TextArea
          id="customer-notes"
          labelText="Notes"
          placeholder="Additional notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}
