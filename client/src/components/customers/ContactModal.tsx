import { useState, useEffect } from 'react';
import { Modal, TextInput } from '@carbon/react';
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
    <Modal
      open={open}
      onRequestClose={onClose}
      onRequestSubmit={handleSubmit}
      modalHeading={isEdit ? 'Edit Contact' : 'Add Contact'}
      primaryButtonText={loading ? 'Saving...' : isEdit ? 'Save' : 'Add'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!firstName.trim() || !lastName.trim() || loading}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <TextInput
              id="contact-first-name"
              labelText="First Name"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextInput
              id="contact-last-name"
              labelText="Last Name"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
        </div>
        <TextInput
          id="contact-email"
          labelText="Email"
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ flex: 1 }}>
            <TextInput
              id="contact-phone"
              labelText="Phone"
              placeholder="+1 234 567 890"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <TextInput
              id="contact-role"
              labelText="Role"
              placeholder="e.g. CEO, CTO, Manager"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
