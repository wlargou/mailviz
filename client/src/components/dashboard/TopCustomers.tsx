import { SkeletonText, Tag } from '@carbon/react';
import { useNavigate } from 'react-router-dom';
import { Email, TaskComplete } from '@carbon/icons-react';
import type { DashboardStats } from '../../types/dashboard';

interface TopCustomersProps {
  stats: DashboardStats | null;
  loading: boolean;
}

function getLogoUrl(domain: string | null, logoUrl: string | null): string | null {
  if (logoUrl) return logoUrl;
  if (domain) return `https://logo.clearbit.com/${domain}`;
  return null;
}

export function TopCustomers({ stats, loading }: TopCustomersProps) {
  const navigate = useNavigate();

  if (loading || !stats) {
    return (
      <div>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ padding: '0.5rem 1rem' }}>
            <SkeletonText paragraph lineCount={1} />
          </div>
        ))}
      </div>
    );
  }

  const { topCustomers } = stats.customers;

  if (topCustomers.length === 0) {
    return <div className="recent-activity__empty">No customer data yet</div>;
  }

  return (
    <div className="top-customers__list">
      {topCustomers.map((customer) => {
        const logo = getLogoUrl(customer.domain, customer.logoUrl);
        return (
          <div
            key={customer.id}
            className="top-customer__row"
            onClick={() => navigate(`/customers/${customer.id}`)}
          >
            {logo ? (
              <img
                src={logo}
                alt={customer.name}
                className="top-customer__logo"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="top-customer__logo top-customer__logo--placeholder">
                {customer.name.charAt(0).toUpperCase()}
              </div>
            )}
            <span className="top-customer__name">{customer.name}</span>
            <div className="top-customer__badges">
              <Tag size="sm" type="blue">
                <Email size={12} /> {customer.emailCount}
              </Tag>
              <Tag size="sm" type="gray">
                <TaskComplete size={12} /> {customer.taskCount}
              </Tag>
            </div>
          </div>
        );
      })}
    </div>
  );
}
