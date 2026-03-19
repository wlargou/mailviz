import { SkeletonText, Tag } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { Checkmark } from '@carbon/icons-react';
import type { DashboardStats } from '../../types/dashboard';

interface NeedsAttentionProps {
  customers: DashboardStats['needsAttention'] | undefined;
  loading: boolean;
}

export function NeedsAttention({ customers, loading }: NeedsAttentionProps) {
  const navigate = useNavigate();

  if (loading || !customers) {
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

  if (customers.length === 0) {
    return (
      <div className="needs-attention__empty">
        <Checkmark size={20} />
        <p>All customers are engaged</p>
      </div>
    );
  }

  return (
    <div className="needs-attention__list">
      {customers.map((customer) => (
        <div
          key={customer.id}
          className="needs-attention__row"
          role="button"
          tabIndex={0}
          onClick={() => navigate(`/customers/${customer.id}`)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/customers/${customer.id}`); } }}
        >
          <div className="needs-attention__logo">
            {customer.logoUrl ? (
              <img
                src={customer.logoUrl}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <span>{customer.name.substring(0, 2).toUpperCase()}</span>
            )}
          </div>
          <div className="needs-attention__info">
            <span className="needs-attention__name">{customer.name}</span>
            <span className="needs-attention__sub">
              {customer.lastContactedDaysAgo >= 999
                ? 'Never contacted'
                : `Last contacted ${customer.lastContactedDaysAgo} days ago`}
            </span>
          </div>
          {customer.openTaskCount > 0 && (
            <Tag size="sm" type="red">
              {customer.openTaskCount} open task{customer.openTaskCount !== 1 ? 's' : ''}
            </Tag>
          )}
        </div>
      ))}
    </div>
  );
}
