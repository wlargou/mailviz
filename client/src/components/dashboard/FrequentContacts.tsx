import { SkeletonText, Tag } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { Email } from '@carbon/icons-react';
import type { DashboardStats } from '../../types/dashboard';

interface FrequentContactsProps {
  contacts: DashboardStats['frequentContacts'] | undefined;
  loading: boolean;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

export function FrequentContacts({ contacts, loading }: FrequentContactsProps) {
  const navigate = useNavigate();

  if (loading || !contacts) {
    return (
      <div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-row">
            <SkeletonText paragraph lineCount={2} />
          </div>
        ))}
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="frequent-contacts__empty">
        <Email size={20} />
        <p>No email data yet</p>
      </div>
    );
  }

  return (
    <div className="frequent-contacts__list">
      {contacts.map((contact) => (
        <div
          key={contact.email}
          className={`frequent-contacts__row${contact.contactId ? ' frequent-contacts__row--clickable' : ''}`}
          role={contact.contactId ? 'button' : undefined}
          tabIndex={contact.contactId ? 0 : undefined}
          onClick={() => {
            if (contact.contactId) navigate(`/contacts/${contact.contactId}`);
          }}
          onKeyDown={(e) => { if (contact.contactId && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/contacts/${contact.contactId}`); } }}
        >
          <div className="frequent-contacts__avatar">
            {getInitials(contact.name, contact.email)}
          </div>
          <div className="frequent-contacts__info">
            <span className="frequent-contacts__name">{contact.name || contact.email}</span>
            {contact.company && (
              <span className="frequent-contacts__company">{contact.company}</span>
            )}
          </div>
          <Tag size="sm" type="blue">{contact.messageCount}</Tag>
        </div>
      ))}
    </div>
  );
}
