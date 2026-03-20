import { useState } from 'react';
import { TextInput, TextArea } from '@carbon/react';
import { CreateSidePanel } from '@carbon/ibm-products';
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
      addNotification({ kind: 'success', title: 'Company created' });
      resetForm();
      onCreated();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create company' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <CreateSidePanel
      open={open}
      onRequestClose={() => { resetForm(); onClose(); }}
      onRequestSubmit={handleSubmit}
      title="New Company"
      subtitle="Add a new company to your CRM"
      formTitle="Company details"
      formDescription="Fill in the company information below."
      primaryButtonText={loading ? 'Creating...' : 'Create'}
      secondaryButtonText="Cancel"
      disableSubmit={!name.trim() || loading}
      selectorPageContent=".app-content"
      selectorPrimaryFocus="#customer-name"
    >
      <TextInput
        id="customer-name"
        labelText="Name"
        placeholder="Customer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        invalid={open && name.length > 0 && !name.trim()}
        invalidText="Name is required"
        className="create-side-panel__form-item"
      />
      <TextInput
        id="customer-company"
        labelText="Company"
        placeholder="Company name"
        value={company}
        onChange={(e) => setCompany(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextInput
        id="customer-email"
        labelText="Email"
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextInput
        id="customer-phone"
        labelText="Phone"
        placeholder="+1 234 567 890"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextInput
        id="customer-website"
        labelText="Website"
        placeholder="https://example.com"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextArea
        id="customer-notes"
        labelText="Notes"
        placeholder="Additional notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="create-side-panel__form-item"
      />
    </CreateSidePanel>
  );
}
