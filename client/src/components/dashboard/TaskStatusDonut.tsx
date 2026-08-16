import { useEffect, useRef, useState } from 'react';
import { SkeletonText } from '@carbon/react';
import { DonutChart } from '@carbon/charts-react';
import { gray50 } from '@carbon/colors';
import type { DashboardStats } from '../../types/dashboard';
import type { TaskStatusConfig } from '../../types/task';
import { taskStatusesApi } from '../../api/taskStatuses';
import { useUIStore } from '../../store/uiStore';

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
  const theme = useUIStore((s) => s.theme);
  // Task statuses are user-defined (task_statuses table), so the slices, their
  // labels and their colors all have to come from the server rather than a
  // hardcoded TODO/IN_PROGRESS/DONE triple.
  const [statuses, setStatuses] = useState<TaskStatusConfig[]>([]);

  useCenterDonut(containerRef);

  useEffect(() => {
    let cancelled = false;
    taskStatusesApi
      .getAll()
      .then(({ data: res }) => {
        if (!cancelled) setStatuses(res.data);
      })
      .catch(() => {
        /* fall back to raw status keys below */
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const total = Object.values(data).reduce((sum, n) => sum + n, 0);

  const configByName = new Map(statuses.map((s) => [s.name, s]));

  // Order by the user's configured status order, then any status that has
  // counts but no matching config (e.g. deleted mid-session).
  const names = [
    ...statuses.map((s) => s.name).filter((n) => n in data),
    ...Object.keys(data).filter((n) => !configByName.has(n)),
  ];

  const labelFor = (name: string) => configByName.get(name)?.label ?? name;

  const chartData = names.map((name) => ({
    group: labelFor(name),
    value: data[name] ?? 0,
  }));

  const colorScale: Record<string, string> = {};
  for (const name of names) {
    colorScale[labelFor(name)] = configByName.get(name)?.color ?? gray50;
  }

  const options = {
    title: 'Tasks by Status',
    // Follows the app theme. Hardcoding g100 kept the chart dark in light mode
    // and forced the transparent-background overrides in _dashboard.scss.
    theme,
    height: '100%',
    resizable: true,
    donut: {
      center: {
        label: 'Total',
        number: total,
      },
    },
    color: {
      scale: colorScale,
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
