/** Gaps that make a feature unusable rather than merely empty. */
export type OnboardingBlocker = 'taskStatuses' | 'dealPartners';

export interface OnboardingStatus {
  completedAt: string | null;
  needsOnboarding: boolean;
  /** True when the account is already working, so guidance would be noise. */
  alreadyUpAndRunning: boolean;
  steps: {
    googleConnected: boolean;
    taskStatusCount: number;
    dealPartnerCount: number;
    hasSignature: boolean;
    hasDisplayName: boolean;
    emailCount: number;
  };
  blocking: OnboardingBlocker[];
}
