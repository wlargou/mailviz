import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActionableNotification, Tag } from '@carbon/react';
import { rfpsApi, type ThreadTenders as Tenders } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';

/**
 * At the top of a thread: the tender it is filed under, or — when it quotes a
 * tender's reference and is not filed — an offer to file it. Filing puts the
 * buyer's clarifications on the tender's page, where the bid is prepared.
 */
export function ThreadTenders({ threadId }: { threadId: string }) {
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const [data, setData] = useState<Tenders | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setData(null);
    rfpsApi.getThreadTenders(threadId)
      .then(({ data: res }) => { if (live) setData(res.data); })
      .catch(() => { /* no banner is the right failure */ });
    return () => { live = false; };
  }, [threadId]);

  if (!data) return null;
  const offer = data.suggested.find((r) => !dismissed.has(r.id));

  const file = async (rfpId: string, name: string) => {
    try {
      await rfpsApi.linkThread(rfpId, threadId);
      const { data: res } = await rfpsApi.getThreadTenders(threadId);
      setData(res.data);
      addNotification({ kind: 'success', title: `Filed under “${name}”` });
    } catch {
      addNotification({ kind: 'error', title: 'Could not file the thread' });
    }
  };

  return (
    <div className="thread-tenders">
      {data.linked.map((r) => (
        <Tag key={r.id} type="purple" size="sm" className="clickable-tag" onClick={() => navigate(`/rfps/${r.id}`)} title={`Filed under ${r.reference}`}>
          Tender · {r.name}
        </Tag>
      ))}
      {offer && (
        <ActionableNotification
          inline
          lowContrast
          kind="info"
          title="This thread quotes a tender"
          subtitle={`${offer.reference} — ${offer.name}`}
          actionButtonLabel="File under it"
          onActionButtonClick={() => void file(offer.id, offer.name)}
          onClose={() => { setDismissed((d) => new Set(d).add(offer.id)); }}
          statusIconDescription="Information"
        />
      )}
    </div>
  );
}
