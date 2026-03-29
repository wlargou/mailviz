import { Button, ClickableTile } from '@carbon/react';
import { ArrowLeft, CalendarHeatMap, Time, RecentlyViewed, Calendar } from '@carbon/icons-react';
import { subDays, subWeeks, subMonths, startOfDay, endOfDay } from 'date-fns';
import type { ReviewPeriod } from './ReviewPage';

const periods = [
  { label: '1 Day', icon: Time, getDates: () => ({ dateAfter: startOfDay(subDays(new Date(), 1)).toISOString(), dateBefore: endOfDay(new Date()).toISOString() }) },
  { label: '1 Week', icon: RecentlyViewed, getDates: () => ({ dateAfter: startOfDay(subWeeks(new Date(), 1)).toISOString(), dateBefore: endOfDay(new Date()).toISOString() }) },
  { label: '1 Month', icon: Calendar, getDates: () => ({ dateAfter: startOfDay(subMonths(new Date(), 1)).toISOString(), dateBefore: endOfDay(new Date()).toISOString() }) },
  { label: '3 Months', icon: CalendarHeatMap, getDates: () => ({ dateAfter: startOfDay(subMonths(new Date(), 3)).toISOString(), dateBefore: endOfDay(new Date()).toISOString() }) },
];

interface Props {
  onSelect: (period: ReviewPeriod) => void;
  onBack: () => void;
}

export function PeriodSelector({ onSelect, onBack }: Props) {
  return (
    <div className="review-period">
      <div className="page-header page-header--padded">
        <div className="page-header__info">
          <Button
            kind="ghost"
            size="sm"
            renderIcon={ArrowLeft}
            onClick={onBack}
            className="review-back-btn"
          >
            Back to Mail
          </Button>
          <h1>Review Emails</h1>
          <p className="page-header__subtitle">
            Choose a time period to catch up on emails you may have missed
          </p>
        </div>
      </div>
      <div className="review-period__grid">
        {periods.map((p) => (
          <ClickableTile
            key={p.label}
            className="review-period__tile"
            onClick={() => {
              const dates = p.getDates();
              onSelect({ label: p.label, ...dates });
            }}
          >
            <p.icon size={32} />
            <span className="review-period__label">{p.label}</span>
          </ClickableTile>
        ))}
      </div>
    </div>
  );
}
