import { Tag } from '@carbon/react';
import type { tenderRisk } from '../../types/rfp';

type Risk = ReturnType<typeof tenderRisk>;

/**
 * "At risk" with the reason in its title: how much is ready against how much
 * of the time is gone. Overdue says so instead.
 */
export function RiskTag({ risk, size = 'sm' }: { risk: Risk; size?: 'sm' | 'md' }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const why = risk.overdue
    ? 'The deadline has passed and it is not submitted'
    : `${pct(risk.ready)} ready with ${pct(risk.timeUsed)} of the time used`;
  // The reason on a wrapper: Carbon's Tag sets its own title to its text.
  return (
    <span className="rfp-risk" title={why}>
      <Tag type="red" size={size} className="rfp-risk-tag">
        {risk.overdue ? '▲ Overdue' : '▲ At risk'}
      </Tag>
    </span>
  );
}

/** "3/10" and a bar — ready pieces of those that apply. */
export function ReadyMeter({ readiness }: { readiness: { ready: number; total: number } }) {
  if (readiness.total === 0) return <span className="rfp-muted">—</span>;
  const pct = Math.round((readiness.ready / readiness.total) * 100);
  return (
    <span className="rfp-ready" aria-label={`${readiness.ready} of ${readiness.total} pieces ready`}>
      <span className="rfp-ready__bar" aria-hidden="true">
        <span className={`rfp-ready__fill${pct === 100 ? ' rfp-ready__fill--done' : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="rfp-ready__count">
        {readiness.ready}/{readiness.total}
      </span>
    </span>
  );
}

/**
 * Ready against time used, as two bars side by side — the at-risk rule made
 * visible. When the first is shorter than the second, the tender is behind.
 */
export function TimeUsed({ risk }: { risk: Risk }) {
  const pct = (n: number) => Math.round(n * 100);
  return (
    <div className="rfp-time-used" aria-label={`${pct(risk.ready)}% ready, ${pct(risk.timeUsed)}% of the time used`}>
      <span className="rfp-time-used__label">Ready</span>
      <span className="rfp-time-used__bar">
        <span className={`rfp-time-used__fill${risk.atRisk ? ' rfp-time-used__fill--behind' : ''}`} style={{ width: `${pct(risk.ready)}%` }} />
      </span>
      <span className="rfp-time-used__pct">{pct(risk.ready)}%</span>
      <span className="rfp-time-used__label">Time used</span>
      <span className="rfp-time-used__bar">
        <span className="rfp-time-used__fill rfp-time-used__fill--time" style={{ width: `${pct(risk.timeUsed)}%` }} />
      </span>
      <span className="rfp-time-used__pct">{pct(risk.timeUsed)}%</span>
    </div>
  );
}
