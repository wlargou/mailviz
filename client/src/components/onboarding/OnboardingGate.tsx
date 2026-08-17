import { useCallback, useEffect, useState } from 'react';
import { onboardingApi } from '../../api/onboarding';
import type { OnboardingStatus } from '../../types/onboarding';
import { WelcomeInterstitial } from './WelcomeInterstitial';
import { SetupWizard } from './SetupWizard';

type Phase = 'loading' | 'welcome' | 'wizard' | 'done';

/**
 * Decides whether a signed-in user sees first-run onboarding, and sequences the
 * two pieces: the welcome tour, then the setup wizard.
 *
 * Mounted inside the authenticated shell so it can assume a session. It renders
 * nothing at all in the common case — an established account resolves to `done`
 * on the first status call and never mounts either component.
 *
 * Completion is recorded when the flow *ends*, by either route: finishing the
 * wizard or dismissing the tour. Recording it up front would mean a user whose
 * browser crashed mid-setup never saw the flow again; recording it only on the
 * happy path would mean someone who skipped gets asked at every login.
 */
export function OnboardingGate() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    onboardingApi
      .getStatus()
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data.data);
        setPhase(data.data.needsOnboarding ? 'welcome' : 'done');
      })
      .catch(() => {
        // Onboarding is guidance. If the status call fails there is nothing to
        // tell the user about — showing an error for a tour they did not ask for
        // would be worse than staying quiet.
        if (!cancelled) setPhase('done');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback((opts: { skipped: boolean }) => {
    // Close first: the flag is bookkeeping, and the user should not watch a
    // spinner to leave a screen they have finished with.
    setPhase('done');
    onboardingApi.complete(opts.skipped).catch(() => {
      // Worst case the flow appears once more on the next login.
    });
  }, []);

  if (phase === 'loading' || phase === 'done' || !status) return null;

  return phase === 'welcome' ? (
    <WelcomeInterstitial
      open
      googleConnected={status.steps.googleConnected}
      onStartSetup={() => setPhase('wizard')}
      onSkip={() => finish({ skipped: true })}
    />
  ) : (
    <SetupWizard open status={status} onFinish={finish} />
  );
}
