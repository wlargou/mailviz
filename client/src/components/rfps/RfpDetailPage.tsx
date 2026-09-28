import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
  Button,
  Grid,
  Column,
  OverflowMenu,
  OverflowMenuItem,
  ProgressBar,
  SkeletonText,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Tag,
  Tile,
} from '@carbon/react';
import { Edit, Launch, Share, UserMultiple } from '@carbon/icons-react';
import { format } from 'date-fns';
import { PageHeader } from '../shared/PageHeader';
import { EmptyState } from '../shared/EmptyState';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { ShareDialog } from '../shared/ShareDialog';
import { SharedBadge } from '../shared/SharedBadge';
import { RfpFormPanel } from './RfpFormPanel';
import { RfpDocuments } from './RfpDocuments';
import { RfpLotsSection } from './RfpLotsSection';
import { RfpResponseSection } from './RfpResponseSection';
import { RfpCorrespondence } from './RfpCorrespondence';
import { RfpVerifiersModal } from './RfpVerifiersModal';
import { PersonAvatar } from './RfpPeople';
import { deadlineTone } from './RfpsPage';
import { RiskTag, TimeUsed } from './RfpRisk';
import { rfpsApi } from '../../api/rfps';
import { useUIStore } from '../../store/uiStore';
import { useAuthStore } from '../../store/authStore';
import {
  formatBudget,
  personName,
  readiness,
  tenderRisk,
  verificationStates,
  RFP_STATUS_LABELS,
  RFP_STATUS_TAG_TYPE,
  RFP_SUBMISSION_FORMAT_LABELS,
  RFP_TERMINAL_STATUSES,
  type RfpCatalogueEntry,
  type RfpDetail,
} from '../../types/rfp';
import { shortDate, timeLeft } from '../../utils/dates';

type Shares = Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }>;

/**
 * One tender: what it is, when it is due, its lots, and — the reason to open
 * it — the response being prepared, dossier by dossier and piece by piece.
 *
 * A page rather than the panel it replaces, because this is where the work
 * happens for the weeks a tender is open, and a panel over the register is
 * the wrong shape for somewhere people stay.
 */
export function RfpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [rfp, setRfp] = useState<RfpDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [catalogue, setCatalogue] = useState<RfpCatalogueEntry[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shares, setShares] = useState<Shares>([]);
  const [verifiersOpen, setVerifiersOpen] = useState(false);

  /** Re-read without the skeleton — every edit on the page ends here. */
  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const { data: res } = await rfpsApi.getById(id);
      setRfp(res.data);
      setNotFound(false);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) setNotFound(true);
      else addNotification({ kind: 'error', title: 'Failed to load the RFP' });
    }
  }, [id, addNotification]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    rfpsApi
      .getCatalogue()
      .then(({ data: res }) => setCatalogue(res.data))
      .catch(() => {
        /* only "Add dossier" needs it, and it says so when empty */
      });
  }, []);

  const fetchShares = useCallback(async () => {
    if (!id) return;
    try {
      const { data: res } = await rfpsApi.getRfpShares(id);
      setShares(res.data);
    } catch {
      setShares([]);
    }
  }, [id]);

  if (loading) {
    return (
      <Grid fullWidth>
        <Column lg={16} md={8} sm={4}>
          <SkeletonText heading width="40%" />
          <SkeletonText paragraph lineCount={4} />
        </Column>
      </Grid>
    );
  }

  if (notFound || !rfp) {
    return (
      <EmptyState
        title="RFP not found"
        description="It may have been deleted, or it is not shared with you."
        action={<Button onClick={() => navigate('/rfps')}>Back to RFPs</Button>}
      />
    );
  }

  const isOwner = rfp.userId === currentUserId;
  const tone = deadlineTone(rfp.deadlineAt, rfp.status);
  const allItems = rfp.folders.flatMap((f) => f.items);
  const { ready, total } = readiness(allItems);
  const risk = tenderRisk(rfp, { ready, total });
  const preparing = !RFP_TERMINAL_STATUSES.includes(rfp.status) && rfp.status !== 'SUBMITTED';
  const fileCount = allItems.reduce((n, i) => n + i.documents.length, 0);
  // What is waiting on the signed-in user: pieces with a file whose current
  // version they have not decided on.
  const awaitingMe = rfp.verifiers.some((v) => v.userId === currentUserId)
    ? allItems.filter(
        (i) => i.status !== 'NOT_APPLICABLE' && verificationStates(i, rfp.verifiers).some((s) => s.person.id === currentUserId && (s.state === 'pending' || s.state === 'stale')) && i.documents.length > 0,
      ).length
    : 0;

  const handleDelete = async () => {
    try {
      await rfpsApi.delete(rfp.id);
      addNotification({ kind: 'success', title: 'RFP deleted' });
      navigate('/rfps');
    } catch {
      addNotification({ kind: 'error', title: 'Failed to delete the RFP' });
    }
  };

  const documentsTotal = rfp.documents.length + fileCount;

  return (
    <div className="rfp-detail">
      <PageHeader
        title={rfp.name}
        subtitle={[rfp.reference, rfp.customer?.name].filter(Boolean).join(' · ')}
        breadcrumbs={[{ label: 'Pursuits', href: '/pursuits' }]}
        actions={
          // One primary action, one secondary, and Delete out of reach of a
          // stray click — three buttons in three styles said nothing about
          // which mattered.
          <div className="rfp-detail__actions">
            {isOwner && (
              <Button
                kind="tertiary"
                size="md"
                renderIcon={Share}
                onClick={async () => {
                  setShareOpen(true);
                  await fetchShares();
                }}
              >
                Share
              </Button>
            )}
            <Button kind="primary" size="md" renderIcon={Edit} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            {isOwner && (
              <OverflowMenu flipped size="md" iconDescription="More actions">
                <OverflowMenuItem itemText="Delete RFP" isDelete onClick={() => setDeleteOpen(true)} />
              </OverflowMenu>
            )}
          </div>
        }
      />

      <div className="rfp-detail__tags">
        <Tag type={RFP_STATUS_TAG_TYPE[rfp.status]} size="md">{RFP_STATUS_LABELS[rfp.status]}</Tag>
        {rfp.isGoe && <Tag type="teal" size="md">GOE</Tag>}
        {risk.atRisk && <RiskTag risk={risk} size="md" />}
        <SharedBadge ownerId={rfp.userId} />
      </div>

      {/* Only when there is someone to verify: on a tender nobody else can
          open, "Verifiers: None" read as a warning about nothing. */}
      {(rfp.verifiers.length > 0 || (rfp._count?.shares ?? 0) > 0) && (
      <div className="rfp-detail__verifiers">
        <span className="rfp-detail__verifiers-label">Verifiers</span>
        {rfp.verifiers.length === 0 ? (
          <span className="rfp-piece-panel__muted">None — pieces are marked Ready by hand</span>
        ) : (
          rfp.verifiers.map((v) => (
            <span key={v.id} className="rfp-detail__verifier">
              <PersonAvatar person={v.user} />
              {personName(v.user)}
            </span>
          ))
        )}
        {isOwner && (
          <Button kind="ghost" size="sm" renderIcon={UserMultiple} onClick={() => setVerifiersOpen(true)}>
            {rfp.verifiers.length === 0 ? 'Add verifiers' : 'Manage'}
          </Button>
        )}
      </div>
      )}

      <div className="rfp-detail__summary">
        <Tile className="rfp-detail__tile">
          <p className="rfp-detail__tile-label">Submission deadline</p>
          <p className="rfp-detail__tile-value">
            <span className={`rfp-deadline rfp-deadline--${tone}`}>
              {shortDate(rfp.deadlineAt, { dayFirst: true })}
              <span className="rfp-deadline__time">{format(new Date(rfp.deadlineAt), 'HH:mm')}</span>
            </span>
          </p>
          <p className="rfp-detail__tile-hint">
            {/* Time left, not a bucket: "Due within a week" said the same
                thing at six days as at two hours. A finished tender has no
                countdown — its date is history. */}
            {RFP_TERMINAL_STATUSES.includes(rfp.status)
              ? format(new Date(rfp.deadlineAt), 'EEEE')
              : `${timeLeft(rfp.deadlineAt)} · ${format(new Date(rfp.deadlineAt), 'EEEE')}`}
          </p>
          {rfp.questionsDeadlineAt && (
            <p className="rfp-detail__tile-hint rfp-detail__questions">
              Questions close {shortDate(rfp.questionsDeadlineAt, { dayFirst: true })}{' '}
              {format(new Date(rfp.questionsDeadlineAt), 'HH:mm')}
              {!RFP_TERMINAL_STATUSES.includes(rfp.status) && ` · ${timeLeft(rfp.questionsDeadlineAt)}`}
            </p>
          )}
        </Tile>

        <Tile className="rfp-detail__tile">
          <p className="rfp-detail__tile-label">Submission</p>
          <p className="rfp-detail__tile-value">{RFP_SUBMISSION_FORMAT_LABELS[rfp.submissionFormat]}</p>
          {rfp.submissionFormat === 'PORTAL' && rfp.portalUrl ? (
            <a className="rfp-detail__tile-hint cds--link" href={rfp.portalUrl} target="_blank" rel="noopener noreferrer">
              Open the buyer&apos;s portal <Launch size={12} />
            </a>
          ) : (
            <p className="rfp-detail__tile-hint">{rfp.submissionFormat === 'PAPER' ? 'Sealed envelopes, by hand' : ' '}</p>
          )}
        </Tile>

        <Tile className="rfp-detail__tile">
          <p className="rfp-detail__tile-label">Budget</p>
          <p className="rfp-detail__tile-value">{rfp.isGoe ? formatBudget(rfp.budget) : 'Not published'}</p>
          <p className="rfp-detail__tile-hint">
            {rfp.lots.length === 1 ? rfp.lots[0].title : `${rfp.lots.length} lots`}
          </p>
        </Tile>

        <Tile className="rfp-detail__tile">
          <p className="rfp-detail__tile-label">Preparation</p>
          {/* While it is being prepared, readiness is shown against the time
              used — the at-risk rule made visible. Otherwise a plain bar. */}
          {preparing && total > 0 ? (
            <>
              <TimeUsed risk={risk} />
              <p className="rfp-detail__tile-hint">
                {ready} of {total} pieces ready
              </p>
            </>
          ) : (
            <ProgressBar
              label="Pieces ready"
              hideLabel
              value={ready}
              max={Math.max(total, 1)}
              size="big"
              status={total > 0 && ready === total ? 'finished' : 'active'}
              helperText={total === 0 ? 'Nothing to prepare yet' : `${ready} of ${total} pieces ready`}
            />
          )}
          {awaitingMe > 0 && (
            <p className="rfp-detail__tile-hint rfp-detail__awaiting">
              {awaitingMe} awaiting your verification
            </p>
          )}
        </Tile>
      </div>

      {rfp.notes && <p className="rfp-detail__notes">{rfp.notes}</p>}

      <Tabs>
        <TabList aria-label="RFP sections">
          <Tab>Response ({ready}/{total})</Tab>
          <Tab>Lots ({rfp.lots.length})</Tab>
          <Tab>Tender documents ({rfp.documents.length})</Tab>
          <Tab>Correspondence</Tab>
        </TabList>
        <TabPanels>
          <TabPanel className="rfp-detail__panel">
            <RfpResponseSection rfp={rfp} catalogue={catalogue} currentUserId={currentUserId} onLocalChange={(update) => setRfp((r) => (r ? update(r) : r))} onRefresh={refresh} />
          </TabPanel>
          <TabPanel className="rfp-detail__panel">
            <RfpLotsSection rfp={rfp} onRefresh={refresh} />
          </TabPanel>
          <TabPanel className="rfp-detail__panel">
            <section className="rfp-detail__section" aria-labelledby="rfp-documents-heading">
              <div className="rfp-detail__section-header">
                <div>
                  <h2 id="rfp-documents-heading" className="rfp-detail__section-title">Tender documents</h2>
                  <p className="rfp-detail__section-subtitle">What the buyer published — the RC, the CPS, the Avis and the annexes</p>
                </div>
              </div>
              <RfpDocuments rfpId={rfp.id} documents={rfp.documents} onUploaded={refresh} />
            </section>
          </TabPanel>
          <TabPanel className="rfp-detail__panel">
            <RfpCorrespondence rfpId={rfp.id} />
          </TabPanel>
        </TabPanels>
      </Tabs>

      {verifiersOpen && (
        <RfpVerifiersModal
          rfp={rfp}
          onClose={() => setVerifiersOpen(false)}
          onSaved={async () => {
            setVerifiersOpen(false);
            await refresh();
          }}
        />
      )}

      <RfpFormPanel open={editOpen} rfp={rfp} onClose={() => setEditOpen(false)} onSaved={refresh} />

      {shareOpen && (
        <ShareDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title={rfp.name}
          currentShares={shares}
          onShare={async (userIds) => {
            await rfpsApi.shareRfp(rfp.id, userIds);
          }}
          onUnshare={async (userId) => {
            await rfpsApi.unshareRfp(rfp.id, userId);
          }}
          onRefresh={fetchShares}
        />
      )}

      <ConfirmDeleteModal
        open={deleteOpen}
        title={rfp.name}
        entityLabel="RFP"
        consequence={
          documentsTotal > 0
            ? `Its lots, its response and ${documentsTotal} file${documentsTotal === 1 ? '' : 's'} will be deleted too.`
            : 'Its lots and its response will be deleted too.'
        }
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
