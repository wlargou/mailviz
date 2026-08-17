import { useState } from 'react';
import { Button, Theme } from '@carbon/react';
import { OnboardingFlow } from '../components/onboarding/OnboardingFlow';
import { onboardingApi } from '../api/onboarding';
import { dealPartnersApi } from '../api/dealPartners';
import { authApi } from '../api/auth';
import { OnboardingSettings } from '../components/settings/OnboardingSettings';
import type { OnboardingStatus } from '../types/onboarding';

/**
 * Development-only harness for looking at the onboarding UI.
 *
 * The app is behind Google OAuth, so every authenticated screen needs a real
 * session to reach. That is correct for the app and useless for checking how a
 * component renders. This route mounts the flow outside the auth guard with
 * fabricated status data so the layout, spacing and theming can be inspected.
 *
 * It proves nothing about integration — no request is made and no data is real.
 * It is only for looking at pixels.
 */

const NEW_ACCOUNT: OnboardingStatus = {
  completedAt: null,
  needsOnboarding: true,
  alreadyUpAndRunning: false,
  steps: {
    googleConnected: true,
    taskStatusCount: 0,
    dealPartnerCount: 0,
    hasSignature: false,
    hasDisplayName: true,
    emailCount: 0,
  },
  blocking: ['taskStatuses', 'dealPartners'],
};

const ESTABLISHED_ACCOUNT: OnboardingStatus = {
  completedAt: null,
  needsOnboarding: false,
  alreadyUpAndRunning: true,
  steps: {
    googleConnected: true,
    taskStatusCount: 3,
    dealPartnerCount: 6,
    hasSignature: true,
    hasDisplayName: true,
    emailCount: 111592,
  },
  blocking: [],
};

/**
 * Replaces the API calls each step makes with resolved promises.
 *
 * Without a session every write 401s, the step guard refuses to advance, and
 * only the first step can be looked at. These modules export plain objects, so
 * the methods can be swapped here — confined to this dev-only file.
 */
function stubApis() {
  onboardingApi.seedTaskStatuses = async () =>
    ({ data: { data: { created: 3, skipped: false } } }) as never;
  onboardingApi.complete = async () => ({ data: { data: {} } }) as never;
  onboardingApi.reset = async () => ({ data: { data: {} } }) as never;
  dealPartnersApi.create = async () => ({ data: { data: {} } }) as never;
  authApi.updateSignature = async () => ({ data: {} }) as never;
}

export function OnboardingPreview() {
  const [theme, setTheme] = useState<'g100' | 'g10'>('g100');
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [showTile, setShowTile] = useState(false);

  document.documentElement.setAttribute('data-carbon-theme', theme);

  return (
    <Theme theme={theme}>
      <div data-carbon-theme={theme} style={{ minHeight: '100vh', padding: '2rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
          <Button size="sm" onClick={() => setTheme(theme === 'g100' ? 'g10' : 'g100')}>
            Theme: {theme}
          </Button>
          <Button
            size="sm"
            kind="secondary"
            onClick={() => {
              stubApis();
              setStatus(NEW_ACCOUNT);
            }}
          >
            New account flow
          </Button>
          <Button size="sm" kind="secondary" onClick={() => setStatus(ESTABLISHED_ACCOUNT)}>
            Established account flow
          </Button>
          <Button size="sm" kind="tertiary" onClick={() => setShowTile(!showTile)}>
            Toggle settings tile
          </Button>
          <Button size="sm" kind="ghost" onClick={() => setStatus(null)}>
            Close flow
          </Button>
        </div>

        {showTile && (
          <div style={{ maxWidth: '40rem' }}>
            <OnboardingSettings />
          </div>
        )}

        {status && <OnboardingFlow status={status} onFinish={() => setStatus(null)} />}
      </div>
    </Theme>
  );
}
