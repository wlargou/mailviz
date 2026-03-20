import { SkeletonText, Button, Tag } from '@carbon/react';
import { ArrowRight, WarningAlt, Calendar } from '@carbon/icons-react';
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
        <SkeletonText paragraph lineCount={3} />
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
    <div className="dashboard-item-list">
      {deals.map((deal) => (
        <div
          key={deal.id}
          className={`dashboard-item dashboard-item--deal${deal.daysUntilExpiry <= 3 ? ' dashboard-item--urgent' : ''}`}
          onClick={() => navigate('/deals')}
        >
          <div className="dashboard-item__time">
            {deal.daysUntilExpiry === 0
              ? 'Today'
              : deal.daysUntilExpiry === 1
                ? '1 day'
                : `${deal.daysUntilExpiry} days`}
          </div>
          <div className="dashboard-item__info">
            <span className="dashboard-item__title">{deal.title}</span>
            <span className="dashboard-item__sub">
              {deal.partner.name}
              {deal.customer && ` · ${deal.customer.name}`}
            </span>
          </div>
          <div className="dashboard-item__tag">
            <Tag
              size="sm"
              type={deal.daysUntilExpiry <= 3 ? 'red' : deal.daysUntilExpiry <= 7 ? 'warm-gray' : 'cool-gray'}
            >
              {deal.status === 'TO_CHALLENGE' ? 'To Challenge' : deal.status === 'APPROVED' ? 'Approved' : deal.status}
            </Tag>
          </div>
        </div>
      ))}
      <Button kind="ghost" size="sm" renderIcon={ArrowRight} className="dashboard-item-list__view-all" onClick={() => navigate('/deals')}>
        View all deals
      </Button>
    </div>
  );
}
