import { api } from './client';
import type { DashboardStats } from '../types/dashboard';
import type { ApiResponse } from '../types/api';

export interface NavCounts {
  unreadEmails: number;
  overdueTasks: number;
  expiringDeals: number;
  eventsToday: number;
}

export const dashboardApi = {
  getStats() {
    return api.get<ApiResponse<DashboardStats>>('/dashboard/stats');
  },

  getNavCounts() {
    return api.get<{ data: NavCounts }>('/dashboard/nav-counts');
  },
};
