import { format, formatDistanceToNow } from 'date-fns';
import { Checkmark, Close, Time, WarningAlt } from '@carbon/icons-react';
import {
  personName,
  verificationStates,
  type RfpItem,
  type RfpPerson,
  type RfpVerifier,
  type VerificationState,
} from '../../types/rfp';

function initials(p: Pick<RfpPerson, 'name' | 'email'>): string {
  const parts = (p.name || p.email).split(/[\s@._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
}

/** A person's photo, or their initials when there is none. */
export function PersonAvatar({ person, size = 'sm' }: { person: Pick<RfpPerson, 'name' | 'email' | 'avatarUrl'>; size?: 'sm' | 'md' }) {
  return (
    <span className={`rfp-avatar rfp-avatar--${size}`} aria-hidden="true">
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(person)}
    </span>
  );
}

/** "3 hours ago", with the exact time on hover. */
export function When({ at }: { at: string }) {
  const d = new Date(at);
  // A missing date is left blank rather than taking the row down with it —
  // date-fns throws on an invalid one.
  if (Number.isNaN(d.getTime())) return null;
  return (
    <time dateTime={at} title={format(d, 'd MMM yyyy, HH:mm')}>
      {formatDistanceToNow(d, { addSuffix: true })}
    </time>
  );
}

export const VERIFICATION_STATE_LABELS: Record<VerificationState, string> = {
  approved: 'Approved',
  changes: 'Changes requested',
  // Their decision — approval or not — was on a version since replaced.
  stale: 'Earlier version',
  pending: 'Not verified yet',
};

const STATE_ICON: Record<VerificationState, typeof Checkmark> = {
  approved: Checkmark,
  changes: Close,
  stale: WarningAlt,
  pending: Time,
};

/**
 * Each verifier's standing on a piece, as a row of avatars ringed by state —
 * the at-a-glance answer to "who still has to look at this?". The count says
 * how many have approved the current version.
 */
export function VerificationSummary({ item, verifiers }: { item: Pick<RfpItem, 'documents' | 'verifications'>; verifiers: RfpVerifier[] }) {
  const states = verificationStates(item, verifiers);
  const approved = states.filter((s) => s.state === 'approved').length;
  return (
    <span className="rfp-verif-summary" aria-label={`${approved} of ${states.length} verifiers approved`}>
      {states.map(({ person, state }) => {
        const Icon = STATE_ICON[state];
        return (
          <span
            key={person.id}
            className={`rfp-verif-summary__person rfp-verif--${state}`}
            title={`${personName(person)} — ${VERIFICATION_STATE_LABELS[state]}`}
          >
            <PersonAvatar person={person} />
            <span className="rfp-verif-summary__badge">
              <Icon size={10} />
            </span>
          </span>
        );
      })}
      <span className="rfp-verif-summary__count">
        {approved}/{states.length}
      </span>
    </span>
  );
}
