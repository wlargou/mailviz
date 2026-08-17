import { useEffect, useState } from 'react';
import { Button, InlineNotification, ListItem, Stack, Tag, Tile, UnorderedList } from '@carbon/react';
import { Compass } from '@carbon/icons-react';
import { onboardingApi } from '../../api/onboarding';
import { OnboardingFlow } from '../onboarding/OnboardingFlow';
import { useUIStore } from '../../store/uiStore';
import type { OnboardingBlocker, OnboardingStatus } from '../../types/onboarding';

/**
 * Settings entry for first-run setup: replay the guided tour, and surface any
 * configuration gap that is still open.
 *
 * The gap list is the useful half. Someone who skipped the wizard has a task
 * board with no columns and no way to create a deal, and nothing else in the app
 * says so out loud — an empty board looks the same as a board you have not filled
 * in yet.
 */

const BLOCKER_COPY: Record<OnboardingBlocker, { title: string; detail: string }> = {
  taskStatuses: {
    title: 'Your task board has no columns',
    detail: 'Until at least one column exists, the board cannot hold a task.',
  },
  dealPartners: {
    title: 'You have no deal partners',
    detail: 'Every deal is registered against a partner, so a deal cannot be created without one.',
  },
};

export function OnboardingSettings() {
  const addNotification = useUIStore((state) => state.addNotification);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onboardingApi
      .getStatus()
      .then(({ data }) => {
        if (!cancelled) setStatus(data.data);
      })
      .catch(() => {
        // Nothing actionable — the tile simply stays quiet.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Runs the flow here and now rather than only clearing the server flag.
   *
   * The gate exempts an account that is already working, so a replay that just
   * reset the flag would be swallowed by that exemption — the button would
   * appear to do nothing for precisely the established users who click it. The
   * reset still happens, so the stored state matches what the user is doing.
   */
  async function handleReplay() {
    setReplaying(true);
    try {
      const { data } = await onboardingApi.getStatus();
      setStatus(data.data);
      await onboardingApi.reset();
      setRunning(true);
    } catch {
      addNotification({ kind: 'error', title: 'Could not restart the setup guide' });
    } finally {
      setReplaying(false);
    }
  }

  async function handleFinish() {
    setRunning(false);
    try {
      await onboardingApi.complete(false);
      const { data } = await onboardingApi.getStatus();
      setStatus(data.data);
    } catch {
      // The tile is a summary; a stale count is not worth an error toast.
    }
  }

  return (
    <Tile className="settings-tile">
      <Stack gap={5}>
        <div className="settings-tile__header">
          <div className="settings-tile__icon">
            <Compass size={20} />
          </div>
          <div>
            <h4 className="settings-tile__title">Setup guide</h4>
            <p className="settings-tile__desc">
              Replay the welcome tour and first-time setup. Replaying changes nothing you have
              already configured.
            </p>
          </div>
        </div>

        {status && status.blocking.length > 0 && (
          <Stack gap={3}>
            {status.blocking.map((blocker) => (
              <InlineNotification
                key={blocker}
                kind="warning"
                lowContrast
                hideCloseButton
                title={BLOCKER_COPY[blocker].title}
                subtitle={BLOCKER_COPY[blocker].detail}
              />
            ))}
          </Stack>
        )}

        {status && (
          <UnorderedList className="onboarding-step__list">
            <ListItem>
              Google account{' '}
              <Tag type={status.steps.googleConnected ? 'green' : 'red'} size="sm">
                {status.steps.googleConnected ? 'Connected' : 'Not connected'}
              </Tag>
            </ListItem>
            <ListItem>
              Task board columns{' '}
              <Tag type={status.steps.taskStatusCount > 0 ? 'green' : 'red'} size="sm">
                {status.steps.taskStatusCount}
              </Tag>
            </ListItem>
            <ListItem>
              Deal partners{' '}
              <Tag type={status.steps.dealPartnerCount > 0 ? 'green' : 'red'} size="sm">
                {status.steps.dealPartnerCount}
              </Tag>
            </ListItem>
            <ListItem>
              Email signature{' '}
              <Tag type={status.steps.hasSignature ? 'green' : 'gray'} size="sm">
                {status.steps.hasSignature ? 'Set' : 'Not set'}
              </Tag>
            </ListItem>
          </UnorderedList>
        )}

        <Button kind="tertiary" size="md" onClick={handleReplay} disabled={replaying}>
          {replaying ? 'Starting…' : 'Run the setup guide again'}
        </Button>

        {running && status && <OnboardingFlow status={status} onFinish={handleFinish} />}
      </Stack>
    </Tile>
  );
}
