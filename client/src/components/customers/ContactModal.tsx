import { useState, useEffect } from 'react';
import { TextInput } from '@carbon/react';
import { CreateSidePanel } from '@carbon/ibm-products';
import { contactsApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import type { Contact } from '../../types/customer';

interface ContactModalProps {
  open: boolean;
  contact: Contact | null; // null = create mode
  customerId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function ContactModal({ open, contact, customerId, onClose, onSaved }: ContactModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const isEdit = !!contact;

  useEffect(() => {
    if (contact) {
      setFirstName(contact.firstName);
      setLastName(contact.lastName);
      setEmail(contact.email || '');
      setPhone(contact.phone || '');
      setRole(contact.role || '');
    } else {
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setRole('');
    }
  }, [contact, open]);

  const handleSubmit = async () => {
    if (!firstName.trim() || !lastName.trim()) return;
    setLoading(true);
    try {
      if (isEdit) {
        await contactsApi.update(contact.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          role: role.trim() || undefined,
        });
        addNotification({ kind: 'success', title: 'Contact updated' });
      } else {
        await contactsApi.create({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          role: role.trim() || undefined,
          customerId,
        });
        addNotification({ kind: 'success', title: 'Contact created' });
      }
      onSaved();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: `Failed to ${isEdit ? 'update' : 'create'} contact` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <CreateSidePanel
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      title={isEdit ? 'Edit Contact' : 'Add Contact'}
      subtitle={isEdit ? 'Update contact information' : 'Add a new contact to this customer'}
      formTitle="Contact details"
      formDescription="Provide the contact's name and optional details."
      primaryButtonText={loading ? 'Saving...' : isEdit ? 'Save' : 'Add'}
      secondaryButtonText="Cancel"
      disableSubmit={!firstName.trim() || !lastName.trim() || loading}
      selectorPageContent=".app-content"
      selectorPrimaryFocus="#contact-first-name"
    >
      <TextInput
        id="contact-first-name"
        labelText="First Name"
        placeholder="First name"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        invalid={open && firstName.length > 0 && !firstName.trim()}
        invalidText="First name is required"
        className="create-side-panel__form-item"
      />
      <TextInput
        id="contact-last-name"
        labelText="Last Name"
        placeholder="Last name"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        invalid={open && lastName.length > 0 && !lastName.trim()}
        invalidText="Last name is required"
        className="create-side-panel__form-item"
      />
      <TextInput
        id="contact-email"
        labelText="Email"
        placeholder="email@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextInput
        id="contact-phone"
        labelText="Phone"
        placeholder="+1 234 567 890"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="create-side-panel__form-item"
      />
      <TextInput
        id="contact-role"
        labelText="Role"
        placeholder="e.g. CEO, CTO, Manager"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="create-side-panel__form-item"
      />
    </CreateSidePanel>
  );
}
