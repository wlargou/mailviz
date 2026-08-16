import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  InlineNotification,
  Modal,
  Pagination,
  RadioButton,
  RadioButtonGroup,
  SkeletonText,
  Tag,
  Tile,
} from '@carbon/react';
import { Merge } from '@carbon/icons-react';
import { format } from 'date-fns';
import { PageHeader } from '../shared/PageHeader';
import { EmptyState } from '../shared/EmptyState';
import { contactsApi } from '../../api/customers';
import { useUIStore } from '../../store/uiStore';
import type { DuplicateContact, DuplicateGroup } from '../../types/customer';
import type { PaginationMeta } from '../../types/api';

/**
 * Review-and-merge for duplicate contacts.
 *
 * Nothing on this page merges anything on its own. The server proposes groups;
 * the user picks which row survives, ticks the rows to discard, and confirms in
 * a modal that spells out exactly what is kept and what is deleted. A wrong
 * merge cannot be undone, so every step is explicit.
 */

function fullName(contact: DuplicateContact): string {
  return `${contact.firstName} ${contact.lastName}`.trim() || '(no name)';
}

function addressesOf(contact: DuplicateContact): string[] {
  return [contact.email, ...contact.aliasEmails].filter((e): e is string => Boolean(e));
}

interface GroupCardProps {
  group: DuplicateGroup;
  onMerged: () => void;
}

function GroupCard({ group, onMerged }: GroupCardProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const [primaryId, setPrimaryId] = useState(group.suggestedPrimaryId);
  // Tracked as opt-*outs* rather than opt-ins so that changing which row
  // survives cannot leave the previous survivor silently unticked — the default
  // is always "everything except the kept contact", minus what the user
  // deliberately spared.
  const [sparedIds, setSparedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [merging, setMerging] = useState(false);

  const primary = group.contacts.find((c) => c.id === primaryId) ?? group.contacts[0];
  const discarded = group.contacts.filter((c) => c.id !== primary.id && !sparedIds.includes(c.id));

  const toggleDiscard = (id: string, checked: boolean) => {
    setSparedIds((ids) => (checked ? ids.filter((x) => x !== id) : [...new Set([...ids, id])]));
  };

  const confirmMerge = async () => {
    setMerging(true);
    try {
      const { data } = await contactsApi.merge({
        targetId: primary.id,
        sourceIds: discarded.map((c) => c.id),
      });
      addNotification({
        kind: 'success',
        title: `Merged ${discarded.length} contact${discarded.length === 1 ? '' : 's'} into ${fullName(primary)}`,
        subtitle: data.data.aliasEmailsAdded.length
          ? `Kept ${data.data.aliasEmailsAdded.join(', ')} as alternate address${data.data.aliasEmailsAdded.length === 1 ? '' : 'es'}`
          : undefined,
      });
      setConfirmOpen(false);
      onMerged();
    } catch {
      addNotification({ kind: 'error', title: 'Merge failed', subtitle: 'Nothing was changed.' });
    } finally {
      setMerging(false);
    }
  };

  return (
    <Tile className="duplicate-group">
      <div className="duplicate-group__header">
        <div className="duplicate-group__company">
          {group.customer.logoUrl && (
            <img
              src={group.customer.logoUrl}
              alt=""
              className="customer-logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <span>{group.customer.name}</span>
          <Tag type={group.confidence === 'high' ? 'green' : 'teal'} size="sm">
            {group.confidence === 'high' ? 'Same address' : 'Likely the same person'}
          </Tag>
        </div>
        <Button
          kind="danger--tertiary"
          size="sm"
          renderIcon={Merge}
          disabled={discarded.length === 0}
          onClick={() => setConfirmOpen(true)}
        >
          Merge {discarded.length} into selected
        </Button>
      </div>

      <p className="duplicate-group__reason">{group.reasons.join(' · ')}</p>

      <RadioButtonGroup
        legendText="Contact to keep"
        name={`primary-${group.id}`}
        orientation="vertical"
        valueSelected={primaryId}
        onChange={(value) => setPrimaryId(String(value))}
      >
        {group.contacts.map((contact) => (
          <RadioButton
            key={contact.id}
            id={`primary-${group.id}-${contact.id}`}
            value={contact.id}
            labelText={
              <span className="duplicate-contact">
                <span className="duplicate-contact__name">{fullName(contact)}</span>
                <span className="duplicate-contact__emails">{addressesOf(contact).join(', ') || '—'}</span>
                <span className="duplicate-contact__meta">
                  {contact.emailCount} email{contact.emailCount === 1 ? '' : 's'}
                  {contact.role ? ` · ${contact.role}` : ''}
                  {contact.phone ? ` · ${contact.phone}` : ''}
                  {` · added ${format(new Date(contact.createdAt), 'MMM d, yyyy')}`}
                </span>
              </span>
            }
          />
        ))}
      </RadioButtonGroup>

      <fieldset className="duplicate-group__discard">
        <legend>Delete and fold into the kept contact</legend>
        {group.contacts
          .filter((c) => c.id !== primaryId)
          .map((contact) => (
            <Checkbox
              key={contact.id}
              id={`discard-${group.id}-${contact.id}`}
              labelText={`${fullName(contact)} — ${contact.email ?? 'no address'}`}
              checked={!sparedIds.includes(contact.id)}
              onChange={(_event, { checked }) => toggleDiscard(contact.id, checked)}
            />
          ))}
      </fieldset>

      {/* Mounted only while open. Carbon keeps a closed Modal in the DOM, and a
          hidden copy of "this will be deleted" text is worth avoiding on a
          destructive flow — for screen readers and for tests alike. */}
      {confirmOpen && (
      <Modal
        open
        danger
        modalHeading="Merge contacts"
        modalLabel={group.customer.name}
        primaryButtonText={merging ? 'Merging…' : `Merge and delete ${discarded.length}`}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={merging || discarded.length === 0}
        onRequestClose={() => setConfirmOpen(false)}
        onRequestSubmit={confirmMerge}
      >
        <div className="duplicate-confirm">
          <h5>Kept</h5>
          <p className="duplicate-confirm__primary">
            {fullName(primary)} — {primary.email ?? 'no address'}
          </p>
          <h5>Deleted</h5>
          <ul>
            {discarded.map((contact) => (
              <li key={contact.id}>
                {fullName(contact)} — {contact.email ?? 'no address'} ({contact.emailCount} email
                {contact.emailCount === 1 ? '' : 's'})
              </li>
            ))}
          </ul>
          <InlineNotification
            kind="warning"
            lowContrast
            hideCloseButton
            title="This cannot be undone"
            subtitle={
              `The deleted contact rows are removed permanently. Their addresses stay on ` +
              `${fullName(primary)} as alternates, so their mail, events and attachments keep showing up there. ` +
              `Phone, role and VIP are copied over only where the kept contact has nothing.`
            }
          />
        </div>
      </Modal>
      )}
    </Tile>
  );
}

export function ContactDuplicatesPage() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await contactsApi.getDuplicates({
        page: String(page),
        limit: String(pageSize),
      });
      setGroups(data.data);
      setMeta(data.meta || null);
      setFailed(false);
    } catch {
      setFailed(true);
      addNotification({ kind: 'error', title: 'Failed to look for duplicates' });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, addNotification]);

  useEffect(() => {
    fetchDuplicates();
  }, [fetchDuplicates]);

  const subtitle = useMemo(() => {
    if (loading || failed || !meta) return 'Contacts that look like the same person';
    if (meta.total === 0) return 'No duplicates found';
    return `${meta.total} group${meta.total === 1 ? '' : 's'} to review — nothing is merged until you confirm`;
  }, [loading, failed, meta]);

  return (
    <div>
      <PageHeader
        title="Duplicate contacts"
        subtitle={subtitle}
        breadcrumbs={[{ label: 'Contacts', href: '/contacts' }]}
      />

      {loading ? (
        <Tile>
          <SkeletonText heading width="30%" />
          <SkeletonText paragraph lineCount={4} />
        </Tile>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No duplicates found"
          description="Contacts are matched on their email address — same address, the same address written differently, or an abbreviated form of it, with the names agreeing."
        />
      ) : (
        <>
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} onMerged={fetchDuplicates} />
          ))}
          {meta && (meta.totalPages > 1 || pageSize !== 10) && (
            <Pagination
              totalItems={meta.total}
              pageSize={pageSize}
              pageSizes={[10, 20, 50]}
              page={page}
              onChange={({ page: p, pageSize: ps }: { page: number; pageSize: number }) => {
                if (ps !== pageSize) { setPageSize(ps); setPage(1); }
                else setPage(p);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
