import { useEffect, useState } from 'react';
import { Modal, SkeletonText, StructuredListBody, StructuredListCell, StructuredListRow, StructuredListWrapper, Tag } from '@carbon/react';
import { fetchServerVersion, type ServerVersion } from '../../api/auth';
import { MailvizLogo } from './MailvizLogo';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

/** Local time, so "when did this deploy" reads as a moment rather than a UTC string. */
function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * What is running, and where.
 *
 * A `passiveModal` because there is nothing to confirm — Carbon's own guidance
 * is that a dialog with no decision in it should not offer buttons that imply
 * one. It is a Modal rather than a SidePanel or Tearsheet by the same rubric
 * the rest of this app follows: a handful of read-only fields is the smallest
 * container, not the largest.
 *
 * It reports the CLIENT version and the SERVER version separately, and says so
 * when they differ. That is the whole reason this exists: the bundle in a tab
 * can be older than the deploy it is talking to, and "which version is in
 * production" has two answers that are usually — but not always — the same.
 */
export function AboutModal({ open, onClose }: AboutModalProps) {
  const [server, setServer] = useState<ServerVersion | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetchServerVersion()
      .then((v) => { if (!cancelled) setServer(v); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const clientVersion = __APP_VERSION__;
  const mismatch = server !== null && server.version !== clientVersion;

  return (
    <Modal
      open={open}
      passiveModal
      size="sm"
      modalHeading="About Mailviz"
      modalLabel="Version"
      onRequestClose={onClose}
    >
      <div className="about-modal">
        <div className="about-modal__brand">
          <MailvizLogo size={32} />
          <div>
            <p className="about-modal__name">Mailviz</p>
            <p className="about-modal__tagline">Personal CRM &amp; email manager</p>
          </div>
        </div>

        <StructuredListWrapper isCondensed aria-label="Version details">
          <StructuredListBody>
            <StructuredListRow>
              <StructuredListCell noWrap>This browser</StructuredListCell>
              <StructuredListCell>
                <code>{clientVersion}</code>
              </StructuredListCell>
            </StructuredListRow>

            <StructuredListRow>
              <StructuredListCell noWrap>Server</StructuredListCell>
              <StructuredListCell>
                {loading && <SkeletonText width="60%" />}
                {!loading && failed && (
                  <span className="about-modal__unreachable">Could not reach the server</span>
                )}
                {!loading && server && (
                  <>
                    <code>{server.version}</code>{' '}
                    {mismatch && (
                      // The case this dialog exists to make visible: a tab
                      // holding an older bundle than the server is running.
                      <Tag type="magenta" size="sm">Reload to update</Tag>
                    )}
                  </>
                )}
              </StructuredListCell>
            </StructuredListRow>

            <StructuredListRow>
              <StructuredListCell noWrap>Deployed</StructuredListCell>
              <StructuredListCell>
                {server ? when(server.startedAt) : '—'}
              </StructuredListCell>
            </StructuredListRow>

            <StructuredListRow>
              <StructuredListCell noWrap>Environment</StructuredListCell>
              <StructuredListCell>{server ? server.environment : '—'}</StructuredListCell>
            </StructuredListRow>

            <StructuredListRow>
              <StructuredListCell noWrap>This build</StructuredListCell>
              <StructuredListCell>{when(__BUILT_AT__)}</StructuredListCell>
            </StructuredListRow>
          </StructuredListBody>
        </StructuredListWrapper>
      </div>
    </Modal>
  );
}
