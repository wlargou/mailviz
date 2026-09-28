import { api } from './client';
import type { DashboardStats } from '../types/dashboard';
import type { ApiResponse } from '../types/api';

export interface NavCounts {
  unreadEmails: number;
  overdueTasks: number;
  expiringDeals: number;
  eventsToday: number;
  /** Threads where a person is waiting on the user's reply. */
  repliesOwed: number;
  /** Tenders whose readiness trails the time used. */
  rfpsAtRisk: number;
}

export const dashboardApi = {
  getStats() {
    return api.get<ApiResponse<DashboardStats>>('/dashboard/stats');
  },

  getNavCounts() {
    return api.get<{ data: NavCounts }>('/dashboard/nav-counts');
  },
};
