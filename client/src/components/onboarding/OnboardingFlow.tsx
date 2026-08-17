import { useState } from 'react';
import type { OnboardingStatus } from '../../types/onboarding';
import { WelcomeInterstitial } from './WelcomeInterstitial';
import { SetupWizard } from './SetupWizard';

interface OnboardingFlowProps {
  status: OnboardingStatus;
  /** Called when the flow ends, by either route. */
  onFinish: (opts: { skipped: boolean }) => void;
}

/**
 * The tour, then the wizard.
 *
 * Extracted so that both entry points share one definition of the sequence: the
 * automatic first-login gate, and the "run it again" button in Settings.
 *
 * Replay is deliberately a UI concern rather than server state. The gate exempts
 * an account that is demonstrably working, so a replay that only cleared the
 * completion flag would be swallowed by that exemption and the button would
 * appear to do nothing — rendering the flow directly is what makes it work for
 * exactly the established accounts most likely to ask for it.
 */
export function OnboardingFlow({ status, onFinish }: OnboardingFlowProps) {
  const [phase, setPhase] = useState<'welcome' | 'wizard'>('welcome');

  return phase === 'welcome' ? (
    <WelcomeInterstitial
      open
      googleConnected={status.steps.googleConnected}
      onStartSetup={() => setPhase('wizard')}
      onSkip={() => onFinish({ skipped: true })}
    />
  ) : (
    <SetupWizard open status={status} onFinish={onFinish} />
  );
}
