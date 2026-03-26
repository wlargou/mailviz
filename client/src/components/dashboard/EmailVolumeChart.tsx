import { SkeletonText } from '@carbon/react';
import { StackedBarChart } from '@carbon/charts-react';
import { ScaleTypes } from '@carbon/charts';
import { format } from 'date-fns';
import type { DashboardStats } from '../../types/dashboard';

import '@carbon/charts-react/styles.css';

interface EmailVolumeChartProps {
  data: DashboardStats['charts']['emailVolume'] | undefined;
  loading: boolean;
}

export function EmailVolumeChart({ data, loading }: EmailVolumeChartProps) {
  if (loading || !data) {
    return (
      <div className="skeleton-block">
        <SkeletonText heading width="40%" />
        <div className="skeleton-chart">
          <SkeletonText paragraph lineCount={5} />
        </div>
      </div>
    );
  }

  const chartData = data.flatMap((d) => [
    { group: 'Received', date: format(new Date(d.date), 'MMM d'), value: d.received },
    { group: 'Sent', date: format(new Date(d.date), 'MMM d'), value: d.sent },
  ]);

  const options = {
    title: 'Email Volume (14 Days)',
    axes: {
      left: {
        mapsTo: 'value',
        title: 'Emails',
        stacked: true,
      },
      bottom: {
        mapsTo: 'date',
        scaleType: ScaleTypes.LABELS,
      },
    },
    // Use g90 (slightly lighter than g100) for transparent-friendly dark theme
    theme: 'g90' as const,
    height: '280px',
    resizable: true,
    color: {
      scale: {
        Received: 'var(--cds-link-primary, #78a9ff)',
        Sent: 'var(--cds-support-success, #42be65)',
      },
    },
    bars: {
      maxWidth: 20,
    },
    legend: {
      alignment: 'center' as const,
    },
    toolbar: {
      enabled: false,
    },
    grid: {
      x: { enabled: false },
      y: { enabled: true },
    },
  };

  return (
    <div className="email-volume-chart-wrapper">
      <StackedBarChart data={chartData} options={options} />
    </div>
  );
}
