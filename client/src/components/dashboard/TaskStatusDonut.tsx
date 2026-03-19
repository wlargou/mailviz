import { useEffect, useRef } from 'react';
import { SkeletonText } from '@carbon/react';
import { DonutChart } from '@carbon/charts-react';
import { blue50, yellow30, green40 } from '@carbon/colors';
import type { DashboardStats } from '../../types/dashboard';

import '@carbon/charts-react/styles.css';

interface TaskStatusDonutProps {
  data: DashboardStats['charts']['taskStatusCounts'] | undefined;
  loading: boolean;
}

/**
 * Carbon Charts positions the donut SVG with a fixed `x` attribute that
 * doesn't account for bottom-legend layout, leaving the donut left-aligned.
 * This hook watches for resizes and recenters the inner SVG.
 */
function useCenterDonut(containerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const center = () => {
      const outer = el.querySelector<SVGSVGElement>('svg.layout-svg-wrapper');
      const inner = outer?.querySelector<SVGSVGElement>(':scope > svg.cds--cc--donut');
      if (!outer || !inner) return;
      const outerWidth = outer.getBoundingClientRect().width;
      inner.setAttribute('x', String(Math.round(outerWidth / 2)));
    };

    // Initial center after chart renders
    const timer = setTimeout(center, 100);

    const ro = new ResizeObserver(center);
    ro.observe(el);

    return () => {
      clearTimeout(timer);
      ro.disconnect();
    };
  }, [containerRef]);
}

export function TaskStatusDonut({ data, loading }: TaskStatusDonutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useCenterDonut(containerRef);

  if (loading || !data) {
    return (
      <div className="skeleton-block">
        <SkeletonText heading width="40%" />
        <div className="skeleton-chart">
          <SkeletonText paragraph lineCount={3} />
        </div>
      </div>
    );
  }

  const total = (data.TODO || 0) + (data.IN_PROGRESS || 0) + (data.DONE || 0);

  const chartData = [
    { group: 'To Do', value: data.TODO || 0 },
    { group: 'In Progress', value: data.IN_PROGRESS || 0 },
    { group: 'Done', value: data.DONE || 0 },
  ];

  const options = {
    title: 'Tasks by Status',
    theme: 'g100' as const,
    height: '100%',
    resizable: true,
    donut: {
      center: {
        label: 'Total',
        number: total,
      },
    },
    color: {
      scale: {
        'To Do': blue50,
        'In Progress': yellow30,
        Done: green40,
      },
    },
    legend: {
      alignment: 'center' as const,
      position: 'bottom' as const,
    },
    toolbar: {
      enabled: false,
    },
  };

  return (
    <div className="chart-fill" ref={containerRef}>
      <DonutChart data={chartData} options={options} />
    </div>
  );
}
