import { useEffect, useState, useMemo, useCallback } from 'react';
import { Button, Toggle, SkeletonText } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { ArrowLeft, Email as EmailIcon } from '@carbon/icons-react';
import { emailsApi } from '../../../api/emails';
import { ThreadDetail } from '../ThreadDetail';
import { ReviewCustomerGroup } from './ReviewCustomerGroup';
import type { EmailThread, ReviewSummary } from '../../../types/email';
import type { ReviewPeriod } from './ReviewPage';
import { decodeEntities } from '../../../utils/text';

/**
 * Step 3 of the review: the selected companies, each paging its own threads.
 *
 * Nothing is fetched wholesale any more. `getReviewSummary` supplies the
 * authoritative per-company counts for the whole period (thread counts, so they
 * are comparable with the paged list's `meta.total`), and each
 * `ReviewCustomerGroup` asks the server for its own threads — including the
 * unread filter, which is now a server-side `isRead=false` rather than a filter
 * applied to an already-capped page.
 */

const UNCATEGORIZED_KEY = '__uncategorized__';

interface Group {
  key: string;
  customerId: string | null;
  customerName: string;
  customerLogoUrl: string | null;
  isVip: boolean;
  totalThreads: number;
  unreadThreads: number;
}

interface Props {
  period: ReviewPeriod;
  customerIds: string[];
  includeUncategorized: boolean;
  onBack: () => void;
}

export function ReviewMailView({ period, customerIds, includeUncategorized, onBack }: Props) {
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedThread, setSelectedThread] = useState<EmailThread | null>(null);

  const fetchSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await emailsApi.getReviewSummary({
        dateAfter: period.dateAfter,
        dateBefore: period.dateBefore,
      });
      setSummary(data);
    } catch {
      // Counts stay as they were; the groups surface their own load errors.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period.dateAfter, period.dateBefore]);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  const groups = useMemo<Group[]>(() => {
    if (!summary) return [];
    const idSet = new Set(customerIds);
    const rows: Group[] = summary.data
      .filter((c) => idSet.has(c.customerId))
      .map((c) => ({
        key: c.customerId,
        customerId: c.customerId,
        customerName: c.customerName,
        customerLogoUrl: c.customerLogoUrl,
        isVip: c.isVip,
        totalThreads: c.totalThreads,
        unreadThreads: c.unreadThreads,
      }))
      // VIP first, then the busiest. Sorted on the total rather than the unread
      // count so that marking mail read mid-review does not reshuffle the page
      // under the user.
      .sort((a, b) => {
        if (a.isVip !== b.isVip) return a.isVip ? -1 : 1;
        if (b.totalThreads !== a.totalThreads) return b.totalThreads - a.totalThreads;
        return a.customerName.localeCompare(b.customerName);
      });

    if (includeUncategorized && summary.uncategorized.totalThreads > 0) {
      rows.push({
        key: UNCATEGORIZED_KEY,
        customerId: null,
        customerName: 'Uncategorized',
        customerLogoUrl: null,
        isVip: false,
        totalThreads: summary.uncategorized.totalThreads,
        unreadThreads: summary.uncategorized.unreadThreads,
      });
    }
    return rows;
  }, [summary, customerIds, includeUncategorized]);

  const totals = useMemo(
    () =>
      groups.reduce(
        (acc, g) => ({
          threads: acc.threads + g.totalThreads,
          unread: acc.unread + g.unreadThreads,
        }),
        { threads: 0, unread: 0 }
      ),
    [groups]
  );

  const visibleGroups = unreadOnly ? groups.filter((g) => g.unreadThreads > 0) : groups;

  return (
    <div className="review-mail">
      <div className="page-header page-header--padded">
        <div className="page-header__info">
          <Button
            kind="ghost"
            size="sm"
            renderIcon={ArrowLeft}
            onClick={onBack}
            className="review-back-btn"
          >
            Back
          </Button>
          <h1>Review — {period.label}</h1>
          <p className="page-header__subtitle">
            {unreadOnly
              ? `${totals.unread} unread threads`
              : `${totals.threads} threads · ${totals.unread} unread`}
            {' · '}
            {visibleGroups.length} {visibleGroups.length === 1 ? 'company' : 'companies'}
          </p>
        </div>
        <div className="page-header__actions">
          <Toggle
            id="review-unread-toggle"
            size="sm"
            labelText=""
            hideLabel
            labelA="All emails"
            labelB="Unread only"
            toggled={unreadOnly}
            onToggle={(checked: boolean) => setUnreadOnly(checked)}
          />
        </div>
      </div>

      {loading ? (
        <div className="review-mail__skeleton">
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ padding: '1rem' }}>
              <SkeletonText heading width="30%" />
              <SkeletonText paragraph lineCount={3} />
            </div>
          ))}
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="review-customers__empty">
          <EmailIcon size={48} />
          <p>{unreadOnly ? 'No unread emails in this period' : 'No emails found'}</p>
        </div>
      ) : (
        <div className="review-mail__groups">
          {visibleGroups.map((group, index) => (
            <ReviewCustomerGroup
              // Remount on a period change so a group cannot show the previous
              // window's threads while its own fetch is in flight.
              key={`${group.key}|${period.dateAfter}`}
              customerId={group.customerId}
              customerName={group.customerName}
              customerLogoUrl={group.customerLogoUrl}
              isVip={group.isVip}
              totalThreads={group.totalThreads}
              unreadThreads={group.unreadThreads}
              period={period}
              unreadOnly={unreadOnly}
              // The first company opens straight away; the rest wait to be
              // opened, so a 40-company review is one request, not forty.
              defaultExpanded={index === 0}
              selectedThreadId={selectedThread?.threadId ?? null}
              onSelectThread={setSelectedThread}
              onThreadsChanged={() => void fetchSummary(true)}
            />
          ))}
        </div>
      )}

      <SidePanel
        open={!!selectedThread}
        onRequestClose={() => setSelectedThread(null)}
        title={decodeEntities(selectedThread?.latestEmail.subject) || 'Thread'}
        size="lg"
        className="mail-page__side-panel"
      >
        {selectedThread?.threadId && (
          <ThreadDetail
            threadId={selectedThread.threadId}
            onEmailAction={() => void fetchSummary(true)}
          />
        )}
      </SidePanel>
    </div>
  );
}
