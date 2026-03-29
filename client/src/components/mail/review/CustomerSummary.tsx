import { useEffect, useState } from 'react';
import { Button, SkeletonText, Tag, Checkbox } from '@carbon/react';
import { ArrowLeft, ArrowRight, StarFilled, Email as EmailIcon } from '@carbon/icons-react';
import { emailsApi } from '../../../api/emails';
import type { ReviewPeriod } from './ReviewPage';

interface CustomerRow {
  customerId: string;
  customerName: string;
  customerDomain: string;
  customerLogoUrl: string | null;
  isVip: boolean;
  totalEmails: number;
  unreadEmails: number;
}

interface Props {
  period: ReviewPeriod;
  onConfirm: (customerIds: string[], includeUncategorized: boolean) => void;
  onBack: () => void;
}

export function CustomerSummary({ period, onConfirm, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [uncategorized, setUncategorized] = useState({ totalEmails: 0, unreadEmails: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [includeUncat, setIncludeUncat] = useState(false);

  useEffect(() => {
    setLoading(true);
    emailsApi
      .getReviewSummary({ dateAfter: period.dateAfter, dateBefore: period.dateBefore })
      .then((res) => {
        setCustomers(res.data.data);
        setUncategorized(res.data.uncategorized);
        // Pre-select all customers
        setSelectedIds(new Set(res.data.data.map((c) => c.customerId)));
        setIncludeUncat(res.data.uncategorized.totalEmails > 0);
      })
      .finally(() => setLoading(false));
  }, [period]);

  const toggleCustomer = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === customers.length) {
      setSelectedIds(new Set());
      setIncludeUncat(false);
    } else {
      setSelectedIds(new Set(customers.map((c) => c.customerId)));
      if (uncategorized.totalEmails > 0) setIncludeUncat(true);
    }
  };

  const totalSelected = selectedIds.size + (includeUncat ? 1 : 0);
  const totalEmails = customers
    .filter((c) => selectedIds.has(c.customerId))
    .reduce((sum, c) => sum + c.totalEmails, 0)
    + (includeUncat ? uncategorized.totalEmails : 0);

  return (
    <div className="review-customers">
      <div className="page-header page-header--padded">
        <div className="page-header__info">
          <Button
            kind="ghost"
            size="sm"
            renderIcon={ArrowLeft}
            onClick={onBack}
            className="review-back-btn"
          >
            Back
          </Button>
          <h1>Select Companies</h1>
          <p className="page-header__subtitle">
            Reviewing emails from the last {period.label.toLowerCase()}
            {' '}&middot;{' '}
            {totalSelected} selected &middot; {totalEmails} emails
          </p>
        </div>
        <div className="page-header__actions">
          <Button kind="ghost" size="sm" onClick={toggleAll}>
            {selectedIds.size === customers.length ? 'Deselect all' : 'Select all'}
          </Button>
          <Button
            kind="primary"
            size="sm"
            renderIcon={ArrowRight}
            disabled={totalSelected === 0}
            onClick={() => onConfirm(Array.from(selectedIds), includeUncat)}
          >
            Start Review
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="review-customers__list">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="review-customer-row">
              <SkeletonText heading width="40%" />
              <SkeletonText width="60%" />
            </div>
          ))}
        </div>
      ) : customers.length === 0 && uncategorized.totalEmails === 0 ? (
        <div className="review-customers__empty">
          <EmailIcon size={48} />
          <p>No emails found in the last {period.label.toLowerCase()}</p>
          <Button kind="tertiary" size="sm" onClick={onBack}>
            Choose a different period
          </Button>
        </div>
      ) : (
        <div className="review-customers__list">
          {customers.map((c) => (
            <div
              key={c.customerId}
              className={`review-customer-row${selectedIds.has(c.customerId) ? ' review-customer-row--selected' : ''}`}
              onClick={() => toggleCustomer(c.customerId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCustomer(c.customerId); } }}
            >
              <div className="review-customer-row__check">
                <Checkbox
                  id={`cust-${c.customerId}`}
                  labelText=""
                  hideLabel
                  checked={selectedIds.has(c.customerId)}
                  onChange={() => {}}
                />
              </div>
              <div className="review-customer-row__info">
                <div className="review-customer-row__name">
                  {c.customerLogoUrl && (
                    <img src={c.customerLogoUrl} alt="" className="review-customer-row__logo" />
                  )}
                  <span>{c.customerName}</span>
                  {c.isVip && <StarFilled size={14} className="vip-star" />}
                </div>
                <span className="review-customer-row__domain">{c.customerDomain}</span>
              </div>
              <div className="review-customer-row__stats">
                <Tag size="sm" type="cool-gray">{c.totalEmails} emails</Tag>
                {c.unreadEmails > 0 && (
                  <Tag size="sm" type="blue">{c.unreadEmails} unread</Tag>
                )}
              </div>
            </div>
          ))}
          {uncategorized.totalEmails > 0 && (
            <div
              className={`review-customer-row${includeUncat ? ' review-customer-row--selected' : ''}`}
              onClick={() => setIncludeUncat((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIncludeUncat((v) => !v); } }}
            >
              <div className="review-customer-row__check">
                <Checkbox
                  id="cust-uncategorized"
                  labelText=""
                  hideLabel
                  checked={includeUncat}
                  onChange={() => {}}
                />
              </div>
              <div className="review-customer-row__info">
                <div className="review-customer-row__name">
                  <span>Uncategorized</span>
                </div>
                <span className="review-customer-row__domain">Emails not linked to a company</span>
              </div>
              <div className="review-customer-row__stats">
                <Tag size="sm" type="cool-gray">{uncategorized.totalEmails} emails</Tag>
                {uncategorized.unreadEmails > 0 && (
                  <Tag size="sm" type="blue">{uncategorized.unreadEmails} unread</Tag>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
