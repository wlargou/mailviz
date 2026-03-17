import { SkeletonText } from '@carbon/react';
import { GroupedBarChart } from '@carbon/charts-react';
import { ScaleTypes } from '@carbon/charts';
import { blue50, green40 } from '@carbon/colors';
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
      <div style={{ padding: '1rem' }}>
        <SkeletonText heading width="40%" />
        <div style={{ height: '250px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
      left: { mapsTo: 'value', title: 'Emails' },
      bottom: { mapsTo: 'date', scaleType: ScaleTypes.LABELS },
    },
    theme: 'g100' as const,
    height: '100%',
    resizable: true,
    color: {
      scale: {
        Received: blue50,
        Sent: green40,
      },
    },
    bars: {
      maxWidth: 16,
    },
    legend: {
      alignment: 'center' as const,
    },
    toolbar: {
      enabled: false,
    },
  };

  return (
    <div className="chart-fill">
      <GroupedBarChart data={chartData} options={options} />
    </div>
  );
}
