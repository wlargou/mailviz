import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import type { CalendarDeadline } from '../../types/calendar';

const LABEL: Record<CalendarDeadline['kind'], string> = {
  RFP_DEADLINE: 'Tender deadline',
  RFP_QUESTIONS: 'Questions close',
  PIECE_DUE: 'Piece due',
  TASK_DUE: 'Task due',
};

/**
 * A dated thing that is not a meeting, drawn apart from meetings: a shape per
 * kind (▲ tender deadline, ◆ questions, ■ work due), its hour when it has one,
 * and a click that goes to the tender or task.
 */
export function DeadlineChip({ deadline }: { deadline: CalendarDeadline }) {
  const navigate = useNavigate();
  const at = new Date(deadline.at);
  const hasHour = at.getHours() !== 0 || at.getMinutes() !== 0;
  const label = `${LABEL[deadline.kind]}: ${deadline.title}${deadline.context ? ` (${deadline.context})` : ''}${hasHour ? `, ${format(at, 'HH:mm')}` : ''}`;
  return (
    <button
      type="button"
      className={`calendar-deadline calendar-deadline--${deadline.kind.toLowerCase().replace('_', '-')}`}
      onClick={(e) => {
        // Inside a day cell that navigates to the day itself.
        e.stopPropagation();
        navigate(deadline.href);
      }}
      title={label}
      aria-label={label}
    >
      <span className="calendar-deadline__shape" aria-hidden="true" />
      {hasHour && <span className="calendar-deadline__time">{format(at, 'HH:mm')}</span>}
      <span className="calendar-deadline__title">{deadline.title}</span>
    </button>
  );
}
