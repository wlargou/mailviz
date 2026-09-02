import { useEffect, useState } from 'react';
import { Modal, SkeletonText, Tag } from '@carbon/react';
import { fetchServerVersion, type ServerVersion } from '../../api/auth';
import { MailvizLogo } from './MailvizLogo';

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

/** A date a person reads, in their own locale and zone. */
function releaseDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { dateStyle: 'long' });
}

/**
 * What this is and when it shipped. Nothing else.
 *
 * An earlier version listed the browser's build, the server's build, the
 * environment and two timestamps. That is a diagnostic panel, not an About
 * box: it asks the reader to work out which of two numbers is "the version",
 * which is a question they should never have been handed.
 *
 * So one version is shown — the SERVER's, because that is what "the app" is —
 * and one date. The client's own build is still fetched and compared, but only
 * to answer a question the reader cannot: whether this tab is running what the
 * server is. When it is not, the number on screen would otherwise be quietly
 * wrong for them, so a reload prompt appears. That is an action, not a detail.
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

  // Falls back to the bundle's own version when the server cannot be reached,
  // so the dialog still answers its one question offline.
  const shownVersion = server?.version ?? __APP_VERSION__;
  const stale = server !== null && server.version !== __APP_VERSION__;

  return (
    <Modal
      open={open}
      passiveModal
      size="sm"
      modalHeading="About Mailviz"
      onRequestClose={onClose}
    >
      <div className="about-modal">
        <MailvizLogo size={40} />

        <p className="about-modal__name">Mailviz</p>
        <p className="about-modal__tagline">Personal CRM &amp; email manager</p>

        {loading ? (
          <SkeletonText width="50%" />
        ) : (
          <>
            <p className="about-modal__version">
              Version <code>{shownVersion}</code>
            </p>
            <p className="about-modal__released">
              {failed
                ? 'Release date unavailable offline'
                : server
                  ? `Released ${releaseDate(server.releasedAt)}`
                  : ''}
            </p>
            {stale && (
              // The one thing the reader cannot work out for themselves: the
              // page they are on is older than the app it is talking to.
              <Tag type="magenta" size="sm">Reload to update</Tag>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
