import { useCallback, useEffect, useState } from 'react';
import { OverflowMenu, OverflowMenuItem, SkeletonText } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { formatDistanceToNowStrict } from 'date-fns';
import { rfpsApi, type RfpThreads } from '../../api/rfps';
import { ThreadDetail } from '../mail/ThreadDetail';
import { useUIStore } from '../../store/uiStore';
import { decodeEntities } from '../../utils/text';
import { openRowOnClick } from '../../utils/rowOpen';

/**
 * The mail filed under a tender — the buyer's clarifications, the avis de
 * report — read beside the bid rather than hunted for in Mail. Threads are
 * filed from the mail reader, which offers it when a thread quotes the
 * tender's reference.
 */
export function RfpCorrespondence({ rfpId, onCount }: { rfpId: string; onCount?: (n: number) => void }) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [data, setData] = useState<RfpThreads | null>(null);
  const [open, setOpen] = useState<{ id: string; subject: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: res } = await rfpsApi.getThreads(rfpId);
      setData(res.data);
      onCount?.(res.data.threads.length);
    } catch {
      setData({ threads: [], hidden: 0 });
    }
  }, [rfpId, onCount]);

  useEffect(() => { void load(); }, [load]);

  const unfile = async (threadId: string) => {
    try {
      const { data: res } = await rfpsApi.unlinkThread(rfpId, threadId);
      setData(res.data);
      onCount?.(res.data.threads.length);
      addNotification({ kind: 'success', title: 'Thread unfiled' });
    } catch {
      addNotification({ kind: 'error', title: 'Could not unfile the thread' });
    }
  };

  if (!data) return <SkeletonText paragraph lineCount={3} />;

  return (
    <section className="rfp-detail__section" aria-labelledby="rfp-mail-heading">
      <div className="rfp-detail__section-header">
        <div>
          <h2 id="rfp-mail-heading" className="rfp-detail__section-title">Correspondence</h2>
          <p className="rfp-detail__section-subtitle">
            Mail filed under this tender. A thread that quotes the reference offers to file itself when you open it in Mail.
          </p>
        </div>
      </div>
      {data.threads.length === 0 ? (
        <p className="rfp-muted">No mail filed yet.</p>
      ) : (
        <ul className="rfp-mail">
          {data.threads.map((t) => (
            <li
              key={t.threadId}
              className="rfp-mail__row"
              onClick={openRowOnClick(() => setOpen({ id: t.threadId, subject: t.subject }))}
            >
              <span className="rfp-mail__what">
                <button type="button" className="table-title-button" onClick={() => setOpen({ id: t.threadId, subject: t.subject })}>
                  {decodeEntities(t.subject) || '(No subject)'}
                </button>
                <small>
                  {[t.from, t.messages > 1 ? `${t.messages} messages` : null, t.linkedBy ? `filed by ${t.linkedBy}` : null].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="rfp-muted">{formatDistanceToNowStrict(new Date(t.receivedAt), { addSuffix: true })}</span>
              <OverflowMenu flipped size="sm" iconDescription={`Actions for ${decodeEntities(t.subject)}`}>
                <OverflowMenuItem itemText="Unfile" onClick={() => void unfile(t.threadId)} />
              </OverflowMenu>
            </li>
          ))}
        </ul>
      )}
      {data.hidden > 0 && (
        <p className="rfp-muted">
          {data.hidden} more filed by others, in mailboxes you cannot read.
        </p>
      )}
      <SidePanel
        open={!!open}
        onRequestClose={() => setOpen(null)}
        title={decodeEntities(open?.subject) || 'Thread'}
        size="lg"
        className="mail-page__side-panel"
      >
        {open && <ThreadDetail threadId={open.id} onEmailAction={() => void load()} />}
      </SidePanel>
    </section>
  );
}
