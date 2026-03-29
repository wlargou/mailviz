import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PeriodSelector } from './PeriodSelector';
import { CustomerSummary } from './CustomerSummary';
import { ReviewMailView } from './ReviewMailView';

export type ReviewPeriod = {
  label: string;
  dateAfter: string;
  dateBefore: string;
};

type Step = 'period' | 'customers' | 'review';

export function ReviewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('period');
  const [period, setPeriod] = useState<ReviewPeriod | null>(null);
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [includeUncategorized, setIncludeUncategorized] = useState(false);

  const handlePeriodSelect = (p: ReviewPeriod) => {
    setPeriod(p);
    setStep('customers');
  };

  const handleCustomersConfirm = (ids: string[], inclUncat: boolean) => {
    setSelectedCustomerIds(ids);
    setIncludeUncategorized(inclUncat);
    setStep('review');
  };

  const handleBack = () => {
    if (step === 'customers') setStep('period');
    else if (step === 'review') setStep('customers');
    else navigate('/mail');
  };

  return (
    <div className="review-page">
      {step === 'period' && (
        <PeriodSelector
          onSelect={handlePeriodSelect}
          onBack={() => navigate('/mail')}
        />
      )}
      {step === 'customers' && period && (
        <CustomerSummary
          period={period}
          onConfirm={handleCustomersConfirm}
          onBack={handleBack}
        />
      )}
      {step === 'review' && period && (
        <ReviewMailView
          period={period}
          customerIds={selectedCustomerIds}
          includeUncategorized={includeUncategorized}
          onBack={handleBack}
        />
      )}
    </div>
  );
}
