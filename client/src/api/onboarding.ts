import { api } from './client';
import type { ApiResponse } from '../types/api';
import type { OnboardingStatus } from '../types/onboarding';

export const onboardingApi = {
  getStatus() {
    return api.get<ApiResponse<OnboardingStatus>>('/onboarding/status');
  },

  /** Creates the starting Kanban columns. No-op when the user already has any. */
  seedTaskStatuses() {
    return api.post<ApiResponse<{ created: number; skipped: boolean }>>('/onboarding/task-statuses');
  },

  /** `skipped` distinguishes "went through it" from "dismissed it" in the audit log. */
  complete(skipped = false) {
    return api.post<ApiResponse<{ completedAt: string; alreadyComplete: boolean }>>(
      '/onboarding/complete',
      { skipped }
    );
  },

  /** Replays the guidance from Settings. Does not undo any configuration. */
  reset() {
    return api.post<ApiResponse<{ completedAt: null }>>('/onboarding/reset');
  },
};
