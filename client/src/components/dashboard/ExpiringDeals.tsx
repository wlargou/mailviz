import { SkeletonText, Tag } from '@carbon/react';
import { WarningAlt, Calendar } from '@carbon/icons-react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import type { DashboardStats } from '../../types/dashboard';

interface ExpiringDealsProps {
  deals: DashboardStats['expiringDeals'] | undefined;
  loading: boolean;
}

export function ExpiringDeals({ deals, loading }: ExpiringDealsProps) {
  const navigate = useNavigate();

  if (loading || !deals) {
    return (
      <div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-row--lg">
            <SkeletonText paragraph lineCount={2} />
          </div>
        ))}
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="card-empty">
        <p>No deals expiring in the next 15 days</p>
      </div>
    );
  }

  return (
    <div className="expiring-deals">
      {deals.map((deal) => (
        <div
          key={deal.id}
          className="expiring-deals__item"
          onClick={() => navigate('/deals')}
        >
          <div className="expiring-deals__icon">
            {deal.daysUntilExpiry <= 3 ? (
              <WarningAlt size={16} className="expiring-deals__icon--urgent" />
            ) : (
              <Calendar size={16} />
            )}
          </div>
          <div className="expiring-deals__info">
            <span className="expiring-deals__title">{deal.title}</span>
            <span className="expiring-deals__meta">
              {deal.partner.name}
              {deal.customer && ` · ${deal.customer.name}`}
            </span>
          </div>
          <div className="expiring-deals__expiry">
            <Tag
              size="sm"
              type={deal.daysUntilExpiry <= 3 ? 'red' : deal.daysUntilExpiry <= 7 ? 'warm-gray' : 'cool-gray'}
            >
              {deal.daysUntilExpiry === 0
                ? 'Today'
                : deal.daysUntilExpiry === 1
                  ? 'Tomorrow'
                  : `${deal.daysUntilExpiry} days`}
            </Tag>
          </div>
        </div>
      ))}
    </div>
  );
}
